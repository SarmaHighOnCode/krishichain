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
  uint32_t ack_seq = 0;
  uint64_t server_ts = 0;  // used to re-derive the clock offset (FW-08)
  uint32_t accepted = 0;
};

class Uplink {
 public:
  bool begin(const char* gateway_url);

  /** POST a batch of up to 100 records (PROTOCOL.md §3.2). */
  UplinkResponse send(const Record* records, const uint8_t* signatures, size_t count,
                      const uint8_t device_address[kAddressLength]);

  bool isOnline() const;

  /** Current backoff delay in ms. Grows 2s → 60s on failure, resets on success. */
  uint32_t backoffMs() const { return backoff_ms_; }

 private:
  const char* gateway_url_ = nullptr;
  uint32_t backoff_ms_ = 2000;
};

}  // namespace krishi
