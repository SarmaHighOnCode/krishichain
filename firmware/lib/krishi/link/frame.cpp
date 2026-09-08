#include "frame.h"
#include "../endian.h"
#include <string.h>

namespace krishi {

uint8_t frameType(const uint8_t* frame, size_t len) {
  if (frame == nullptr || len < kFrameHeaderLength || len > kMaxFrameLength) return 0;
  if (frame[0] != kFrameMagic || frame[1] != kLinkVersion) return 0;

  const uint8_t type = frame[2];
  const uint8_t payloadLen = frame[3];

  if (kFrameHeaderLength + payloadLen != len) return 0;

  size_t expectedPayloadLen = 0;
  switch (type) {
    case kFrameRecord:
      expectedPayloadLen = 154;
      break;
    case kFrameAck:
      expectedPayloadLen = 32;
      break;
    case kFrameBeacon:
      expectedPayloadLen = 25;
      break;
    case kFrameHeartbeat:
      expectedPayloadLen = 28;
      break;
    case kFrameTimesync:
      expectedPayloadLen = 9;
      break;
    default:
      return 0;
  }

  if (payloadLen != expectedPayloadLen) return 0;
  return type;
}

size_t encodeRecordFrame(const RecordFrame& in, uint8_t* out, size_t cap) {
  constexpr size_t kPayloadLen = 154;
  constexpr size_t kTotalLen = kFrameHeaderLength + kPayloadLen;
  if (out == nullptr || cap < kTotalLen) return 0;

  uint8_t* p = out;
  endian::put8(p, kFrameMagic);
  endian::put8(p, kLinkVersion);
  endian::put8(p, kFrameRecord);
  endian::put8(p, static_cast<uint8_t>(kPayloadLen));

  endian::putBytes(p, in.canonical, kCanonicalLength);
  endian::putBytes(p, in.sig, kSignatureLength);

  return static_cast<size_t>(p - out);
}

size_t encodeAckFrame(const AckFrame& in, uint8_t* out, size_t cap) {
  constexpr size_t kPayloadLen = 32;
  constexpr size_t kTotalLen = kFrameHeaderLength + kPayloadLen;
  if (out == nullptr || cap < kTotalLen) return 0;

  uint8_t* p = out;
  endian::put8(p, kFrameMagic);
  endian::put8(p, kLinkVersion);
  endian::put8(p, kFrameAck);
  endian::put8(p, static_cast<uint8_t>(kPayloadLen));

  endian::putBytes(p, in.dev, kAddressLength);
  endian::put32(p, in.ackSeq);
  endian::put64(p, in.serverTs);

  return static_cast<size_t>(p - out);
}

size_t encodeBeaconFrame(const BeaconFrame& in, uint8_t* out, size_t cap) {
  constexpr size_t kPayloadLen = 25;
  constexpr size_t kTotalLen = kFrameHeaderLength + kPayloadLen;
  if (out == nullptr || cap < kTotalLen) return 0;

  uint8_t* p = out;
  endian::put8(p, kFrameMagic);
  endian::put8(p, kLinkVersion);
  endian::put8(p, kFrameBeacon);
  endian::put8(p, static_cast<uint8_t>(kPayloadLen));

  endian::putBytes(p, in.headDev, kAddressLength);
  endian::put8(p, in.channel);
  endian::put32(p, in.uptimeS);

  return static_cast<size_t>(p - out);
}

size_t encodeHeartbeatFrame(const HeartbeatFrame& in, uint8_t* out, size_t cap) {
  constexpr size_t kPayloadLen = 28;
  constexpr size_t kTotalLen = kFrameHeaderLength + kPayloadLen;
  if (out == nullptr || cap < kTotalLen) return 0;

  uint8_t* p = out;
  endian::put8(p, kFrameMagic);
  endian::put8(p, kLinkVersion);
  endian::put8(p, kFrameHeartbeat);
  endian::put8(p, static_cast<uint8_t>(kPayloadLen));

  endian::putBytes(p, in.dev, kAddressLength);
  endian::put32(p, in.lastSeq);
  endian::put16(p, in.bufDepth);
  endian::put8(p, in.bat);
  endian::put8(p, in.state);

  return static_cast<size_t>(p - out);
}

size_t encodeTimesyncFrame(const TimesyncFrame& in, uint8_t* out, size_t cap) {
  constexpr size_t kPayloadLen = 9;
  constexpr size_t kTotalLen = kFrameHeaderLength + kPayloadLen;
  if (out == nullptr || cap < kTotalLen) return 0;

  uint8_t* p = out;
  endian::put8(p, kFrameMagic);
  endian::put8(p, kLinkVersion);
  endian::put8(p, kFrameTimesync);
  endian::put8(p, static_cast<uint8_t>(kPayloadLen));

  endian::put64(p, in.unixSeconds);
  endian::put8(p, in.tsq);

  return static_cast<size_t>(p - out);
}

bool decodeRecordFrame(const uint8_t* frame, size_t len, RecordFrame& out) {
  if (frameType(frame, len) != kFrameRecord) return false;
  const uint8_t* p = frame + kFrameHeaderLength;
  memcpy(out.canonical, p, kCanonicalLength);
  p += kCanonicalLength;
  memcpy(out.sig, p, kSignatureLength);
  return true;
}

bool decodeAckFrame(const uint8_t* frame, size_t len, AckFrame& out) {
  if (frameType(frame, len) != kFrameAck) return false;
  const uint8_t* p = frame + kFrameHeaderLength;
  memcpy(out.dev, p, kAddressLength);
  p += kAddressLength;
  out.ackSeq = endian::get32(p);
  out.serverTs = endian::get64(p);
  return true;
}

bool decodeBeaconFrame(const uint8_t* frame, size_t len, BeaconFrame& out) {
  if (frameType(frame, len) != kFrameBeacon) return false;
  const uint8_t* p = frame + kFrameHeaderLength;
  memcpy(out.headDev, p, kAddressLength);
  p += kAddressLength;
  out.channel = *p++;
  out.uptimeS = endian::get32(p);
  return true;
}

bool decodeHeartbeatFrame(const uint8_t* frame, size_t len, HeartbeatFrame& out) {
  if (frameType(frame, len) != kFrameHeartbeat) return false;
  const uint8_t* p = frame + kFrameHeaderLength;
  memcpy(out.dev, p, kAddressLength);
  p += kAddressLength;
  out.lastSeq = endian::get32(p);
  out.bufDepth = endian::get16(p);
  out.bat = *p++;
  out.state = *p++;
  return true;
}

bool decodeTimesyncFrame(const uint8_t* frame, size_t len, TimesyncFrame& out) {
  if (frameType(frame, len) != kFrameTimesync) return false;
  const uint8_t* p = frame + kFrameHeaderLength;
  out.unixSeconds = endian::get64(p);
  out.tsq = *p++;
  return true;
}

}  // namespace krishi
