package com.krishichain.app.domain

/**
 * Companion attestation encoding — Kotlin port of `packages/core/src/companion.ts`. A companion
 * is a signed statement by one device about *another device's record* (for a phone virtual node
 * with nothing else to witness, its own record — see SWARM-API.md "Companions"), linked by
 * `(subjectDev, subjectSeq, subject)` where `subject` is the record digest.
 *
 * DOMAIN SEPARATION from records: byte 0 is `0xC1` where a record's byte 0 is its version `0x01`,
 * and the lengths differ (124 vs 90), so nothing keccak sees as a companion can be parsed as a
 * record. `payload` is always `keccak256(evidence bytes)`, never the evidence itself.
 *
 * Only GPS (`kind = 3`) is implemented here — the ticket's IMU stretch goal (`kind = 2`) was
 * deliberately not built; see the Android virtual-node report for why.
 */

const val COMPANION_MAGIC = 0xC1
const val COMPANION_LENGTH = 124
const val COMPANION_VERSION = 1

object CompanionKind {
    const val PHOTO = 1
    const val IMU = 2
    const val GPS = 3
}

/** Verdict bits, inside the signed region — the witness attests to these, the server infers
 *  nothing. Only `GPS_FIX` is relevant to a GPS companion. */
object CompanionFlags {
    const val LID_OPEN = 1 shl 0
    const val SHOCK = 1 shl 1
    const val DEGRADED = 1 shl 2
    const val GPS_FIX = 1 shl 3
}

/** Byte offsets of the canonical companion encoding. */
object CompanionOffsets {
    const val MAGIC = 0
    const val V = 1
    const val KIND = 2
    const val DEV = 3
    const val SEQ = 23
    const val TS = 27
    const val SUBJECT_DEV = 35
    const val SUBJECT_SEQ = 55
    const val SUBJECT = 59
    const val FLAGS = 91
    const val PAYLOAD = 92
}

/**
 * One attestation about one record. `seq` is the witness's own counter — unlike a record's `seq`
 * it carries no chain-continuity check, ordering is advisory only.
 */
data class CompanionAttestation(
    val v: Int = COMPANION_VERSION,
    val kind: Int,
    val dev: Hex,
    val seq: Long,
    val ts: Long,
    val subjectDev: Hex,
    val subjectSeq: Long,
    val subject: Hex,
    val flags: Int,
    val payload: Hex,
)

/** Pack a companion into its canonical 124 bytes. */
fun encodeCompanion(c: CompanionAttestation): ByteArray {
    require(c.v in 0..0xff) { "v out of range: ${c.v}" }
    require(c.kind in 1..0xff) { "kind out of range: ${c.kind}" }
    require(c.seq in 0..0xFFFFFFFFL) { "seq out of range: ${c.seq}" }
    require(c.subjectSeq in 0..0xFFFFFFFFL) { "subjectSeq out of range: ${c.subjectSeq}" }
    require(c.flags in 0..0xff) { "flags out of range: ${c.flags}" }
    require(c.ts >= 0L) { "ts out of range: ${c.ts}" }

    val buf = ByteArray(COMPANION_LENGTH)
    buf[CompanionOffsets.MAGIC] = COMPANION_MAGIC.toByte()
    buf[CompanionOffsets.V] = c.v.toByte()
    buf[CompanionOffsets.KIND] = c.kind.toByte()
    writeFixedHex(buf, CompanionOffsets.DEV, c.dev, 20, "dev")
    writeUInt32BE(buf, CompanionOffsets.SEQ, c.seq)
    writeUInt64BE(buf, CompanionOffsets.TS, c.ts)
    writeFixedHex(buf, CompanionOffsets.SUBJECT_DEV, c.subjectDev, 20, "subjectDev")
    writeUInt32BE(buf, CompanionOffsets.SUBJECT_SEQ, c.subjectSeq)
    writeFixedHex(buf, CompanionOffsets.SUBJECT, c.subject, 32, "subject")
    buf[CompanionOffsets.FLAGS] = c.flags.toByte()
    writeFixedHex(buf, CompanionOffsets.PAYLOAD, c.payload, 32, "payload")
    return buf
}

fun encodeCompanionHex(c: CompanionAttestation): Hex = encodeCompanion(c).toHex()

/** keccak256 of the canonical companion — the value that gets signed. */
fun companionDigest(c: CompanionAttestation): Hex = keccak256(encodeCompanion(c)).toHex()

/** Position evidence, 12 bytes. `payload` is `keccak256` of this. */
data class GpsEvidence(
    /** Latitude in micro-degrees: 12345678 means 12.345678 degrees. */
    val latMicro: Int,
    /** Longitude in micro-degrees. */
    val lonMicro: Int,
    /** Horizontal accuracy, centimetres. */
    val accuracyCm: Int,
    /** Ground speed, cm/s. */
    val speedCmS: Int,
)

fun encodeGpsEvidence(gps: GpsEvidence): ByteArray {
    require(gps.latMicro in -90_000_000..90_000_000) { "latMicro out of range: ${gps.latMicro}" }
    require(gps.lonMicro in -180_000_000..180_000_000) { "lonMicro out of range: ${gps.lonMicro}" }
    require(gps.accuracyCm in 0..0xffff) { "accuracyCm out of range: ${gps.accuracyCm}" }
    require(gps.speedCmS in 0..0xffff) { "speedCmS out of range: ${gps.speedCmS}" }

    val buf = ByteArray(12)
    writeInt32BE(buf, 0, gps.latMicro)
    writeInt32BE(buf, 4, gps.lonMicro)
    writeUInt16BE(buf, 8, gps.accuracyCm)
    writeUInt16BE(buf, 10, gps.speedCmS)
    return buf
}

fun gpsEvidenceHash(gps: GpsEvidence): Hex = keccak256(encodeGpsEvidence(gps)).toHex()
