/**
 * Merkle tree over record digests. PROTOCOL.md §4.
 *
 * Sorted-pair keccak256 — deliberately matching OpenZeppelin's MerkleProof so that a proof
 * verifies identically on-chain, in the gateway, and in the consumer's browser. An unsorted
 * implementation passes its own tests happily and then fails on-chain, which is a bad place
 * to discover it.
 *
 * This is the file that makes the economics work: one 32-byte root commits to 256+ records,
 * so anchoring costs the same whether it covers 10 readings or 10,000 (ADR-0003).
 */

import { keccak256 } from "./crypto.js";
import { hexToBytes } from "./record.js";
import type { Hex } from "./types.js";

/** keccak256(min(a,b) || max(a,b)) — commutative, so proofs carry no direction bits. */
export function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  const buf = new Uint8Array(64);
  buf.set(hexToBytes(lo), 0);
  buf.set(hexToBytes(hi), 32);
  return keccak256(buf);
}

export interface MerkleTree {
  /** layers[0] is the leaves; the last layer is a single root. */
  layers: Hex[][];
  root: Hex;
  leafCount: number;
}

/**
 * Build a tree. An odd node at any level is promoted unchanged to the next level
 * (it is not duplicated — duplication enables the second-preimage trick where a leaf
 * pair can be passed off as a single leaf).
 */
export function buildTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("cannot build a Merkle tree over zero leaves");

  const layers: Hex[][] = [leaves.slice()];
  while (layers[layers.length - 1]!.length > 1) {
    const current = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    layers.push(next);
  }

  return { layers, root: layers[layers.length - 1]![0]!, leafCount: leaves.length };
}

/** Sibling path for the leaf at `index`, bottom-up. */
export function getProof(tree: MerkleTree, index: number): Hex[] {
  if (index < 0 || index >= tree.leafCount) {
    throw new Error(`leaf index ${index} out of range [0, ${tree.leafCount})`);
  }
  const proof: Hex[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level]!;
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = layer[siblingIdx];
    // No sibling means this node was promoted; nothing to add to the path.
    if (sibling !== undefined) proof.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Walk a proof up from `leaf` and return the root it implies. */
export function processProof(leaf: Hex, proof: Hex[]): Hex {
  return proof.reduce<Hex>((acc, sibling) => hashPair(acc, sibling), leaf);
}

/**
 * Verify inclusion. This runs in the consumer's browser against a root read straight from
 * the chain — the moment the whole project exists for (PRD §6.6).
 */
export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  return processProof(leaf, proof).toLowerCase() === root.toLowerCase();
}

export interface InclusionProof {
  digest: Hex;
  root: Hex;
  proof: Hex[];
  index: number;
  leafCount: number;
}

/** Build every proof for a batch in one pass — what the gateway persists per record. */
export function buildProofs(leaves: Hex[]): InclusionProof[] {
  const tree = buildTree(leaves);
  return leaves.map((digest, index) => ({
    digest,
    root: tree.root,
    proof: getProof(tree, index),
    index,
    leafCount: tree.leafCount,
  }));
}
