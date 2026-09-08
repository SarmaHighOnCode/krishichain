/**
 * On-chain reads and writes for lots — tickets S1-10 and S1-11.
 *
 * NONCE DISCIPLINE. The anchor service and the lot writer share one signer. Two
 * concurrent `writeContract` calls from the same account race for the same nonce, and the
 * loser is silently dropped or replaced — which for us would mean a breach flag that
 * quietly never landed while the dashboard said it did. Every transaction in the gateway
 * therefore goes through one `TxQueue`, so there is exactly one in flight at a time.
 *
 * This is the same class of bug as the double-anchor in `anchor.ts`, from the opposite
 * direction: there we sent something twice, here we would send two things that cancel.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Chain,
  type Hex as ViemHex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Serialises transactions from one signer. FIFO, and a failure never stalls the queue. */
export class TxQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Swallow on the chain itself so one rejection cannot poison every later caller,
    // while still rejecting the promise we hand back.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const LOT_REGISTRY_ABI = [
  {
    type: "function",
    name: "createLot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lotId", type: "bytes16" },
      { name: "gtin", type: "bytes14" },
      { name: "geohash", type: "string" },
      { name: "harvestTs", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "flagLot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lotId", type: "bytes16" },
      { name: "reason", type: "bytes32" },
      { name: "evidenceDigest", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLot",
    stateMutability: "view",
    inputs: [{ name: "lotId", type: "bytes16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "custodian", type: "address" },
          { name: "state", type: "uint8" },
          { name: "flagged", type: "bool" },
          { name: "harvestTs", type: "uint64" },
          { name: "createdAt", type: "uint64" },
          { name: "parent", type: "bytes16" },
          { name: "gtin", type: "bytes14" },
          { name: "geohash", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getChildren",
    stateMutability: "view",
    inputs: [{ name: "lotId", type: "bytes16" }],
    outputs: [{ type: "bytes16[]" }],
  },
  {
    type: "function",
    name: "flagCount",
    stateMutability: "view",
    inputs: [{ name: "lotId", type: "bytes16" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** `LotState` enum in LotRegistry.sol, in declaration order. */
export const LOT_STATES = [
  "NONE",
  "CREATED",
  "AGGREGATED",
  "IN_TRANSIT",
  "DELIVERED",
  "FINALIZED",
] as const;

export type LotStateName = (typeof LOT_STATES)[number];

export interface OnChainLot {
  lot: ViemHex;
  creator: Address;
  custodian: Address;
  state: LotStateName;
  flagged: boolean;
  harvestTs: string;
  createdAt: string;
  parent: ViemHex | null;
  gtin: ViemHex;
  geohash: string;
  flagCount: number;
}

export interface ChainLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

export interface LotServiceOptions {
  rpcUrl: string;
  privateKey: ViemHex;
  contract: Address;
  chainId: number;
  queue: TxQueue;
  log: ChainLogger;
  /** Default GTIN stamped onto lots the gateway opens itself. */
  gtin?: ViemHex;
  timeoutMs?: number;
}

const ZERO_LOT_BYTES = `0x${"00".repeat(16)}` as ViemHex;

/**
 * Reads and writes `LotRegistry`.
 *
 * The gateway opens a lot the first time it sees one, because the demo's lots are created
 * by a node binding to a QR code in the field, not by someone clicking a button. Without
 * this the on-chain lifecycle would be an empty slide.
 */
export class LotService {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: Chain;
  /** Lots we have already opened on-chain, so we do not pay for a duplicate attempt. */
  private readonly created = new Set<string>();
  private readonly flagged = new Set<string>();

  constructor(private readonly options: LotServiceOptions) {
    this.account = privateKeyToAccount(options.privateKey);
    this.chain = {
      id: options.chainId,
      name: `chain-${options.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [options.rpcUrl] } },
    } as Chain;
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000 }),
    }) as PublicClient;
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000 }),
    });
  }

  get signer(): Address {
    return this.account.address;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getLot(lot: ViemHex): Promise<OnChainLot | undefined> {
    try {
      const [raw, flags] = await Promise.all([
        this.publicClient.readContract({
          address: this.options.contract,
          abi: LOT_REGISTRY_ABI,
          functionName: "getLot",
          args: [lot],
        }),
        this.publicClient.readContract({
          address: this.options.contract,
          abi: LOT_REGISTRY_ABI,
          functionName: "flagCount",
          args: [lot],
        }),
      ]);

      const state = LOT_STATES[Number(raw.state)] ?? "NONE";
      if (state === "NONE") return undefined;

      return {
        lot,
        creator: raw.creator,
        custodian: raw.custodian,
        state,
        flagged: raw.flagged,
        harvestTs: raw.harvestTs.toString(),
        createdAt: raw.createdAt.toString(),
        parent: raw.parent === ZERO_LOT_BYTES ? null : raw.parent,
        gtin: raw.gtin,
        geohash: raw.geohash,
        flagCount: Number(flags),
      };
    } catch (error) {
      this.options.log.warn({ err: String(error), lot }, "could not read lot");
      return undefined;
    }
  }

  async getChildren(lot: ViemHex): Promise<ViemHex[]> {
    try {
      const children = await this.publicClient.readContract({
        address: this.options.contract,
        abi: LOT_REGISTRY_ABI,
        functionName: "getChildren",
        args: [lot],
      });
      return [...children];
    } catch {
      return [];
    }
  }

  /**
   * Every lot rolled up into this one, transitively. The recall question in the direction
   * that matters most: "which farms fed the lot on truck 27?"
   *
   * Guarded against cycles and depth. `aggregate()` refuses a child that already has a
   * parent, so a cycle should be impossible — but a traversal that can hang the query API
   * on a malformed graph is not worth the two lines it saves.
   */
  async descendants(root: ViemHex, maxDepth = 8): Promise<ViemHex[]> {
    const seen = new Set<string>([root.toLowerCase()]);
    const out: ViemHex[] = [];
    let frontier: ViemHex[] = [root];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: ViemHex[] = [];
      for (const lot of frontier) {
        for (const child of await this.getChildren(lot)) {
          const key = child.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(child);
          next.push(child);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** The other direction: every shipment this crate was folded into. */
  async ancestors(lot: ViemHex, maxDepth = 8): Promise<ViemHex[]> {
    const out: ViemHex[] = [];
    const seen = new Set<string>([lot.toLowerCase()]);
    let cursor = lot;

    for (let depth = 0; depth < maxDepth; depth++) {
      const record = await this.getLot(cursor);
      if (!record?.parent) break;
      const key = record.parent.toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);
      out.push(record.parent);
      cursor = record.parent;
    }
    return out;
  }

  /**
   * Which of these lots the chain considers flagged.
   *
   * The chain is authoritative here, and it knows things we do not. `aggregate()` taints a
   * parent lot the moment a flagged child is rolled into it — no call of ours is involved
   * and no event names the parent, so a gateway that only tracked its own `flagLot` calls
   * would serve `VERIFIED` for a shipment the chain has already condemned. That is exactly
   * the failure CLAUDE.md invariant 5 forbids, so we ask rather than assume.
   */
  async flaggedAmong(lots: ViemHex[]): Promise<ViemHex[]> {
    const flagged: ViemHex[] = [];
    for (const lot of lots) {
      const info = await this.getLot(lot);
      if (info?.flagged) flagged.push(lot);
    }
    return flagged;
  }

  // -------------------------------------------------------------------------
  // Writes — all through the shared queue.
  // -------------------------------------------------------------------------

  /** Open a lot the first time we see it. No-op if it already exists on-chain. */
  async ensureLot(lot: ViemHex, harvestTs: bigint, geohash = ""): Promise<boolean> {
    const key = lot.toLowerCase();
    if (this.created.has(key)) return false;
    this.created.add(key);

    return this.options.queue.run(async () => {
      try {
        const existing = await this.getLot(lot);
        if (existing) return false;

        const hash = await this.walletClient.writeContract({
          address: this.options.contract,
          abi: LOT_REGISTRY_ABI,
          functionName: "createLot",
          args: [lot, this.options.gtin ?? (`0x${"00".repeat(14)}` as ViemHex), geohash, harvestTs],
          account: this.account,
          chain: this.chain,
        });
        await this.publicClient.waitForTransactionReceipt({ hash, timeout: this.options.timeoutMs ?? 10_000 });
        this.options.log.info({ lot, tx: hash }, "lot opened on-chain");
        return true;
      } catch (error) {
        // Un-latch so a later record can retry: failing to open a lot must not
        // permanently prevent it from ever being flagged.
        this.created.delete(key);
        this.options.log.warn({ err: String(error), lot }, "createLot failed");
        return false;
      }
    });
  }

  /**
   * Record a breach against a lot — ticket S1-10, within 10 s of the causing record.
   *
   * Flags are additive and cannot be cleared on-chain, by design: the party at fault must
   * not be able to quietly delete the evidence.
   */
  async flagLot(lot: ViemHex, reason: string, evidence: ViemHex): Promise<ViemHex | undefined> {
    const key = lot.toLowerCase();
    if (this.flagged.has(key)) return undefined;
    this.flagged.add(key);

    return this.options.queue.run(async () => {
      try {
        const hash = await this.walletClient.writeContract({
          address: this.options.contract,
          abi: LOT_REGISTRY_ABI,
          functionName: "flagLot",
          args: [lot, keccak256(stringToHex(reason)), evidence],
          account: this.account,
          chain: this.chain,
        });
        await this.publicClient.waitForTransactionReceipt({ hash, timeout: this.options.timeoutMs ?? 10_000 });
        this.options.log.warn({ lot, reason, tx: hash }, "lot flagged on-chain");
        return hash;
      } catch (error) {
        this.flagged.delete(key);
        this.options.log.warn({ err: String(error), lot, reason }, "flagLot failed");
        return undefined;
      }
    });
  }
}
