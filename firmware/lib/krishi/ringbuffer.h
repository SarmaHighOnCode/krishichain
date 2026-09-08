#pragma once
/**
 * Crash-safe flash ring buffer — ticket H1-06. This is where the offline demo lives.
 *
 * Every record is appended here BEFORE any attempt to transmit. Online is treated as a lucky
 * special case of offline, not the other way round; that inversion is the whole reason the
 * "pull the WiFi" demo beat works (docs/DEMO-SCRIPT.md, 3:00).
 *
 * Slot layout (96 bytes, in the dedicated `krishibuf` partition — see partitions.csv):
 *
 *   [ magic:2 | len:2 | canonical record:90 | crc32:4 ... ]
 *
 * Recovery is by scan on boot: read every slot, reject any whose magic or CRC fails (a torn
 * write from a power cut), and take the highest contiguous seq as the head. NVS is
 * deliberately not used — it is a key-value store with its own GC, the wrong shape for an
 * append-only log we must recover by scanning.
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"

namespace krishi {

struct BufferStats {
  uint32_t count;       // records currently held
  uint32_t capacity;    // total slots
  uint32_t oldest_seq;
  uint32_t newest_seq;
  uint32_t torn_slots;  // slots discarded during recovery — surfaces power-cut events
};

class RingBuffer {
 public:
  /** Mount the partition and recover head/tail by scan. Safe after an unclean shutdown. */
  bool begin();

  /** Append a record plus its signature. Durable before returning. */
  bool append(const Record& record, const uint8_t signature[kSignatureLength]);

  /**
   * Read up to `max` records from the tail, oldest first, without consuming them.
   * The tail only advances on an acknowledged upload (`releaseThrough`), so a gateway crash
   * mid-batch cannot lose data.
   */
  size_t peek(Record* out_records, uint8_t* out_signatures, size_t max) const;

  /** Drop everything up to and including `ackSeq` (PROTOCOL.md §3.3). */
  bool releaseThrough(uint32_t ack_seq);

  bool isEmpty() const;
  BufferStats stats() const;

  /** Erase the whole buffer. Commissioning only. */
  static bool format();
};

}  // namespace krishi
