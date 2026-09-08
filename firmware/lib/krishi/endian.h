#pragma once
/**
 * Big-endian serialization utilities for KrishiChain protocol and frame codecs.
 *
 * Explicit big-endian read/write functions. Do NOT replace these with struct memcpy:
 * the ESP32 is little-endian, canonical/frame form is big-endian, and struct layout is not portable.
 */

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace krishi {
namespace endian {

inline void put8(uint8_t*& p, uint8_t value) { *p++ = value; }

inline void put16(uint8_t*& p, uint16_t value) {
  *p++ = static_cast<uint8_t>(value >> 8);
  *p++ = static_cast<uint8_t>(value);
}

inline void put32(uint8_t*& p, uint32_t value) {
  *p++ = static_cast<uint8_t>(value >> 24);
  *p++ = static_cast<uint8_t>(value >> 16);
  *p++ = static_cast<uint8_t>(value >> 8);
  *p++ = static_cast<uint8_t>(value);
}

inline void put64(uint8_t*& p, uint64_t value) {
  for (int shift = 56; shift >= 0; shift -= 8) {
    *p++ = static_cast<uint8_t>(value >> shift);
  }
}

inline void putBytes(uint8_t*& p, const uint8_t* src, size_t length) {
  memcpy(p, src, length);
  p += length;
}

inline uint16_t get16(const uint8_t*& p) {
  uint16_t value = static_cast<uint16_t>(p[0]) << 8 | p[1];
  p += 2;
  return value;
}

inline uint32_t get32(const uint8_t*& p) {
  uint32_t value = static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 |
                   static_cast<uint32_t>(p[2]) << 8 | static_cast<uint32_t>(p[3]);
  p += 4;
  return value;
}

inline uint64_t get64(const uint8_t*& p) {
  uint64_t value = 0;
  for (int i = 0; i < 8; ++i) value = (value << 8) | *p++;
  return value;
}

}  // namespace endian
}  // namespace krishi
