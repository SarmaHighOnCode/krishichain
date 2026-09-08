/**
 * KrishiChain HEAD Node Firmware
 * WiFi STA + ESP-NOW receiver + local sensing + ring buffer + gateway uplink.
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
#include "heartbeat.h"
#include "sampling.h"
#include "uplink.h"

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
static HeartbeatTracker gTracker;
static Uplink gUplink;
static SamplingState gSamplingState;
static SamplingConfig gSamplingCfg;

static uint32_t gLastSampleMs = 0;
static uint32_t gLastUplinkMs = 0;
static uint32_t gLastBeaconMs = 0;
static uint32_t gLastHeartbeatMs = 0;
static char gGatewayUrl[128] = "http://192.168.1.100:3000/api/ingest";
static uint8_t gLotId[16] = {0};

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
  if (digitalRead(pins::kReedSwitch) == HIGH) flags |= kFlagLidOpen;
#endif
  return flags;
}

static Record readSensors() {
  Record r{};
  r.v = KRISHI_PROTOCOL_VERSION;
  memcpy(r.dev, gIdentity.address(), kAddressLength);
  r.ts = time(nullptr);
  r.tsq = 2; // NTP sync quality
  memcpy(r.lot, gLotId, kLotLength);
  r.t = 41; // 4.1 C mock / DS18B20
  r.h = 812; // 81.2 % mock
  r.lux = 0;
  r.flags = readFlagsNow();
  r.bat = 255; // mains powered
  return r;
}

static void runUplinkCycle() {
  if (gRingBuffer.isEmpty()) return;

  uint8_t canonicals[kMaxUplinkBatch * kCanonicalLength];
  uint8_t sigs[kMaxUplinkBatch * kSignatureLength];
  size_t count = gRingBuffer.peekCanonical(canonicals, sigs, kMaxUplinkBatch);
  if (count == 0) return;

  Record records[kMaxUplinkBatch];
  for (size_t i = 0; i < count; ++i) {
    decodeRecord(canonicals + i * kCanonicalLength, kCanonicalLength, records[i]);
  }

  size_t runStarts[8], runLengths[8];
  size_t runs = groupByDevice(records, count, runStarts, runLengths, 8);

  for (size_t r = 0; r < runs; ++r) {
    size_t start = runStarts[r];
    size_t len = runLengths[r];
    const uint8_t* dev = records[start].dev;

    UplinkResponse resp = gUplink.sendBatch(canonicals + start * kCanonicalLength, sigs + start * kSignatureLength, len, dev);
    if (resp.result == UplinkResult::kOk) {
      gRingBuffer.releaseThrough(dev, resp.ackSeq);
      gLedState = LedState::kOk;
      if (memcmp(dev, gIdentity.address(), kAddressLength) != 0) {
        AckFrame ack{};
        memcpy(ack.dev, dev, kAddressLength);
        ack.ackSeq = resp.ackSeq;
        ack.serverTs = resp.serverTs;
        uint8_t frameBuf[64];
        size_t frameLen = encodeAckFrame(ack, frameBuf, sizeof(frameBuf));
        gLink.broadcast(frameBuf, frameLen);
      }
    } else if (resp.result == UplinkResult::kUnauthorised) {
      gLedState = LedState::kFault;
    } else {
      gLedState = LedState::kOffline;
    }
  }
}

static void handleSerialCli() {
#ifndef KRISHI_NATIVE
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.startsWith("WIFI ")) {
    int sp = line.indexOf(' ', 5);
    if (sp > 5) {
      String ssid = line.substring(5, sp);
      String pass = line.substring(sp + 1);
      Preferences p; p.begin("krishi_cfg", false);
      p.putString("ssid", ssid); p.putString("pass", pass); p.end();
      Serial.println("OK: WiFi updated, restart required");
    }
  } else if (line.startsWith("GW ")) {
    String url = line.substring(3);
    strncpy(gGatewayUrl, url.c_str(), sizeof(gGatewayUrl) - 1);
    Preferences p; p.begin("krishi_cfg", false);
    p.putString("gw", gGatewayUrl); p.end();
    Serial.println("OK: Gateway URL updated");
  } else if (line.equals("STATUS")) {
    BufferStats s = gRingBuffer.stats();
    Serial.printf("STATUS: count=%u cap=%u torn=%u overwrit=%u\n",
                  s.count, s.capacity, s.tornSlots, s.overwritten);
  }
#endif
}

void setup() {
#ifndef KRISHI_NATIVE
  Serial.begin(115200);
  pinMode(pins::kStatusLed, OUTPUT);
  pinMode(pins::kReedSwitch, INPUT_PULLUP);

  Preferences cfg;
  cfg.begin("krishi_cfg", true);
  String ssid = cfg.getString("ssid", "KrishiGateway");
  String pass = cfg.getString("pass", "krishipass");
  String gw = cfg.getString("gw", gGatewayUrl);
  strncpy(gGatewayUrl, gw.c_str(), sizeof(gGatewayUrl) - 1);
  cfg.end();

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  gIdentity.begin(gKeyStore);
  gChain.begin(gChainStore);
  gFlashStore.sectorSize(); // init partition check
  gRingBuffer.begin(gFlashStore);

  gLink.beginHead(WiFi.channel());
  gUplink.begin(gGatewayUrl);

  if (gIdentity.wasCommissionedThisBoot()) {
    char addrHex[43];
    toHex(gIdentity.address(), kAddressLength, addrHex, sizeof(addrHex));
    Serial.printf("COMMISSIONED ADDRESS: %s\n", addrHex);
  }
#endif
  gLedState = LedState::kOk;
}

void loop() {
  handleSerialCli();

  // 1. Radio queue drain
  ReceivedFrame rxFrame;
  while (gLink.pop(rxFrame)) {
    uint8_t type = frameType(rxFrame.data, rxFrame.len);
    if (type == kFrameRecord) {
      RecordFrame rf;
      if (decodeRecordFrame(rxFrame.data, rxFrame.len, rf)) {
        gRingBuffer.appendCanonical(rf.canonical, rf.sig);
      }
    } else if (type == kFrameHeartbeat) {
      HeartbeatFrame hf;
      if (decodeHeartbeatFrame(rxFrame.data, rxFrame.len, hf)) {
        gTracker.observe(hf, millis());
      }
    }
  }

  // 2. Sensor sampling
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

  // 3. Uplink cycle
  if (now - gLastUplinkMs >= 5000) {
    runUplinkCycle();
    gLastUplinkMs = now;
  }

  // 4. Beacon
  if (now - gLastBeaconMs >= kBeaconIntervalMs) {
    BeaconFrame bf{};
    memcpy(bf.headDev, gIdentity.address(), kAddressLength);
    bf.channel = gLink.channel();
    bf.uptimeS = now / 1000;
    uint8_t frameBuf[64];
    size_t frameLen = encodeBeaconFrame(bf, frameBuf, sizeof(frameBuf));
    gLink.broadcast(frameBuf, frameLen);
    gLastBeaconMs = now;
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
