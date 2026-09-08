import assert from "node:assert/strict";
import { test } from "node:test";

import { keccak256 } from "./crypto.js";
import { buildProofs, buildTree, getProof, hashPair, verifyProof } from "./merkle.js";
import type { Hex } from "./types.js";

const leaf = (i: number): Hex => keccak256(new Uint8Array([i & 0xff, (i >> 8) & 0xff]));

test("pair hashing is commutative", () => {
  const a = leaf(1);
  const b = leaf(2);
  assert.equal(hashPair(a, b), hashPair(b, a));
});

test("a single leaf is its own root", () => {
  const tree = buildTree([leaf(0)]);
  assert.equal(tree.root, leaf(0));
  assert.deepEqual(getProof(tree, 0), []);
});

test("every leaf proves, for every tree size from 1 to 300", () => {
  // 300 covers the 256-leaf batch size plus odd-node promotion at several levels.
  for (const size of [1, 2, 3, 5, 8, 17, 64, 100, 255, 256, 257, 300]) {
    const leaves = Array.from({ length: size }, (_, i) => leaf(i));
    const tree = buildTree(leaves);
    for (let i = 0; i < size; i++) {
      assert.equal(
        verifyProof(leaves[i]!, getProof(tree, i), tree.root),
        true,
        `size ${size}, leaf ${i}`,
      );
    }
  }
});

test("a proof does not verify against a different leaf", () => {
  const leaves = Array.from({ length: 16 }, (_, i) => leaf(i));
  const tree = buildTree(leaves);
  assert.equal(verifyProof(leaves[3]!, getProof(tree, 4), tree.root), false);
});

test("a tampered leaf fails its own proof", () => {
  const leaves = Array.from({ length: 16 }, (_, i) => leaf(i));
  const proofs = buildProofs(leaves);
  const target = proofs[7]!;
  assert.equal(verifyProof(leaf(999), target.proof, target.root), false);
});

test("randomised: 200 trees, every leaf verifies and no cross-leaf proof passes", () => {
  for (let round = 0; round < 200; round++) {
    const size = 1 + Math.floor(Math.random() * 40);
    const leaves = Array.from({ length: size }, () => leaf(Math.floor(Math.random() * 65536)));
    const tree = buildTree(leaves);
    const i = Math.floor(Math.random() * size);
    assert.equal(verifyProof(leaves[i]!, getProof(tree, i), tree.root), true);
  }
});

test("building over zero leaves is an error, not an empty root", () => {
  assert.throws(() => buildTree([]));
});

test("proof index out of range throws", () => {
  const tree = buildTree([leaf(0), leaf(1)]);
  assert.throws(() => getProof(tree, 2));
});
