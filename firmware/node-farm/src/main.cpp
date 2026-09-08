/**
 * KrishiChain FARM NODE — crate at the farm gate and in the pre-cool shed.
 *
 * Same protocol stack as the transit node; different sensors, and it is usually online.
 * Its distinctive job is LOT COMMISSIONING: binding a physical crate (RFID tag or QR) to a
 * lot id, so every subsequent record from either node carries that lot.
 *
 * Shares everything in lib/krishi with node-transit. Keep divergence to this file — if you
 * find yourself copying protocol logic across, it belongs in the library instead.
 *
 * Tickets: H1-02 identity · H1-05 chain · H1-06 buffer · H1-09 sensors · H1-11 lot binding
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

uint8_t current_lot[krishi::kLotLength] = {0};
bool lot_bound = false;
bool boot_flag_pending = true;

/**
 * Bind a crate to a lot (FW-11). Triggered by the BOOT button, an RFID tap, or a serial
 * `LOT <hex>` command. The binding record carries kFlagLotBound so an auditor can see
 * exactly when — and by which device — the physical crate entered the system.
 */
void bindLot(const uint8_t lot[krishi::kLotLength]) {
  memcpy(current_lot, lot, krishi::kLotLength);
  lot_bound = true;
  // TODO(H1-11): emit an immediate record with kFlagLotBound rather than waiting for the
  // next sampling tick — the demo beat depends on the tap producing visible feedback.
}

krishi::Record readSensors() {
  krishi::Record record;
  memcpy(record.dev, identity.address(), krishi::kAddressLength);
  if (lot_bound) memcpy(record.lot, current_lot, krishi::kLotLength);

  // TODO(H1-09): DHT22 + optional capacitive soil moisture on ADC1 (GPIO 34).
  record.t = krishi::kSensorFaultTemp;
  record.h = krishi::kSensorFaultHumidity;
  record.flags |= krishi::kFlagSensorFault;

  record.ts = 0;
  record.tsq = krishi::kTimeUnsynced;
  record.bat = krishi::kBatteryMains;  // farm node runs on USB

  if (boot_flag_pending) {
    record.flags |= krishi::kFlagBoot;
    boot_flag_pending = false;
  }
  return record;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(krishi::pins::kStatusLed, OUTPUT);
  pinMode(krishi::pins::kLotButton, INPUT_PULLUP);

  Serial.println();
  Serial.println("KrishiChain farm node");

  if (!identity.begin()) {
    Serial.println("FATAL: identity unavailable");
    return;
  }

  char address_hex[krishi::kAddressLength * 2 + 3];
  krishi::toHex(identity.address(), krishi::kAddressLength, address_hex, sizeof(address_hex));
  Serial.printf("device address: %s\n", address_hex);

  if (identity.wasCommissionedThisBoot()) {
    Serial.println("*** NEWLY COMMISSIONED — register this address on-chain:");
    Serial.printf("    npm run device:register -- --address %s --class FARM_V1\n", address_hex);
  }

  chain.begin();
  buffer.begin();
  uplink.begin("http://192.168.1.50:8080");
}

void loop() {
  krishi::Record record = readSensors();
  chain.stamp(record);

  uint8_t canonical[krishi::kCanonicalLength];
  krishi::encodeRecord(record, canonical, sizeof(canonical));

  uint8_t digest[krishi::kDigestLength];
  krishi::Identity::digest(canonical, sizeof(canonical), digest);

  uint8_t signature[krishi::kSignatureLength];
  if (identity.sign(digest, signature) && buffer.append(record, signature)) {
    chain.advance(digest);
  }

  // TODO(H1-08): drain the buffer when online, releasing only through ackSeq.
  // TODO(H1-11): poll the lot button / RFID reader and call bindLot().
  (void)bindLot;

  delay(KRISHI_SAMPLE_INTERVAL_MS);
}
