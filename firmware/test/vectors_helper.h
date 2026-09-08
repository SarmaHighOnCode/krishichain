#pragma once

#include <ArduinoJson.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "../../lib/krishi/record.h"

namespace {

const char* kVectorPaths[] = {
    "../packages/core/fixtures/vectors.json",
    "packages/core/fixtures/vectors.json",
    "../../packages/core/fixtures/vectors.json",
    "../../../packages/core/fixtures/vectors.json",
};

inline void hexToBytes(const char* hex, uint8_t* out, size_t len) {
  if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
  for (size_t i = 0; i < len; ++i) {
    auto nib = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return 0;
    };
    out[i] = static_cast<uint8_t>((nib(hex[i * 2]) << 4) | nib(hex[i * 2 + 1]));
  }
}

static JsonDocument gVectorsDoc;
static bool gVectorsLoaded = false;

inline bool loadVectors() {
  if (gVectorsLoaded) return true;
  for (const char* path : kVectorPaths) {
    FILE* file = fopen(path, "rb");
    if (file == nullptr) continue;

    std::string contents;
    char buffer[4096];
    size_t readBytes = 0;
    while ((readBytes = fread(buffer, 1, sizeof(buffer), file)) > 0) {
      contents.append(buffer, readBytes);
    }
    fclose(file);

    if (deserializeJson(gVectorsDoc, contents) == DeserializationError::Ok) {
      gVectorsLoaded = true;
      return true;
    }
  }
  return false;
}

inline const JsonDocument& vectorsDoc() {
  loadVectors();
  return gVectorsDoc;
}

inline const char* vectorsDeviceAddress() {
  loadVectors();
  return gVectorsDoc["testDeviceAddress"].as<const char*>();
}

inline const char* vectorsPrivateKey() {
  loadVectors();
  return gVectorsDoc["testPrivateKey"].as<const char*>();
}

inline JsonArrayConst vectorsChainRun() {
  loadVectors();
  return gVectorsDoc["chain"]["run"].as<JsonArrayConst>();
}

inline krishi::Record hydrate(JsonObjectConst raw) {
  krishi::Record record;
  record.v = raw["v"].as<uint8_t>();
  krishi::fromHex(raw["dev"].as<const char*>(), record.dev, krishi::kAddressLength);
  record.seq = raw["seq"].as<uint32_t>();
  krishi::fromHex(raw["prev"].as<const char*>(), record.prev, krishi::kDigestLength);
  record.ts = strtoull(raw["ts"].as<const char*>(), nullptr, 10);
  record.tsq = raw["tsq"].as<uint8_t>();
  krishi::fromHex(raw["lot"].as<const char*>(), record.lot, krishi::kLotLength);
  record.t = raw["t"].as<int16_t>();
  record.h = raw["h"].as<uint16_t>();
  record.lux = raw["lux"].as<uint16_t>();
  record.flags = raw["flags"].as<uint8_t>();
  record.bat = raw["bat"].as<uint8_t>();
  return record;
}

}  // namespace
