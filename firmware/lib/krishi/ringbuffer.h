#pragma once
/**
 * Crash-safe flash ring buffer — ticket H1-06.
 *
 * Every record is appended here BEFORE any attempt to transmit.
 *
 * Slot layout (256 bytes, 16 per 4096-byte sector):
 *   [ magic:2 = 0x4B52 | len:2 = 154 | canonical:90 | sig:64 | crc32:4 | state:1 | pad:93 ]
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"
#include "store/flash_store.h"

namespace krishi {

constexpr size_t kSlotSize = 256;
constexpr size_t kSlotsPerSector = 16;  // 4096 / 256
constexpr uint16_t kSlotMagic = 0x4B52;
constexpr uint16_t kSlotPayloadLen = 154;  // 90 canonical + 64 sig

struct BufferStats {
  uint32_t count = 0;
  uint32_t capacity = 0;
  uint32_t oldestSeq = 0;
  uint32_t newestSeq = 0;
  uint32_t tornSlots = 0;
  uint32_t overwritten = 0;
};

class RingBuffer {
 public:
  bool begin(FlashStore& flash);

  bool append(const Record& record, const uint8_t signature[kSignatureLength]);
  bool appendCanonical(const uint8_t canonical[kCanonicalLength], const uint8_t signature[kSignatureLength]);
  size_t peek(Record* records, uint8_t* signatures, size_t max) const;
  size_t peekCanonical(uint8_t* canonicalBlocks, uint8_t* signatures, size_t max) const;
  bool releaseThrough(const uint8_t dev[kAddressLength], uint32_t ackSeq);
  bool isEmpty() const;
  BufferStats stats() const;

 private:
  FlashStore* flash_ = nullptr;
  size_t totalSlots_ = 0;
  size_t head_ = 0;
  size_t tail_ = 0;
  mutable BufferStats stats_{};
};

}  // namespace krishi
