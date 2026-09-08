#define UNITY_INCLUDE_64
#include <unity.h>
#include <cstring>
#include "../../lib/krishi/link/frame.h"

void test_record_frame_round_trips() {
  krishi::RecordFrame in;
  for (int i = 0; i < 90; ++i) in.canonical[i] = static_cast<uint8_t>(i);
  for (int i = 0; i < 64; ++i) in.sig[i] = static_cast<uint8_t>(0xC0 + i);

  uint8_t frame[krishi::kMaxFrameLength];
  size_t len = krishi::encodeRecordFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(158, len);                  // 4 header + 154 payload
  TEST_ASSERT_EQUAL_UINT8(krishi::kFrameRecord, krishi::frameType(frame, len));

  krishi::RecordFrame out;
  TEST_ASSERT_TRUE(krishi::decodeRecordFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.canonical, out.canonical, 90);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.sig, out.sig, 64);
}

void test_every_frame_fits_espnow_v1_limit() {
  uint8_t frame[300];
  krishi::RecordFrame r{};
  krishi::AckFrame a{};
  krishi::BeaconFrame b{};
  krishi::HeartbeatFrame h{};
  krishi::TimesyncFrame t{};
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeRecordFrame(r, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeAckFrame(a, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeBeaconFrame(b, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeHeartbeatFrame(h, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeTimesyncFrame(t, frame, sizeof(frame)));
}

void test_ack_frame_round_trips_big_endian() {
  krishi::AckFrame in{};
  memset(in.dev, 0xAB, 20);
  in.ackSeq = 0x01020304;
  in.serverTs = 0x0102030405060708ULL;

  uint8_t frame[64];
  size_t len = krishi::encodeAckFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_UINT8(0x01, frame[4 + 20]);        // ackSeq MSB first
  krishi::AckFrame out{};
  TEST_ASSERT_TRUE(krishi::decodeAckFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT32(in.ackSeq, out.ackSeq);
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(in.serverTs >> 32), static_cast<uint32_t>(out.serverTs >> 32));
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(in.serverTs), static_cast<uint32_t>(out.serverTs));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.dev, out.dev, 20);
}

void test_beacon_frame_round_trips() {
  krishi::BeaconFrame in{};
  memset(in.headDev, 0xDE, 20);
  in.channel = 6;
  in.uptimeS = 3600;

  uint8_t frame[64];
  size_t len = krishi::encodeBeaconFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(29, len);

  krishi::BeaconFrame out{};
  TEST_ASSERT_TRUE(krishi::decodeBeaconFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.headDev, out.headDev, 20);
  TEST_ASSERT_EQUAL_UINT8(6, out.channel);
  TEST_ASSERT_EQUAL_UINT32(3600, out.uptimeS);
}

void test_heartbeat_frame_round_trips() {
  krishi::HeartbeatFrame in{};
  memset(in.dev, 0xFE, 20);
  in.lastSeq = 12345;
  in.bufDepth = 42;
  in.bat = 85;
  in.state = 1;

  uint8_t frame[64];
  size_t len = krishi::encodeHeartbeatFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(32, len);

  krishi::HeartbeatFrame out{};
  TEST_ASSERT_TRUE(krishi::decodeHeartbeatFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.dev, out.dev, 20);
  TEST_ASSERT_EQUAL_UINT32(12345, out.lastSeq);
  TEST_ASSERT_EQUAL_UINT16(42, out.bufDepth);
  TEST_ASSERT_EQUAL_UINT8(85, out.bat);
  TEST_ASSERT_EQUAL_UINT8(1, out.state);
}

void test_timesync_frame_round_trips() {
  krishi::TimesyncFrame in{};
  in.unixSeconds = 1725796800ULL;
  in.tsq = 2;

  uint8_t frame[64];
  size_t len = krishi::encodeTimesyncFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(13, len);

  krishi::TimesyncFrame out{};
  TEST_ASSERT_TRUE(krishi::decodeTimesyncFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(in.unixSeconds >> 32), static_cast<uint32_t>(out.unixSeconds >> 32));
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(in.unixSeconds), static_cast<uint32_t>(out.unixSeconds));
  TEST_ASSERT_EQUAL_UINT8(2, out.tsq);
}

void test_foreign_frames_are_rejected() {
  uint8_t junk[32] = {0};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(junk, sizeof(junk)));

  uint8_t wrongMagic[32] = {0x00, 0x01, 0x01, 0x02};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(wrongMagic, sizeof(wrongMagic)));

  uint8_t wrongVersion[32] = {0x4B, 0x02, 0x01, 0x02};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(wrongVersion, sizeof(wrongVersion)));

  uint8_t truncated[6] = {0x4B, 0x01, 0x01, 154, 0x00, 0x00};   // len field lies
  krishi::RecordFrame out;
  TEST_ASSERT_FALSE(krishi::decodeRecordFrame(truncated, sizeof(truncated), out));
}

void test_encode_refuses_a_short_buffer() {
  krishi::RecordFrame r{};
  uint8_t tiny[10];
  TEST_ASSERT_EQUAL_size_t(0, krishi::encodeRecordFrame(r, tiny, sizeof(tiny)));

  krishi::AckFrame a{};
  TEST_ASSERT_EQUAL_size_t(0, krishi::encodeAckFrame(a, tiny, sizeof(tiny)));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_record_frame_round_trips);
  RUN_TEST(test_every_frame_fits_espnow_v1_limit);
  RUN_TEST(test_ack_frame_round_trips_big_endian);
  RUN_TEST(test_beacon_frame_round_trips);
  RUN_TEST(test_heartbeat_frame_round_trips);
  RUN_TEST(test_timesync_frame_round_trips);
  RUN_TEST(test_foreign_frames_are_rejected);
  RUN_TEST(test_encode_refuses_a_short_buffer);
  return UNITY_END();
}
