/**
 * Companion attestations — ticket S1-14, ADR-0004 §1.
 *
 * A CAM witness photographs a crate; a phone reports GPS and a shock event. None of that
 * fits in the 90-byte canonical record, and it must not: PROTOCOL v1 is frozen and the
 * golden vectors are the referee between C++ and TypeScript. Widening the record to carry
 * a photo hash would invalidate both implementations mid-build.
 *
 * So companions ride *alongside* a record, linked by `(subjectDev, subjectSeq, subject)`,
 * and carry their own signature from their own device key. The canonical record is
 * untouched; the evidence around it gets denser.
 *
 * DOMAIN SEPARATION. Companions are signed by the same secp256k1 keys, over the same
 * keccak256 construction, as records. If the two encodings could collide, a witness
 * signature could be replayed as a sensor reading. Two things prevent it: byte 0 is
 * `0xC1` where a record's is its version byte `0x01`, and the lengths differ (124 vs 90).
 * Nothing keccak sees as a companion can be parsed as a record.
 *
 * WHAT IS SIGNED. `payload` is always `keccak256(evidence bytes)` — the image for a PHOTO,
 * the fixed-length struct for IMU and GPS. One rule, every kind. The verdict bits live in
 * `flags` inside the signed region, so "the lid was open" is attested by the device rather
 * than asserted by our server. That distinction is the whole project.
 */

import { keccak256, signDigest, verifyDigest, type VerifyResult } from "./crypto.js";
import { bytesToHex, hexToBytes } from "./record.js";
import type { Hex } from "./types.js";

/** Byte 0 of every companion. Separates the companion domain from the record domain. */
export const COMPANION_MAGIC = 0xc1;

/** Fixed canonical length. Like the record, there is exactly one valid serialisation. */
export const COMPANION_LENGTH = 124;

/** Companion protocol version. Independent of the record version — this one may grow. */
export const COMPANION_VERSION = 1;

/** What kind of witness this is. */
export const CompanionKind = {
  /** ESP32-CAM: keccak256 of the captured frame plus a lid open/closed verdict. */
  PHOTO: 1,
  /** Accelerometer: peak shock magnitude over a window. */
  IMU: 2,
  /** Phone or tracker: position fix. */
  GPS: 3,
} as const;

export type CompanionKindValue = (typeof CompanionKind)[keyof typeof CompanionKind];

/** Verdict bits. Inside the signed region — the device attests to these, we do not infer them. */
export const CompanionFlags = {
  /** The witness observed the lid or seal open. The CAM's headline verdict. */
  LID_OPEN: 1 << 0,
  /** An impact above the configured threshold occurred in this window. */
  SHOCK: 1 << 1,
  /** Capture succeeded but conditions were poor: dark frame, low satellite count. */
  DEGRADED: 1 << 2,
  /** A valid position fix backs this attestation. */
  GPS_FIX: 1 << 3,
} as const;

/** Byte offsets of the canonical companion encoding. */
export const COMPANION_OFFSETS = {
  magic: 0,
  v: 1,
  kind: 2,
  dev: 3,
  seq: 23,
  ts: 27,
  subjectDev: 35,
  subjectSeq: 55,
  subject: 59,
  flags: 91,
  payload: 92,
} as const;

/**
 * One attestation about one record.
 *
 * `seq` is the witness's own counter. Unlike a record's `seq` it carries no chain: a
 * companion makes a claim about someone else's history, so its own ordering is advisory.
 * Replay is prevented by `(dev, seq, subject)` being unique, not by chain continuity.
 */
export interface CompanionAttestation {
  v: number;
  kind: CompanionKindValue;
  /** The witnessing device — the CAM or the phone, not the node being witnessed. */
  dev: Hex;
  /** Monotonic per witness. Advisory ordering only. */
  seq: number;
  /** Witness's belief about the time, unix seconds. */
  ts: bigint;
  /** Device whose record this attests to. */
  subjectDev: Hex;
  /** `seq` of that record. */
  subjectSeq: number;
  /** Digest of that record — the actual cryptographic link. */
  subject: Hex;
  /** Bitfield of `CompanionFlags`. */
  flags: number;
  /** keccak256 of the evidence bytes. Never the evidence itself. */
  payload: Hex;
}

