#pragma once
/**
 * ESP-NOW swarm transport — tickets H2-11 (LEAF tx side) / H1-14 (HEAD rx side).
 *
 * Transport fallback (ADR-0004): LEAF --ESP-NOW--> HEAD --WiFi--> laptop normally;
 * HEAD loss (missed heartbeats) --> LEAF WiFi direct; no network --> flash buffer.
 *
 * Rules, non-negotiable:
 *   1. ONE channel for the whole swarm (kChannel). ESP-NOW and WiFi share the radio;
 *      a LEAF that WiFis on channel 6 while ESP-NOWing on channel 1 hears nothing.
 *   2. Relay never rewrites dev/sig/seq/prev. The HEAD forwards the canonical 90 bytes
 *      + 64-byte signature byte-identical; the gateway verifies end-to-end.
 *   3. Everything fits the 250-byte ESP-NOW payload: a record frame is 157 bytes.
 *
 * This header is host-portable (no Arduino includes) so the frame layout is covered
 * by firmware/test/test_swarm on the native env.
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"

namespace krishi {
namespace swarm {

constexpr uint8_t kChannel = 1;          // the whole swarm lives here
constexpr uint16_t kMagic = 0x4B43;      // "KC", big-endian on the wire
constexpr size_t kMaxEspNowPayload = 250;

constexpr uint32_t kHeartbeatPeriodMs = 5000;  // HEAD broadcasts this often (H1-14)
constexpr uint32_t kHeadMissAllow = 3;         // LEAF declares HEAD lost after 3 misses

// A HEAD heartbeat is UNAUTHENTICATED (docs/PROTOCOL-LINK.md section 7.3): it is not
// signed, not chained, and any device on the channel can forge one. Adopting an
// interval straight from a heartbeat with no bound lets a single spoofed or buggy
// broadcast blind a LEAF indefinitely (interval too high) or drain its battery and
// flood the radio (interval too low). Clamp both directions. Bounds match the HEAD
// side's SamplingConfig defaults (sampling.h) so a legitimate broadcast is never
// rejected, only an out-of-range one.
constexpr uint32_t kMinIntervalMs = 10000;
constexpr uint32_t kMaxIntervalMs = 300000;

/** Broadcast peer: LEAF sends to everyone, HEADs listen. No MAC provisioning. */
constexpr uint8_t kBroadcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

enum FrameType : uint8_t {
  kFrameRecord = 0x01,     // LEAF -> HEAD: one signed record
  kFrameHeartbeat = 0x02,  // HEAD -> all: alive + sample interval + ack for one leaf
};

/**
 * Record frame, 157 bytes: magic u16 BE | type u8 | canonical[90] | sig[64].
 * The HEAD decodes the canonical bytes (decodeRecord) into POST /ingest JSON.
 */
constexpr size_t kRecordFrameLength = 2 + 1 + kCanonicalLength + kSignatureLength;

/**
 * Heartbeat frame, 56 bytes:
 *   magic u16 BE | type u8 | headDev[20] | intervalMs u32 BE | headSeq u32 BE
 *   | ackDev[20] | ackSeq u32 BE | flags u8 (bit0 = incident active)
 * ackDev/ackSeq is the gateway ackSeq the HEAD last received for ONE leaf
 * (single-leaf fast path; multi-leaf needs a follow-up ticket, not this demo).
 */
constexpr size_t kHeartbeatLength = 2 + 1 + 20 + 4 + 4 + 20 + 4 + 1;

namespace detail {

inline void put16be(uint8_t*& p, uint16_t v) {
  *p++ = static_cast<uint8_t>(v >> 8);
  *p++ = static_cast<uint8_t>(v);
}

inline void put32be(uint8_t*& p, uint32_t v) {
  *p++ = static_cast<uint8_t>(v >> 24);
  *p++ = static_cast<uint8_t>(v >> 16);
  *p++ = static_cast<uint8_t>(v >> 8);
  *p++ = static_cast<uint8_t>(v);
}

inline uint16_t get16be(const uint8_t*& p) {
  uint16_t v = static_cast<uint16_t>(p[0]) << 8 | p[1];
  p += 2;
  return v;
}

inline uint32_t get32be(const uint8_t*& p) {
  uint32_t v = static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 |
               static_cast<uint32_t>(p[2]) << 8 | static_cast<uint32_t>(p[3]);
  p += 4;
  return v;
}

}  // namespace detail

/** Pack one signed record into a broadcast frame. Returns bytes written, 0 if small. */
inline size_t packRecordFrame(const uint8_t canonical[kCanonicalLength],
                              const uint8_t signature[kSignatureLength], uint8_t* out,
                              size_t capacity) {
  if (capacity < kRecordFrameLength) return 0;
  uint8_t* p = out;
  detail::put16be(p, kMagic);
  *p++ = kFrameRecord;
  for (size_t i = 0; i < kCanonicalLength; ++i) *p++ = canonical[i];
  for (size_t i = 0; i < kSignatureLength; ++i) *p++ = signature[i];
  return static_cast<size_t>(p - out);
}

inline bool parseRecordFrame(const uint8_t* in, size_t length, const uint8_t** canonical_out,
                             const uint8_t** sig_out) {
  if (length != kRecordFrameLength) return false;
  const uint8_t* p = in;
  if (detail::get16be(p) != kMagic) return false;
  if (*p++ != kFrameRecord) return false;
  *canonical_out = p;
  *sig_out = p + kCanonicalLength;
  return true;
}

struct Heartbeat {
  uint8_t head_dev[kAddressLength];
  uint32_t interval_ms;
  uint32_t head_seq;
  uint8_t ack_dev[kAddressLength];
  uint32_t ack_seq;
  uint8_t flags;
  Heartbeat()
      : interval_ms(30000), head_seq(0), ack_seq(0), flags(0) {
    for (size_t i = 0; i < kAddressLength; ++i) head_dev[i] = 0;
    for (size_t i = 0; i < kAddressLength; ++i) ack_dev[i] = 0;
  }
};

/** Pack a HEAD heartbeat. Returns bytes written, 0 if small. */
inline size_t packHeartbeat(const Heartbeat& hb, uint8_t* out, size_t capacity) {
  if (capacity < kHeartbeatLength) return 0;
  uint8_t* p = out;
  detail::put16be(p, kMagic);
  *p++ = kFrameHeartbeat;
  for (size_t i = 0; i < kAddressLength; ++i) *p++ = hb.head_dev[i];
  detail::put32be(p, hb.interval_ms);
  detail::put32be(p, hb.head_seq);
  for (size_t i = 0; i < kAddressLength; ++i) *p++ = hb.ack_dev[i];
  detail::put32be(p, hb.ack_seq);
  *p++ = hb.flags;
  return static_cast<size_t>(p - out);
}

inline bool parseHeartbeat(const uint8_t* in, size_t length, Heartbeat& out) {
  if (length != kHeartbeatLength) return false;
  const uint8_t* p = in;
  if (detail::get16be(p) != kMagic) return false;
  if (*p++ != kFrameHeartbeat) return false;
  for (size_t i = 0; i < kAddressLength; ++i) out.head_dev[i] = *p++;
  out.interval_ms = detail::get32be(p);
  out.head_seq = detail::get32be(p);
  for (size_t i = 0; i < kAddressLength; ++i) out.ack_dev[i] = *p++;
  out.ack_seq = detail::get32be(p);
  out.flags = *p++;
  return true;
}

}  // namespace swarm
}  // namespace krishi
