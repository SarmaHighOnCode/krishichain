#include "record.h"
#include "endian.h"

#include <string.h>

namespace krishi {
using namespace endian;

namespace {

inline int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

}  // namespace

size_t encodeRecord(const Record& record, uint8_t* out, size_t capacity) {
  if (capacity < kCanonicalLength) return 0;

  uint8_t* p = out;
  put8(p, record.v);                              // 0
  putBytes(p, record.dev, kAddressLength);        // 1
  put32(p, record.seq);                           // 21
  putBytes(p, record.prev, kDigestLength);        // 25
  put64(p, record.ts);                            // 57
  put8(p, record.tsq);                            // 65
  putBytes(p, record.lot, kLotLength);            // 66
  put16(p, static_cast<uint16_t>(record.t));      // 82
  put16(p, record.h);                             // 84
  put16(p, record.lux);                           // 86
  put8(p, record.flags);                          // 88
  put8(p, record.bat);                            // 89

  return static_cast<size_t>(p - out);  // == kCanonicalLength
}

bool decodeRecord(const uint8_t* in, size_t length, Record& out) {
  if (length != kCanonicalLength) return false;

  const uint8_t* p = in;
  out.v = *p++;
  memcpy(out.dev, p, kAddressLength);
  p += kAddressLength;
  out.seq = get32(p);
  memcpy(out.prev, p, kDigestLength);
  p += kDigestLength;
  out.ts = get64(p);
  out.tsq = *p++;
  memcpy(out.lot, p, kLotLength);
  p += kLotLength;
  out.t = static_cast<int16_t>(get16(p));
  out.h = get16(p);
  out.lux = get16(p);
  out.flags = *p++;
  out.bat = *p++;

  return true;
}

void toHex(const uint8_t* bytes, size_t length, char* out, size_t capacity) {
  static const char kDigits[] = "0123456789abcdef";
  if (capacity < length * 2 + 3) {
    if (capacity > 0) out[0] = '\0';
    return;
  }
  out[0] = '0';
  out[1] = 'x';
  for (size_t i = 0; i < length; ++i) {
    out[2 + i * 2] = kDigits[bytes[i] >> 4];
    out[3 + i * 2] = kDigits[bytes[i] & 0x0F];
  }
  out[2 + length * 2] = '\0';
}

bool fromHex(const char* hex, uint8_t* out, size_t length) {
  if (hex == nullptr) return false;
  if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;

  for (size_t i = 0; i < length; ++i) {
    const int hi = hexValue(hex[i * 2]);
    const int lo = hexValue(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<uint8_t>(hi << 4 | lo);
  }
  return true;
}

}  // namespace krishi
