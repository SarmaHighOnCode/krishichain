"use client";

/**
 * Tickets S2-06 (ops dashboard) + S2-07 (live updates).
 *
 * Audience is the FPO manager / transporter, not the consumer: "is the field data flowing,
 * is anything quarantined or flagged, what did we last anchor" — not a proof-verification UI.
 *
 * S2-07 is 3 s polling against the existing `GET /ops/summary`, nothing more — explicitly no
 * WebSocket/SSE layer. A poll failure must never crash the page or blank the numbers: it keeps
 * the last-known-good summary on screen and surfaces staleness instead (CLAUDE.md #5 — failing
 * loudly applies to the consumer badge, but a transient gateway blip here is not a verification
 * failure, it's an ops signal, so it gets a quieter "stale" treatment).
 *
 * The poll hits `/api/ops/summary` (same-origin, see app/api/ops/summary/route.ts), not the
 * gateway directly — the gateway sends no CORS headers, so a browser-side fetch straight to it
 * fails silently with ERR_FAILED. The route handler does the actual cross-origin call
 * server-side, where CORS doesn't apply.
 */

import { useEffect, useState } from "react";

import { ZERO_ROOT, type NodeHealth, type OpsSummary } from "../lib/ops";

const POLL_INTERVAL_MS = 3000;
const POLL_ENDPOINT = "/api/ops/summary";

async function fetchOpsSummaryClient(): Promise<OpsSummary | null> {
  try {
    const response = await fetch(POLL_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as OpsSummary;
  } catch {
    return null;
  }
}

function truncateRoot(root: string): string {
  if (root.length <= 20) return root;
  return `${root.slice(0, 12)}…${root.slice(-8)}`;
}

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  /** Reuses the existing badge palette — no new colors — to make a nonzero quarantine/incident
   *  count visually stand out per the ticket. */
  emphasis?: "flagged" | "bad";
}) {
  const valueColor =
    emphasis === "bad"
      ? "var(--status-unverifiable)"
      : emphasis === "flagged"
        ? "var(--status-flagged)"
        : "var(--color-ink)";

  return (
    <div className="card ops-stat-card">
      <p className="eyebrow" style={{ marginBottom: "var(--space-xs)" }}>
        {label}
      </p>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "2rem",
          lineHeight: 1.1,
          color: valueColor,
        }}
      >
        {value}
      </p>
      {emphasis && (
        <span className={`badge ${emphasis === "bad" ? "badge--bad" : "badge--flagged"}`} style={{ marginTop: "var(--space-sm)" }}>
          needs attention
        </span>
      )}
    </div>
  );
}

/**
 * Stub for the per-device table this dashboard should eventually show. The gateway has no
 * per-node endpoint today (see the comment on `NodeHealth` in lib/ops.ts) — `nodes` is always
 * empty until one exists. Rendering a hardcoded row here would look like real telemetry; it
 * isn't, so this renders an honest "not available yet" state instead.
 */
function NodeHealthTable({ nodes }: { nodes: NodeHealth[] }) {
  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
        Node health
      </p>
      {nodes.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Per-device last-seen and buffer depth aren&apos;t available yet — the gateway only
          exposes aggregate counts via <code>GET /ops/summary</code>. This table is wired up to
          render real rows as soon as a <code>GET /ops/nodes</code>-style endpoint (per-device{" "}
          <code>{"{ address, lastSeen, bufferDepth, status }"}</code>) exists; until then it stays
          empty rather than showing fabricated devices.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-hairline)" }}>
              <th style={{ padding: "var(--space-sm) 0" }}>Device</th>
              <th style={{ padding: "var(--space-sm) 0" }}>Last seen</th>
              <th style={{ padding: "var(--space-sm) 0" }}>Buffer depth</th>
              <th style={{ padding: "var(--space-sm) 0" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.address} style={{ borderBottom: "1px solid var(--color-card-border)" }}>
                <td style={{ padding: "var(--space-sm) 0" }}>
                  <code>{node.address}</code>
                </td>
                <td style={{ padding: "var(--space-sm) 0" }}>
                  {new Date(node.lastSeen).toLocaleTimeString()}
                </td>
                <td style={{ padding: "var(--space-sm) 0" }}>{node.bufferDepth}</td>
                <td style={{ padding: "var(--space-sm) 0" }}>
                  <span
                    className={`badge ${
                      node.status === "online"
                        ? "badge--ok"
                        : node.status === "stale"
                          ? "badge--pending"
                          : "badge--bad"
                    }`}
                  >
                    {node.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function OpsDashboard({ initialSummary }: { initialSummary: OpsSummary | null }) {
  const [summary, setSummary] = useState<OpsSummary | null>(initialSummary);
  const [lastUpdated, setLastUpdated] = useState<number | null>(initialSummary ? Date.now() : null);
  const [isLive, setIsLive] = useState<boolean>(initialSummary !== null);
  // Forces a re-render once a second so "updated Xs ago" counts up between polls, without
  // itself triggering a network call.
  const [, setTick] = useState(0);

  useEffect(() => {
    const tickId = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tickId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await fetchOpsSummaryClient();
      if (cancelled) return;
      if (result) {
        setSummary(result);
        setLastUpdated(Date.now());
        setIsLive(true);
      } else {
        // Gateway unreachable this tick: keep the last-known-good numbers on screen and mark
        // the feed stale rather than blanking the page or throwing. Polling keeps retrying.
        setIsLive(false);
      }
    }

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const secondsAgo = lastUpdated !== null ? Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000)) : null;

  // Per-device rows: none available from the gateway yet — see NodeHealthTable's comment.
  const nodes: NodeHealth[] = [];

  return (
    <>
      <div className="ops-status-line">
        {isLive ? (
          <span className="badge badge--ok">live</span>
        ) : (
          <span className="badge badge--flagged">reconnecting…</span>
        )}
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {secondsAgo === null
            ? "waiting for first update…"
            : secondsAgo <= 1
              ? "updated just now"
              : `updated ${secondsAgo}s ago`}
        </span>
      </div>

      {summary === null ? (
        <div className="card">
          <p className="muted" style={{ marginBottom: 0 }}>
            Gateway unreachable. Is it running? Try <code>npm run dev:gateway</code>. This page
            keeps retrying every {POLL_INTERVAL_MS / 1000}s.
          </p>
        </div>
      ) : (
        <>
          <div className="ops-stat-grid">
            <StatCard label="Records ingested" value={summary.records} />
            <StatCard
              label="Quarantined"
              value={summary.quarantined}
              emphasis={summary.quarantined > 0 ? "bad" : undefined}
            />
            <StatCard label="Batches closed" value={summary.batches} />
            <StatCard label="Pending leaves (buffer depth)" value={summary.pendingLeaves} />
            <StatCard
              label="Incidents"
              value={summary.incidents}
              emphasis={summary.incidents > 0 ? "flagged" : undefined}
            />
          </div>

          <div className="card">
            <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
              Last anchored root
            </p>
            {summary.lastRoot === ZERO_ROOT ? (
              <span className="badge badge--pending">none anchored yet</span>
            ) : (
              <code title={summary.lastRoot}>{truncateRoot(summary.lastRoot)}</code>
            )}
          </div>
        </>
      )}

      <NodeHealthTable nodes={nodes} />

      <style>{`
        .ops-status-line {
          display: flex;
          align-items: center;
          gap: var(--space-md);
          margin-bottom: var(--space-lg);
        }

        .ops-stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: var(--space-lg);
          margin: var(--space-lg) 0;
        }

        .ops-stat-card {
          margin: 0;
        }
      `}</style>
    </>
  );
}
