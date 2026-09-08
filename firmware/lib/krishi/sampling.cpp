#include "sampling.h"
#include <cstdlib>

namespace krishi {

uint32_t nextInterval(SamplingState& state, int16_t t, uint8_t flags, const SamplingConfig& cfg) {
  if (!state.primed) {
    state.primed = true;
    state.lastT = t;
    state.lastFlags = flags;
    state.stableCount = 0;
    return state.intervalMs;
  }

  const bool deltaUnstable = (std::abs(t - state.lastT) >= cfg.deltaThresholdDeciC);
  const bool breachProximityUnstable = (t >= (cfg.breachTempDeciC - cfg.proximityBandDeciC));
  const bool flagChangeUnstable = (flags != state.lastFlags);
  const bool faultFlagUnstable = ((flags & (kFlagLidOpen | kFlagShock | kFlagSensorFault)) != 0);

  if (deltaUnstable || breachProximityUnstable || flagChangeUnstable || faultFlagUnstable) {
    state.intervalMs = cfg.minMs;
    state.stableCount = 0;
  } else {
    state.stableCount++;
    if (state.stableCount >= cfg.stableSamplesBeforeSlowing) {
      state.intervalMs = static_cast<uint32_t>((state.intervalMs * 3) / 2);
      if (state.intervalMs > cfg.maxMs) {
        state.intervalMs = cfg.maxMs;
      }
      state.stableCount = 0;
    }
  }

  state.lastT = t;
  state.lastFlags = flags;
  return state.intervalMs;
}

bool requiresImmediateSample(const SamplingState& state, uint8_t flags) {
  if (!state.primed) return true;
  return flags != state.lastFlags;
}

}  // namespace krishi
