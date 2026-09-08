#include "file_flash_store.h"
#include <string.h>

namespace krishi {

MemoryFlashStore::MemoryFlashStore(size_t sectors, size_t sectorSize)
    : sectors_(sectors), sectorSize_(sectorSize), buffer_(sectors * sectorSize, 0xFF) {}

bool MemoryFlashStore::eraseSector(size_t sector) {
  if (sector >= sectors_) return false;
  memset(buffer_.data() + sector * sectorSize_, 0xFF, sectorSize_);
  return true;
}

void MemoryFlashStore::failNextWriteAfter(size_t bytes) {
  failWriteAfter_ = static_cast<int>(bytes);
}

void MemoryFlashStore::setPowerCutPending(bool pending) {
  powerCutPending_ = pending;
}

bool MemoryFlashStore::write(size_t offset, const uint8_t* data, size_t len) {
  if (offset + len > buffer_.size()) return false;

  size_t bytesToWrite = len;
  bool failMidWrite = false;

  if (failWriteAfter_ >= 0) {
    if (static_cast<size_t>(failWriteAfter_) < len) {
      bytesToWrite = static_cast<size_t>(failWriteAfter_);
      failMidWrite = true;
    }
    failWriteAfter_ = -1;
  }

  for (size_t i = 0; i < bytesToWrite; ++i) {
    // NOR flash bit clearing: 1 bits can be cleared to 0, 0 bits cannot be turned to 1 without erase
    buffer_[offset + i] &= data[i];
  }

  return !failMidWrite;
}

bool MemoryFlashStore::read(size_t offset, uint8_t* out, size_t len) const {
  if (offset + len > buffer_.size()) return false;
  memcpy(out, buffer_.data() + offset, len);
  return true;
}

}  // namespace krishi