/** A companion as it travels over the wire. */
export interface SignedCompanion extends CompanionAttestation {
  /** 64 bytes r || s, low-s normalised, exactly as for records. */
  sig: Hex;
}

function writeFixed(buf: Uint8Array, offset: number, hex: Hex, length: number, field: string): void {
  const bytes = hexToBytes(hex);
  if (bytes.length !== length) {
    throw new Error(`${field}: expected ${length} bytes, got ${bytes.length}`);
  }
  buf.set(bytes, offset);
}

function assertRange(value: number, min: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field}: ${value} out of range [${min}, ${max}]`);
  }
}

/** Pack a companion into its canonical 124 bytes. */
export function encodeCompanion(c: CompanionAttestation): Uint8Array {
  assertRange(c.v, 0, 0xff, "v");
  assertRange(c.kind, 1, 0xff, "kind");
  assertRange(c.seq, 0, 0xffffffff, "seq");
  assertRange(c.subjectSeq, 0, 0xffffffff, "subjectSeq");
  assertRange(c.flags, 0, 0xff, "flags");
  if (c.ts < 0n || c.ts > 0xffffffffffffffffn) {
    throw new Error(`ts: ${c.ts} out of uint64 range`);
  }

  const buf = new Uint8Array(COMPANION_LENGTH);
  const dv = new DataView(buf.buffer);

  dv.setUint8(COMPANION_OFFSETS.magic, COMPANION_MAGIC);
  dv.setUint8(COMPANION_OFFSETS.v, c.v);
  dv.setUint8(COMPANION_OFFSETS.kind, c.kind);
  writeFixed(buf, COMPANION_OFFSETS.dev, c.dev, 20, "dev");
  dv.setUint32(COMPANION_OFFSETS.seq, c.seq, false);
  dv.setBigUint64(COMPANION_OFFSETS.ts, c.ts, false);
  writeFixed(buf, COMPANION_OFFSETS.subjectDev, c.subjectDev, 20, "subjectDev");
  dv.setUint32(COMPANION_OFFSETS.subjectSeq, c.subjectSeq, false);
  writeFixed(buf, COMPANION_OFFSETS.subject, c.subject, 32, "subject");
  dv.setUint8(COMPANION_OFFSETS.flags, c.flags);
  writeFixed(buf, COMPANION_OFFSETS.payload, c.payload, 32, "payload");

  return buf;
}

/** Unpack canonical bytes. Round-trips exactly with `encodeCompanion`. */
export function decodeCompanion(bytes: Uint8Array): CompanionAttestation {
  if (bytes.length !== COMPANION_LENGTH) {
    throw new Error(`canonical companion must be ${COMPANION_LENGTH} bytes, got ${bytes.length}`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint8(COMPANION_OFFSETS.magic);
  if (magic !== COMPANION_MAGIC) {
    throw new Error(
      `companion magic must be 0x${COMPANION_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }

  return {
    v: dv.getUint8(COMPANION_OFFSETS.v),
    kind: dv.getUint8(COMPANION_OFFSETS.kind) as CompanionKindValue,
    dev: bytesToHex(bytes.subarray(COMPANION_OFFSETS.dev, COMPANION_OFFSETS.dev + 20)),
    seq: dv.getUint32(COMPANION_OFFSETS.seq, false),
    ts: dv.getBigUint64(COMPANION_OFFSETS.ts, false),
    subjectDev: bytesToHex(
      bytes.subarray(COMPANION_OFFSETS.subjectDev, COMPANION_OFFSETS.subjectDev + 20),
    ),
    subjectSeq: dv.getUint32(COMPANION_OFFSETS.subjectSeq, false),
    subject: bytesToHex(bytes.subarray(COMPANION_OFFSETS.subject, COMPANION_OFFSETS.subject + 32)),
    flags: dv.getUint8(COMPANION_OFFSETS.flags),
    payload: bytesToHex(bytes.subarray(COMPANION_OFFSETS.payload, COMPANION_OFFSETS.payload + 32)),
  };
}

