/**
 * Canonical record encoding — the single most safety-critical file in the repo.
 *
 * The canonical form is the concatenation of the fields in the exact order of
 * PROTOCOL.md §1.1, big-endian, fixed width, no delimiters and no field names.
 * Fixed-length was chosen over CBOR/JSON precisely so that C++ and TypeScript
 * cannot disagree: there is exactly one valid serialisation of a given record.
 *
 * If your code and a golden vector disagree, your code is wrong. Never edit a
 * vector to make a test pass.
 */

import { CANONICAL_LENGTH, PROTOCOL_VERSION, type Hex, type SensorRecord, type TimeQualityValue } from "./types.js";

export function hexToBytes(hex: Hex | string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex: ${hex}`);
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}`;
}

function writeFixed(view: Uint8Array, offset: number, value: Hex, expectedLength: number, field: string): void {
  const bytes = hexToBytes(value);
  if (bytes.length !== expectedLength) {
    throw new Error(`${field}: expected ${expectedLength} bytes, got ${bytes.length}`);
  }
  view.set(bytes, offset);
}

function assertRange(value: number, min: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field}: ${value} out of range [${min}, ${max}]`);
  }
}

/**
 * Pack a record into its canonical 90 bytes.
 *
 * Validation is strict and deliberate: a record that cannot be encoded is a bug to
 * surface at the source, not a record to silently coerce. The firmware has no room
 * for coercion logic, so neither do we.
 */
export function encodeRecord(record: SensorRecord): Uint8Array {
  assertRange(record.v, 0, 0xff, "v");
  assertRange(record.seq, 0, 0xffffffff, "seq");
  assertRange(record.tsq, 0, 2, "tsq");
  assertRange(record.t, -32768, 32767, "t");
  assertRange(record.h, 0, 0xffff, "h");
  assertRange(record.lux, 0, 0xffff, "lux");
  assertRange(record.flags, 0, 0xff, "flags");
  assertRange(record.bat, 0, 0xff, "bat");
  if (record.flags & 0x80) throw new Error("flags: bit 7 is reserved and must be zero");
  if (record.ts < 0n || record.ts > 0xffffffffffffffffn) throw new Error(`ts: ${record.ts} out of uint64 range`);

  const buf = new Uint8Array(CANONICAL_LENGTH);
  const dv = new DataView(buf.buffer);

  dv.setUint8(0, record.v);
  writeFixed(buf, 1, record.dev, 20, "dev");
  dv.setUint32(21, record.seq, false);
  writeFixed(buf, 25, record.prev, 32, "prev");
  dv.setBigUint64(57, record.ts, false);
  dv.setUint8(65, record.tsq);
  writeFixed(buf, 66, record.lot, 16, "lot");
  dv.setInt16(82, record.t, false);
  dv.setUint16(84, record.h, false);
  dv.setUint16(86, record.lux, false);
  dv.setUint8(88, record.flags);
  dv.setUint8(89, record.bat);

  return buf;
}

/** Unpack canonical bytes back into a record. Round-trips exactly with `encodeRecord`. */
export function decodeRecord(bytes: Uint8Array): SensorRecord {
  if (bytes.length !== CANONICAL_LENGTH) {
    throw new Error(`canonical record must be ${CANONICAL_LENGTH} bytes, got ${bytes.length}`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    v: dv.getUint8(0),
    dev: bytesToHex(bytes.subarray(1, 21)),
    seq: dv.getUint32(21, false),
    prev: bytesToHex(bytes.subarray(25, 57)),
    ts: dv.getBigUint64(57, false),
    tsq: dv.getUint8(65) as TimeQualityValue,
    lot: bytesToHex(bytes.subarray(66, 82)),
    t: dv.getInt16(82, false),
    h: dv.getUint16(84, false),
    lux: dv.getUint16(86, false),
    flags: dv.getUint8(88),
    bat: dv.getUint8(89),
  };
}

/** Canonical bytes as a hex string. Handy in tests and vectors. */
export function encodeRecordHex(record: SensorRecord): Hex {
  return bytesToHex(encodeRecord(record));
}

/** True if the record claims the current protocol version. */
export function isCurrentVersion(record: SensorRecord): boolean {
  return record.v === PROTOCOL_VERSION;
}
