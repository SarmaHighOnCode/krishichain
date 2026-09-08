/**
 * Digest, signing and verification. Mirrors firmware/lib/krishi/crypto/.
 *
 * Two rules that break things silently if you get them wrong:
 *
 *  1. The device address drops the 0x04 prefix byte before hashing:
 *       address = keccak256(uncompressedPubkey[1:])[12:]
 *     Forgetting the slice produces a plausible-looking address that never matches.
 *
 *  2. `s` must be in the lower half of the curve order. High-`s` signatures are
 *     valid ECDSA but malleable, which breaks signature-based deduplication and
 *     lets the same record appear twice with different bytes. We reject them.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

import { bytesToHex, encodeRecord, hexToBytes } from "./record.js";
import type { Hex, SensorRecord } from "./types.js";

export function keccak256(bytes: Uint8Array): Hex {
  return bytesToHex(keccak_256(bytes));
}

/** keccak256 of the canonical encoding. This is the value that gets signed and Merkled. */
export function recordDigest(record: SensorRecord): Hex {
  return keccak256(encodeRecord(record));
}

/** Derive the 20-byte device address from a 65-byte uncompressed public key. */
export function deviceAddressFromPublicKey(publicKey: Uint8Array): Hex {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("expected a 65-byte uncompressed public key starting with 0x04");
  }
  const hashed = keccak_256(publicKey.subarray(1));
  return bytesToHex(hashed.subarray(12));
}

/** Derive the device address a private key would produce. */
export function deviceAddressFromPrivateKey(privateKey: Uint8Array | Hex): Hex {
  const key = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  return deviceAddressFromPublicKey(secp256k1.getPublicKey(key, false));
}

/**
 * Sign a digest. Deterministic (RFC 6979) and low-`s` normalised, so the same record
 * always produces the same 64 bytes — on the ESP32 and here.
 */
export function signDigest(digest: Hex, privateKey: Uint8Array | Hex): Hex {
  const key = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  const signature = secp256k1.sign(hexToBytes(digest), key, { lowS: true });
  return bytesToHex(signature.toCompactRawBytes());
}

/** Sign a record's canonical digest. */
export function signRecord(record: SensorRecord, privateKey: Uint8Array | Hex): Hex {
  return signDigest(recordDigest(record), privateKey);
}

export type VerifyFailure =
  | "BAD_SIGNATURE_LENGTH"
  | "HIGH_S"
  | "MALFORMED_SIGNATURE"
  | "ADDRESS_MISMATCH";

export type VerifyResult = { ok: true; address: Hex } | { ok: false; reason: VerifyFailure };

/**
 * Recover every address that could have produced this signature.
 *
 * The wire format carries no recovery id — it costs a byte and the device does not need
 * one — so both recovery bits must be tried. Both usually succeed and yield *different*
 * valid addresses, so a caller must never take the first result as "the signer": it has to
 * match against an expected address. Returning a list makes that impossible to get wrong.
 *
 * Rejecting high-`s` first keeps the common bad case cheap.
 */
export function recoverCandidates(
  digest: Hex,
  sig: Hex,
): { ok: true; addresses: Hex[] } | { ok: false; reason: VerifyFailure } {
  const sigBytes = hexToBytes(sig);
  if (sigBytes.length !== 64) return { ok: false, reason: "BAD_SIGNATURE_LENGTH" };

  let signature: ReturnType<typeof secp256k1.Signature.fromCompact>;
  try {
    signature = secp256k1.Signature.fromCompact(sigBytes);
  } catch {
    return { ok: false, reason: "MALFORMED_SIGNATURE" };
  }
  if (signature.hasHighS()) return { ok: false, reason: "HIGH_S" };

  const digestBytes = hexToBytes(digest);
  const addresses: Hex[] = [];
  for (const recovery of [0, 1] as const) {
    try {
      const point = signature.addRecoveryBit(recovery).recoverPublicKey(digestBytes);
      addresses.push(deviceAddressFromPublicKey(point.toRawBytes(false)));
    } catch {
      // This recovery bit does not yield a point. Fine — the other one will.
    }
  }
  if (addresses.length === 0) return { ok: false, reason: "MALFORMED_SIGNATURE" };
  return { ok: true, addresses };
}

/** Verify a signature over an arbitrary digest against a known signer address. */
export function verifyDigest(digest: Hex, sig: Hex, expected: Hex): VerifyResult {
  const recovered = recoverCandidates(digest, sig);
  if (!recovered.ok) return recovered;

  const target = expected.toLowerCase();
  const match = recovered.addresses.find((address) => address.toLowerCase() === target);
  return match ? { ok: true, address: match } : { ok: false, reason: "ADDRESS_MISMATCH" };
}

/**
 * Verify that `sig` over `record` was produced by the key behind `record.dev`.
 *
 * We check against the address *inside the record*, which is itself covered by the
 * signature. A record therefore cannot claim one device and be signed by another.
 */
export function verifyRecord(record: SensorRecord, sig: Hex): VerifyResult {
  return verifyDigest(recordDigest(record), sig, record.dev);
}
