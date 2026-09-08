/**
 * Host-side conformance test for the ESP-NOW radio callback's foreign-frame filter.
 *
 * This is the fix for the bug found while reconciling PR #2 (H2, swarm.h/failover.h)
 * with PR #3 (H1, link/frame.h): node-head's callback only recognized its own
 * link/frame.h magic, so every RECORD frame a real LEAF or CAM sends (swarm.h's
 * magic) was silently dropped in the radio callback itself — never even reaching
 * EspNowLink::pop(). Sensor data never crossed the LEAF->HEAD boundary at all,
 * despite both sides compiling clean and passing their own unit tests.
 *
 * espnow.cpp is otherwise untouched by pio test -e native: no other test file
 * includes link/espnow.h, so isRecognizedFrame() is the only thing in that file
 * host-testable at all, and until this file existed it wasn't tested — the exact
 * kind of gap that let the original bug ship clean.
 */

#include <unity.h>
#include <cstring>

#include "../../lib/krishi/link/espnow.h"
#include "../../lib/krishi/link/frame.h"
#include "../../lib/krishi/swarm.h"

using krishi::isRecognizedFrame;

void test_accepts_a_link_frame_h_record_frame() {
  krishi::RecordFrame rf{};
  uint8_t frame[krishi::kMaxFrameLength];
  size_t len = krishi::encodeRecordFrame(rf, frame, sizeof(frame));
  TEST_ASSERT_TRUE(isRecognizedFrame(frame, len));
}

void test_accepts_a_link_frame_h_heartbeat_frame() {
  krishi::HeartbeatFrame hf{};
  uint8_t frame[krishi::kMaxFrameLength];
  size_t len = krishi::encodeHeartbeatFrame(hf, frame, sizeof(frame));
  TEST_ASSERT_TRUE(isRecognizedFrame(frame, len));
}

// THE regression test: a real LEAF sends exactly this shape. Before the fix,
// isRecognizedFrame's predecessor (a bare frameType() check) rejected it.
void test_accepts_a_swarm_h_record_frame() {
  uint8_t canonical[krishi::kCanonicalLength] = {0};
  uint8_t sig[krishi::kSignatureLength] = {0};
  uint8_t frame[krishi::swarm::kRecordFrameLength];
  size_t len = krishi::swarm::packRecordFrame(canonical, sig, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(krishi::swarm::kRecordFrameLength, len);
  TEST_ASSERT_TRUE_MESSAGE(isRecognizedFrame(frame, len),
                           "a swarm.h RECORD frame must reach the radio queue, "
                           "not be dropped as foreign");
}

void test_accepts_a_swarm_h_heartbeat_frame() {
  krishi::swarm::Heartbeat hb;
  uint8_t frame[krishi::swarm::kHeartbeatLength];
  size_t len = krishi::swarm::packHeartbeat(hb, frame, sizeof(frame));
  TEST_ASSERT_TRUE(isRecognizedFrame(frame, len));
}

// A stray frame from an unrelated ESP-NOW project on the same channel — neither
// protocol's magic — must still be dropped. The fix must not turn the filter off.
void test_rejects_a_truly_foreign_frame() {
  uint8_t junk[32];
  memset(junk, 0x99, sizeof(junk));
  TEST_ASSERT_FALSE(isRecognizedFrame(junk, sizeof(junk)));
}

void test_rejects_a_frame_that_only_shares_swarm_h_length_not_magic() {
  // Same length as a swarm.h RECORD frame, wrong magic — must not be accepted
  // just because the byte count happens to line up.
  uint8_t frame[krishi::swarm::kRecordFrameLength];
  memset(frame, 0, sizeof(frame));
  frame[0] = 0xAA;
  frame[1] = 0xBB;
  TEST_ASSERT_FALSE(isRecognizedFrame(frame, sizeof(frame)));
}

void test_rejects_empty_input() {
  uint8_t frame[4] = {0};
  TEST_ASSERT_FALSE(isRecognizedFrame(frame, 0));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_accepts_a_link_frame_h_record_frame);
  RUN_TEST(test_accepts_a_link_frame_h_heartbeat_frame);
  RUN_TEST(test_accepts_a_swarm_h_record_frame);
  RUN_TEST(test_accepts_a_swarm_h_heartbeat_frame);
  RUN_TEST(test_rejects_a_truly_foreign_frame);
  RUN_TEST(test_rejects_a_frame_that_only_shares_swarm_h_length_not_magic);
  RUN_TEST(test_rejects_empty_input);
  return UNITY_END();
}
