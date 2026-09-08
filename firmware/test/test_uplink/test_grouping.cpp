#include <unity.h>
#include <cstring>
#include "../../lib/krishi/uplink.h"

void test_groups_mixed_devices_into_runs() {
  krishi::Record records[6];
  uint8_t devA[20], devB[20];
  memset(devA, 0xAA, 20);
  memset(devB, 0xBB, 20);
  // A A B B B A -> three runs. peek() returns buffer order, not device order.
  const uint8_t* pattern[6] = {devA, devA, devB, devB, devB, devA};
  for (int i = 0; i < 6; ++i) memcpy(records[i].dev, pattern[i], 20);

  size_t starts[8], lengths[8];
  size_t runs = krishi::groupByDevice(records, 6, starts, lengths, 8);
  TEST_ASSERT_EQUAL_size_t(3, runs);
  TEST_ASSERT_EQUAL_size_t(0, starts[0]);  TEST_ASSERT_EQUAL_size_t(2, lengths[0]);
  TEST_ASSERT_EQUAL_size_t(2, starts[1]);  TEST_ASSERT_EQUAL_size_t(3, lengths[1]);
  TEST_ASSERT_EQUAL_size_t(5, starts[2]);  TEST_ASSERT_EQUAL_size_t(1, lengths[2]);
}

void test_single_device_is_one_run() {
  krishi::Record records[5];
  uint8_t dev[20];
  memset(dev, 0xCC, 20);
  for (int i = 0; i < 5; ++i) memcpy(records[i].dev, dev, 20);
  size_t starts[4], lengths[4];
  TEST_ASSERT_EQUAL_size_t(1, krishi::groupByDevice(records, 5, starts, lengths, 4));
  TEST_ASSERT_EQUAL_size_t(5, lengths[0]);
}

void test_empty_input_is_zero_runs() {
  size_t starts[4], lengths[4];
  TEST_ASSERT_EQUAL_size_t(0, krishi::groupByDevice(nullptr, 0, starts, lengths, 4));
}

void test_run_count_is_capped_at_maxruns() {
  // Alternating devices with maxRuns=2 must stop at 2 rather than overflow the caller's array.
  krishi::Record records[6];
  for (int i = 0; i < 6; ++i) memset(records[i].dev, i % 2 ? 0xAA : 0xBB, 20);
  size_t starts[2], lengths[2];
  TEST_ASSERT_EQUAL_size_t(2, krishi::groupByDevice(records, 6, starts, lengths, 2));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_groups_mixed_devices_into_runs);
  RUN_TEST(test_single_device_is_one_run);
  RUN_TEST(test_empty_input_is_zero_runs);
  RUN_TEST(test_run_count_is_capped_at_maxruns);
  return UNITY_END();
}
