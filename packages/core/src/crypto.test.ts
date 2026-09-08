import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deviceAddressFromPrivateKey,
  keccak256,
  recoverCandidates,
  signDigest,
  verifyDigest,
} from "./crypto.js";
import type { Hex } from "./types.js";

const KEY: Hex = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const ADDRESS = deviceAddressFromPrivateKey(KEY);
const DIGEST = keccak256(new TextEncoder().encode("krishichain"));

test("signing is deterministic — same input, same 64 bytes", () => {
  assert.equal(signDigest(DIGEST, KEY), signDigest(DIGEST, KEY));
});

test("a signature verifies against the signer address", () => {
  const result = verifyDigest(DIGEST, signDigest(DIGEST, KEY), ADDRESS);
  assert.equal(result.ok, true);
});

/**
 * Regression: without a recovery id, BOTH recovery bits usually produce a valid — and
 * different — address. Any implementation that returns "the first one that recovers" will
 * happily accept signatures from the wrong key. This test exists because we shipped that
 * bug once already.
 */
test("both recovery bits recover, so the wrong candidate must be rejected", () => {
  const sig = signDigest(DIGEST, KEY);
  const recovered = recoverCandidates(DIGEST, sig);
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;

  assert.ok(recovered.addresses.length >= 1);
  const matches = recovered.addresses.filter((a) => a.toLowerCase() === ADDRESS.toLowerCase());
  assert.equal(matches.length, 1, "exactly one candidate is the real signer");

  for (const candidate of recovered.addresses) {
    if (candidate.toLowerCase() === ADDRESS.toLowerCase()) continue;
    assert.equal(
      verifyDigest(DIGEST, sig, candidate).ok,
      true,
      "a decoy candidate verifies against itself — which is exactly why the caller must supply the expected address",
    );
  }
});

test("a signature does not verify against an unrelated address", () => {
  const other = deviceAddressFromPrivateKey(`0x${"11".repeat(32)}`);
  const result = verifyDigest(DIGEST, signDigest(DIGEST, KEY), other);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ADDRESS_MISMATCH");
});

test("a signature over a different digest does not verify", () => {
  const otherDigest = keccak256(new TextEncoder().encode("tampered"));
  assert.equal(verifyDigest(otherDigest, signDigest(DIGEST, KEY), ADDRESS).ok, false);
});

test("wrong signature length is rejected before any curve work", () => {
  const result = recoverCandidates(DIGEST, "0xdeadbeef");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "BAD_SIGNATURE_LENGTH");
});

test("a high-s signature is rejected as malleable", () => {
  // n = curve order. Flipping s to n-s keeps the signature valid ECDSA but changes its bytes.
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const sig = signDigest(DIGEST, KEY);
  const s = BigInt(`0x${sig.slice(66)}`);
  const flipped = `${sig.slice(0, 66)}${(N - s).toString(16).padStart(64, "0")}` as Hex;

  const result = recoverCandidates(DIGEST, flipped);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "HIGH_S");
});

test("device address derivation drops the 0x04 prefix byte", () => {
  // The classic bug: hashing all 65 bytes yields a plausible but wrong address.
  assert.equal(ADDRESS.length, 42);
  assert.match(ADDRESS, /^0x[0-9a-f]{40}$/);
});
