#pragma once
/**
 * Companion attestations — ticket H2-12 (firmware emit side) / S1-14 (gateway ingest).
 *
 * PROTOCOL v1's 90 canonical bytes are frozen, so everything that is NOT T/H/lux —
 * photo hashes, lid verdicts, shock — rides OUTSIDE the record as a companion linked
 * by (dev, seq, digest). Golden vectors stay valid.
 *
 * CAM_PHOTO_V1 companion, canonical 96 bytes for signing:
 *   dev[20] | seq u32 BE | recordDigest[32] | photoHash[32] (keccak256 of the JPEG)
 *   | luxMean u16 BE | lidFlags u8 (bit0 = lid open) | imgBytes u32 BE | reserved u8 (=0)
 * sig = secp256k1_sign(deviceKey, keccak256(companionCanonical)), low-s normalised,
 * exactly like a record signature (same Identity::sign).
 *
 * Wire format (firmware -> gateway), proposed endpoint POST /ingest/companion:
 *   { dev, seq, digest, kind: "CAM_PHOTO_V1", photoHash, luxMean, lidOpen,
 *     imgBytes, w, h, sig }
 * Gateway verification (S1-14): look up record (dev,seq); reject if digest !=
 * recordDigest(record); recompute companion canonical; verifyRecord-style check of
 * sig against dev. No raw photo ever leaves the SD card / goes on-chain.
 *
 * Host-portable: covered by firmware/test/test_swarm on native.
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"

namespace krishi {
namespace companion {

constexpr size_t kCanonicalLength = 96;
constexpr uint8_t kLidOpenBit = 0x01;

namespace offsets {
constexpr size_t kDev = 0;
constexpr size_t kSeq = 20;
constexpr size_t kDigest = 24;
constexpr size_t kPhotoHash = 56;
constexpr size_t kLuxMean = 88;
constexpr size_t kLidFlags = 90;
constexpr size_t kImgBytes = 91;
constexpr size_t kReserved = 95;
}  // namespace offsets

struct CamAttest {
  uint8_t dev[kAddressLength];
  uint32_t seq;
  uint8_t record_digest[kDigestLength];
  uint8_t photo_hash[kDigestLength];
  uint16_t lux_mean;
  bool lid_open;
  uint32_t img_bytes;
  CamAttest() : seq(0), lux_mean(0), lid_open(false), img_bytes(0) {
    for (size_t i = 0; i < kAddressLength; ++i) dev[i] = 0;
    for (size_t i = 0; i < kDigestLength; ++i) record_digest[i] = 0;
    for (size_t i = 0; i < kDigestLength; ++i) photo_hash[i] = 0;
  }
};

inline void put16be(uint8_t*& p, uint16_t v) {
  *p++ = static_cast<uint8_t>(v >> 8);
  *p++ = static_cast<uint8_t>(v);
}

inline void put32be(uint8_t*& p, uint32_t v) {
  *p++ = static_cast<uint8_t>(v >> 24);
  *p++ = static_cast<uint8_t>(v >> 16);
  *p++ = static_cast<uint8_t>(v >> 8);
  *p++ = static_cast<uint8_t>(v);
}

/** Pack the 96 companion-canonical bytes. Returns bytes written, 0 if small. */
inline size_t packCamAttest(const CamAttest& a, uint8_t* out, size_t capacity) {
  if (capacity < kCanonicalLength) return 0;
  uint8_t* p = out;
  for (size_t i = 0; i < kAddressLength; ++i) *p++ = a.dev[i];
  put32be(p, a.seq);
  for (size_t i = 0; i < kDigestLength; ++i) *p++ = a.record_digest[i];
  for (size_t i = 0; i < kDigestLength; ++i) *p++ = a.photo_hash[i];
  put16be(p, a.lux_mean);
  *p++ = a.lid_open ? kLidOpenBit : 0x00;
  put32be(p, a.img_bytes);
  *p++ = 0x00;  // reserved, must be zero
  return static_cast<size_t>(p - out);
}

}  // namespace companion
}  // namespace krishi
