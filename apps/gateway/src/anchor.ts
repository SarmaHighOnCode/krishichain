/**
 * Anchor service — ticket S1-09. PROTOCOL.md §4, ADR-0003.
 *
 * Takes a closed Merkle batch and commits its root on-chain. One transaction per 256+
 * readings is what makes the economics work: anchoring costs the same whether it covers
 * ten readings or ten thousand.
 *
 * THE FAILURE MODE THIS FILE EXISTS FOR. An RPC timeout is not a failed transaction. The
 * request timed out; the transaction may well be in the mempool, or already mined. Retry
 * it naively and you anchor the same batch twice, which corrupts the `prevRoot` chain that
 * makes a *dropped* batch detectable — so the naive retry breaks the exact property
 * anchoring exists to provide.
 *
 * So the service never asks "did my call return?". It asks the chain "how many anchors do
 * you have?" and treats that as the only truth:
 *
 *   1. Write the intent to disk BEFORE sending anything.
 *   2. Read `anchorCount()`. If it is already past this batch, the transaction landed
 *      during whatever went wrong last time. Record it and move on.
 *   3. Send. On success, record the receipt.
 *   4. On timeout or any unknown outcome, leave the intent on disk and reconcile on the
 *      next tick — step 2 will resolve it.
 *
 * The high-water mark survives a gateway restart, so a crash mid-anchor is recoverable
 * rather than a silent double-write. `BatchAnchor.anchor` also reverts on a `prevRoot`
 * mismatch, which is a second net under the first — but a contract revert is a bad place
 * to discover a bug the service should have prevented.
 *
 * LOCAL SYNCHRONOUSLY, AMOY ASYNCHRONOUSLY. The demo must work with no internet
 * (CLAUDE.md invariant 6), so the local chain is the path the demo depends on and it is
 * awaited. Amoy is the shareable, publicly verifiable path and is fired off in the
 * background: if the venue WiFi is hostile, the demo is unaffected and the explorer link
 * simply arrives late.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex as ViemHex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { ClosedBatch } from "./batcher.js";
import { TxQueue } from "./chain.js";

/** Minimal ABI — only what the service calls. */
export const BATCH_ANCHOR_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "leafCount", type: "uint32" },
      { name: "prevRoot", type: "bytes32" },
    ],
    outputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "function",
    name: "anchorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRoot",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "latestRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export type AnchorStatus = "PENDING" | "ANCHORED" | "FAILED";

export interface AnchorRecord {
  index: number;
  root: ViemHex;
  prevRoot: ViemHex;
  leafCount: number;
  status: AnchorStatus;
  txHash?: ViemHex;
  blockNumber?: string;
  error?: string;
  updatedAt: number;
}

interface AnchorState {
  /** Highest batch index we have STARTED anchoring. The high-water mark. */
  highWater: number;
  /** Per-batch outcome, keyed by batch index. */
  anchors: Record<string, AnchorRecord>;
}

const EMPTY_STATE: AnchorState = { highWater: -1, anchors: {} };

export interface AnchorLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface AnchorServiceOptions {
  rpcUrl: string;
  privateKey: ViemHex;
  contract: Address;
  chainId: number;
  statePath: string;
  log: AnchorLogger;
  /** Notified whenever a batch's status changes, so the dashboard sees the transition. */
  onUpdate?: (record: AnchorRecord) => void;
  /** Milliseconds before we stop waiting on a receipt and treat the outcome as unknown. */
  timeoutMs?: number;
  /**
   * Shared transaction queue. The lot writer uses the same signer, and two concurrent
   * writes from one account race for a nonce — so both must go through one queue.
   */
  queue?: TxQueue;
}

export class AnchorService {
  private state: AnchorState = EMPTY_STATE;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private chain: { id: number; name: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: { default: { http: string[] } } };
  /**
   * Serialises anchoring so two batches can never race for the same `prevRoot`, and — when
   * shared with the lot writer — so no two transactions from this signer race for a nonce.
   */
  private readonly queue: TxQueue;