/** keccak256 of the canonical companion. The value that gets signed. */
export function companionDigest(c: CompanionAttestation): Hex {
  return keccak256(encodeCompanion(c));
}

/** Sign a companion with the witness's device key. Deterministic and low-s, as for records. */
export function signCompanion(c: CompanionAttestation, privateKey: Uint8Array | Hex): Hex {
  return signDigest(companionDigest(c), privateKey);
}

/** Verify a companion against the witness address it claims. */
export function verifyCompanion(c: CompanionAttestation, sig: Hex): VerifyResult {
  return verifyDigest(companionDigest(c), sig, c.dev);
}

// ---------------------------------------------------------------------------
// Evidence encodings. `payload` is keccak256 of these bytes, for every kind.
//
// The gateway receives the evidence in the clear, recomputes the hash and compares it to
// the signed `payload`. A witness cannot therefore sign one set of numbers and report
// another. For a PHOTO the evidence is the image, which stays on the device — we can only
// confirm that the hash we were handed is the one that was signed, which is exactly the
// claim we make on the consumer page.
// ---------------------------------------------------------------------------

/** Accelerometer evidence, 8 bytes. */
export interface ImuEvidence {
  /** Peak acceleration over the window, milli-g. */
  peakMilliG: number;
  /** How long the event lasted, milliseconds. */
  durationMs: number;
  /** Sampling rate the peak was observed at, Hz. Context for the magnitude. */
  sampleHz: number;
}

/** Position evidence, 12 bytes. */
export interface GpsEvidence {
  /** Latitude in micro-degrees. 12345678 means 12.345678 degrees. */
  latMicro: number;
  /** Longitude in micro-degrees. */
  lonMicro: number;
  /** Horizontal accuracy, centimetres. */
  accuracyCm: number;
  /** Ground speed, cm/s. */
  speedCmS: number;
}

export function encodeImuEvidence(imu: ImuEvidence): Uint8Array {
  assertRange(imu.peakMilliG, 0, 0xffff, "peakMilliG");
  assertRange(imu.durationMs, 0, 0xffff, "durationMs");
  assertRange(imu.sampleHz, 0, 0xffff, "sampleHz");

  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, imu.peakMilliG, false);
  dv.setUint16(2, imu.durationMs, false);
  dv.setUint16(4, imu.sampleHz, false);
  dv.setUint16(6, 0, false); // reserved, must be zero
  return buf;
}

export function decodeImuEvidence(bytes: Uint8Array): ImuEvidence {
  if (bytes.length !== 8) throw new Error(`IMU evidence must be 8 bytes, got ${bytes.length}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    peakMilliG: dv.getUint16(0, false),
    durationMs: dv.getUint16(2, false),
    sampleHz: dv.getUint16(4, false),
  };
}

export function encodeGpsEvidence(gps: GpsEvidence): Uint8Array {
  assertRange(gps.latMicro, -90_000_000, 90_000_000, "latMicro");
  assertRange(gps.lonMicro, -180_000_000, 180_000_000, "lonMicro");
  assertRange(gps.accuracyCm, 0, 0xffff, "accuracyCm");
  assertRange(gps.speedCmS, 0, 0xffff, "speedCmS");

  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setInt32(0, gps.latMicro, false);
  dv.setInt32(4, gps.lonMicro, false);
  dv.setUint16(8, gps.accuracyCm, false);
  dv.setUint16(10, gps.speedCmS, false);
  return buf;
}

export function decodeGpsEvidence(bytes: Uint8Array): GpsEvidence {
  if (bytes.length !== 12) throw new Error(`GPS evidence must be 12 bytes, got ${bytes.length}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    latMicro: dv.getInt32(0, false),
    lonMicro: dv.getInt32(4, false),
    accuracyCm: dv.getUint16(8, false),
    speedCmS: dv.getUint16(10, false),
  };
}

export function imuEvidenceHash(imu: ImuEvidence): Hex {
  return keccak256(encodeImuEvidence(imu));
}

export function gpsEvidenceHash(gps: GpsEvidence): Hex {
  return keccak256(encodeGpsEvidence(gps));
}
