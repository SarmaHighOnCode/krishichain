#include <unity.h>
#include <cstring>
#include "../../lib/krishi/chain.h"
#include "../../lib/krishi/crypto/keccak256.h"
#include "../vectors_helper.h"

void setUp(void) {}
void tearDown(void) {}

void test_genesis_has_zero_seq_and_zero_prev() {
  krishi::MemoryChainStore store;
  krishi::Chain chain;
  chain.begin(store);

  krishi::Record record;
  chain.stamp(record);
  uint8_t zeros[32] = {0};
  TEST_ASSERT_EQUAL_UINT32(0, record.seq);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zeros, record.prev, 32);
}

void test_run_reproduces_golden_chain() {
  krishi::MemoryChainStore store;
  krishi::Chain chain;
  chain.begin(store);

  for (JsonObjectConst entry : vectorsChainRun()) {
    krishi::Record record = hydrate(entry["record"]);

    krishi::Record stamped = record;
    chain.stamp(stamped);
    TEST_ASSERT_EQUAL_UINT32(record.seq, stamped.seq);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(record.prev, stamped.prev, 32);

    uint8_t canonical[krishi::kCanonicalLength], digest[32], expected[32];
    krishi::encodeRecord(stamped, canonical, sizeof(canonical));
    keccak256(canonical, sizeof(canonical), digest);

    hexToBytes(entry["digest"].as<const char*>(), expected, 32);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, digest, 32);

    TEST_ASSERT_TRUE(chain.advance(digest));
  }
}

void test_reboot_resumes_at_the_right_seq() {
  krishi::MemoryChainStore store;
  {
    krishi::Chain chain;
    chain.begin(store);
    for (int i = 0; i < 5; ++i) {
      uint8_t digest[32];
      memset(digest, i, 32);
      chain.advance(digest);
    }
  }
  krishi::Chain resumed;
  resumed.begin(store);
  uint8_t last[32];
  memset(last, 4, 32);
  TEST_ASSERT_EQUAL_UINT32(5, resumed.nextSeq());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(last, resumed.prevDigest(), 32);
}

int main(int, char**) {
  UNITY_BEGIN();
  loadVectors();
  RUN_TEST(test_genesis_has_zero_seq_and_zero_prev);
  RUN_TEST(test_run_reproduces_golden_chain);
  RUN_TEST(test_reboot_resumes_at_the_right_seq);
  return UNITY_END();
}
