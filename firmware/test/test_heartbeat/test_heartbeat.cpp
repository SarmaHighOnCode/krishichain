#include <unity.h>
#include <cstring>
#include "../../lib/krishi/heartbeat.h"

void test_tracker_records_liveness() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  frame.lastSeq = 42;
  frame.bufDepth = 7;
  frame.bat = 90;
  frame.state = 0;
  tracker.observe(frame, 1000);

  krishi::NodeLiveness out[4];
  TEST_ASSERT_EQUAL_size_t(1, tracker.snapshot(out, 4, 1500));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(frame.dev, out[0].dev, 20);
  TEST_ASSERT_EQUAL_UINT32(42, out[0].lastSeq);
  TEST_ASSERT_EQUAL_UINT16(7, out[0].bufDepth);
  TEST_ASSERT_EQUAL_UINT8(90, out[0].bat);
  TEST_ASSERT_EQUAL_UINT8(0, out[0].state);
  TEST_ASSERT_EQUAL_UINT32(500, out[0].ageMs);
}

void test_node_goes_stale_after_the_timeout() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  tracker.observe(frame, 1000);
  TEST_ASSERT_FALSE(tracker.isStale(frame.dev, 60000, 90000));
  TEST_ASSERT_TRUE(tracker.isStale(frame.dev, 200000, 90000));
}

void test_repeat_heartbeats_update_rather_than_duplicate() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  frame.lastSeq = 1;
  tracker.observe(frame, 1000);
  frame.lastSeq = 9;
  tracker.observe(frame, 2000);

  krishi::NodeLiveness out[4];
  TEST_ASSERT_EQUAL_size_t(1, tracker.snapshot(out, 4, 2000));
  TEST_ASSERT_EQUAL_UINT32(9, out[0].lastSeq);
}

void test_unknown_device_is_stale() {
  krishi::HeartbeatTracker tracker;
  uint8_t unknown[20];
  memset(unknown, 0xFF, 20);
  TEST_ASSERT_TRUE(tracker.isStale(unknown, 1000, 90000));
}

void test_evicts_stalest_node_on_9th_arrival() {
  krishi::HeartbeatTracker tracker;
  // Fill 8 nodes with timestamps 100..800
  for (uint8_t i = 1; i <= 8; ++i) {
    krishi::HeartbeatFrame frame{};
    memset(frame.dev, i, 20);
    frame.lastSeq = i;
    tracker.observe(frame, i * 100);
  }

  krishi::NodeLiveness out[8];
  TEST_ASSERT_EQUAL_size_t(8, tracker.snapshot(out, 8, 1000));

  // Node 1 (seen at 100) is the stalest. Now add 9th node at t = 900.
  krishi::HeartbeatFrame ninth{};
  memset(ninth.dev, 0x09, 20);
  ninth.lastSeq = 99;
  tracker.observe(ninth, 900);

  TEST_ASSERT_EQUAL_size_t(8, tracker.snapshot(out, 8, 1000));

  // Node 1 should have been evicted (unknown / stale)
  uint8_t node1[20];
  memset(node1, 0x01, 20);
  TEST_ASSERT_TRUE(tracker.isStale(node1, 1000, 90000));

  // 9th node should be present
  TEST_ASSERT_FALSE(tracker.isStale(ninth.dev, 1000, 90000));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_tracker_records_liveness);
  RUN_TEST(test_node_goes_stale_after_the_timeout);
  RUN_TEST(test_repeat_heartbeats_update_rather_than_duplicate);
  RUN_TEST(test_unknown_device_is_stale);
  RUN_TEST(test_evicts_stalest_node_on_9th_arrival);
  return UNITY_END();
}
