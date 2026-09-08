/**
 * KrishiChain LEAF NODE (ESP32-S2 Lolin) — ticket H2-11.
 *
 * SYNTH MODE: no sensors wired (no DHT/LDR on the bench). T/H/lux are
 * synthesized with the same curve as scripts/sim-node.ts (4C wobble, breach
 * climb on demand), so the LEAF's chain/ESP-NOW/failover story is fully
 * demoable with zero hardware. The phone PWA is the authoritative live
 * source in the demo; this node proves a second signer in the lot.
 *
 * Prefers ESP-NOW broadcast to the HEAD; falls back to WiFi-direct
 * POST /ingest when the HEAD goes silent (LeafLink, lib/krishi/failover.h).
 * S2 is single-core, no BT — never HEAD.
 *
 * Loop (ARCHITECTURE §2.1a, ADR-0004):
 *   synth sensors → stamp chain → encode → digest → sign → append to flash FIRST
 *   → if ESP-NOW: broadcast frame → if WiFi: drain via Uplink/ackSeq
 *
 * Channel discipline: the whole swarm lives on krishi::swarm::kChannel. WiFi
 * begins on that channel too — a LEAF on channel 6 never hears a HEAD on 1.
 *
 * NO WIRING. Only the onboard LED + BOOT button are touched.
 */

#include <Arduino.h>

#ifdef ARDUINO_ARCH_ESP32
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#endif

#include "chain.h"
#include "companion.h"
#include "failover.h"
#include "identity.h"
#include "pins.h"
#include "record.h"
#include "ringbuffer.h"
#include "store/esp_flash_store.h"
#include "swarm.h"
#include "uplink.h"

namespace {

krishi::Identity identity;
krishi::Chain chain;
krishi::EspFlashStore flash_store;
krishi::RingBuffer buffer;
krishi::Uplink uplink;
krishi::LeafLink leaf_link;

bool synth_breach = false;  // serial `HEAT` starts the climb, `COOL` ends it
uint32_t synth_seq = 0;

volatile bool heartbeat_pending = false;
uint8_t heartbeat_buf[krishi::swarm::kHeartbeatLength];
volatile size_t heartbeat_len = 0;
uint32_t last_ack_seq = 0;
volatile bool ack_for_us = false;

bool boot_flag_pending = true;
uint32_t last_sample_ms = 0;

#ifdef ARDUINO_ARCH_ESP32
void onHeartbeatRecv(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (len != static_cast<int>(sizeof(heartbeat_buf))) return;
  for (size_t i = 0; i < sizeof(heartbeat_buf); ++i) heartbeat_buf[i] = data[i];
  heartbeat_len = sizeof(heartbeat_buf);
  heartbeat_pending = true;
}
#endif

krishi::Record readSensors() {
  krishi::Record record;
  memcpy(record.dev, identity.address(), krishi::kAddressLength);

  // SYNTH (bench reality: no DHT/LDR wired). Same curve as sim-node.ts:
  // 4.0C ± 0.4 wobble; HEAT climbs ~0.22C/record up to 28C for the breach beat.
  int16_t temp = static_cast<int16_t>(40 + (static_cast<int>(synth_seq * 37) % 9) - 4);
  if (synth_breach && synth_seq > 20) {
    int32_t climb = temp + static_cast<int32_t>((synth_seq - 20) * 22) / 10;
    temp = static_cast<int16_t>(climb > 280 ? 280 : climb);
  }
  record.t = temp;
  record.h = static_cast<uint16_t>(800 + (synth_seq % 40));
  record.lux = synth_breach && synth_seq > 20 ? 420 : 0;  // lid-open proxy with heat
  if (synth_breach && synth_seq > 20) record.flags |= krishi::kFlagLidOpen;
  record.bat = static_cast<uint8_t>(synth_seq > 800 ? 20 : 100 - synth_seq / 10);
  ++synth_seq;

  record.ts = 0;  // TODO(H1-08): NTP. tsq stays UNSYNCED until first sync.
  record.tsq = krishi::kTimeUnsynced;

  if (boot_flag_pending) {
    record.flags |= krishi::kFlagBoot;
    boot_flag_pending = false;
  }
  return record;
}

bool captureAndStore(uint8_t canonical[krishi::kCanonicalLength],
                     uint8_t signature[krishi::kSignatureLength]) {
  krishi::Record record = readSensors();
  chain.stamp(record);
  if (krishi::encodeRecord(record, canonical, krishi::kCanonicalLength) !=
      krishi::kCanonicalLength) {
    return false;
  }
  uint8_t digest[krishi::kDigestLength];
  krishi::Identity::digest(canonical, krishi::kCanonicalLength, digest);
  if (!identity.sign(digest, signature)) return false;
  if (!buffer.append(record, signature)) {
    Serial.println("WARN: ring buffer append failed");
    return false;
  }
  chain.advance(digest);
  Serial.printf("leaf seq=%u t=%d.%dC h=%u.%u%% lux=%u flags=0x%02x mode=%s buf=%u\n", record.seq,
                record.t / 10, abs(record.t % 10), record.h / 10, record.h % 10, record.lux,
                record.flags, leaf_link.mode() == krishi::LeafLink::kEspNow ? "espnow" : "wifi",
                buffer.stats().count);
  return true;
}

void drainViaEspNow(const uint8_t* canonical, const uint8_t* signature) {
#ifdef ARDUINO_ARCH_ESP32
  uint8_t frame[krishi::swarm::kRecordFrameLength];
  size_t n = krishi::swarm::packRecordFrame(canonical, signature, frame, sizeof(frame));
  if (n > 0) esp_now_send(krishi::swarm::kBroadcastMac, frame, n);
#else
  (void)canonical;
  (void)signature;
#endif
}

void drainViaWifi() {
  if (!uplink.isOnline() || buffer.isEmpty()) return;
  constexpr size_t kDrainMax = 8;
  uint8_t canonicals[kDrainMax * krishi::kCanonicalLength];
  uint8_t sigs[kDrainMax * krishi::kSignatureLength];
  size_t count = buffer.peekCanonical(canonicals, sigs, kDrainMax);
  if (count == 0) return;
  krishi::Record probe;
  if (!krishi::decodeRecord(canonicals, krishi::kCanonicalLength, probe)) return;
  krishi::UplinkResponse resp = uplink.sendBatch(canonicals, sigs, count, probe.dev);
  if (resp.result == krishi::UplinkResult::kOk) {
    buffer.releaseThrough(probe.dev, resp.ackSeq);
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
#ifdef ARDUINO_ARCH_ESP32
  // S2 native USB: wait briefly so the commissioning line is not lost.
  for (int i = 0; i < 20 && !Serial; ++i) delay(100);
#endif
  pinMode(krishi::pins::kStatusLed, OUTPUT);
  pinMode(krishi::pins::kLotButton, INPUT_PULLUP);

  Serial.println();
  Serial.println("KrishiChain LEAF node (S2, synth — no sensors wired)");

  if (!identity.begin()) {
    Serial.println("FATAL: identity unavailable");
    return;
  }
  char address_hex[krishi::kAddressLength * 2 + 3];
  krishi::toHex(identity.address(), krishi::kAddressLength, address_hex, sizeof(address_hex));
  Serial.printf("device address: %s\n", address_hex);
  if (identity.wasCommissionedThisBoot()) {
    Serial.println("*** NEWLY COMMISSIONED — register this address on-chain:");
    Serial.printf("    npm run device:register -- --address %s --class LEAF_V1\n", address_hex);
  }

  chain.begin();
  flash_store.sectorSize();  // init partition check
  buffer.begin(flash_store);

#ifdef ARDUINO_ARCH_ESP32
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  esp_wifi_set_channel(krishi::swarm::kChannel, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() == ESP_OK) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, krishi::swarm::kBroadcastMac, 6);
    peer.channel = krishi::swarm::kChannel;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
    esp_now_register_recv_cb(
        [](const uint8_t* mac, const uint8_t* data, int len) { onHeartbeatRecv(mac, data, len); });
    Serial.printf("esp-now on channel %d\n", krishi::swarm::kChannel);
  } else {
    Serial.println("WARN: esp_now_init failed — starting WiFi-direct");
  }
  // WiFi-direct fallback uses the same channel so ESP-NOW keeps working.
  // TODO(H2-11 bench): fill real SSID via serial `WIFI <ssid> <pass>`.
  WiFi.begin("krishichain", "krishichain");
#endif

