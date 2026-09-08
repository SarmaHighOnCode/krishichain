/**
 * Protocol types. Mirrors docs/PROTOCOL.md §1.
 *
 * INVARIANT: this file and firmware/lib/krishi/record.h describe the same 90 bytes.
 * Changing either without the other is a protocol break — bump PROTOCOL_VERSION and
 * regenerate the golden vectors in the same PR.
 */

export type Hex = `0x${string}`;

/** Protocol version. Occupies byte 0 of every canonical record. */
export const PROTOCOL_VERSION = 1;

/** Total canonical payload length in bytes. Fixed — there is exactly one valid encoding. */
export const CANONICAL_LENGTH = 90;

/** Byte offsets of each field in the canonical encoding (PROTOCOL.md §1.1). */
export const OFFSETS = {
  v: 0,
  dev: 1,
  seq: 21,
  prev: 25,
  ts: 57,
  tsq: 65,
  lot: 66,
  t: 82,
  h: 84,
  lux: 86,
  flags: 88,
  bat: 89,
} as const;

/** Record flag bits (PROTOCOL.md §1.2). Bit 7 is reserved and must be zero. */
export const Flags = {
  /** Lid/seal sensor reports open at capture time. */
  LID_OPEN: 1 << 0,
  /** Accelerometer threshold exceeded since the previous record. */
  SHOCK: 1 << 1,
  /** At least one sensor returned a fault sentinel. */
  SENSOR_FAULT: 1 << 2,
  /** Written to flash while offline rather than sent live. */
  BUFFERED: 1 << 3,
  /** First record after a boot — a power loss or reset happened. */
  BOOT: 1 << 4,
  /** This record is the one that bound `lot`. */
  LOT_BOUND: 1 << 5,
  /** This record is a calibration reading. */
  CAL: 1 << 6,
} as const;

/**
 * Time quality. A device that has never reached NTP still records, but says so.
 * We never silently present an unsynced timestamp as fact (PRD §3).
 */
export const TimeQuality = {
  /** Never synced since boot. Timestamp is a guess. */
  UNSYNCED: 0,
  /** Synced, but more than an hour ago. */
  STALE: 1,
  /** Synced within the last hour. */
  FRESH: 2,
} as const;

export type TimeQualityValue = (typeof TimeQuality)[keyof typeof TimeQuality];

/** Sentinel written when a sensor fails. Never fabricate a plausible reading instead. */
export const SENSOR_FAULT_TEMP = -32768;
export const SENSOR_FAULT_HUMIDITY = 0xffff;
/** `bat` value meaning "mains powered, no battery". */
export const BATTERY_MAINS = 0xff;

/** 32 zero bytes. The `prev` of a genesis record. */
export const ZERO_DIGEST: Hex = `0x${"00".repeat(32)}`;
/** 16 zero bytes. The `lot` of an unbound record. */
export const ZERO_LOT: Hex = `0x${"00".repeat(16)}`;

/**
 * One observation. The atom of the system: signed individually, chained per device,
 * batched into a Merkle tree, committed on-chain.
 */
export interface SensorRecord {
  /** Protocol version. */
  v: number;
  /** Device address, 20 bytes: keccak256(uncompressedPubkey[1:])[12:]. */
  dev: Hex;
  /** Monotonic per device. Genesis is 0. Never reused, never skipped. */
  seq: number;
  /** Digest of record seq-1, or ZERO_DIGEST at genesis. */
  prev: Hex;
  /** Unix seconds — the device's *belief* about the time. See `tsq`. */
  ts: bigint;
  /** How much that belief is worth. */
  tsq: TimeQualityValue;
  /** Lot ULID, 16 bytes. ZERO_LOT when unbound. */
  lot: Hex;
  /** Temperature in deci-degrees Celsius. 254 = 25.4C. SENSOR_FAULT_TEMP on failure. */
  t: number;
  /** Relative humidity in deci-percent. 655 = 65.5%. SENSOR_FAULT_HUMIDITY on failure. */
  h: number;
  /** Ambient light in lux, clamped to uint16. A tamper signal inside a sealed box. */
  lux: number;
  /** Bitfield of `Flags`. */
  flags: number;
  /** Battery percent 0-100, or BATTERY_MAINS. */
  bat: number;
}

/** A record as it travels over the wire, with its signature attached. */
export interface SignedRecord extends SensorRecord {
  /** 64 bytes: r || s, with s normalised to the lower half of the curve order. */
  sig: Hex;
}
