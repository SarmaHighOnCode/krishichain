#pragma once
/**
 * Per-device hash chain — ticket H1-05. docs/PROTOCOL.md §2.
 *
 * Signatures alone let anyone downstream drop the inconvenient readings and still present a
 * set of individually valid records. Chaining each record to the digest of its predecessor
 * makes the *set* attestable: an omission becomes a detectable event instead of silence.
 *
 * ORDERING RULE (this is the crash-safety subtlety): commit chain state to store only AFTER
 * the record has been durably appended to the ring buffer. A crash between the two replays
 * one record, which is idempotent on the gateway. A crash in the other order LOSES one,
 * which is permanent. Always prefer duplication over loss.
 */

#include <stdint.h>
#include <string.h>

#include "record.h"

namespace krishi {

class ChainStore {
 public:
  virtual ~ChainStore() = default;
  virtual bool load(uint32_t& nextSeq, uint8_t prevDigest[kDigestLength]) = 0;
  virtual bool save(uint32_t nextSeq, const uint8_t prevDigest[kDigestLength]) = 0;
};

class MemoryChainStore : public ChainStore {
 public:
  MemoryChainStore() : has_data_(false), seq_(0) { memset(digest_, 0, kDigestLength); }

  bool load(uint32_t& nextSeq, uint8_t prevDigest[kDigestLength]) override {
    if (!has_data_) return false;
    nextSeq = seq_;
    memcpy(prevDigest, digest_, kDigestLength);
    return true;
  }

  bool save(uint32_t nextSeq, const uint8_t prevDigest[kDigestLength]) override {
    has_data_ = true;
    seq_ = nextSeq;
    memcpy(digest_, prevDigest, kDigestLength);
    return true;
  }

 private:
  bool has_data_;
  uint32_t seq_;
  uint8_t digest_[kDigestLength];
};

#ifndef KRISHI_NATIVE
class NvsChainStore : public ChainStore {
 public:
  bool load(uint32_t& nextSeq, uint8_t prevDigest[kDigestLength]) override;
  bool save(uint32_t nextSeq, const uint8_t prevDigest[kDigestLength]) override;
};
#endif

class Chain {
 public:
  Chain() = default;

  /** Restore (seq, prevDigest) from store. On a fresh device: seq = 0, prev = all zeros. */
  bool begin(ChainStore& store);
  bool begin();

  uint32_t nextSeq() const { return next_seq_; }
  const uint8_t* prevDigest() const { return prev_digest_; }

  /** Populate `record.seq` and `record.prev` from the current chain state. */
  void stamp(Record& record) const;

  /**
   * Advance the chain after a record has been durably stored.
   * @param digest keccak256 of the record's canonical encoding.
   * NOTE: Saves to store BEFORE updating in-memory state.
   */
  bool advance(const uint8_t digest[kDigestLength]);

  /** Wipe chain state. Only for re-commissioning — this orphans the device's history. */
  static bool reset();

 private:
  ChainStore* store_ = nullptr;
  uint32_t next_seq_ = 0;
  uint8_t prev_digest_[kDigestLength] = {0};
};

}  // namespace krishi
