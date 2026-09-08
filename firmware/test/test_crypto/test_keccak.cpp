#include <unity.h>
#include <cstring>
#include "../../lib/krishi/crypto/keccak256.h"
#include "../../lib/krishi/record.h"
#include "../vectors_helper.h"

void test_keccak_empty_input() {
  uint8_t out[32];
  uint8_t expected[32];
  hexToBytes("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", expected, 32);
  keccak256(nullptr, 0, out);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 32);
}

void test_keccak_abc() {
  uint8_t out[32];
  uint8_t expected[32];
  hexToBytes("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45", expected, 32);
  keccak256(reinterpret_cast<const uint8_t*>("abc"), 3, out);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 32);
}

void test_keccak_200_bytes() {
  uint8_t input[200];
  for (size_t i = 0; i < sizeof(input); ++i) input[i] = static_cast<uint8_t>(i);
  uint8_t out[32];
  keccak256(input, sizeof(input), out);
  uint8_t zero[32] = {0};
  TEST_ASSERT_FALSE(memcmp(out, zero, 32) == 0);
}

void test_keccak_golden_vectors() {
  TEST_ASSERT_TRUE_MESSAGE(loadVectors(), "Failed to load vectors.json");
  JsonArrayConst records = vectorsDoc()["records"].as<JsonArrayConst>();
  for (JsonObjectConst entry : records) {
    krishi::Record record = hydrate(entry["record"]);
    uint8_t canonical[krishi::kCanonicalLength];
    size_t written = krishi::encodeRecord(record, canonical, sizeof(canonical));
    TEST_ASSERT_EQUAL_UINT32(krishi::kCanonicalLength, written);

    uint8_t digest[32];
    keccak256(canonical, written, digest);

    uint8_t expectedDigest[32];
    hexToBytes(entry["digest"].as<const char*>(), expectedDigest, 32);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expectedDigest, digest, 32);
  }
}
