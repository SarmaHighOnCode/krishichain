#pragma once
/**
 * Build-time role configuration. See docs/adr/0005-espnow-link-protocol.md.
 *
 * LEAF: ESP-NOW only. Never associates to WiFi. Signs and buffers its own records.
 * HEAD: WiFi STA + ESP-NOW. Signs its own records AND relays the LEAF's, byte-for-byte.
 */

#include <stddef.h>
#include <stdint.h>

#if !defined(KRISHI_ROLE_HEAD) && !defined(KRISHI_ROLE_LEAF) && !defined(KRISHI_ROLE_CAM) && !defined(KRISHI_NATIVE)
#error "Define KRISHI_ROLE_HEAD, KRISHI_ROLE_LEAF or KRISHI_ROLE_CAM"
#endif

namespace krishi {

constexpr uint32_t kSampleIntervalMsDefault = 30000;
constexpr uint32_t kHeartbeatIntervalMs = 30000;
constexpr uint32_t kBeaconIntervalMs = 5000;

/** Max records in one HTTP batch to the gateway (PROTOCOL.md §3.2). */
constexpr size_t kMaxUplinkBatch = 100;

/** Consecutive unacked send cycles before a LEAF re-scans for the HEAD's channel. */
constexpr uint8_t kAckMissesBeforeRescan = 3;

#if defined(KRISHI_ROLE_HEAD)
constexpr bool kIsHead = true;
constexpr bool kIsLeaf = false;
#elif defined(KRISHI_ROLE_LEAF)
constexpr bool kIsHead = false;
constexpr bool kIsLeaf = true;
#else
constexpr bool kIsHead = false;
constexpr bool kIsLeaf = false;
#endif

}  // namespace krishi
