#include "chain.h"

#include <string.h>

#ifndef KRISHI_NATIVE
#include <Preferences.h>
#endif

namespace krishi {

#ifndef KRISHI_NATIVE
bool NvsChainStore::load(uint32_t& nextSeq, uint8_t prevDigest[kDigestLength]) {
  Preferences prefs;
  if (!prefs.begin("krishi_chain", true)) {
    return false;
  }
  nextSeq = prefs.getUInt("seq", 0);
  size_t len = prefs.getBytes("prev", prevDigest, kDigestLength);
  prefs.end();
  if (len != kDigestLength) {
    memset(prevDigest, 0, kDigestLength);
  }
  return true;
}

bool NvsChainStore::save(uint32_t nextSeq, const uint8_t prevDigest[kDigestLength]) {
  Preferences prefs;
  if (!prefs.begin("krishi_chain", false)) {
    return false;
  }
  prefs.putUInt("seq", nextSeq);
  prefs.putBytes("prev", prevDigest, kDigestLength);
  prefs.end();
  return true;
}
#endif

bool Chain::begin(ChainStore& store) {
  store_ = &store;
  uint32_t loaded_seq = 0;
  uint8_t loaded_prev[kDigestLength] = {0};

  if (store_->load(loaded_seq, loaded_prev)) {
    next_seq_ = loaded_seq;
    memcpy(prev_digest_, loaded_prev, kDigestLength);
  } else {
    next_seq_ = 0;
    memset(prev_digest_, 0, kDigestLength);
  }
  return true;
}

bool Chain::begin() {
#ifndef KRISHI_NATIVE
  static NvsChainStore default_store;
  return begin(default_store);
#else
  static MemoryChainStore default_store;
  return begin(default_store);
#endif
}

void Chain::stamp(Record& record) const {
  record.seq = next_seq_;
  memcpy(record.prev, prev_digest_, kDigestLength);
}

bool Chain::advance(const uint8_t digest[kDigestLength]) {
  if (!store_) return false;

  uint32_t next_seq = next_seq_ + 1;

  // IMPORTANT: Save to store BEFORE updating in-memory state!
  if (!store_->save(next_seq, digest)) {
    return false;
  }

  next_seq_ = next_seq;
  memcpy(prev_digest_, digest, kDigestLength);
  return true;
}

bool Chain::reset() {
#ifndef KRISHI_NATIVE
  Preferences prefs;
  if (prefs.begin("krishi_chain", false)) {
    prefs.clear();
    prefs.end();
    return true;
  }
  return false;
#else
  return true;
#endif
}

}  // namespace krishi
