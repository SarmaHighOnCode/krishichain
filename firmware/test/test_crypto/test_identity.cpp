#include <unity.h>
#include <cstring>
#include "../../lib/krishi/identity.h"
#include "../vectors_helper.h"

void test_first_boot_generates_and_persists() {
  krishi::MemoryKeyStore store;
  krishi::Identity a;
  TEST_ASSERT_TRUE(a.begin(store));
  TEST_ASSERT_TRUE(a.wasCommissionedThisBoot());

  uint8_t first[20];
  memcpy(first, a.address(), 20);

  krishi::Identity b;  // simulates a reboot
  TEST_ASSERT_TRUE(b.begin(store));
  TEST_ASSERT_FALSE(b.wasCommissionedThisBoot());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(first, b.address(), 20);
}

void test_two_devices_get_different_identities() {
  krishi::MemoryKeyStore s1, s2;
  krishi::Identity a, b;
  TEST_ASSERT_TRUE(a.begin(s1));
  TEST_ASSERT_TRUE(b.begin(s2));
  TEST_ASSERT_FALSE(memcmp(a.address(), b.address(), 20) == 0);
}

void test_sign_record_matches_manual_digest_then_sign() {
  krishi::MemoryKeyStore store;
  krishi::Identity id;
  TEST_ASSERT_TRUE(id.begin(store));

  krishi::Record record{};
  memcpy(record.dev, id.address(), 20);
  record.seq = 7;

  uint8_t canonical[krishi::kCanonicalLength];
  size_t written = krishi::encodeRecord(record, canonical, sizeof(canonical));
  TEST_ASSERT_EQUAL_UINT32(krishi::kCanonicalLength, written);

  uint8_t digest[32], expected[64], actual[64];
  krishi::Identity::digest(canonical, written, digest);
  TEST_ASSERT_TRUE(id.sign(digest, expected));
  TEST_ASSERT_TRUE(id.signRecord(record, actual));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, actual, 64);
}