  uplink.begin("http://192.168.1.50:8080");
  last_sample_ms = millis();
}

void loop() {
  // Bench controls over serial: HEAT starts the breach climb, COOL ends it.
  // The button forces an immediate sample so the beat lands on cue.
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "HEAT") {
      synth_breach = true;
      Serial.println("synth breach ON");
    } else if (cmd == "COOL") {
      synth_breach = false;
      Serial.println("synth breach OFF");
    }
  }
  bool force_sample = digitalRead(krishi::pins::kLotButton) == LOW;
#ifdef ARDUINO_ARCH_ESP32
  if (heartbeat_pending) {
    heartbeat_pending = false;
    krishi::swarm::Heartbeat hb;
    if (krishi::swarm::parseHeartbeat(heartbeat_buf, heartbeat_len, hb)) {
      leaf_link.markBeatSeen();
      leaf_link.onHeartbeat(millis(), hb);
      uint8_t self[krishi::kAddressLength];
      memcpy(self, identity.address(), sizeof(self));
      if (memcmp(hb.ack_dev, self, sizeof(self)) == 0) {
        last_ack_seq = hb.ack_seq;
        ack_for_us = true;
      }
    }
  }
#endif
  leaf_link.poll(millis());

  if (ack_for_us) {
    ack_for_us = false;
    // releaseThrough is per-device (a HEAD relays for many devices and must say which
    // one); a LEAF only ever releases its own records.
    buffer.releaseThrough(identity.address(), last_ack_seq);
  }

  uint32_t interval = leaf_link.sampleIntervalMs();
  if (!force_sample && millis() - last_sample_ms < interval) {
    delay(50);
    return;
  }
  last_sample_ms = millis();

  uint8_t canonical[krishi::kCanonicalLength];
  uint8_t signature[krishi::kSignatureLength];
  if (!captureAndStore(canonical, signature)) {
    digitalWrite(krishi::pins::kStatusLed, LOW);
    return;
  }

  if (leaf_link.mode() == krishi::LeafLink::kEspNow) {
    drainViaEspNow(canonical, signature);
    digitalWrite(krishi::pins::kStatusLed, HIGH);
  } else {
    drainViaWifi();
    // Slow blink while WiFi-direct: visible failover without serial.
    digitalWrite(krishi::pins::kStatusLed, (millis() / 500) % 2 == 0 ? HIGH : LOW);
  }
}
