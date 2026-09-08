/**
 * Merkle batcher — ticket S1-08. PROTOCOL.md §4, ADR-0003.
 *
 * Closes a batch at 256 leaves or 60 seconds, whichever comes first, builds the tree, stores
 * every inclusion proof, and hands the root to the anchor service. One transaction commits to
 * 256+ readings, which is the difference between ~₹1.50 and ~₹240 per traced crate.
 */

import { buildProofs, type Hex, type InclusionProof } from "@krishichain/core";

export interface ClosedBatch {
  index: number;
  root: Hex;
  prevRoot: Hex;
  leafCount: number;
  proofs: InclusionProof[];
  closedAt: number;
  reason: "size" | "time" | "manual";
}

const ZERO_ROOT: Hex = `0x${"00".repeat(32)}`;

export interface BatcherOptions {
  maxLeaves?: number;
  maxSeconds?: number;
  onBatch: (batch: ClosedBatch) => void | Promise<void>;
}

export class MerkleBatcher {
  private pending: Hex[] = [];
  private timer: NodeJS.Timeout | undefined;
  private index = 0;
  private prevRoot: Hex = ZERO_ROOT;

  private readonly maxLeaves: number;
  private readonly maxMs: number;

  constructor(private readonly options: BatcherOptions) {
    this.maxLeaves = options.maxLeaves ?? 256;
    this.maxMs = (options.maxSeconds ?? 60) * 1000;
  }

  /** Queue a record digest as a leaf. Closes the batch when it hits the size limit. */
  add(digest: Hex): void {
    this.pending.push(digest);

    if (this.pending.length >= this.maxLeaves) {
      void this.close("size");
      return;
    }
    // First leaf of an open batch starts the clock, so a slow trickle of records still
    // becomes verifiable within a minute rather than waiting for 256.
    if (this.timer === undefined) {
      this.timer = setTimeout(() => void this.close("time"), this.maxMs);
      this.timer.unref?.();
    }
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get lastRoot(): Hex {
    return this.prevRoot;
  }

  /** Close the current batch immediately. No-op when empty. */
  async close(reason: ClosedBatch["reason"] = "manual"): Promise<ClosedBatch | undefined> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending.length === 0) return undefined;

    const leaves = this.pending;
    this.pending = [];

    const proofs = buildProofs(leaves);
    const root = proofs[0]!.root;

    const batch: ClosedBatch = {
      index: this.index,
      root,
      prevRoot: this.prevRoot,
      leafCount: leaves.length,
      proofs,
      closedAt: Date.now(),
      reason,
    };

    this.index += 1;
    this.prevRoot = root;

    await this.options.onBatch(batch);
    return batch;
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
