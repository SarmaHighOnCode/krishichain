#pragma once
#ifndef KRISHI_NATIVE
#include "flash_store.h"
#include <esp_partition.h>

namespace krishi {

class EspFlashStore : public FlashStore {
 public:
  EspFlashStore() {
    part_ = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, static_cast<esp_partition_subtype_t>(0x40), "krishibuf");
  }

  size_t sectorSize() const override { return 4096; }
  size_t sectorCount() const override {
    return part_ != nullptr ? part_->size / 4096 : 0;
  }

  bool eraseSector(size_t sector) override {
    if (part_ == nullptr || sector >= sectorCount()) return false;
    return esp_partition_erase_range(part_, sector * 4096, 4096) == ESP_OK;
  }

  bool write(size_t offset, const uint8_t* data, size_t len) override {
    if (part_ == nullptr || offset + len > part_->size) return false;
    return esp_partition_write(part_, offset, data, len) == ESP_OK;
  }

  bool read(size_t offset, uint8_t* out, size_t len) const override {
    if (part_ == nullptr || offset + len > part_->size) return false;
    return esp_partition_read(part_, offset, out, len) == ESP_OK;
  }

 private:
  const esp_partition_t* part_ = nullptr;
};

}  // namespace krishi
#endif
