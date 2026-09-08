#pragma once
/**
 * Per-device hash chain — ticket H1-05. docs/PROTOCOL.md §2.
 *
 * Signatures alone let anyone downstream drop the inconvenient readings and still present a
 * set of individually valid records. Chaining each record to the digest of its predecessor
 * makes the *set* attestable: an omission becomes a detectable event instead of silence.
 *
 * ORDERING RULE (this is the crash-safety subtlety): commit chain state to NVS only AFTER
 * the record has been durably appended to the ring buffer. A crash between the two replays
 * one record, which is idempotent on the gateway. A crash in the other order LOSES one,
 * which is permanent. Always prefer duplication over loss.
 */

#include <stdint.h>

#include "record.h"

namespace krishi {

class Chain {
 public:
  /** Restore (seq, prevDigest) from NVS. On a fresh device: seq = 0, prev = all zeros. */
  bool begin();

  uint32_t nextSeq() const { return next_seq_; }
  const uint8_t* prevDigest() const { return prev_digest_; }

  /** Populate `record.seq` and `record.prev` from the current chain state. */
  void stamp(Record& record) const;

  /**
   * Advance the chain after a record has been durably stored.
   * @param digest keccak256 of the record's canonical encoding.
   */
  bool advance(const uint8_t digest[kDigestLength]);

  /** Wipe chain state. Only for re-commissioning — this orphans the device's history. */
  static bool reset();

 private:
  uint32_t next_seq_ = 0;
  uint8_t prev_digest_[kDigestLength] = {0};
};

}  // namespace krishi
