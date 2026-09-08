#include <unity.h>
#include <cstring>
#include "../../lib/krishi/store/file_flash_store.h"
#include "../../lib/krishi/ringbuffer.h"

void test_append_then_peek_returns_the_record() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  TEST_ASSERT_TRUE(buffer.begin(flash));
  TEST_ASSERT_TRUE(buffer.isEmpty());

  krishi::Record record{};
  record.v = 1;
  record.seq = 1;
  record.t = 41;
  uint8_t sig[64];
  memset(sig, 0xAB, sizeof(sig));
  TEST_ASSERT_TRUE(buffer.append(record, sig));

  krishi::Record out[4];
  uint8_t sigs[4 * 64];
  TEST_ASSERT_EQUAL_size_t(1, buffer.peek(out, sigs, 4));
  TEST_ASSERT_EQUAL_UINT32(1, out[0].seq);
  TEST_ASSERT_EQUAL_INT16(41, out[0].t);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(sig, sigs, 64);
}

void test_peek_does_not_consume() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  buffer.begin(flash);

  for (int i = 0; i < 3; ++i) {
    krishi::Record record{};
    record.v = 1;
    record.seq = i;
    uint8_t sig[64] = {0};
    buffer.append(record, sig);
  }

  krishi::Record out1[4], out2[4];
  uint8_t sigs1[4 * 64], sigs2[4 * 64];
  TEST_ASSERT_EQUAL_size_t(3, buffer.peek(out1, sigs1, 4));
  TEST_ASSERT_EQUAL_size_t(3, buffer.peek(out2, sigs2, 4));
}

void test_release_through_advances_the_tail() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  buffer.begin(flash);

  uint8_t dev[20];
  memset(dev, 0xAA, 20);

  for (int i = 0; i < 10; ++i) {
    krishi::Record record{};
    record.v = 1;
    memcpy(record.dev, dev, 20);
    record.seq = i;
    uint8_t sig[64] = {0};
    buffer.append(record, sig);
  }

  buffer.releaseThrough(dev, 4);

  krishi::Record out[10];
  uint8_t sigs[10 * 64];
  size_t count = buffer.peek(out, sigs, 10);
  TEST_ASSERT_EQUAL_size_t(5, count);
  TEST_ASSERT_EQUAL_UINT32(5, out[0].seq);
}

void test_recovery_after_reopen_finds_every_record() {
  krishi::MemoryFlashStore flash(8);
  {
    krishi::RingBuffer buffer;
    buffer.begin(flash);
    for (int i = 0; i < 20; ++i) {
      krishi::Record record{};
      record.v = 1;
      record.seq = i;
      uint8_t sig[64] = {0};
      buffer.append(record, sig);
    }
  }

  krishi::RingBuffer recovered;
  TEST_ASSERT_TRUE(recovered.begin(flash));
  TEST_ASSERT_EQUAL_UINT32(20, recovered.stats().count);
}

void test_torn_write_is_skipped_not_fatal() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  buffer.begin(flash);

  krishi::Record record{};
  record.v = 1;
  uint8_t sig[64] = {0};
  for (int i = 0; i < 5; ++i) {
    record.seq = i;
    buffer.append(record, sig);
  }

  flash.failNextWriteAfter(80); // power cut 80 bytes into slot 5
  record.seq = 5;
  buffer.append(record, sig);

  krishi::RingBuffer recovered;
  TEST_ASSERT_TRUE(recovered.begin(flash));
  TEST_ASSERT_EQUAL_UINT32(5, recovered.stats().count);
  TEST_ASSERT_EQUAL_UINT32(1, recovered.stats().tornSlots);
}

void test_wraparound_overwrites_oldest_and_counts_it() {
  krishi::MemoryFlashStore flash(2); // 2 sectors = 32 slots
  krishi::RingBuffer buffer;
  buffer.begin(flash);

  krishi::Record record{};
  record.v = 1;
  uint8_t sig[64] = {0};

  for (int i = 0; i < 40; ++i) {
    record.seq = i;
    buffer.append(record, sig);
  }

  // Sector erase granularity: erasing sector 0 destroys all 16 records (seq 0-15).
  // After 40 appends: sector 1 has seq 16-31 (16), sector 0 has seq 32-39 (8).
  // Total live = 24, overwritten = 16, oldest surviving = seq 16.
  TEST_ASSERT_EQUAL_UINT32(24, buffer.stats().count);
  TEST_ASSERT_EQUAL_UINT32(16, buffer.stats().overwritten);
  TEST_ASSERT_EQUAL_UINT32(16, buffer.stats().oldestSeq);
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_append_then_peek_returns_the_record);
  RUN_TEST(test_peek_does_not_consume);
  RUN_TEST(test_release_through_advances_the_tail);
  RUN_TEST(test_recovery_after_reopen_finds_every_record);
  RUN_TEST(test_torn_write_is_skipped_not_fatal);
  RUN_TEST(test_wraparound_overwrites_oldest_and_counts_it);
  return UNITY_END();
}
