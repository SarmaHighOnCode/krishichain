package com.krishichain.app.domain

import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Cross-check test for the companion codec and signer, mirroring `RecordCodecTest`'s golden-
 * vector technique — but there is no shared `vectors.json` fixture for companions (only records
 * and Merkle proofs are in that file). Instead these expected values were generated once by a
 * throwaway `tsx` script that called `encodeCompanion`/`companionDigest`/`signCompanion`/
 * `encodeGpsEvidence`/`gpsEvidenceHash` from `packages/core` directly with the fixed inputs below
 * (same `testPrivateKey`/`testDeviceAddress` as `packages/core/fixtures/vectors.json`), then
 * hardcoded here. The generator script was deleted after use, per the ticket's instructions — it
 * is not part of this repo. If this test ever needs regenerating, the script is trivial to
 * rewrite: build a `CompanionAttestation` with these exact fields and call those four functions.
 */
class CompanionCodecTest {

    // packages/core/fixtures/vectors.json's testPrivateKey / testDeviceAddress.
    private val testPrivateKey = BigInteger(
        "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
        16,
    )
    private val dev: Hex = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23"

    // The genesis record's digest from vectors.json — used as the `subject` here, i.e. this
    // companion attests to that exact record.
    private val subjectDigest: Hex = "0xdc637f1c670546cf66785c2b44e50c29fa835af52a5528050c133e95f3fc07d8"

    private val gps = GpsEvidence(latMicro = 12345678, lonMicro = -122419416, accuracyCm = 500, speedCmS = 0)

    @Test
    fun `GPS evidence encodes to the cross-checked bytes and hash`() {
        assertEquals("0x00bc614ef8b4072801f40000", encodeGpsEvidence(gps).toHex())
        assertEquals(
            "0x581e9137e98b3144e8cfb75c063725e994a378f19c2337af627807595a348120",
            gpsEvidenceHash(gps),
        )
    }

    @Test
    fun `GPS companion encodes, digests and signs to the cross-checked values`() {
        val companion = CompanionAttestation(
            v = COMPANION_VERSION,
            kind = CompanionKind.GPS,
            dev = dev,
            seq = 0,
            ts = 1789012345L,
            subjectDev = dev,
            subjectSeq = 0,
            subject = subjectDigest,
            flags = CompanionFlags.GPS_FIX,
            payload = gpsEvidenceHash(gps),
        )

        assertEquals(
            "0xc101032c7536e3605d9c16a7a3d7b1898e529396a65c2300000000000000006aa229792c7536e3605d9c16a7a3d7b1898e529396a65c2300000000dc637f1c670546cf66785c2b44e50c29fa835af52a5528050c133e95f3fc07d808581e9137e98b3144e8cfb75c063725e994a378f19c2337af627807595a348120",
            encodeCompanionHex(companion),
        )

        val digest = companionDigest(companion)
        assertEquals("0xbf09142bec73e3cc6e08b7b5cd8fd8487b14de6fe206398d6aa9ae58466b05b5", digest)

        val sig = signDigestHex(digest, testPrivateKey)
        assertEquals(
            "0x41a85c8eecce924d1ebc91099f21adbd75eeef0263abcda2ea832ffda3d038c02598e1f510a1bb42cc30ee5a1aaf061dc086210a37296f5f1c08208e8e928c87",
            sig,
        )
    }
}
