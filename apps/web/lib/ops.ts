/**
 * Shared types + fetch helper for the ops dashboard (S2-06/S2-07).
 *
 * Used both server-side (apps/web/app/ops/page.tsx, for the first paint) and client-side
 * (components/OpsDashboard.tsx, for the 3 s poll) so the two never drift on shape.
 */

/** Mirrors `GET /ops/summary` in apps/gateway/src/index.ts — aggregate counters only. */
export interface OpsSummary {
  records: number;
  quarantined: number;
  batches: number;
  pendingLeaves: number;
  lastRoot: string;
  incidents: number;
}

/**
 * Per-device health row for a future node table. The gateway does not expose this today —
 * `GET /ops/summary` is aggregate-only, there is no per-device array anywhere in
 * apps/gateway/src/index.ts. This type exists so the table in OpsDashboard has somewhere to
 * plug in real data later without a reshape. Do not populate it with fabricated rows.
 *
 * Recommended shape for the gateway team: `GET /ops/nodes` ->
 *   { address: Hex; lastSeen: number /* epoch ms *\/; bufferDepth: number; status: NodeStatus }[]
 * `lastSeen` from the most recent accepted record per `dev`; `bufferDepth` from the node's own
 * buffered-but-unsent count (needs the node to report it, e.g. an `ackSeq` gap) or, failing
 * that, its share of `pendingLeaves`; `status` derived from how stale `lastSeen` is.
 */
export type NodeStatus = "online" | "stale" | "offline";

export interface NodeHealth {
  address: string;
  lastSeen: number;
  bufferDepth: number;
  status: NodeStatus;
}

export const ZERO_ROOT = `0x${"00".repeat(32)}`;

export async function fetchOpsSummary(gatewayUrl: string): Promise<OpsSummary | null> {
  try {
    const response = await fetch(`${gatewayUrl}/ops/summary`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as OpsSummary;
  } catch {
    return null;
  }
}
