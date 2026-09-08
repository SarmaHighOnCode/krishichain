#pragma once
/**
 * LEAF link state machine — ticket H2-11. Pure logic, no Arduino, no radio calls.
 *
 * The LEAF prefers ESP-NOW (cheap, no association) and falls back to WiFi-direct
 * POST /ingest when the HEAD stops heartbeating. It rejoins ESP-NOW after the HEAD
 * proves it is back. Hysteresis both ways so a flapping HEAD does not flap the link.
 *
 * Clock is injected (now_ms) so the native test drives time deterministically and
 * the sketch passes millis(). Unsigned subtraction keeps millis() wraparound safe.
 */

#include <stdint.h>

#include "swarm.h"

namespace krishi {

class LeafLink {
 public:
  enum Mode : uint8_t { kEspNow, kWifiDirect };

  struct Config {
    uint32_t heartbeat_period_ms;
    uint32_t miss_allow;  // misses before HEAD is lost
    uint32_t rejoin_beats;  // consecutive beats before rejoin
    Config(uint32_t period = swarm::kHeartbeatPeriodMs, uint32_t miss = swarm::kHeadMissAllow,
           uint32_t rejoin = 2)
        : heartbeat_period_ms(period), miss_allow(miss), rejoin_beats(rejoin) {}
  };

  explicit LeafLink(const Config& config = Config()) : config_(config) { init(); }

  /**
   * Feed a received HEAD heartbeat. Adopts the broadcast sample interval, clamped to
   * [kMinIntervalMs, kMaxIntervalMs] — a heartbeat is unauthenticated, so an
   * out-of-range value is treated as noise rather than obeyed (swarm.h, section on
   * kMinIntervalMs/kMaxIntervalMs).
   */
  void onHeartbeat(uint32_t now_ms, const swarm::Heartbeat& hb) {
    last_beat_ms_ = now_ms;
    uint32_t interval = hb.interval_ms;
    if (interval < swarm::kMinIntervalMs) interval = swarm::kMinIntervalMs;
    if (interval > swarm::kMaxIntervalMs) interval = swarm::kMaxIntervalMs;
    interval_ms_ = interval;
    incident_ = (hb.flags & 0x01) != 0;
    if (mode_ == kWifiDirect) {
      ++rejoin_count_;
      if (rejoin_count_ >= config_.rejoin_beats) {
        mode_ = kEspNow;
        rejoin_count_ = 0;
        flap_count_++;
      }
    } else {
      rejoin_count_ = 0;
    }
  }

  /** Call every loop. Moves to WiFi-direct when the HEAD has been silent too long. */
  void poll(uint32_t now_ms) {
    if (mode_ == kEspNow && last_beat_seen_ &&
        (now_ms - last_beat_ms_) > config_.heartbeat_period_ms * config_.miss_allow) {
      mode_ = kWifiDirect;
      rejoin_count_ = 0;
      flap_count_++;
    }
  }

  /** First heartbeat ever still pending: stay on ESP-NOW, it costs nothing to try. */
  void markBeatSeen() { last_beat_seen_ = true; }

  Mode mode() const { return mode_; }
  bool headAlive(uint32_t now_ms) const {
    return last_beat_seen_ &&
           (now_ms - last_beat_ms_) <= config_.heartbeat_period_ms * config_.miss_allow;
  }
  uint32_t sampleIntervalMs() const { return interval_ms_; }
  bool incident() const { return incident_; }
  uint32_t flaps() const { return flap_count_; }

 private:
  Config config_;
  Mode mode_;
  uint32_t last_beat_ms_;
  bool last_beat_seen_;
  uint32_t interval_ms_;
  uint32_t rejoin_count_;
  uint32_t flap_count_;
  bool incident_;

 public:
  void init() {
    mode_ = kEspNow;
    last_beat_ms_ = 0;
    last_beat_seen_ = false;
    interval_ms_ = 30000;
    rejoin_count_ = 0;
    flap_count_ = 0;
    incident_ = false;
  }
};

}  // namespace krishi
