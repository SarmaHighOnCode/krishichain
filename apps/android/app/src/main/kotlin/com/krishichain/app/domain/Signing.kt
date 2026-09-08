package com.krishichain.app.domain

import java.math.BigInteger
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.ec.CustomNamedCurves
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECPrivateKeyParameters
import org.bouncycastle.crypto.signers.ECDSASigner
import org.bouncycastle.crypto.signers.HMacDSAKCalculator

/**
 * secp256k1 ECDSA signing over a pre-computed 32-byte digest. Mirrors
 * `packages/core/src/crypto.ts::signDigest` — same curve, same compact `r || s` output, same
 * low-s normalisation.
 *
 * Two rules from `crypto.ts`'s header comment that this file exists to enforce:
 *
 *  1. `s` must be in the lower half of the curve order. High-`s` signatures are valid ECDSA but
 *     malleable, and the gateway rejects them outright (`recoverCandidates` -> `HIGH_S`) because
 *     they break signature-based deduplication. This is not optional.
 *  2. Determinism (RFC 6979) is NOT required for verification to succeed — a random-nonce ECDSA
 *     signature verifies exactly the same as a deterministic one, as long as it is low-s. Bouncy
 *     Castle's [HMacDSAKCalculator] gives us RFC 6979 determinism for free (handy for reproducible
 *     tests), but nothing here depends on it.
 */
private val CURVE_SPEC = CustomNamedCurves.getByName("secp256k1")

/** secp256k1 domain parameters, shared with [Identity] for key generation and address derivation. */
val SECP256K1_DOMAIN: ECDomainParameters =
    ECDomainParameters(CURVE_SPEC.curve, CURVE_SPEC.g, CURVE_SPEC.n, CURVE_SPEC.h)

private val CURVE_ORDER: BigInteger = SECP256K1_DOMAIN.n
private val HALF_CURVE_ORDER: BigInteger = CURVE_ORDER.shiftRight(1)

/**
 * Sign a 32-byte digest with [privateKey]. Output is 64 bytes: `r` (32 bytes big-endian)
 * concatenated with `s` (32 bytes big-endian, forced low-half). No recovery byte, no DER
 * encoding — raw compact `r || s`, exactly PROTOCOL's wire format.
 */
fun signDigest(digest: ByteArray, privateKey: BigInteger): ByteArray {
    require(digest.size == 32) { "digest must be 32 bytes, got ${digest.size}" }

    val signer = ECDSASigner(HMacDSAKCalculator(SHA256Digest()))
    signer.init(true, ECPrivateKeyParameters(privateKey, SECP256K1_DOMAIN))
    val components = signer.generateSignature(digest)
    val r = components[0]
    val rawS = components[1]
    // Low-s normalisation: if s > n/2, replace it with n - s. Both values are valid ECDSA
    // signatures for the same message; only the low one is accepted downstream.
    val s = if (rawS > HALF_CURVE_ORDER) CURVE_ORDER.subtract(rawS) else rawS

    return r.toFixedBytes(32) + s.toFixedBytes(32)
}

/** [signDigest] over a hex digest, returning a `0x`-prefixed hex signature. */
fun signDigestHex(digestHex: Hex, privateKey: BigInteger): Hex =
    signDigest(hexToBytes(digestHex), privateKey).toHex()

/**
 * A [BigInteger] as a fixed-length big-endian byte array — `BigInteger.toByteArray()` prepends a
 * sign byte for values whose high bit is set, and doesn't pad short values, neither of which is
 * what a canonical 32-byte field wants.
 */
internal fun BigInteger.toFixedBytes(length: Int): ByteArray {
    val raw = this.toByteArray()
    val trimmed = if (raw.size > length) raw.copyOfRange(raw.size - length, raw.size) else raw
    if (trimmed.size == length) return trimmed
    val out = ByteArray(length)
    System.arraycopy(trimmed, 0, out, length - trimmed.size, trimmed.size)
    return out
}
