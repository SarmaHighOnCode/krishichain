/**
 * Shared types + fetch helper for the ops dashboard (S2-06/S2-07).
 *
 * Used both server-side (apps/web/app/ops/page.tsx, for the first paint) and client-side
 * (components/OpsDashboard.tsx, for the 3 s poll) so the two never drift on shape.
 */

import type { HealthEvent } from "@krishichain/core";

/**
 * Mirrors `GET /ops/summary` in apps/gateway/src/index.ts. S1-14/S1-15 (companion ingest +
 * MQTT/swarm) added the fields below `incidents` — including real per-node rows, which used to
 * not exist (see NodeHealth's history before this).
 */
export interface OpsSummary {
  records: number;
  companions: number;
  orphanCompanions: number;
  quarantined: number;
  batches: number;
  pendingLeaves: number;
  lastRoot: string;
  incidents: number;
  breaches: number;
  mqtt: { connected: boolean; dropped: number };
  /** Real per-device rows, direct from the gateway's swarm store — `store.allNodes()`. */
  nodes: HealthEvent[];
}

/**
 * Display row for the node health table. A thin reshape of `HealthEvent` (dev -> address,
 * lastSeenAt -> lastSeen) rather than a second source of truth — `status` is derived from the
 * gateway's own `online` boolean, not re-guessed client-side, because `online` is already
 * computed correctly there (a 5 s silence timeout — see docs/SWARM-API.md's "online is
 * computed, not reported").
 *
 * "buffering" is the one derived exception: a node that is reachable (`online === true`) but
 * still holding a nonzero backlog (`bufferDepth > 0`) is visibly catching up on
 * store-and-forward — the literal behaviour H1-08 built (pull WiFi, restore it, backlog
 * uploads oldest-first). It's an honest, expected, non-alarming intermediate state, not a
 * failure — see the `.badge--pending` reuse in OpsDashboard.tsx.
 */
export type NodeStatus = "online" | "buffering" | "offline";

export interface NodeHealth {
  address: string;
  lastSeen: number;
  bufferDepth: number | null;
  /** Battery percent 0-100, or null when this node hasn't reported one (`HealthEvent.bat` is
   *  optional — never fabricate a number for a row that doesn't have it). */
  bat: number | null;
  status: NodeStatus;
}

function statusFor(e: HealthEvent): NodeStatus {
  if (!e.online) return "offline";
  return (e.bufferDepth ?? 0) > 0 ? "buffering" : "online";
}

export function toNodeHealth(events: HealthEvent[]): NodeHealth[] {
  return events.map((e) => ({
    address: e.dev,
    lastSeen: e.lastSeenAt,
    bufferDepth: e.bufferDepth ?? null,
    bat: e.bat ?? null,
    status: statusFor(e),
  }));
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
