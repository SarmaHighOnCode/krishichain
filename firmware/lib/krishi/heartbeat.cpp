#include "heartbeat.h"
#include <string.h>

namespace krishi {

void HeartbeatTracker::observe(const HeartbeatFrame& frame, uint32_t nowMs) {
  // Check if device is already present
  for (size_t i = 0; i < kMaxNodes; ++i) {
    if (nodes_[i].active && memcmp(nodes_[i].dev, frame.dev, kAddressLength) == 0) {
      nodes_[i].lastSeq = frame.lastSeq;
      nodes_[i].bufDepth = frame.bufDepth;
      nodes_[i].bat = frame.bat;
      nodes_[i].state = frame.state;
      nodes_[i].lastSeenMs = nowMs;
      return;
    }
  }

  // If new device and space available:
  if (count_ < kMaxNodes) {
    for (size_t i = 0; i < kMaxNodes; ++i) {
      if (!nodes_[i].active) {
        memcpy(nodes_[i].dev, frame.dev, kAddressLength);
        nodes_[i].lastSeq = frame.lastSeq;
        nodes_[i].bufDepth = frame.bufDepth;
        nodes_[i].bat = frame.bat;
        nodes_[i].state = frame.state;
        nodes_[i].lastSeenMs = nowMs;
        nodes_[i].active = true;
        count_++;
        return;
      }
    }
  }

  // Evict stalest entry if 9th arrives
  size_t stalestIdx = 0;
  uint32_t oldestSeenMs = nodes_[0].lastSeenMs;

  for (size_t i = 1; i < kMaxNodes; ++i) {
    if (nodes_[i].lastSeenMs < oldestSeenMs) {
      oldestSeenMs = nodes_[i].lastSeenMs;
      stalestIdx = i;
    }
  }

  memcpy(nodes_[stalestIdx].dev, frame.dev, kAddressLength);
  nodes_[stalestIdx].lastSeq = frame.lastSeq;
  nodes_[stalestIdx].bufDepth = frame.bufDepth;
  nodes_[stalestIdx].bat = frame.bat;
  nodes_[stalestIdx].state = frame.state;
  nodes_[stalestIdx].lastSeenMs = nowMs;
  nodes_[stalestIdx].active = true;
}

size_t HeartbeatTracker::snapshot(NodeLiveness* out, size_t max, uint32_t nowMs) const {
  if (out == nullptr || max == 0) return 0;

  size_t written = 0;
  for (size_t i = 0; i < kMaxNodes && written < max; ++i) {
    if (nodes_[i].active) {
      memcpy(out[written].dev, nodes_[i].dev, kAddressLength);
      out[written].lastSeq = nodes_[i].lastSeq;
      out[written].bufDepth = nodes_[i].bufDepth;
      out[written].bat = nodes_[i].bat;
      out[written].state = nodes_[i].state;
      out[written].ageMs = (nowMs >= nodes_[i].lastSeenMs) ? (nowMs - nodes_[i].lastSeenMs) : 0;
      written++;
    }
  }

  return written;
}

bool HeartbeatTracker::isStale(const uint8_t dev[kAddressLength], uint32_t nowMs,
                               uint32_t timeoutMs) const {
  if (dev == nullptr) return true;

  for (size_t i = 0; i < kMaxNodes; ++i) {
    if (nodes_[i].active && memcmp(nodes_[i].dev, dev, kAddressLength) == 0) {
      const uint32_t age = (nowMs >= nodes_[i].lastSeenMs) ? (nowMs - nodes_[i].lastSeenMs) : 0;
      return age > timeoutMs;
    }
  }

  return true;  // Unknown device is stale
}

}  // namespace krishi