  constructor(private readonly options: AnchorServiceOptions) {
    this.queue = options.queue ?? new TxQueue();
    this.account = privateKeyToAccount(options.privateKey);
    this.chain = {
      id: options.chainId,
      name: `chain-${options.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [options.rpcUrl] } },
    };
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000 }),
    }) as PublicClient;
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000 }),
    });
    this.load();
  }

  get signer(): Address {
    return this.account.address;
  }

  get highWater(): number {
    return this.state.highWater;
  }

  anchorFor(index: number): AnchorRecord | undefined {
    return this.state.anchors[String(index)];
  }

  all(): AnchorRecord[] {
    return Object.values(this.state.anchors).sort((a, b) => a.index - b.index);
  }

  // -------------------------------------------------------------------------
  // Persistence. Written atomically: a torn state file after a power cut would
  // be worse than no state file, because it would look authoritative.
  // -------------------------------------------------------------------------

  private load(): void {
    try {
      if (!existsSync(this.options.statePath)) return;
      const raw = readFileSync(this.options.statePath, "utf8");
      const parsed = JSON.parse(raw) as AnchorState;
      if (typeof parsed.highWater === "number" && parsed.anchors) {
        this.state = parsed;
        this.options.log.info(
          { highWater: parsed.highWater, anchors: Object.keys(parsed.anchors).length },
          "anchor state recovered",
        );
      }
    } catch (error) {
      this.options.log.warn({ err: String(error) }, "anchor state unreadable — starting fresh");
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.options.statePath), { recursive: true });
      const tmp = `${this.options.statePath}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      renameSync(tmp, this.options.statePath);
    } catch (error) {
      this.options.log.error({ err: String(error) }, "could not persist anchor state");
    }
  }

  private update(record: AnchorRecord): void {
    this.state.anchors[String(record.index)] = record;
    this.state.highWater = Math.max(this.state.highWater, record.index);
    this.save();
    this.options.onUpdate?.(record);
  }

