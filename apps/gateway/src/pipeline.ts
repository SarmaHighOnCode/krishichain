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
  companionDigest,
  EMPTY_CHAIN_STATE,
  gpsEvidenceHash,
  imuEvidenceHash,
  verifyCompanion,
  verifyRecord,
  type ChainState,
  type ChainVerdict,
  type CompanionAttestation,
  type GpsEvidence,
  type Hex,
  type ImuEvidence,
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

// ---------------------------------------------------------------------------
// Companions — ticket S1-14.
// ---------------------------------------------------------------------------

export type CompanionRejectReason = RejectReason | "PAYLOAD_MISMATCH" | "REPLAY";

/** Evidence a witness sends in the clear so we can check it against what it signed. */
export type CompanionEvidence = { imu: ImuEvidence } | { gps: GpsEvidence } | undefined;

export interface CompanionAccepted {
  status: "accepted";
  companion: CompanionAttestation;
  digest: Hex;
  imu?: ImuEvidence;
}

export interface CompanionRejected {
  status: "rejected";
  companion: CompanionAttestation;
  reason: CompanionRejectReason;
  detail?: string;
}

export type CompanionOutcome = CompanionAccepted | CompanionRejected;

/**
 * Verifies witness attestations.
 *
 * Same step order as records and for the same reasons — membership before curve
 * arithmetic, verification before storage. One extra step at the end: if the witness sent
 * its evidence in the clear, we recompute the hash and check it against the `payload` it
 * signed. A device that signs one set of numbers and reports another is caught here rather
 * than being quietly believed, which matters because those numbers vote in the consensus
 * rule.
 */
export class CompanionVerifier {
  /** (dev, seq, subject) already seen. Companions carry no chain, so replay is caught here. */
  private readonly seen = new Set<string>();

  constructor(private readonly devices: DeviceDirectory) {}

  ingest(
    companion: CompanionAttestation,
    signature: Hex,
    evidence?: CompanionEvidence,
  ): CompanionOutcome {
    if (!this.devices.isKnown(companion.dev)) {
      return { status: "rejected", companion, reason: "UNKNOWN_DEVICE" };
    }
    if (!this.devices.isActive(companion.dev)) {
      return { status: "rejected", companion, reason: "REVOKED_DEVICE" };
    }

    const verified = verifyCompanion(companion, signature);
    if (!verified.ok) {
      return { status: "rejected", companion, reason: "BAD_SIGNATURE", detail: verified.reason };
    }

    let imu: ImuEvidence | undefined;
    if (evidence !== undefined) {
      const expected =
        "imu" in evidence ? imuEvidenceHash(evidence.imu) : gpsEvidenceHash(evidence.gps);
      if (expected.toLowerCase() !== companion.payload.toLowerCase()) {
        return {
          status: "rejected",
          companion,
          reason: "PAYLOAD_MISMATCH",
          detail: `evidence hashes to ${expected}, signed payload is ${companion.payload}`,
        };
      }
      if ("imu" in evidence) imu = evidence.imu;
    }

    // A PHOTO carries no separate evidence: the payload IS the image hash, and the image
    // never leaves the device. We can only attest that the hash we show is the hash that
    // was signed — which is exactly the claim the consumer page makes.
    const key = `${companion.dev.toLowerCase()}:${companion.seq}:${companion.subject.toLowerCase()}`;
    if (this.seen.has(key)) {
      return { status: "rejected", companion, reason: "REPLAY" };
    }
    this.seen.add(key);

    const accepted: CompanionAccepted = {
      status: "accepted",
      companion,
      digest: companionDigest(companion),
    };
    if (imu !== undefined) accepted.imu = imu;
    return accepted;
  }
}
