package com.krishichain.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Golden-vector test, per CLAUDE.md invariant #1: `packages/core/fixtures/vectors.json` is the
 * referee between the C++ firmware, the TypeScript stack, and (now) this Kotlin encoder. These
 * exact canonical-hex/digest pairs are hardcoded from that file's `records` array — if this test
 * disagrees with the fixture, `encodeRecord`/`recordDigest` here is wrong, not the fixture. Never
 * edit the expected values below to make this test pass.
 *
 * Same style as `MerkleVectorsTest` — a pure JVM test needing no emulator.
 */
class RecordCodecTest {

    private val dev: Hex = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23"

    // vectors.records[0] "genesis": seq 0, all-zero prev.
    @Test
    fun `genesis record matches the golden vector`() {
        val record = SensorRecord(
            v = 1,
            dev = dev,
            seq = 0,
            prev = ZERO_DIGEST,
            ts = 1789012345L,
            tsq = 2,
            lot = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
            t = 41,
            h = 812,
            lux = 0,
            flags = 16,
            bat = 87,
        )
        assertEquals(
            "0x012c7536e3605d9c16a7a3d7b1898e529396a65c23000000000000000000000000000000000000000000000000000000000000000000000000000000006aa2297902018f2c9a7b3d4e5f8091a2b3c4d5e6f70029032c00001057",
            encodeRecordHex(record),
        )
        assertEquals(
            "0xdc637f1c670546cf66785c2b44e50c29fa835af52a5528050c133e95f3fc07d8",
            recordDigest(record),
        )
    }

    // vectors.records[2] "negative_temperature": int16 sign handling, -18.5C.
    @Test
    fun `negative temperature record matches the golden vector`() {
        val record = SensorRecord(
            v = 1,
            dev = dev,
            seq = 1,
            prev = "0x" + "11".repeat(32),
            ts = 1789012345L,
            tsq = 2,
            lot = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
            t = -185,
            h = 812,
            lux = 0,
            flags = 0,
            bat = 87,
        )
        assertEquals(
            "0x012c7536e3605d9c16a7a3d7b1898e529396a65c23000000011111111111111111111111111111111111111111111111111111111111111111000000006aa2297902018f2c9a7b3d4e5f8091a2b3c4d5e6f7ff47032c00000057",
            encodeRecordHex(record),
        )
        assertEquals(
            "0xf6a3cbb2546692c4e800cd2bd24043a645a7fe64295a0b8766f144a3c5c7fbdd",
            recordDigest(record),
        )
    }

    // vectors.records[3] "temp_sensor_fault": the sentinel this app actually sends for t on
    // every record, since a phone has no calibrated temperature sensor (CLAUDE.md: never
    // fabricate a reading).
    @Test
    fun `temperature sensor fault sentinel matches the golden vector`() {
        val record = SensorRecord(
            v = 1,
            dev = dev,
            seq = 1,
            prev = "0x" + "11".repeat(32),
            ts = 1789012345L,
            tsq = 2,
            lot = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
            t = -32768,
            h = 812,
            lux = 0,
            flags = 4,
            bat = 87,
        )
        assertEquals(
            "0x012c7536e3605d9c16a7a3d7b1898e529396a65c23000000011111111111111111111111111111111111111111111111111111111111111111000000006aa2297902018f2c9a7b3d4e5f8091a2b3c4d5e6f78000032c00000457",
            encodeRecordHex(record),
        )
        assertEquals(
            "0x6f783460c7f1b520c7f4d4450f588f7f3272ebd1822818e5d59e97a7274b4001",
            recordDigest(record),
        )
    }

    // vectors.records[16] "humidity_sensor_fault"-adjacent: humidity fault sentinel — also part
    // of what this app sends on every record.
    @Test
    fun `humidity sensor fault sentinel matches the golden vector`() {
        val record = SensorRecord(
            v = 1,
            dev = dev,
            seq = 1,
            prev = "0x" + "11".repeat(32),
            ts = 1789012345L,
            tsq = 2,
            lot = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
            t = 41,
            h = 65535,
            lux = 0,
            flags = 4,
            bat = 87,
        )
        assertEquals(
            "0x012c7536e3605d9c16a7a3d7b1898e529396a65c23000000011111111111111111111111111111111111111111111111111111111111111111000000006aa2297902018f2c9a7b3d4e5f8091a2b3c4d5e6f70029ffff00000457",
            encodeRecordHex(record),
        )
        assertEquals(
            "0x851099db3fbf9dcb0c85a7435a5b705a97debe2a48b454aadb36fb18ea42799c",
            recordDigest(record),
        )
    }

    // vectors.records[18] "max_values": upper boundary of every numeric field, including a
    // uint32 seq that exceeds Int.MAX_VALUE — exercises the Long-based seq/ts path.
    @Test
    fun `max values boundary record matches the golden vector`() {
        val record = SensorRecord(
            v = 1,
            dev = dev,
            seq = 4294967294L,
            prev = "0x" + "11".repeat(32),
            ts = 4294967295L,
            tsq = 2,
            lot = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
            t = 32767,
            h = 65534,
            lux = 65535,
            flags = 127,
            bat = 100,
        )
        assertEquals(
            "0x012c7536e3605d9c16a7a3d7b1898e529396a65c23fffffffe111111111111111111111111111111111111111111111111111111111111111100000000ffffffff02018f2c9a7b3d4e5f8091a2b3c4d5e6f77ffffffeffff7f64",
            encodeRecordHex(record),
        )
        assertEquals(
            "0xcb5ed9f37ff8c0892592e65d82eacf0683610e96d277dff72e02116353b84040",
            recordDigest(record),
        )
    }
}
