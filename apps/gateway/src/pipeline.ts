/**
 * The ingest pipeline. ARCHITECTURE §2.3.
 *
 * The step ORDER is a correctness property, not a style choice:
 *
 *   1. schema validate
 *   2. device known + not revoked?          -> 401, quarantine
 *   3. signature valid over canonical bytes -> 401, quarantine
 *   4. hash-chain verdict                   -> accept | gap | fork | duplicate
 *   5. persist record + verdict
 *   6. rules engine -> incidents -> LotRegistry.flagLot
 *   7. enqueue leaf for the Merkle batcher
 *
 * Step 2 before step 3 matters: verifying a signature costs real CPU, and an unknown device
 * flooding a field gateway is the obvious DoS. Check membership first, it is a map lookup.
 *
 * Step 5 after 2-4 is the load-bearing one: the store must never contain a record that was
 * not verified, or the database becomes a laundering step for unsigned data.
 */

import {
  checkChain,
  EMPTY_CHAIN_STATE,
  verifyRecord,
  type ChainState,
  type ChainVerdict,
  type Hex,
  type SensorRecord,
} from "@krishichain/core";

export type RejectReason = "UNKNOWN_DEVICE" | "REVOKED_DEVICE" | "BAD_SIGNATURE";

export interface Accepted {
  status: "accepted";
  record: SensorRecord;
  digest: Hex;
  verdict: ChainVerdict;
  detail?: string;
}

export interface Rejected {
  status: "rejected";
  record: SensorRecord;
  reason: RejectReason;
  detail?: string;
}

export type Outcome = Accepted | Rejected;

/** Anything that can answer "was this device trusted?". Backed by DeviceRegistry on-chain. */
export interface DeviceDirectory {
  isKnown(device: Hex): boolean;
  isActive(device: Hex): boolean;
}

/** In-memory directory for the local demo and tests. Ticket S1-06 swaps in the on-chain read. */
export class MemoryDeviceDirectory implements DeviceDirectory {
  private readonly active = new Set<string>();
  private readonly known = new Set<string>();

  register(device: Hex): void {
    this.known.add(device.toLowerCase());
    this.active.add(device.toLowerCase());
  }

  revoke(device: Hex): void {
    this.active.delete(device.toLowerCase());
  }

  isKnown(device: Hex): boolean {
    return this.known.has(device.toLowerCase());
  }

  isActive(device: Hex): boolean {
    return this.active.has(device.toLowerCase());
  }
}

/**
 * Verifies a batch and tracks per-device chain state.
 *
 * Deliberately holds no database: the caller persists. That keeps the security-critical
 * decisions in one testable place, and it is why the same code runs in tests, in the
 * simulator, and in the live ingest path.
 */
export class Verifier {
  private readonly chains = new Map<string, ChainState>();

  constructor(private readonly devices: DeviceDirectory) {}

  chainState(device: Hex): ChainState {
    return this.chains.get(device.toLowerCase()) ?? EMPTY_CHAIN_STATE;
  }

  /** Run one record through steps 2-4. Returns the outcome; persistence is the caller's job. */
  ingest(record: SensorRecord, signature: Hex): Outcome {
    // Step 2 — membership, before any curve arithmetic.
    if (!this.devices.isKnown(record.dev)) {
      return { status: "rejected", record, reason: "UNKNOWN_DEVICE" };
    }
    if (!this.devices.isActive(record.dev)) {
      return { status: "rejected", record, reason: "REVOKED_DEVICE" };
    }

    // Step 3 — signature over the canonical bytes.
    const verified = verifyRecord(record, signature);
    if (!verified.ok) {
      return { status: "rejected", record, reason: "BAD_SIGNATURE", detail: verified.reason };
    }

    // Step 4 — chain continuity. A gap does NOT stop later records: we record the gap as a
    // finding and keep ingesting, because refusing the rest would hand an attacker a cheap
    // denial-of-evidence.
    const key = record.dev.toLowerCase();
    const check = checkChain(this.chainState(record.dev), record);
    if (check.next) this.chains.set(key, check.next);

    const accepted: Accepted = { status: "accepted", record, digest: check.digest, verdict: check.verdict };
    if (check.detail !== undefined) accepted.detail = check.detail;
    return accepted;
  }

  ingestBatch(entries: Array<{ record: SensorRecord; signature: Hex }>): Outcome[] {
    return entries.map(({ record, signature }) => this.ingest(record, signature));
  }

  /**
   * Highest seq we can acknowledge for a device (PROTOCOL.md §3.3).
   * The node frees everything up to this, so it must never run ahead of what we stored.
   */
  ackSeq(device: Hex): number {
    return this.chainState(device).lastSeq ?? 0;
  }
}
