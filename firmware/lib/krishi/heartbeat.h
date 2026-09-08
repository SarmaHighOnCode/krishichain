#pragma once
/**
 * Heartbeat tracker for LEAF node liveness (docs/PROTOCOL-LINK.md §5).
 *
 * Fixed array of up to 8 nodes, evicts the stalest entry if a 9th arrives.
 * A heartbeat is non-evidential and unauthenticated; kept strictly separate from records.
 */

#include <stddef.h>
#include <stdint.h>
#include "link/frame.h"

namespace krishi {

struct NodeLiveness {
  uint8_t dev[kAddressLength];
  uint32_t lastSeq;
  uint16_t bufDepth;
  uint8_t bat;
  uint8_t state;
  uint32_t ageMs;
};

class HeartbeatTracker {
 public:
  void observe(const HeartbeatFrame& frame, uint32_t nowMs);
  size_t snapshot(NodeLiveness* out, size_t max, uint32_t nowMs) const;
  bool isStale(const uint8_t dev[kAddressLength], uint32_t nowMs, uint32_t timeoutMs) const;

 private:
  static constexpr size_t kMaxNodes = 8;
  struct NodeEntry {
    uint8_t dev[kAddressLength];
    uint32_t lastSeq;
    uint16_t bufDepth;
    uint8_t bat;
    uint8_t state;
    uint32_t lastSeenMs;
    bool active = false;
  };

  NodeEntry nodes_[kMaxNodes] = {};
  size_t count_ = 0;
};

}  // namespace krishi
