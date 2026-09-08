/**
 * Host-side conformance test: swarm frames, LEAF failover, CAM companions.
 *
 *   cd firmware && pio test -e native   (or g++ -std=gnu++17 this file)
 *
 * Tickets H2-11 (LEAF link) + H2-12 (CAM companion). No board, no radio:
 * every header under test is pure logic, which is exactly why the failover
 * hysteresis and the companion layout get proven here instead of on a demo table.
 */

#include <unity.h>

#include <cstring>

#include "../../lib/krishi/companion.h"
#include "../../lib/krishi/failover.h"
#include "../../lib/krishi/record.h"
#include "../../lib/krishi/swarm.h"

using krishi::kAddressLength;
using krishi::kCanonicalLength;
using krishi::kDigestLength;
using krishi::kSignatureLength;

namespace {

krishi::swarm::Heartbeat makeBeat(uint32_t interval = 30000, uint8_t flags = 0) {
  krishi::swarm::Heartbeat hb;
  hb.interval_ms = interval;
  hb.head_seq = 42;
  hb.flags = flags;
  for (size_t i = 0; i < kAddressLength; ++i) hb.head_dev[i] = static_cast<uint8_t>(i + 1);
  return hb;
}

}  // namespace

void test_record_frame_round_trips_byte_identical() {
  uint8_t canonical[kCanonicalLength];
  uint8_t sig[kSignatureLength];
  for (size_t i = 0; i < kCanonicalLength; ++i) canonical[i] = static_cast<uint8_t>(i * 3 + 1);
  for (size_t i = 0; i < kSignatureLength; ++i) sig[i] = static_cast<uint8_t>(i * 7 + 2);

  uint8_t frame[krishi::swarm::kRecordFrameLength];
  TEST_ASSERT_EQUAL_size_t(krishi::swarm::kRecordFrameLength,
                           krishi::swarm::packRecordFrame(canonical, sig, frame, sizeof(frame)));
  TEST_ASSERT_LESS_THAN_size_t(krishi::swarm::kMaxEspNowPayload, sizeof(frame));

  const uint8_t* canon_out = nullptr;
  const uint8_t* sig_out = nullptr;
  TEST_ASSERT_TRUE(krishi::swarm::parseRecordFrame(frame, sizeof(frame), &canon_out, &sig_out));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(canonical, canon_out, kCanonicalLength);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(sig, sig_out, kSignatureLength);
}

void test_record_frame_rejects_bad_magic_and_short_buffer() {
  uint8_t canonical[kCanonicalLength] = {0};
  uint8_t sig[kSignatureLength] = {0};
  uint8_t frame[krishi::swarm::kRecordFrameLength];
  krishi::swarm::packRecordFrame(canonical, sig, frame, sizeof(frame));

  uint8_t small[10];
  TEST_ASSERT_EQUAL_size_t(0, krishi::swarm::packRecordFrame(canonical, sig, small, sizeof(small)));

  frame[0] ^= 0xFF;  // corrupt magic
  const uint8_t* c = nullptr;
  const uint8_t* s = nullptr;
  TEST_ASSERT_FALSE(krishi::swarm::parseRecordFrame(frame, sizeof(frame), &c, &s));
}

void test_heartbeat_round_trips_and_carries_interval() {
  const krishi::swarm::Heartbeat sent = makeBeat(10000, 0x01);
  uint8_t frame[krishi::swarm::kHeartbeatLength];
  TEST_ASSERT_EQUAL_size_t(krishi::swarm::kHeartbeatLength,
                           krishi::swarm::packHeartbeat(sent, frame, sizeof(frame)));

  krishi::swarm::Heartbeat got;
  TEST_ASSERT_TRUE(krishi::swarm::parseHeartbeat(frame, sizeof(frame), got));
  TEST_ASSERT_EQUAL_UINT32(10000, got.interval_ms);
  TEST_ASSERT_EQUAL_UINT32(42, got.head_seq);
  TEST_ASSERT_EQUAL_UINT8(0x01, got.flags);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(sent.head_dev, got.head_dev, kAddressLength);
}

void test_leaf_starts_on_esp_now_and_adopts_broadcast_interval() {
  krishi::LeafLink leaf_link;
  TEST_ASSERT_EQUAL(krishi::LeafLink::kEspNow, leaf_link.mode());
  TEST_ASSERT_EQUAL_UINT32(30000, leaf_link.sampleIntervalMs());

  const krishi::swarm::Heartbeat hb = makeBeat(10000);
  leaf_link.markBeatSeen();
  leaf_link.onHeartbeat(1000, hb);
  TEST_ASSERT_EQUAL_UINT32(10000, leaf_link.sampleIntervalMs());
  TEST_ASSERT_TRUE(leaf_link.incident() == false);
}

