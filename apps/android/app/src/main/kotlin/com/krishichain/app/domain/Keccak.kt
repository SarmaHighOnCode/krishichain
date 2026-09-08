package com.krishichain.app.domain

import org.bouncycastle.crypto.digests.KeccakDigest

/**
 * keccak256 — the ORIGINAL Keccak padding (0x01 domain separator), not NIST's final SHA3-256
 * (0x06 domain separator). Ethereum, `packages/core/src/crypto.ts`, and every on-chain value in
 * this repo use the original Keccak. `MessageDigest.getInstance("SHA3-256")` on the JVM is the
 * NIST variant and silently produces different digests for the same input — it would fail every
 * golden vector in `packages/core/fixtures/vectors.json` and every real on-chain root without
 * throwing anywhere. Bouncy Castle's `KeccakDigest` is the correct primitive here.
 */
fun keccak256(input: ByteArray): ByteArray {
    val digest = KeccakDigest(256)
    digest.update(input, 0, input.size)
    val out = ByteArray(digest.digestSize)
    digest.doFinal(out, 0)
    return out
}
