package com.krishichain.app.domain

/**
 * Merkle proof verification — Kotlin port of `packages/core/src/merkle.ts`. Sorted-pair
 * keccak256, matching OpenZeppelin's `MerkleProof` so a proof verifies identically on-chain, in
 * the gateway, and here. Tested against the real golden vectors in
 * `packages/core/fixtures/vectors.json` (see `domain/MerkleVectorsTest.kt`) — if this disagrees
 * with that fixture, this code is wrong, not the fixture (CLAUDE.md invariant #1).
 */

/** keccak256(min(a,b) || max(a,b)) — commutative, so proofs carry no direction bits. The
 *  comparison is on lowercase hex *strings*; the concatenation is of the raw 32-byte values. */
fun hashPair(a: Hex, b: Hex): Hex {
    val (lo, hi) = if (a.lowercase() <= b.lowercase()) a to b else b to a
    val buf = ByteArray(64)
    val loBytes = hexToBytes(lo)
    val hiBytes = hexToBytes(hi)
    System.arraycopy(loBytes, 0, buf, 0, 32)
    System.arraycopy(hiBytes, 0, buf, 32, 32)
    return keccak256(buf).toHex()
}

/** Walk a proof up from `leaf` and return the root it implies. */
fun processProof(leaf: Hex, proof: List<Hex>): Hex =
    proof.fold(leaf) { acc, sibling -> hashPair(acc, sibling) }

/**
 * Verify inclusion. This runs against a root read straight from the chain via a public RPC —
 * the moment the whole project exists for (PRD §6.6) — never against the gateway's own
 * self-reported root.
 */
fun verifyProof(leaf: Hex, proof: List<Hex>, root: Hex): Boolean =
    processProof(leaf, proof).lowercase() == root.lowercase()
