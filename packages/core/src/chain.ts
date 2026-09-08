/**
 * Per-device hash chain state machine. PROTOCOL.md §2.
 *
 * Signatures alone let an operator drop the inconvenient readings and present a set of
 * individually valid records. The hash chain makes the *set* attestable: an omission
 * becomes a visible, recorded event rather than silence. This file is where that
 * guarantee actually lives, so every branch here is tested.
 */

import { recordDigest } from "./crypto.js";
import type { Hex, SensorRecord } from "./types.js";
import { ZERO_DIGEST } from "./types.js";

export type ChainVerdict =
  /** Correct successor. Store it. */
  | "ACCEPT"
  /** Already seen, byte-identical. Idempotent no-op. */
  | "DUPLICATE"
  /** seq jumped forward — records are missing. Store, mark unverifiable, raise an incident. */
  | "CHAIN_GAP"
  /** Same seq, different digest, or prev does not match. The device is emitting a divergent
   *  history. Quarantine and alert — this is the serious one. */
  | "CHAIN_FORK";

export interface ChainState {
  /** seq of the last accepted record, or null if we have never seen this device. */
  lastSeq: number | null;
  /** Digest of the last accepted record. */
  lastDigest: Hex | null;
}

export interface ChainCheck {
  verdict: ChainVerdict;
  digest: Hex;
  /** Number of records missing, when the verdict is CHAIN_GAP. */
  missing?: number;
  /** Human-readable reason, for the incident log and the ops dashboard. */
  detail?: string;
  /** State to persist if this record is accepted. Absent when it must not advance state. */
  next?: ChainState;
}

export const EMPTY_CHAIN_STATE: ChainState = { lastSeq: null, lastDigest: null };

/**
 * Classify an incoming record against the device's known chain state.
 *
 * Deliberately pure: the gateway owns persistence, this owns the decision. That split is
 * what lets the same logic run in tests, in the simulator and in the ingest path.
 */
export function checkChain(state: ChainState, record: SensorRecord): ChainCheck {
  const digest = recordDigest(record);

  // First record we have ever seen from this device.
  if (state.lastSeq === null || state.lastDigest === null) {
    if (record.seq === 0) {
      if (record.prev !== ZERO_DIGEST) {
        return {
          verdict: "CHAIN_FORK",
          digest,
          detail: "genesis record must have a zero prev digest",
        };
      }
      return { verdict: "ACCEPT", digest, next: { lastSeq: 0, lastDigest: digest } };
    }
    // Joining mid-stream: everything before this is missing, and we say so rather than
    // quietly accepting the device's history from here.
    return {
      verdict: "CHAIN_GAP",
      digest,
      missing: record.seq,
      detail: `first record from this device is seq ${record.seq}, expected genesis`,
      next: { lastSeq: record.seq, lastDigest: digest },
    };
  }

  const expected = state.lastSeq + 1;

  if (record.seq === expected) {
    if (record.prev !== state.lastDigest) {
      return {
        verdict: "CHAIN_FORK",
        digest,
        detail: `prev mismatch at seq ${record.seq}: expected ${state.lastDigest}, got ${record.prev}`,
      };
    }
    return { verdict: "ACCEPT", digest, next: { lastSeq: record.seq, lastDigest: digest } };
  }

  if (record.seq < expected) {
    // A replay. Identical is harmless (the node retried before an ack landed); different
    // bytes at the same seq means two histories exist, which is never harmless.
    if (record.seq === state.lastSeq && digest === state.lastDigest) {
      return { verdict: "DUPLICATE", digest, detail: "identical replay of the last record" };
    }
    return {
      verdict: record.seq === state.lastSeq ? "CHAIN_FORK" : "DUPLICATE",
      digest,
      detail:
        record.seq === state.lastSeq
          ? `divergent record at seq ${record.seq}: same seq, different digest`
          : `stale record at seq ${record.seq}, already at ${state.lastSeq}`,
    };
  }

  return {
    verdict: "CHAIN_GAP",
    digest,
    missing: record.seq - expected,
    detail: `${record.seq - expected} record(s) missing between seq ${expected} and ${record.seq}`,
    next: { lastSeq: record.seq, lastDigest: digest },
  };
}

/**
 * Verify a complete run of records as a standalone chain.
 *
 * This is what runs when an offline node drains its buffer: the whole backlog is checked
 * for continuity in one pass, so an outage produces a verified run rather than a hole.
 */
export function verifyRun(
  records: SensorRecord[],
  from: ChainState = EMPTY_CHAIN_STATE,
): { ok: boolean; state: ChainState; failures: Array<{ index: number; check: ChainCheck }> } {
  let state = from;
  const failures: Array<{ index: number; check: ChainCheck }> = [];

  records.forEach((record, index) => {
    const check = checkChain(state, record);
    if (check.verdict !== "ACCEPT") failures.push({ index, check });
    if (check.next) state = check.next;
  });

  return { ok: failures.length === 0, state, failures };
}
