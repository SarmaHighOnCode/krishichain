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
        : "var(--dash-navy)";

  return (
    <div className="dash-stat-card">
      <p className="dash-stat-card__label">{label}</p>
      <p className="dash-stat-card__value" style={{ color: valueColor }}>
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
    <div className="dash-panel">
      <p className="dash-panel__title">Node health</p>
      {nodes.length === 0 ? (
        <p className="muted dash-panel__empty">
          Per-device last-seen and buffer depth aren&apos;t available yet — the gateway only
          exposes aggregate counts via <code>GET /ops/summary</code>. This table is wired up to
          render real rows as soon as a <code>GET /ops/nodes</code>-style endpoint (per-device{" "}
          <code>{"{ address, lastSeen, bufferDepth, status }"}</code>) exists; until then it stays
          empty rather than showing fabricated devices.
        </p>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Last seen</th>
              <th>Buffer depth</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.address}>
                <td>
                  <code>{node.address}</code>
                </td>
                <td>{new Date(node.lastSeen).toLocaleTimeString()}</td>
                <td className="dash-table__tnum">{node.bufferDepth}</td>
                <td>
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
        <div className="dash-panel">
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

          <div className="dash-root-panel">
            <p className="dash-root-panel__title">Last anchored root</p>
            {summary.lastRoot === ZERO_ROOT ? (
              <span className="badge badge--pending">none anchored yet</span>
            ) : (
              <code className="dash-root-panel__value" title={summary.lastRoot}>
                {truncateRoot(summary.lastRoot)}
              </code>
            )}
          </div>
        </>
      )}

      <NodeHealthTable nodes={nodes} />

      <style>{`
        .ops-status-line {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-md);
          margin-bottom: var(--space-lg);
        }

        .ops-stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 24px;
          margin: 0 0 24px;
        }

        .dash-stat-card {
          background: var(--dash-canvas);
          border: 1px solid var(--dash-hairline);
          border-radius: var(--dash-radius-lg);
          padding: 20px 24px;
          box-shadow: var(--dash-shadow-1);
          transition: box-shadow 0.15s ease;
        }

        .dash-stat-card:hover {
          box-shadow: var(--dash-shadow-2);
        }

        .dash-stat-card__label {
          margin: 0 0 8px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--dash-ink-mute);
        }

        .dash-stat-card__value {
          margin: 0;
          font-family: var(--font-display);
          font-weight: 300;
          font-size: 2.25rem;
          line-height: 1.1;
          letter-spacing: -0.02em;
          font-feature-settings: "tnum";
        }

        .dash-panel {
          background: var(--dash-canvas);
          border: 1px solid var(--dash-hairline);
          border-radius: var(--dash-radius-lg);
          box-shadow: var(--dash-shadow-1);
          padding: 24px;
          margin-bottom: 24px;
        }

        .dash-panel__title {
          margin: 0 0 12px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--dash-ink-mute);
        }

        .dash-panel__empty {
          margin-bottom: 0;
        }

        .dash-root-panel {
          background: var(--dash-navy-900);
          color: var(--dash-canvas);
          border-radius: var(--dash-radius-xl);
          box-shadow: var(--dash-shadow-2);
          padding: 24px;
          margin-bottom: 24px;
        }

        .dash-root-panel__title {
          margin: 0 0 12px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--dash-primary-subdued);
        }

        .dash-root-panel__value {
          font-family: var(--font-mono);
          font-size: 1rem;
          font-feature-settings: "tnum";
          color: var(--dash-canvas);
          background: transparent;
          padding: 0;
        }

        .dash-table {
          width: 100%;
          border-collapse: collapse;
        }

        .dash-table thead tr {
          text-align: left;
          border-bottom: 1px solid var(--dash-hairline);
        }

        .dash-table th {
          padding: 8px 12px;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--dash-ink-mute);
          font-weight: 400;
        }

        .dash-table td {
          padding: 12px;
          border-bottom: 1px solid var(--dash-hairline);
          font-size: 0.9rem;
        }

        .dash-table__tnum {
          font-feature-settings: "tnum";
        }

        .dash-table tbody tr:hover {
          background: var(--dash-canvas-soft);
        }

        .dash-table tbody tr:last-child td {
          border-bottom: none;
        }
      `}</style>
    </>
  );
}
