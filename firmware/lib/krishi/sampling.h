#pragma once
/**
 * Pure adaptive sampling interval policy (docs/PROTOCOL-LINK.md §6).
 *
 * Bounds: minMs = 10s, maxMs = 300s, default = 30s.
 * Unstable (collapse to minMs):
 *   - |t - t_prev| >= 0.5 C (5 deci-C)
 *   - t is within 2.0 C (20 deci-C) of breach threshold (10.0 C / 100 deci-C)
 *   - any flag bit changed since previous sample
 *   - LID_OPEN, SHOCK, or SENSOR_FAULT is set
 * Stable: after 3 stable samples, interval = min(interval * 1.5, maxMs).
 */

#include <stdint.h>
#include "record.h"

namespace krishi {

struct SamplingConfig {
  uint32_t minMs = 10000;
  uint32_t maxMs = 300000;
  int16_t deltaThresholdDeciC = 5;     // 0.5 C of movement is "unstable"
  int16_t breachTempDeciC = 100;       // 10.0 C, matches gateway rule
  int16_t proximityBandDeciC = 20;     // within 2.0 C of breach is "unstable"
  uint8_t stableSamplesBeforeSlowing = 3;
};

struct SamplingState {
  uint32_t intervalMs = 30000;
  uint8_t stableCount = 0;
  int16_t lastT = 0;
  uint8_t lastFlags = 0;
  bool primed = false;
};

uint32_t nextInterval(SamplingState& state, int16_t t, uint8_t flags, const SamplingConfig& cfg);
bool requiresImmediateSample(const SamplingState& state, uint8_t flags);

}  // namespace krishi
