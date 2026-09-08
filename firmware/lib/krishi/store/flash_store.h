#pragma once
#include <stddef.h>
#include <stdint.h>

namespace krishi {

class FlashStore {
 public:
  virtual ~FlashStore() = default;
  virtual size_t sectorSize() const = 0;       // 4096 on ESP32
  virtual size_t sectorCount() const = 0;
  virtual bool eraseSector(size_t sector) = 0;
  virtual bool write(size_t offset, const uint8_t* data, size_t len) = 0;
  virtual bool read(size_t offset, uint8_t* out, size_t len) const = 0;
};

}  // namespace krishi
