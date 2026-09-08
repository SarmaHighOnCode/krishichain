/**
 * KrishiChain LEAF Node Firmware
 * ESP-NOW sender + local sensing + ring buffer. Never connects to WiFi AP.
 * See docs/PROTOCOL-LINK.md and docs/adr/0005-espnow-link-protocol.md.
 */

#include <Arduino.h>
#include "roles.h"
#include "pins.h"
#include "record.h"
#include "identity.h"
#include "chain.h"
#include "store/flash_store.h"
#ifndef KRISHI_NATIVE
#include "store/esp_flash_store.h"
#endif
#include "ringbuffer.h"
#include "link/espnow.h"
#include "link/frame.h"
#include "sampling.h"

#ifndef KRISHI_NATIVE
#include <WiFi.h>
#include <Preferences.h>
#endif

using namespace krishi;

static Identity gIdentity;
static NvsKeyStore gKeyStore;
static Chain gChain;
static NvsChainStore gChainStore;
#ifndef KRISHI_NATIVE
static EspFlashStore gFlashStore;
#endif
static RingBuffer gRingBuffer;
static EspNowLink gLink;
static SamplingState gSamplingState;
static SamplingConfig gSamplingCfg;

static uint32_t gLastSampleMs = 0;
static uint32_t gLastSendMs = 0;
static uint32_t gLastHeartbeatMs = 0;
static uint8_t gAckMisses = 0;
static uint8_t gHeadMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool gLinkBound = false;

enum class LedState { kBoot, kOk, kOffline, kBuffering, kBreach, kFault };
static LedState gLedState = LedState::kBoot;

static void updateLed() {
#ifndef KRISHI_NATIVE
  static uint32_t lastToggle = 0;
  static bool pinOn = false;
  uint32_t now = millis();

  uint32_t interval = 1000;
  switch (gLedState) {
    case LedState::kBoot: interval = 100; break;
    case LedState::kOk: interval = 2000; break;
    case LedState::kOffline: interval = 500; break;
    case LedState::kBuffering: interval = 250; break;
    case LedState::kBreach: interval = 50; break;
    case LedState::kFault: interval = 1000; break;
  }

  if (now - lastToggle >= interval) {
    lastToggle = now;
    pinOn = !pinOn;
    digitalWrite(pins::kStatusLed, pinOn ? HIGH : LOW);
  }
#endif
}

static uint8_t readFlagsNow() {
  uint8_t flags = 0;
#ifndef KRISHI_NATIVE
  // Leaf node tamper lid optional/not fitted
#endif
  return flags;
}

static Record readSensors() {
  Record r{};
  r.v = KRISHI_PROTOCOL_VERSION;
  memcpy(r.dev, gIdentity.address(), kAddressLength);
  r.ts = time(nullptr);
  r.tsq = 0; // offline / unsynced clock until timesync
  memset(r.lot, 0, kLotLength);
  r.t = 41;
  r.h = 812;
  r.lux = 0;
  r.flags = readFlagsNow();
  r.bat = 87;
  return r;
}

static void sendRecordsCycle() {
  if (gRingBuffer.isEmpty()) return;

  Record recs[1];
  uint8_t sigs[kSignatureLength];
  size_t count = gRingBuffer.peek(recs, sigs, 1);
  if (count == 0) return;

  RecordFrame rf{};
  encodeRecord(recs[0], rf.canonical, kCanonicalLength);
  memcpy(rf.sig, sigs, kSignatureLength);

  uint8_t frameBuf[kMaxFrameLength];
  size_t len = encodeRecordFrame(rf, frameBuf, sizeof(frameBuf));
  if (len > 0) {
    bool ok = gLink.send(gHeadMac, frameBuf, len);
    if (!ok) {
      gAckMisses++;
      gLedState = LedState::kOffline;
      if (gAckMisses >= kAckMissesBeforeRescan) {
        gLinkBound = gLink.beginLeaf();
        gAckMisses = 0;
      }
    }
  }
}

void setup() {
#ifndef KRISHI_NATIVE
  Serial.begin(115200);
  pinMode(pins::kStatusLed, OUTPUT);

  gIdentity.begin(gKeyStore);
  gChain.begin(gChainStore);
  gFlashStore.sectorSize();
  gRingBuffer.begin(gFlashStore);

  gLinkBound = gLink.beginLeaf();
#endif
  gLedState = LedState::kOk;
}

void loop() {
  // 1. Drain ACKs and Timesync from HEAD
  ReceivedFrame rxFrame;
  while (gLink.pop(rxFrame)) {
    uint8_t type = frameType(rxFrame.data, rxFrame.len);
    if (type == kFrameAck) {
      AckFrame ack;
      if (decodeAckFrame(rxFrame.data, rxFrame.len, ack)) {
        if (memcmp(ack.dev, gIdentity.address(), kAddressLength) == 0) {
          gRingBuffer.releaseThrough(gIdentity.address(), ack.ackSeq);
          gAckMisses = 0;
          gLedState = LedState::kOk;
          memcpy(gHeadMac, rxFrame.mac, 6);
        }
      }
    }
  }

  // 2. Local sensor sampling (durable before transmit)
  uint32_t now = millis();
  uint8_t currentFlags = readFlagsNow();
  if (now - gLastSampleMs >= gSamplingState.intervalMs ||
      requiresImmediateSample(gSamplingState, currentFlags)) {
    Record record = readSensors();
    gChain.stamp(record);
    uint8_t sig[kSignatureLength];
    if (gIdentity.signRecord(record, sig)) {
      if (gRingBuffer.append(record, sig)) {
        uint8_t canonical[kCanonicalLength];
        encodeRecord(record, canonical, sizeof(canonical));
        uint8_t digest[kDigestLength];
        Identity::digest(canonical, sizeof(canonical), digest);
        gChain.advance(digest);
      }
    }
    nextInterval(gSamplingState, record.t, record.flags, gSamplingCfg);
    gLastSampleMs = now;
  }

  // 3. Transmit cycle
  if (now - gLastSendMs >= 1000) {
    sendRecordsCycle();
    gLastSendMs = now;
  }

  // 4. Heartbeat
  if (now - gLastHeartbeatMs >= kHeartbeatIntervalMs) {
    HeartbeatFrame hf{};
    memcpy(hf.dev, gIdentity.address(), kAddressLength);
    hf.lastSeq = gChain.nextSeq() > 0 ? gChain.nextSeq() - 1 : 0;
    hf.bufDepth = static_cast<uint16_t>(gRingBuffer.stats().count);
    hf.bat = 87;
    hf.state = static_cast<uint8_t>(gLedState);
    uint8_t frameBuf[64];
    size_t len = encodeHeartbeatFrame(hf, frameBuf, sizeof(frameBuf));
    gLink.send(gHeadMac, frameBuf, len);
    gLastHeartbeatMs = now;
  }

  updateLed();
}

#ifdef KRISHI_NATIVE
int main() {
  setup();
  for (int i = 0; i < 5; ++i) loop();
  return 0;
}
#endif
