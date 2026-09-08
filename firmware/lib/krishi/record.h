#pragma once
/**
 * Canonical record encoding — the C++ half of the contract with packages/core/src/record.ts.
 *
 * docs/PROTOCOL.md §1.3 defines the 90 bytes. Both implementations are refereed by
 * packages/core/fixtures/vectors.json. If this disagrees with a vector, THIS is wrong.
 *
 * No dynamic allocation anywhere in this path: the encode path runs every sampling interval
 * on a device that must not fragment its heap over a three-day journey.
 */

#include <stddef.h>
#include <stdint.h>

namespace krishi {

constexpr uint8_t kProtocolVersion = KRISHI_PROTOCOL_VERSION;
constexpr size_t kCanonicalLength = 90;
constexpr size_t kAddressLength = 20;
constexpr size_t kDigestLength = 32;
constexpr size_t kLotLength = 16;
constexpr size_t kSignatureLength = 64;

/** Flag bits. Mirrors `Flags` in packages/core/src/types.ts. Bit 7 is reserved. */
enum Flags : uint8_t {
  kFlagLidOpen = 1 << 0,
  kFlagShock = 1 << 1,
  kFlagSensorFault = 1 << 2,
  kFlagBuffered = 1 << 3,
  kFlagBoot = 1 << 4,
  kFlagLotBound = 1 << 5,
  kFlagCal = 1 << 6,
};

/** Time quality. A device that never reached NTP still records — and says so. */
enum TimeQuality : uint8_t {
  kTimeUnsynced = 0,
  kTimeStale = 1,
  kTimeFresh = 2,
};

/** Sentinels. Never fabricate a plausible reading in place of a failed one. */
constexpr int16_t kSensorFaultTemp = INT16_MIN;
constexpr uint16_t kSensorFaultHumidity = 0xFFFF;
constexpr uint8_t kBatteryMains = 0xFF;

/**
 * One observation.
 *
 * Field order here is documentation only — encode() writes the canonical order explicitly
 * rather than memcpy-ing the struct, because struct padding and endianness are exactly the
 * kind of thing that differs between a host test build and an ESP32 build.
 */
struct Record {
  uint8_t v = kProtocolVersion;
  uint8_t dev[kAddressLength] = {0};
  uint32_t seq = 0;
  uint8_t prev[kDigestLength] = {0};
  uint64_t ts = 0;
  uint8_t tsq = kTimeUnsynced;
  uint8_t lot[kLotLength] = {0};
  int16_t t = 0;
  uint16_t h = 0;
  uint16_t lux = 0;
  uint8_t flags = 0;
  uint8_t bat = kBatteryMains;
};

/**
 * Write the canonical 90 bytes of `record` into `out`.
 * @return kCanonicalLength on success, 0 if `capacity` is too small.
 */
size_t encodeRecord(const Record& record, uint8_t* out, size_t capacity);

/** Parse canonical bytes back into a Record. Returns false on a wrong-length input. */
bool decodeRecord(const uint8_t* in, size_t length, Record& out);

/** Lowercase hex, with a leading "0x". `out` needs 2*length + 3 bytes. */
void toHex(const uint8_t* bytes, size_t length, char* out, size_t capacity);

/** Parse hex (with or without "0x") into `out`. Returns false on malformed input. */
bool fromHex(const char* hex, uint8_t* out, size_t length);

}  // namespace krishi
