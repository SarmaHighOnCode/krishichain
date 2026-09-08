/**
 * KrishiChain TRANSIT NODE — sealed into the cold box with the lot.
 *
 * This node carries the demo (docs/HARDWARE.md §1). It runs mostly offline, which is the
 * normal condition for a rural cold chain, and its job is to make an offline period into a
 * *verified run* rather than a hole in the evidence.
 *
 * Loop, in this exact order (ARCHITECTURE §2.1):
 *
 *     read sensors → stamp chain → canonical encode → keccak256 → sign
 *       → append to flash ring buffer      (ALWAYS, before any transmit attempt)
 *       → if online: drain oldest-first, advance tail only on ackSeq
 *
 * Writing to flash first is what makes the "pull the WiFi" demo work. Do not reorder it into
 * a send-then-buffer-on-failure shape, however much more natural that reads.
 *
 * Tickets: H1-02 identity · H1-05 chain · H1-06 buffer · H1-07/08 uplink · H1-09 sensors
 *          H1-10 tamper · H1-12 LED states
 */

#include <Arduino.h>

#include "chain.h"
#include "identity.h"
#include "pins.h"
#include "record.h"
#include "ringbuffer.h"
#include "uplink.h"

namespace {

krishi::Identity identity;
krishi::Chain chain;
krishi::RingBuffer buffer;
krishi::Uplink uplink;

bool boot_flag_pending = true;

/** Visible state, readable from two metres across a demo table (FW-12). */
enum class NodeState { kBoot, kOk, kOffline, kBuffering, kBreach, kFault };
NodeState state = NodeState::kBoot;

void setLed(NodeState next) {
  state = next;
  // TODO(H1-12): distinct blink patterns per state. A judge reads the LED before the screen.
  digitalWrite(krishi::pins::kStatusLed, next == NodeState::kOk ? HIGH : LOW);
}

krishi::Record readSensors() {
  krishi::Record record;
  memcpy(record.dev, identity.address(), krishi::kAddressLength);

  // TODO(H1-09): real DHT22 read. Respect the 2 s minimum interval; on failure emit the
  // sentinel and set kFlagSensorFault — never fabricate a plausible reading.
  record.t = krishi::kSensorFaultTemp;
  record.h = krishi::kSensorFaultHumidity;
  record.flags |= krishi::kFlagSensorFault;

  // TODO(H1-10): LDR + reed. Lid open inside a sealed box is the tamper signal.
  record.lux = 0;

  // TODO(H1-08): NTP sync sets ts and tsq. Until the first sync, tsq MUST stay kTimeUnsynced —
  // we never present a guessed timestamp as fact (PRD §3).
  record.ts = 0;
  record.tsq = krishi::kTimeUnsynced;

  if (boot_flag_pending) {
    record.flags |= krishi::kFlagBoot;
    boot_flag_pending = false;
  }
  return record;
}

void captureAndStore() {
  krishi::Record record = readSensors();
  chain.stamp(record);

  uint8_t canonical[krishi::kCanonicalLength];
  if (krishi::encodeRecord(record, canonical, sizeof(canonical)) != krishi::kCanonicalLength) {
    setLed(NodeState::kFault);
    return;
  }

  uint8_t digest[krishi::kDigestLength];
  krishi::Identity::digest(canonical, sizeof(canonical), digest);

  uint8_t signature[krishi::kSignatureLength];
  if (!identity.sign(digest, signature)) {
    setLed(NodeState::kFault);
    return;
  }

  // Durable first. Chain state advances only after the record is safely on flash, so a power
  // cut between the two replays one record instead of losing one.
  if (!buffer.append(record, signature)) {
    setLed(NodeState::kFault);
    return;
  }
  chain.advance(digest);
}

void drainBuffer() {
  if (buffer.isEmpty()) return;

  if (!uplink.isOnline()) {
    setLed(NodeState::kBuffering);
    return;
  }

  // TODO(H1-08): peek up to 100, send, and release only through the returned ackSeq.
  // On kUnauthorised, stop uploading entirely and show the fault state — the device is not
  // registered in DeviceRegistry and retrying forever helps nobody.
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(krishi::pins::kStatusLed, OUTPUT);
  pinMode(krishi::pins::kReedSwitch, INPUT_PULLUP);
  setLed(NodeState::kBoot);

  Serial.println();
  Serial.println("KrishiChain transit node");

  if (!identity.begin()) {
    Serial.println("FATAL: identity unavailable");
    setLed(NodeState::kFault);
    return;
  }

  char address_hex[krishi::kAddressLength * 2 + 3];
  krishi::toHex(identity.address(), krishi::kAddressLength, address_hex, sizeof(address_hex));
  Serial.printf("device address: %s\n", address_hex);

  if (identity.wasCommissionedThisBoot()) {
    Serial.println("*** NEWLY COMMISSIONED — register this address on-chain:");
    Serial.printf("    npm run device:register -- --address %s --class TRANSIT_V1\n", address_hex);
  }

  chain.begin();
  buffer.begin();
  uplink.begin("http://192.168.1.50:8080");  // TODO(H1-13): configurable over serial

  const krishi::BufferStats stats = buffer.stats();
  Serial.printf("buffer: %u/%u records, next seq %u, %u torn slots recovered\n", stats.count,
                stats.capacity, chain.nextSeq(), stats.torn_slots);

  setLed(NodeState::kOk);
}

void loop() {
  captureAndStore();
  drainBuffer();
  delay(KRISHI_SAMPLE_INTERVAL_MS);
}