void test_leaf_fails_over_after_three_missed_beats_then_rejoins() {
  krishi::LeafLink leaf_link;
  leaf_link.markBeatSeen();
  leaf_link.onHeartbeat(0, makeBeat());

  leaf_link.poll(5000 * 3);  // exactly at the deadline: still ESP-NOW
  TEST_ASSERT_EQUAL(krishi::LeafLink::kEspNow, leaf_link.mode());
  leaf_link.poll(5000 * 3 + 1);  // one ms past: HEAD declared lost
  TEST_ASSERT_EQUAL(krishi::LeafLink::kWifiDirect, leaf_link.mode());
  TEST_ASSERT_EQUAL_UINT32(1, leaf_link.flaps());

  // One beat is not enough to rejoin (flap guard); two consecutive are.
  leaf_link.onHeartbeat(20000, makeBeat());
  TEST_ASSERT_EQUAL(krishi::LeafLink::kWifiDirect, leaf_link.mode());
  leaf_link.onHeartbeat(25000, makeBeat());
  TEST_ASSERT_EQUAL(krishi::LeafLink::kEspNow, leaf_link.mode());
  TEST_ASSERT_EQUAL_UINT32(2, leaf_link.flaps());
}

void test_leaf_flags_incident_from_heartbeat() {
  krishi::LeafLink leaf_link;
  leaf_link.markBeatSeen();
  leaf_link.onHeartbeat(0, makeBeat(10000, 0x01));
  TEST_ASSERT_TRUE(leaf_link.incident());
  TEST_ASSERT_EQUAL_UINT32(10000, leaf_link.sampleIntervalMs());
}

void test_companion_packs_96_bytes_with_lid_bit_and_zero_reserved() {
  krishi::companion::CamAttest a;
  for (size_t i = 0; i < kAddressLength; ++i) a.dev[i] = static_cast<uint8_t>(i + 9);
  a.seq = 7;
  for (size_t i = 0; i < kDigestLength; ++i) a.record_digest[i] = 0xAA;
  for (size_t i = 0; i < kDigestLength; ++i) a.photo_hash[i] = 0x55;
  a.lux_mean = 137;
  a.lid_open = true;
  a.img_bytes = 76800;

  uint8_t out[krishi::companion::kCanonicalLength];
  TEST_ASSERT_EQUAL_size_t(krishi::companion::kCanonicalLength,
                           krishi::companion::packCamAttest(a, out, sizeof(out)));

  TEST_ASSERT_EQUAL_UINT8_ARRAY(a.dev, out + krishi::companion::offsets::kDev, kAddressLength);
  TEST_ASSERT_EQUAL_UINT8(0, out[krishi::companion::offsets::kSeq + 3] - 7);  // seq BE tail
  TEST_ASSERT_EQUAL_UINT8_ARRAY(a.record_digest, out + krishi::companion::offsets::kDigest,
                                kDigestLength);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(a.photo_hash, out + krishi::companion::offsets::kPhotoHash,
                                kDigestLength);
  TEST_ASSERT_EQUAL_UINT8(137, out[krishi::companion::offsets::kLuxMean + 1]);
  TEST_ASSERT_EQUAL_UINT8(krishi::companion::kLidOpenBit,
                          out[krishi::companion::offsets::kLidFlags]);
  TEST_ASSERT_EQUAL_UINT8(0, out[krishi::companion::offsets::kReserved]);

  // Lid shut clears the bit; layout otherwise identical.
  a.lid_open = false;
  uint8_t shut[krishi::companion::kCanonicalLength];
  krishi::companion::packCamAttest(a, shut, sizeof(shut));
  TEST_ASSERT_EQUAL_UINT8(0, shut[krishi::companion::offsets::kLidFlags]);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(out, shut, krishi::companion::kCanonicalLength - 6);
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_record_frame_round_trips_byte_identical);
  RUN_TEST(test_record_frame_rejects_bad_magic_and_short_buffer);
  RUN_TEST(test_heartbeat_round_trips_and_carries_interval);
  RUN_TEST(test_leaf_starts_on_esp_now_and_adopts_broadcast_interval);
  RUN_TEST(test_leaf_fails_over_after_three_missed_beats_then_rejoins);
  RUN_TEST(test_leaf_flags_incident_from_heartbeat);
  RUN_TEST(test_companion_packs_96_bytes_with_lid_bit_and_zero_reserved);
  return UNITY_END();
}
