#include <unity.h>
#include "../../lib/krishi/sampling.h"

static const krishi::SamplingConfig kCfg{};

void test_stable_readings_slow_down_after_three_samples() {
  krishi::SamplingState s;
  s.intervalMs = 30000;
  s.lastT = 41;
  s.primed = true;
  for (int i = 0; i < 3; ++i) krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(45000, s.intervalMs);           // 30000 * 1.5
}

void test_interval_never_exceeds_max() {
  krishi::SamplingState s;
  s.lastT = 41;
  s.primed = true;
  for (int i = 0; i < 100; ++i) krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.maxMs, s.intervalMs);
}

void test_a_moving_temperature_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.primed = true;
  krishi::nextInterval(s, 60, 0, kCfg);                     // +1.9 C, well over 0.5
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_approaching_the_threshold_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 81;
  s.primed = true;
  krishi::nextInterval(s, 82, 0, kCfg);                     // 8.2 C: inside the 2 C band
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_any_flag_change_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.lastFlags = 0;
  s.primed = true;
  krishi::nextInterval(s, 41, krishi::kFlagLidOpen, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_sensor_fault_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.primed = true;
  krishi::nextInterval(s, 41, krishi::kFlagSensorFault, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_lid_open_demands_an_immediate_sample() {
  krishi::SamplingState s;
  s.lastFlags = 0;
  TEST_ASSERT_TRUE(krishi::requiresImmediateSample(s, krishi::kFlagLidOpen));
  s.lastFlags = krishi::kFlagLidOpen;
  TEST_ASSERT_FALSE(krishi::requiresImmediateSample(s, krishi::kFlagLidOpen));  // already known
}

void test_first_observation_does_not_look_unstable() {
  krishi::SamplingState s;
  krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(30000, s.intervalMs);
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_stable_readings_slow_down_after_three_samples);
  RUN_TEST(test_interval_never_exceeds_max);
  RUN_TEST(test_a_moving_temperature_resets_to_minimum);
  RUN_TEST(test_approaching_the_threshold_resets_to_minimum);
  RUN_TEST(test_any_flag_change_resets_to_minimum);
  RUN_TEST(test_sensor_fault_resets_to_minimum);
  RUN_TEST(test_lid_open_demands_an_immediate_sample);
  RUN_TEST(test_first_observation_does_not_look_unstable);
  return UNITY_END();
}
