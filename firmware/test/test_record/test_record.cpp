/**
 * Host-side conformance test: the firmware's canonical encoder against the golden vectors.
 *
 *   cd firmware && pio test -e native
 *
 * This runs with no board attached, which is the point — H1 can get the protocol layer
 * exactly right before any hardware exists, and a mismatch with the TypeScript side shows up
 * in seconds instead of at integration gate 1.
 *
 * Ticket H1-03. Definition of done: every vector passes, byte for byte.
 */

#include <ArduinoJson.h>
#include <unity.h>

#include <cstdio>
#include <cstring>
#include <string>

#include "../../lib/krishi/record.h"

using krishi::kCanonicalLength;
using krishi::Record;

namespace {

// pio runs tests from the `firmware/` directory; the fallbacks cover running from the repo
// root or from inside the test directory.
const char* kVectorPaths[] = {
    "../packages/core/fixtures/vectors.json",
    "packages/core/fixtures/vectors.json",
    "../../packages/core/fixtures/vectors.json",
};

JsonDocument doc;

bool loadVectors() {
  for (const char* path : kVectorPaths) {
    FILE* file = fopen(path, "rb");
    if (file == nullptr) continue;

    std::string contents;
    char buffer[4096];
    size_t read = 0;
    while ((read = fread(buffer, 1, sizeof(buffer), file)) > 0) contents.append(buffer, read);
    fclose(file);

    if (deserializeJson(doc, contents) == DeserializationError::Ok) {
      printf("loaded vectors from %s\n", path);
      return true;
    }
  }
  return false;
}

Record hydrate(JsonObjectConst raw) {
  Record record;
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

void test_vectors_loaded() {
  TEST_ASSERT_TRUE_MESSAGE(
      !doc.isNull(),
      "vectors.json not found — run `npm run gen:vectors` at the repo root first (ticket S1-02)");
  TEST_ASSERT_EQUAL(90, doc["canonicalLength"].as<int>());
}

void test_canonical_encoding_matches_every_vector() {
  uint8_t encoded[kCanonicalLength];
  char hex[kCanonicalLength * 2 + 3];

  for (JsonObjectConst vector : doc["records"].as<JsonArrayConst>()) {
    const Record record = hydrate(vector["record"]);

    const size_t written = krishi::encodeRecord(record, encoded, sizeof(encoded));
    TEST_ASSERT_EQUAL_size_t(kCanonicalLength, written);

    krishi::toHex(encoded, kCanonicalLength, hex, sizeof(hex));

    char message[192];
    snprintf(message, sizeof(message), "canonical mismatch on vector '%s'",
             vector["name"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(vector["canonical"].as<const char*>(), hex, message);
  }
}

void test_decode_round_trips_every_vector() {
  uint8_t encoded[kCanonicalLength];
  uint8_t reencoded[kCanonicalLength];

  for (JsonObjectConst vector : doc["records"].as<JsonArrayConst>()) {
    const Record original = hydrate(vector["record"]);
    krishi::encodeRecord(original, encoded, sizeof(encoded));

    Record decoded;
    TEST_ASSERT_TRUE(krishi::decodeRecord(encoded, kCanonicalLength, decoded));

    krishi::encodeRecord(decoded, reencoded, sizeof(reencoded));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(encoded, reencoded, kCanonicalLength);
  }
}

void test_encode_refuses_a_short_buffer() {
  Record record;
  uint8_t small[10];
  TEST_ASSERT_EQUAL_size_t(0, krishi::encodeRecord(record, small, sizeof(small)));
}

void test_decode_refuses_a_wrong_length() {
  uint8_t bytes[kCanonicalLength] = {0};
  Record out;
  TEST_ASSERT_FALSE(krishi::decodeRecord(bytes, kCanonicalLength - 1, out));
}

int main(int, char**) {
  UNITY_BEGIN();
  loadVectors();
  RUN_TEST(test_vectors_loaded);
  RUN_TEST(test_canonical_encoding_matches_every_vector);
  RUN_TEST(test_decode_round_trips_every_vector);
  RUN_TEST(test_encode_refuses_a_short_buffer);
  RUN_TEST(test_decode_refuses_a_wrong_length);
  return UNITY_END();
}
