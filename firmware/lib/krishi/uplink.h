#pragma once
/**
 * Gateway uplink — tickets H1-07 and H1-08. docs/PROTOCOL.md §3.
 *
 * Error handling is the whole job here, and the asymmetry matters:
 *
 *   200  advance the buffer tail to `ackSeq`
 *   400  malformed — log, drop the batch, set BOOT on the next record
 *   401  signature invalid or device not registered → STOP uploading, blink fault,
 *        KEEP BUFFERING. A device that is not in DeviceRegistry must not spin forever.
 *   429  backoff 2s → 60s
 *   5xx  gateway down — keep buffering, retry with jitter
 *
 * The node never deletes unacknowledged data on an error. Duplication is idempotent on the
 * gateway; loss is permanent.
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"
#include "roles.h"

namespace krishi {

enum class UplinkResult {
  kOk,
  kNoNetwork,
  kMalformed,      // 400
  kUnauthorised,   // 401 — terminal until the device is registered
  kBackoff,        // 429
  kServerError,    // 5xx / timeout
};

struct UplinkResponse {
  UplinkResult result = UplinkResult::kNoNetwork;
  uint32_t ackSeq = 0;
  uint64_t serverTs = 0;  // used to re-derive the clock offset (FW-08)
  uint32_t accepted = 0;
};

/** Pure: splits a mixed-device peek into contiguous per-device runs. Host-tested. */
size_t groupByDevice(const Record* records, size_t count,
                     size_t* runStarts, size_t* runLengths, size_t maxRuns);

class Uplink {
 public:
  bool begin(const char* gatewayUrl);

  /** POST a batch of records in raw canonical byte blocks for dev. */
  UplinkResponse sendBatch(const uint8_t* canonicalBlock, const uint8_t* signatureBlock,
                           size_t count, const uint8_t dev[kAddressLength]);

  /** Compatibility alias for sendBatch using Record array. */
  UplinkResponse send(const Record* records, const uint8_t* signatures, size_t count,
                      const uint8_t deviceAddress[kAddressLength]);

  bool isOnline() const;
  uint32_t backoffMs() const { return backoffMs_; }

 private:
  const char* gatewayUrl_ = nullptr;
  uint32_t backoffMs_ = 2000;
};

}  // namespace krishi
