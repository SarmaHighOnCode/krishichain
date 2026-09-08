#pragma once
/**
 * ESP-NOW Link Protocol Frame Codec (docs/PROTOCOL-LINK.md §1).
 *
 * Header: [ magic:1 = 0x4B | ver:1 = 0x01 | type:1 | len:1 | payload:len ]
 * Max total frame length is 250 bytes (ESP-NOW v1 constraint).
 */

#include <stddef.h>
#include <stdint.h>
#include "../record.h"

namespace krishi {

constexpr uint8_t kFrameMagic = 0x4B;
constexpr uint8_t kLinkVersion = 0x01;
constexpr size_t kFrameHeaderLength = 4;
constexpr size_t kMaxFrameLength = 250;

enum FrameType : uint8_t {
  kFrameRecord = 0x01,
  kFrameAck = 0x02,
  kFrameBeacon = 0x03,
  kFrameHeartbeat = 0x04,
  kFrameTimesync = 0x05,
};

struct RecordFrame {
  uint8_t canonical[kCanonicalLength];  // 90
  uint8_t sig[kSignatureLength];        // 64
};

struct AckFrame {
  uint8_t dev[kAddressLength];          // 20
  uint32_t ackSeq;
  uint64_t serverTs;
};

struct BeaconFrame {
  uint8_t headDev[kAddressLength];       // 20
  uint8_t channel;
  uint32_t uptimeS;
};

struct HeartbeatFrame {
  uint8_t dev[kAddressLength];          // 20
  uint32_t lastSeq;
  uint16_t bufDepth;
  uint8_t bat;
  uint8_t state;
};

struct TimesyncFrame {
  uint64_t unixSeconds;
  uint8_t tsq;
};

size_t encodeRecordFrame(const RecordFrame& in, uint8_t* out, size_t cap);
size_t encodeAckFrame(const AckFrame& in, uint8_t* out, size_t cap);
size_t encodeBeaconFrame(const BeaconFrame& in, uint8_t* out, size_t cap);
size_t encodeHeartbeatFrame(const HeartbeatFrame& in, uint8_t* out, size_t cap);
size_t encodeTimesyncFrame(const TimesyncFrame& in, uint8_t* out, size_t cap);

/** Returns the FrameType, or 0 if the frame is not ours / malformed. */
uint8_t frameType(const uint8_t* frame, size_t len);

bool decodeRecordFrame(const uint8_t* frame, size_t len, RecordFrame& out);
bool decodeAckFrame(const uint8_t* frame, size_t len, AckFrame& out);
bool decodeBeaconFrame(const uint8_t* frame, size_t len, BeaconFrame& out);
bool decodeHeartbeatFrame(const uint8_t* frame, size_t len, HeartbeatFrame& out);
bool decodeTimesyncFrame(const uint8_t* frame, size_t len, TimesyncFrame& out);

}  // namespace krishi
