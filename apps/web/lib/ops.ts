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
 */
export type NodeStatus = "online" | "offline";

export interface NodeHealth {
  address: string;
  lastSeen: number;
  bufferDepth: number | null;
  status: NodeStatus;
}

export function toNodeHealth(events: HealthEvent[]): NodeHealth[] {
  return events.map((e) => ({
    address: e.dev,
    lastSeen: e.lastSeenAt,
    bufferDepth: e.bufferDepth ?? null,
    status: e.online ? "online" : "offline",
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
