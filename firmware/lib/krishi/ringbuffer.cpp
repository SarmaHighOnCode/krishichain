#include "ringbuffer.h"
#include <string.h>

namespace krishi {

namespace {

static uint32_t calculateCrc32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (int j = 0; j < 8; ++j) {
      crc = (crc >> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc;
}

}  // namespace

bool RingBuffer::begin(FlashStore& flash) {
  flash_ = &flash;
  totalSlots_ = flash_->sectorCount() * kSlotsPerSector;
  if (totalSlots_ == 0) return false;

  stats_ = BufferStats{};
  stats_.capacity = static_cast<uint32_t>(totalSlots_);

  size_t validSlots = 0;
  uint32_t minSeq = UINT32_MAX, maxSeq = 0;
  size_t minSeqSlot = 0, maxSeqSlot = 0;

  for (size_t slot = 0; slot < totalSlots_; ++slot) {
    uint8_t slotBuf[kSlotSize];
    if (!flash_->read(slot * kSlotSize, slotBuf, kSlotSize)) continue;

    uint16_t magic = (static_cast<uint16_t>(slotBuf[0]) << 8) | slotBuf[1];
    uint16_t len = (static_cast<uint16_t>(slotBuf[2]) << 8) | slotBuf[3];
    uint32_t storedCrc = (static_cast<uint32_t>(slotBuf[158]) << 24) |
                         (static_cast<uint32_t>(slotBuf[159]) << 16) |
                         (static_cast<uint32_t>(slotBuf[160]) << 8) |
                         slotBuf[161];

    if (magic == kSlotMagic && len == kSlotPayloadLen) {
      uint32_t actualCrc = calculateCrc32(slotBuf + 2, 156);
      if (actualCrc == storedCrc) {
        Record r;
        bool decoded = decodeRecord(slotBuf + 4, kCanonicalLength, r);

        if (slotBuf[162] == 0xFF) {
          validSlots++;
          if (decoded) {
            if (r.seq < minSeq) { minSeq = r.seq; minSeqSlot = slot; }
            if (r.seq >= maxSeq) { maxSeq = r.seq; maxSeqSlot = slot; }
          }
        }
        // Also track maxSeqSlot across released slots to place head correctly
        if (decoded && r.seq >= maxSeq) {
          maxSeq = r.seq;
          maxSeqSlot = slot;
        }
      } else {
        stats_.tornSlots++;
      }
    } else {
      bool nonFF = false;
      for (size_t b = 0; b < kSlotSize; ++b) {
        if (slotBuf[b] != 0xFF) { nonFF = true; break; }
      }
      if (nonFF) stats_.tornSlots++;
    }
  }

  if (validSlots > 0) {
    tail_ = minSeqSlot;
    head_ = (maxSeqSlot + 1) % totalSlots_;
    stats_.oldestSeq = minSeq;
    stats_.newestSeq = maxSeq;
  } else {
    tail_ = 0;
    head_ = 0;
  }

  stats_.count = static_cast<uint32_t>(validSlots);
  return true;
}

bool RingBuffer::append(const Record& record, const uint8_t signature[kSignatureLength]) {
  if (flash_ == nullptr || totalSlots_ == 0) return false;

  size_t targetSlot = head_;
  size_t targetSector = targetSlot / kSlotsPerSector;

  if (targetSlot % kSlotsPerSector == 0) {
    size_t sectorStart = targetSector * kSlotsPerSector;
    size_t sectorEnd = sectorStart + kSlotsPerSector;
    uint32_t validInSector = 0;

    for (size_t s = 0; s < kSlotsPerSector; ++s) {
      size_t checkSlot = sectorStart + s;
      uint8_t sBuf[kSlotSize];
      if (flash_->read(checkSlot * kSlotSize, sBuf, kSlotSize)) {
        uint16_t magic = (static_cast<uint16_t>(sBuf[0]) << 8) | sBuf[1];
        uint8_t state = sBuf[162];
        if (magic == kSlotMagic && state == 0xFF) {
          validInSector++;
        }
      }
    }

    flash_->eraseSector(targetSector);

    if (validInSector > 0) {
      stats_.overwritten += validInSector;
      if (stats_.count >= validInSector)
        stats_.count -= validInSector;
      else
        stats_.count = 0;

      // If the tail was inside the erased sector, advance it past
      if (tail_ >= sectorStart && tail_ < sectorEnd) {
        tail_ = sectorEnd % totalSlots_;
        // Re-derive oldestSeq from the new tail
        for (size_t scan = 0; scan < totalSlots_; ++scan) {
          size_t idx = (tail_ + scan) % totalSlots_;
          uint8_t tBuf[kSlotSize];
          if (flash_->read(idx * kSlotSize, tBuf, kSlotSize)) {
            uint16_t m = (static_cast<uint16_t>(tBuf[0]) << 8) | tBuf[1];
            if (m == kSlotMagic && tBuf[162] == 0xFF) {
              Record r;
              if (decodeRecord(tBuf + 4, kCanonicalLength, r)) {
                stats_.oldestSeq = r.seq;
                tail_ = idx;
              }
              break;
            }
          }
        }
      }
    }
  }

  uint8_t slotBuf[kSlotSize];
  memset(slotBuf, 0xFF, sizeof(slotBuf));

  slotBuf[2] = (kSlotPayloadLen >> 8) & 0xFF;
  slotBuf[3] = kSlotPayloadLen & 0xFF;

  encodeRecord(record, slotBuf + 4, kCanonicalLength);
  memcpy(slotBuf + 94, signature, kSignatureLength);

  uint32_t crc = calculateCrc32(slotBuf + 2, 156);
  slotBuf[158] = (crc >> 24) & 0xFF;
  slotBuf[159] = (crc >> 16) & 0xFF;
  slotBuf[160] = (crc >> 8) & 0xFF;
  slotBuf[161] = crc & 0xFF;

  slotBuf[162] = 0xFF;

  size_t offset = targetSlot * kSlotSize;
  if (!flash_->write(offset + 2, slotBuf + 2, kSlotSize - 2)) return false;

  uint8_t magicBuf[2] = {static_cast<uint8_t>((kSlotMagic >> 8) & 0xFF),
                         static_cast<uint8_t>(kSlotMagic & 0xFF)};
  if (!flash_->write(offset, magicBuf, 2)) return false;

  head_ = (head_ + 1) % totalSlots_;
  if (stats_.count == 0) stats_.oldestSeq = record.seq;
  stats_.newestSeq = record.seq;
  if (stats_.count < stats_.capacity) stats_.count++;

  return true;
}

bool RingBuffer::appendCanonical(const uint8_t canonical[kCanonicalLength], const uint8_t signature[kSignatureLength]) {
  Record r;
  if (!decodeRecord(canonical, kCanonicalLength, r)) return false;
  return append(r, signature);
}

size_t RingBuffer::peek(Record* records, uint8_t* signatures, size_t max) const {
  if (flash_ == nullptr || stats_.count == 0 || max == 0) return 0;

  size_t readCount = 0;
  size_t curr = tail_;
  size_t checked = 0;

  while (readCount < max && checked < totalSlots_) {
    uint8_t slotBuf[kSlotSize];
    if (!flash_->read(curr * kSlotSize, slotBuf, kSlotSize)) break;

    uint16_t magic = (static_cast<uint16_t>(slotBuf[0]) << 8) | slotBuf[1];
    uint8_t state = slotBuf[162];

    if (magic == kSlotMagic && state == 0xFF) {
      if (decodeRecord(slotBuf + 4, kCanonicalLength, records[readCount])) {
        memcpy(signatures + readCount * kSignatureLength, slotBuf + 94, kSignatureLength);
        readCount++;
      }
    }
    curr = (curr + 1) % totalSlots_;
    checked++;
  }

  return readCount;
}

size_t RingBuffer::peekCanonical(uint8_t* canonicalBlocks, uint8_t* signatures, size_t max) const {
  if (flash_ == nullptr || stats_.count == 0 || max == 0) return 0;

  size_t readCount = 0;
  size_t curr = tail_;
  size_t checked = 0;

  while (readCount < max && checked < totalSlots_) {
    uint8_t slotBuf[kSlotSize];
    if (!flash_->read(curr * kSlotSize, slotBuf, kSlotSize)) break;

    uint16_t magic = (static_cast<uint16_t>(slotBuf[0]) << 8) | slotBuf[1];
    uint8_t state = slotBuf[162];

    if (magic == kSlotMagic && state == 0xFF) {
      memcpy(canonicalBlocks + readCount * kCanonicalLength, slotBuf + 4, kCanonicalLength);
      memcpy(signatures + readCount * kSignatureLength, slotBuf + 94, kSignatureLength);
      readCount++;
    }
    curr = (curr + 1) % totalSlots_;
    checked++;
  }

  return readCount;
}

bool RingBuffer::releaseThrough(const uint8_t dev[kAddressLength], uint32_t ackSeq) {
  if (flash_ == nullptr || stats_.count == 0) return false;

  size_t curr = tail_;
  size_t checked = 0;

  while (checked < totalSlots_) {
    uint8_t slotBuf[kSlotSize];
    if (flash_->read(curr * kSlotSize, slotBuf, kSlotSize)) {
      uint16_t magic = (static_cast<uint16_t>(slotBuf[0]) << 8) | slotBuf[1];
      uint8_t state = slotBuf[162];
      if (magic == kSlotMagic && state == 0xFF) {
        Record r;
        if (decodeRecord(slotBuf + 4, kCanonicalLength, r)) {
          if (memcmp(r.dev, dev, kAddressLength) == 0 && r.seq <= ackSeq) {
            uint8_t stateZero = 0x00;
            flash_->write(curr * kSlotSize + 162, &stateZero, 1);
          }
        }
      }
    }
    curr = (curr + 1) % totalSlots_;
    checked++;
  }

  while (stats_.count > 0) {
    uint8_t slotBuf[kSlotSize];
    if (!flash_->read(tail_ * kSlotSize, slotBuf, kSlotSize)) break;
    uint16_t magic = (static_cast<uint16_t>(slotBuf[0]) << 8) | slotBuf[1];
    uint8_t state = slotBuf[162];
    if (magic == kSlotMagic && state == 0x00) {
      tail_ = (tail_ + 1) % totalSlots_;
      stats_.count--;
    } else {
      break;
    }
  }

  return true;
}

bool RingBuffer::isEmpty() const { return stats_.count == 0; }
BufferStats RingBuffer::stats() const { return stats_; }

}  // namespace krishi
