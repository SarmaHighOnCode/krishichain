package com.krishichain.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Golden-vector test, per CLAUDE.md invariant #1: `packages/core/fixtures/vectors.json` is the
 * referee between the C++ firmware, the TypeScript stack, and (now) this Kotlin port. These
 * exact leaves/root/proofs are hardcoded from that file's `merkle` object — if this test
 * disagrees with the fixture, the Kotlin `hashPair`/`verifyProof` implementation is wrong, not
 * the fixture. Never edit the expected values here to make this test pass.
 *
 * A pure JVM test (no Android framework, no emulator) — `domain/Keccak.kt`, `Hex.kt`, and
 * `Merkle.kt` only depend on Bouncy Castle and the Kotlin stdlib, so `./gradlew test` exercises
 * the real keccak256 + Merkle-proof code path without needing `emulator-5554` at all.
 */
class MerkleVectorsTest {

    private val leaves = listOf(
        "0x100db9069b769632fe00d99fc5e53f6a73bff22111f75f4e1df1d9d44ff0a2c7",
        "0x22037ab51bbb7b66390ef78b83e7be3fe9bd7e7621e7ca5686d1c7449865fa2e",
        "0xcb74eb0430e8019e5c4162577ccff1bcfb6dbf69858daf7e9a7329c4b792b86a",
        "0x3bb067dab1ba743b058bd1667c5d172ac371031613fcd631984c841b43462c2f",
        "0xe956a1d769f407aaf94b548a73f976d9fc4bab73144bf656e7c5d1cb32cdfbc5",
        "0x0cafb1b2c3c6f2476cd03863743616aad95a634e96b33453f0df00daa28d1ecf",
        "0x8b6dc3d2b975afe2c9b6d23206929ee1233019d20d048b9ec42f0e492a681b1b",
        "0x25a5236866098d9b40c16e50b2b9be4cf658ccf3d716d77e2a4e1aa57de28e4b",
    )

    private val root = "0xe8daf639504d59fe82bc80dbcd38582e4c5317346f9878b3d3bc632e8af8f979"

    // vectors.merkle.proofs[i].proof, indexed to match `leaves` above.
    private val proofs: List<List<String>> = listOf(
        listOf(
            "0x22037ab51bbb7b66390ef78b83e7be3fe9bd7e7621e7ca5686d1c7449865fa2e",
            "0xf60e974778ed95dbce2c3fbc5c7a404066b6c92f94a7d06a3042c99d576e27c6",
            "0x87ad627d97ce6400dd6a74cce33c11a994e226289ae55e2b82321165ae70f750",
        ),
        listOf(
            "0x100db9069b769632fe00d99fc5e53f6a73bff22111f75f4e1df1d9d44ff0a2c7",
            "0xf60e974778ed95dbce2c3fbc5c7a404066b6c92f94a7d06a3042c99d576e27c6",
            "0x87ad627d97ce6400dd6a74cce33c11a994e226289ae55e2b82321165ae70f750",
        ),
        listOf(
            "0x3bb067dab1ba743b058bd1667c5d172ac371031613fcd631984c841b43462c2f",
            "0x81233174481188c10e806e20de985f1a3194122586beb6b20b46593387ef65f3",
            "0x87ad627d97ce6400dd6a74cce33c11a994e226289ae55e2b82321165ae70f750",
        ),
        listOf(
            "0xcb74eb0430e8019e5c4162577ccff1bcfb6dbf69858daf7e9a7329c4b792b86a",
            "0x81233174481188c10e806e20de985f1a3194122586beb6b20b46593387ef65f3",
            "0x87ad627d97ce6400dd6a74cce33c11a994e226289ae55e2b82321165ae70f750",
        ),
        listOf(
            "0x0cafb1b2c3c6f2476cd03863743616aad95a634e96b33453f0df00daa28d1ecf",
            "0x5ccb1f97e808c73eedfa38d39c024f930ebcc2deeb6e5c0f897a3faa2398d993",
            "0x671e31b5ec1390e32aa531a7873ec6f8e59fbbf452e72d3648fdf84e67a7b048",
        ),
        listOf(
            "0xe956a1d769f407aaf94b548a73f976d9fc4bab73144bf656e7c5d1cb32cdfbc5",
            "0x5ccb1f97e808c73eedfa38d39c024f930ebcc2deeb6e5c0f897a3faa2398d993",
            "0x671e31b5ec1390e32aa531a7873ec6f8e59fbbf452e72d3648fdf84e67a7b048",
        ),
        listOf(
            "0x25a5236866098d9b40c16e50b2b9be4cf658ccf3d716d77e2a4e1aa57de28e4b",
            "0x056b6f0df03df2fee4e6b80579aa0795780fb19ca852867f8927c2a9dedeea38",
            "0x671e31b5ec1390e32aa531a7873ec6f8e59fbbf452e72d3648fdf84e67a7b048",
        ),
        listOf(
            "0x8b6dc3d2b975afe2c9b6d23206929ee1233019d20d048b9ec42f0e492a681b1b",
            "0x056b6f0df03df2fee4e6b80579aa0795780fb19ca852867f8927c2a9dedeea38",
            "0x671e31b5ec1390e32aa531a7873ec6f8e59fbbf452e72d3648fdf84e67a7b048",
        ),
    )

    @Test
    fun `every leaf's proof recomputes to the documented root`() {
        leaves.forEachIndexed { index, leaf ->
            assertTrue(
                "leaf $index ($leaf) did not verify against the golden root",
                verifyProof(leaf, proofs[index], root),
            )
        }
    }

    @Test
    fun `processProof reproduces the exact root value, not just a truthy match`() {
        leaves.forEachIndexed { index, leaf ->
            assertEquals(root.lowercase(), processProof(leaf, proofs[index]).lowercase())
        }
    }

    @Test
    fun `a tampered proof does not verify`() {
        val tampered = proofs[0].toMutableList()
        tampered[0] = "0x" + "ab".repeat(32)
        assertTrue(!verifyProof(leaves[0], tampered, root))
    }

    @Test
    fun `hashPair is commutative and sorted, matching OpenZeppelin MerkleProof`() {
        val a = leaves[0]
        val b = leaves[1]
        assertEquals(hashPair(a, b), hashPair(b, a))
    }

    @Test
    fun `keccak256 uses original Keccak padding, not NIST SHA3`() {
        // keccak256("") — the well-known empty-input Keccak-256 digest. NIST SHA3-256("") differs
        // (a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a).
        val emptyDigest = keccak256(ByteArray(0)).toHex()
        assertEquals("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", emptyDigest)
    }
}
