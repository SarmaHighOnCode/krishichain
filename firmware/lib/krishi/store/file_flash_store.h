#pragma once
#include <vector>
#include "flash_store.h"

namespace krishi {

class MemoryFlashStore : public FlashStore {
 public:
  explicit MemoryFlashStore(size_t sectors = 16, size_t sectorSize = 4096);

  size_t sectorSize() const override { return sectorSize_; }
  size_t sectorCount() const override { return sectors_; }

  bool eraseSector(size_t sector) override;
  bool write(size_t offset, const uint8_t* data, size_t len) override;
  bool read(size_t offset, uint8_t* out, size_t len) const override;

  void failNextWriteAfter(size_t bytes);
  void setPowerCutPending(bool pending);

 private:
  size_t sectors_;
  size_t sectorSize_;
  std::vector<uint8_t> buffer_;
  int failWriteAfter_ = -1;
  bool powerCutPending_ = false;
};

}  // namespace krishi
