#include <unity.h>
#include <cstdlib>
#include <cstring>
#include "../../lib/krishi/store/file_flash_store.h"
#include "../../lib/krishi/ringbuffer.h"

void test_100_random_power_cuts_never_break_the_chain() {
  krishi::MemoryFlashStore flash(16);
  uint32_t nextSeq = 0;

  for (int cycle = 0; cycle < 100; ++cycle) {
    krishi::RingBuffer buffer;
    TEST_ASSERT_TRUE(buffer.begin(flash));

    const int writes = 1 + (rand() % 20);
    for (int i = 0; i < writes; ++i) {
      if (rand() % 10 == 0) flash.failNextWriteAfter(rand() % 160);   // cut mid-slot
      krishi::Record record{};
      record.v = 1;
      record.seq = nextSeq;
      uint8_t sig[64] = {0};
      if (buffer.append(record, sig)) nextSeq++;
    }

    // Reopening must always succeed, and must never claim a record it cannot return.
    krishi::RingBuffer reopened;
    TEST_ASSERT_TRUE(reopened.begin(flash));
    const krishi::BufferStats stats = reopened.stats();
    TEST_ASSERT_TRUE(stats.count <= stats.capacity);

    krishi::Record out[64];
    uint8_t sigs[64 * 64];
    const size_t got = reopened.peek(out, sigs, 64);
    TEST_ASSERT_TRUE(got <= stats.count);
    for (size_t i = 1; i < got; ++i) {
      TEST_ASSERT_TRUE_MESSAGE(out[i].seq >= out[i - 1].seq, "peek must return non-decreasing seq");
    }
  }
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_100_random_power_cuts_never_break_the_chain);
  return UNITY_END();
}
