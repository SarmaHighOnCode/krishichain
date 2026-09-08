/**
 * KrishiChain LEAF NODE (ESP32-S2 Lolin) — ticket H2-11.
 *
 * Dense cheap sensing: DHT22 T/H + LDR light. Prefers ESP-NOW broadcast to the
 * HEAD; falls back to WiFi-direct POST /ingest when the HEAD goes silent
 * (LeafLink, lib/krishi/failover.h). S2 is single-core, no BT — never HEAD.
 *
 * Loop (ARCHITECTURE §2.1a, ADR-0004):
 *   read sensors → stamp chain → encode → digest → sign → append to flash FIRST
 *   → if link==ESP-NOW: broadcast frame → if link==WiFi: drain via Uplink/ackSeq
 *
 * Channel discipline: the whole swarm lives on krishi::swarm::kChannel. WiFi
 * begins on that channel too — a LEAF on channel 6 never hears a HEAD on 1.
 */

#include <Arduino.h>

#ifdef ARDUINO_ARCH_ESP32
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#endif

#include <DHT.h>

#include "chain.h"
#include "companion.h"
#include "failover.h"
#include "identity.h"
#include "pins.h"
#include "record.h"
#include "ringbuffer.h"
#include "swarm.h"
#include "uplink.h"

namespace {

krishi::Identity identity;
krishi::Chain chain;
krishi::RingBuffer buffer;
krishi::Uplink uplink;
krishi::LeafLink leaf_link;

DHT dht(krishi::pins::kDhtData, DHT22);

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

  // TODO(H1-09): move behind the shared sensor layer. Direct reads here so H2
  // can bench the S2 wiring without waiting on the abstraction.
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) {
    record.t = krishi::kSensorFaultTemp;
    record.h = krishi::kSensorFaultHumidity;
    record.flags |= krishi::kFlagSensorFault;
  } else {
    record.t = static_cast<int16_t>(temp * 10);
    record.h = static_cast<uint16_t>(hum * 10);
  }

  // LDR divider on ADC1 (S2 ADC is usable with WiFi on, unlike classic ADC2).
  int raw = analogRead(krishi::pins::kLdr);
  record.lux = static_cast<uint16_t>(raw);

  if (krishi::pins::kHasBatterySense) {
    int batt = analogRead(krishi::pins::kBatterySense);
    // 100k/100k divider, 13-bit ADC, 3.3V ref: rough percent over 3.0–4.2V.
    float volts = (batt / 8191.0f) * 3.3f * 2.0f;
    record.bat = volts >= 4.15f ? 100 : volts <= 3.0f ? 0
                                 : static_cast<uint8_t>((volts - 3.0f) / 1.2f * 100.0f);
  } else {
    record.bat = krishi::kBatteryMains;
  }

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
  if (!buffer.append(record, signature)) return false;
  chain.advance(digest);
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
  // TODO(H1-07/08): peek up to 100, send, releaseThrough(ackSeq). Same contract
  // as the transit node; the Uplink impl lands with H1.
  (void)uplink;
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
  dht.begin();

  Serial.println();
  Serial.println("KrishiChain LEAF node (S2)");

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
  buffer.begin();

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
    buffer.releaseThrough(last_ack_seq);
  }

  uint32_t interval = leaf_link.sampleIntervalMs();
  if (millis() - last_sample_ms < interval) {
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
