package com.krishichain.app.domain

/**
 * Canonical sensor-record encoding — Kotlin port of `packages/core/src/record.ts::encodeRecord`.
 * PROTOCOL.md §1.1: the concatenation of the fields below, in this exact order, big-endian,
 * fixed-width, no delimiters, no field names. Cross-checked byte-for-byte against
 * `packages/core/fixtures/vectors.json` in `RecordCodecTest` — per CLAUDE.md invariant #1, if
 * this file ever disagrees with a vector, this file is wrong.
 */

/** Total canonical length, bytes. PROTOCOL.md §1.1. */
const val CANONICAL_RECORD_LENGTH = 90

/** Current protocol version. */
const val PROTOCOL_VERSION = 1

/** 32 zero bytes — `prev` for a genesis (`seq = 0`) record. */
val ZERO_DIGEST: Hex = "0x" + "00".repeat(32)

/** 16 zero bytes — `lot` when the record is not bound to a lot yet. */
val ZERO_LOT: Hex = "0x" + "00".repeat(16)

/**
 * One sensor reading, before signing. Mirrors `SensorRecord` in `packages/core/src/types.ts`.
 * `ts` is unix seconds; a `Long` is plenty (unix seconds won't approach `Long.MAX_VALUE`) and
 * avoids `BigInteger`/`ULong` ceremony the TS side needs `bigint` for only because JS numbers
 * lose precision past 2^53.
 */
data class SensorRecord(
    val v: Int = PROTOCOL_VERSION,
    val dev: Hex,
    val seq: Long,
    val prev: Hex,
    val ts: Long,
    val tsq: Int,
    val lot: Hex,
    val t: Int,
    val h: Int,
    val lux: Int,
    val flags: Int,
    val bat: Int,
)

/** Byte offsets of the canonical record encoding, PROTOCOL.md §1.1. */
object RecordOffsets {
    const val V = 0
    const val DEV = 1
    const val SEQ = 21
    const val PREV = 25
    const val TS = 57
    const val TSQ = 65
    const val LOT = 66
    const val T = 82
    const val H = 84
    const val LUX = 86
    const val FLAGS = 88
    const val BAT = 89
}

/** Pack a record into its canonical 90 bytes. Validation is strict on purpose — a record that
 *  can't be encoded is a bug to surface here, not to silently coerce (mirrors `record.ts`'s
 *  `assertRange`). */
fun encodeRecord(record: SensorRecord): ByteArray {
    require(record.v in 0..0xff) { "v out of range: ${record.v}" }
    require(record.seq in 0..0xFFFFFFFFL) { "seq out of range: ${record.seq}" }
    require(record.tsq in 0..2) { "tsq out of range: ${record.tsq}" }
    require(record.t in -32768..32767) { "t out of range: ${record.t}" }
    require(record.h in 0..0xffff) { "h out of range: ${record.h}" }
    require(record.lux in 0..0xffff) { "lux out of range: ${record.lux}" }
    require(record.flags in 0..0xff) { "flags out of range: ${record.flags}" }
    require(record.flags and 0x80 == 0) { "flags: bit 7 is reserved and must be zero" }
    require(record.bat in 0..0xff) { "bat out of range: ${record.bat}" }
    require(record.ts >= 0L) { "ts out of range: ${record.ts}" }

    val buf = ByteArray(CANONICAL_RECORD_LENGTH)
    buf[RecordOffsets.V] = record.v.toByte()
    writeFixedHex(buf, RecordOffsets.DEV, record.dev, 20, "dev")
    writeUInt32BE(buf, RecordOffsets.SEQ, record.seq)
    writeFixedHex(buf, RecordOffsets.PREV, record.prev, 32, "prev")
    writeUInt64BE(buf, RecordOffsets.TS, record.ts)
    buf[RecordOffsets.TSQ] = record.tsq.toByte()
    writeFixedHex(buf, RecordOffsets.LOT, record.lot, 16, "lot")
    writeInt16BE(buf, RecordOffsets.T, record.t)
    writeUInt16BE(buf, RecordOffsets.H, record.h)
    writeUInt16BE(buf, RecordOffsets.LUX, record.lux)
    buf[RecordOffsets.FLAGS] = record.flags.toByte()
    buf[RecordOffsets.BAT] = record.bat.toByte()
    return buf
}

/** Canonical bytes as a `0x`-prefixed hex string. Handy for tests and logging. */
fun encodeRecordHex(record: SensorRecord): Hex = encodeRecord(record).toHex()

/** keccak256 of the canonical encoding — the value that gets signed and Merkled. */
fun recordDigest(record: SensorRecord): Hex = keccak256(encodeRecord(record)).toHex()

// ---------------------------------------------------------------------------
// Big-endian fixed-width writers, shared with CompanionCodec.kt (same package).
// ---------------------------------------------------------------------------

/** Decode `hex` and copy it into `buf` at `offset`, requiring an exact `length` match. */
internal fun writeFixedHex(buf: ByteArray, offset: Int, hex: Hex, length: Int, field: String) {
    val bytes = hexToBytes(hex)
    require(bytes.size == length) { "$field: expected $length bytes, got ${bytes.size}" }
    System.arraycopy(bytes, 0, buf, offset, length)
}

internal fun writeUInt16BE(buf: ByteArray, offset: Int, value: Int) {
    buf[offset] = ((value ushr 8) and 0xff).toByte()
    buf[offset + 1] = (value and 0xff).toByte()
}

/** Writes a signed 16-bit value as its two's-complement big-endian bytes. */
internal fun writeInt16BE(buf: ByteArray, offset: Int, value: Int) {
    val unsigned = value and 0xffff
    buf[offset] = ((unsigned ushr 8) and 0xff).toByte()
    buf[offset + 1] = (unsigned and 0xff).toByte()
}

internal fun writeInt32BE(buf: ByteArray, offset: Int, value: Int) {
    buf[offset] = ((value ushr 24) and 0xff).toByte()
    buf[offset + 1] = ((value ushr 16) and 0xff).toByte()
    buf[offset + 2] = ((value ushr 8) and 0xff).toByte()
    buf[offset + 3] = (value and 0xff).toByte()
}

internal fun writeUInt32BE(buf: ByteArray, offset: Int, value: Long) {
    buf[offset] = ((value ushr 24) and 0xffL).toByte()
    buf[offset + 1] = ((value ushr 16) and 0xffL).toByte()
    buf[offset + 2] = ((value ushr 8) and 0xffL).toByte()
    buf[offset + 3] = (value and 0xffL).toByte()
}

internal fun writeUInt64BE(buf: ByteArray, offset: Int, value: Long) {
    for (i in 0..7) {
        buf[offset + i] = ((value ushr (8 * (7 - i))) and 0xffL).toByte()
    }
}