  /** How many anchors the chain says exist. The only authority on what has landed. */
  private async onChainCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.options.contract,
      abi: BATCH_ANCHOR_ABI,
      functionName: "anchorCount",
    });
    return Number(count);
  }

  /** Queue a batch for anchoring. Resolves when this batch has been attempted. */
  async submit(batch: ClosedBatch): Promise<AnchorRecord> {
    return this.queue.run(() => this.anchorOne(batch));
  }

  private async anchorOne(batch: ClosedBatch): Promise<AnchorRecord> {
    const base: AnchorRecord = {
      index: batch.index,
      root: batch.root as ViemHex,
      prevRoot: batch.prevRoot as ViemHex,
      leafCount: batch.leafCount,
      status: "PENDING",
      updatedAt: Date.now(),
    };

    // Step 1 — intent first. If we die between here and the receipt, the next start knows
    // this batch was in flight and must be reconciled rather than resent.
    this.update(base);

    try {
      // Step 2 — ask the chain, not our own memory. This is what makes a retry after a
      // timeout safe: if the earlier transaction landed, the count has already moved past
      // this batch and there is nothing to send.
      const count = await this.onChainCount();
      if (count > batch.index) {
        const onChainRoot = await this.publicClient.readContract({
          address: this.options.contract,
          abi: BATCH_ANCHOR_ABI,
          functionName: "getRoot",
          args: [BigInt(batch.index)],
        });

        const matches = String(onChainRoot).toLowerCase() === batch.root.toLowerCase();
        const record: AnchorRecord = {
          ...base,
          status: matches ? "ANCHORED" : "FAILED",
          updatedAt: Date.now(),
          ...(matches
            ? {}
            : {
                error: `anchor ${batch.index} already holds ${onChainRoot}, not our root — the batcher and the chain disagree`,
              }),
        };
        this.options.log.info(
          { index: batch.index, matches },
          "batch was already anchored — reconciled without resending",
        );
        this.update(record);
        return record;
      }

      // Step 3 — send.
      const hash = await this.walletClient.writeContract({
        address: this.options.contract,
        abi: BATCH_ANCHOR_ABI,
        functionName: "anchor",
        args: [batch.root as ViemHex, batch.leafCount, batch.prevRoot as ViemHex],
        account: this.account,
        chain: this.chain,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        timeout: this.options.timeoutMs ?? 10_000,
      });

      const record: AnchorRecord = {
        ...base,
        status: receipt.status === "success" ? "ANCHORED" : "FAILED",
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        updatedAt: Date.now(),
      };
      this.update(record);
      this.options.log.info(
        { index: batch.index, root: batch.root, tx: hash, block: record.blockNumber },
        "batch anchored",
      );
      return record;
    } catch (error) {
      // Deliberately NOT marked FAILED. We do not know that it failed — we know we stopped
      // waiting. It stays PENDING so `reconcile()` can ask the chain what actually
      // happened, which is the only way to avoid double-anchoring.
      const message = error instanceof Error ? error.message : String(error);
      const record: AnchorRecord = { ...base, status: "PENDING", error: message, updatedAt: Date.now() };
      this.update(record);
      this.options.log.warn(
        { index: batch.index, err: message },
        "anchor outcome unknown — left pending for reconciliation, NOT retried blindly",
      );
      return record;
    }
  }

  /**
   * Resolve every batch whose outcome we never learned, by asking the chain.
   *
   * Safe to call on a timer and on startup. It never sends a transaction; it only turns
   * "unknown" into "anchored" or leaves it unknown for next time.
   */
  async reconcile(): Promise<number> {
    const pending = this.all().filter((a) => a.status === "PENDING");
    if (pending.length === 0) return 0;

    let resolved = 0;
    try {
      const count = await this.onChainCount();
      for (const record of pending) {
        if (count <= record.index) continue;

        const onChainRoot = await this.publicClient.readContract({
          address: this.options.contract,
          abi: BATCH_ANCHOR_ABI,
          functionName: "getRoot",
          args: [BigInt(record.index)],
        });
        const matches = String(onChainRoot).toLowerCase() === record.root.toLowerCase();

        this.update({
          ...record,
          status: matches ? "ANCHORED" : "FAILED",
          updatedAt: Date.now(),
          ...(matches ? {} : { error: `chain holds ${onChainRoot} at index ${record.index}` }),
        });
        resolved += 1;
      }
    } catch (error) {
      this.options.log.warn({ err: String(error) }, "reconcile could not reach the chain");
    }
    return resolved;
  }

  /**
   * Where the anchor chain currently stands.
   *
   * The batcher restarts at index 0 with a zero `prevRoot` whenever the gateway restarts,
   * but the chain has not forgotten anything. Anchoring without asking would revert with
   * `PrevRootMismatch` on the first batch after every restart — the contract catching a
   * mistake the gateway should never have made. The demo path has to survive a restart
   * that does not also reset the chain, because that is what actually happens on the day.
   */
  async chainHead(): Promise<{ nextIndex: number; prevRoot: ViemHex }> {
    const count = await this.onChainCount();
    if (count === 0) {
      return { nextIndex: 0, prevRoot: `0x${"00".repeat(32)}` as ViemHex };
    }
    const latest = await this.publicClient.readContract({
      address: this.options.contract,
      abi: BATCH_ANCHOR_ABI,
      functionName: "latestRoot",
    });
    return { nextIndex: count, prevRoot: latest as ViemHex };
  }

  /** Is the chain reachable and does the signer hold ANCHOR_ROLE's practical requirement, gas? */
  async preflight(): Promise<{ ok: boolean; detail: string }> {
    try {
      const [count, balance] = await Promise.all([
        this.onChainCount(),
        this.publicClient.getBalance({ address: this.account.address }),
      ]);
      if (balance === 0n) {
        return { ok: false, detail: `signer ${this.account.address} has no gas` };
      }
      return { ok: true, detail: `chain ${this.options.chainId}, ${count} anchors, signer ${this.account.address}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Read the address the deploy script wrote. Returns undefined when nothing is deployed. */
export function loadDeployment(
  network: string,
  repoRoot: string,
): { chainId: number; contracts: Record<string, Address> } | undefined {
  const path = join(repoRoot, "deployments", network, "addresses.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      chainId: number;
      contracts: Record<string, Address>;
    };
  } catch {
    return undefined;
  }
}
