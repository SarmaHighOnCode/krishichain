/**
 * Ticket S2-04 — the verdict badge, as an explicit decision function.
 *
 * The page used to compute this inline as "any verdict !== ACCEPT", which can't tell a
 * `CHAIN_GAP` (records are missing) from a `DUPLICATE` (a harmless idempotent replay). Using
 * the real verdict vocabulary from `packages/core/src/chain.ts` fixes that.
 */

import type { ChainVerdict } from "@krishichain/core";

import { deriveIncidents, type LotRecordLike } from "../lib/incidents";

export interface BadgeRecord extends LotRecordLike {
  verdict: ChainVerdict;
  anchored: boolean;
}

export type VerificationStatus = "UNVERIFIABLE" | "FLAGGED" | "PENDING_ANCHOR" | "VERIFIED";

/** CHAIN_GAP and CHAIN_FORK are trust breaks — records are missing or the device's history
 *  diverged. DUPLICATE alone is not: it's an idempotent replay and must not escalate. */
const CHAIN_BREAKS: ReadonlySet<ChainVerdict> = new Set(["CHAIN_GAP", "CHAIN_FORK"]);

export function decideVerificationStatus(
  records: BadgeRecord[],
  incidentOptions?: { tempMaxC?: number },
): VerificationStatus {
  if (records.some((record) => CHAIN_BREAKS.has(record.verdict))) return "UNVERIFIABLE";

  const { breached } = deriveIncidents(records, incidentOptions);
  if (breached) return "FLAGGED";

  if (!records.every((record) => record.anchored)) return "PENDING_ANCHOR";

  return "VERIFIED";
}

const COPY: Record<VerificationStatus, { label: string; className: string }> = {
  UNVERIFIABLE: { label: "Unverifiable — chain gap or fork", className: "badge--bad" },
  FLAGGED: { label: "Flagged — cold chain breach", className: "badge--flagged" },
  PENDING_ANCHOR: { label: "Pending anchor", className: "badge--pending" },
  VERIFIED: { label: "Verified", className: "badge--ok" },
};

export function Badge({ status }: { status: VerificationStatus }) {
  const { label, className } = COPY[status];
  return <span className={`badge ${className}`}>{label}</span>;
}
