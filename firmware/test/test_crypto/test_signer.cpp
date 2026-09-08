#include <unity.h>
#include <cstring>
#include <uECC.h>
#include "../../lib/krishi/crypto/signer.h"
#include "../vectors_helper.h"

static const char* kTestKeyHex =
    "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";

void test_address_matches_vectors() {
  TEST_ASSERT_TRUE_MESSAGE(loadVectors(), "Failed to load vectors.json");
  uint8_t priv[32], pub[65], addr[20], expected[20];
  hexToBytes(kTestKeyHex, priv, 32);
  TEST_ASSERT_TRUE(krishi::derivePublicKey(priv, pub));
  TEST_ASSERT_TRUE(krishi::deriveAddress(pub, addr));
  hexToBytes(vectorsDeviceAddress(), expected, 20);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, addr, 20);
}

void test_public_key_is_uncompressed() {
  uint8_t priv[32], pub[65];
  hexToBytes(kTestKeyHex, priv, 32);
  TEST_ASSERT_TRUE(krishi::derivePublicKey(priv, pub));
  TEST_ASSERT_EQUAL_UINT8(0x04, pub[0]);
}

void test_every_signature_is_low_s() {
  uint8_t priv[32], digest[32], sig[64];
  hexToBytes(kTestKeyHex, priv, 32);
  for (int i = 0; i < 32; ++i) {
    for (int b = 0; b < 32; ++b) digest[b] = static_cast<uint8_t>(i * 31 + b);
    TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, sig));
    TEST_ASSERT_TRUE_MESSAGE(krishi::isLowS(sig), "signer emitted a high-s signature");
  }
}

void test_signing_is_deterministic() {
  uint8_t priv[32], digest[32], a[64], b[64];
  hexToBytes(kTestKeyHex, priv, 32);
  for (int i = 0; i < 32; ++i) digest[i] = static_cast<uint8_t>(i);
  TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, a));
  TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, b));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(a, b, 64);
}

void test_signature_verifies_with_uecc() {
  TEST_ASSERT_TRUE_MESSAGE(loadVectors(), "Failed to load vectors.json");
  uint8_t priv[32], pub[65];
  hexToBytes(kTestKeyHex, priv, 32);
  TEST_ASSERT_TRUE(krishi::derivePublicKey(priv, pub));

  JsonArrayConst records = vectorsDoc()["records"].as<JsonArrayConst>();
  for (JsonObjectConst entry : records) {
    uint8_t digest[32], sig[64];
    hexToBytes(entry["digest"].as<const char*>(), digest, 32);
    TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, sig));
    int verified = uECC_verify(pub + 1, digest, 32, sig, uECC_secp256k1());
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, verified, "uECC_verify failed for signed digest");
  }
}
