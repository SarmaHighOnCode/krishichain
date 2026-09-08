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

import { useEffect, useState, type CSSProperties } from "react";

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
  accentColor,
}: {
  label: string;
  value: number;
  /** Reuses the existing badge palette — no new colors — to make a nonzero quarantine/incident
   *  count visually stand out per the ticket. */
  emphasis?: "flagged" | "bad";
  /** Top accent bar color — purely a card-identity cue (like a colored tab), same idea as
   *  emphasis but decorative rather than semantic. Callers pass a neutral hairline color for
   *  cards that have nothing to flag, so the bar never implies a problem that isn't there. */
  accentColor: string;
}) {
  const valueColor =
    emphasis === "bad"
      ? "var(--status-unverifiable)"
      : emphasis === "flagged"
        ? "var(--status-flagged)"
        : "var(--dash-navy)";

  return (
    <div className="dash-stat-card" style={{ "--accent": accentColor } as CSSProperties}>
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
 * Donut breakdown of `records` into three real, already-fetched buckets — no new data source.
 * `settled` is derived (records minus the two buckets the gateway does report), not observed
 * directly; it reads as "accepted and not currently pending or quarantined" rather than a
 * separately-verified status.
 */
function RecordsDonut({ summary }: { summary: OpsSummary }) {
  const quarantined = summary.quarantined;
  const pending = summary.pendingLeaves;
  const settled = Math.max(summary.records - quarantined - pending, 0);
  const total = settled + pending + quarantined;

  const segments = [
    { label: "Settled", value: settled, color: "var(--status-verified)" },
    { label: "Pending anchor", value: pending, color: "var(--status-pending)" },
    { label: "Quarantined", value: quarantined, color: "var(--status-unverifiable)" },
  ];

  const r = 52;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div className="dash-panel dash-donut-panel">
      <p className="dash-panel__title">Record composition</p>
      <div className="dash-donut">
        <svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="Record composition donut chart">
          <g transform="rotate(-90 60 60)">
            <circle cx="60" cy="60" r={r} fill="none" stroke="var(--dash-hairline)" strokeWidth="16" />
            {total > 0 &&
              segments
                .filter((s) => s.value > 0)
                .map((seg) => {
                  const length = (seg.value / total) * circumference;
                  const dashoffset = -cumulative;
                  cumulative += length;
                  return (
                    <circle
                      key={seg.label}
                      cx="60"
                      cy="60"
                      r={r}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="16"
                      strokeDasharray={`${length} ${circumference - length}`}
                      strokeDashoffset={dashoffset}
                    />
                  );
                })}
          </g>
          <text x="60" y="56" textAnchor="middle" className="dash-donut__total">
            {summary.records}
          </text>
          <text x="60" y="72" textAnchor="middle" className="dash-donut__total-label">
            records
          </text>
        </svg>
        <ul className="dash-donut__legend">
          {segments.map((seg) => (
            <li key={seg.label}>
              <span className="dash-donut__dot" style={{ background: seg.color }} aria-hidden="true" />
              <span className="dash-donut__legend-label">{seg.label}</span>
              <span className="dash-donut__legend-value">{seg.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface TrendPoint {
  t: number;
  records: number;
}

/**
 * A trend line built only from values this browser tab has actually observed via its own 3 s
 * poll — never invented. The gateway has no time-series endpoint (`GET /ops/summary` is a
 * point-in-time aggregate), so there is no way to plot real history before this page loaded;
 * the caption says so explicitly rather than pretending this is a historical chart.
 */
function SessionTrend({ history }: { history: TrendPoint[] }) {
  if (history.length < 2) {
    return (
      <div className="dash-panel dash-trend-panel">
        <p className="dash-panel__title">Records this session</p>
        <p className="muted dash-panel__empty">Collecting live samples…</p>
      </div>
    );
  }

  const values = history.map((p) => p.records);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 300;
  const height = 80;
  const pad = 6;

  const points = history.map((p, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - pad - ((p.records - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <div className="dash-panel dash-trend-panel">
      <p className="dash-panel__title">Records this session</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="dash-trend__svg" preserveAspectRatio="none" role="img" aria-label="Records ingested, sampled this session">
        <path d={areaPath} className="dash-trend__area" />
        <path d={linePath} className="dash-trend__line" />
      </svg>
      <p className="muted dash-trend__caption">
        {history.length} live samples since this page loaded — the gateway doesn&apos;t expose historical
        time-series data yet, so this only covers the current session.
      </p>
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
  // Every value this tab has actually observed via its own poll — see SessionTrend's comment on
  // why this is the only honest source for a trend line here.
  const [history, setHistory] = useState<TrendPoint[]>(
    initialSummary ? [{ t: Date.now(), records: initialSummary.records }] : [],
  );
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
        setHistory((h) => [...h, { t: Date.now(), records: result.records }].slice(-40));
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

  const updatedText =
    secondsAgo === null ? "waiting for first update…" : secondsAgo <= 1 ? "updated just now" : `updated ${secondsAgo}s ago`;

  return (
    <>
      <div className="dash-hero">
        <div className="dash-hero__intro">
          <p className="dash-hero__eyebrow">KrishiChain · Ops</p>
          <h2 className="dash-hero__title">Ops overview.</h2>
          <p className="dash-hero__sub muted">
            Field node health, buffer depth and incidents — live from the gateway.
          </p>
          <div className="dash-hero__meta">
            {isLive ? (
              <span className="badge badge--ok">live</span>
            ) : (
              <span className="badge badge--flagged">reconnecting…</span>
            )}
            <span className="muted dash-hero__updated">{updatedText}</span>
          </div>
        </div>

        {summary && (
          <div className="dash-hero__stats">
            <div className="dash-hero__stat">
              <strong>{summary.records}</strong>
              <span>records ingested</span>
            </div>
            <div className="dash-hero__stat">
              <strong>{summary.batches}</strong>
              <span>batches closed</span>
            </div>
          </div>
        )}
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
            <StatCard label="Records ingested" value={summary.records} accentColor="var(--dash-primary)" />
            <StatCard
              label="Quarantined"
              value={summary.quarantined}
              emphasis={summary.quarantined > 0 ? "bad" : undefined}
              accentColor={summary.quarantined > 0 ? "var(--status-unverifiable)" : "var(--dash-hairline)"}
            />
            <StatCard label="Batches closed" value={summary.batches} accentColor="var(--dash-navy-900)" />
            <StatCard
              label="Pending leaves (buffer depth)"
              value={summary.pendingLeaves}
              accentColor="var(--dash-primary-soft)"
            />
            <StatCard
              label="Incidents"
              value={summary.incidents}
              emphasis={summary.incidents > 0 ? "flagged" : undefined}
              accentColor={summary.incidents > 0 ? "var(--status-flagged)" : "var(--dash-hairline)"}
            />
          </div>

          <div className="dash-chart-row">
            <SessionTrend history={history} />
            <RecordsDonut summary={summary} />
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
        .dash-hero {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: 24px;
          background: linear-gradient(120deg, #f5e9d4 0%, #eef1ff 32%, #e3e0fb 58%, #ffe3ef 100%);
          border-radius: var(--dash-radius-xl);
          padding: 32px 36px;
          margin-bottom: 24px;
          box-shadow: var(--dash-shadow-2);
        }

        .dash-hero__eyebrow {
          margin: 0 0 8px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--dash-ink-secondary);
        }

        .dash-hero__title {
          margin: 0 0 6px;
          font-family: var(--font-display);
          font-weight: 300;
          font-size: 2.25rem;
          line-height: 1.1;
          letter-spacing: -0.02em;
          color: var(--dash-navy);
        }

        .dash-hero__sub {
          margin: 0 0 16px;
          max-width: 34rem;
        }

        .dash-hero__meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--space-md);
        }

        .dash-hero__updated {
          font-size: 0.85rem;
        }

        .dash-hero__stats {
          display: flex;
          gap: 32px;
        }

        .dash-hero__stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }

        .dash-hero__stat strong {
          font-family: var(--font-display);
          font-weight: 300;
          font-size: 2.5rem;
          line-height: 1.1;
          letter-spacing: -0.02em;
          color: var(--dash-navy);
          font-feature-settings: "tnum";
        }

        .dash-hero__stat span {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--dash-ink-mute);
        }

        .ops-stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 24px;
          margin: 0 0 24px;
        }

        .dash-stat-card {
          position: relative;
          overflow: hidden;
          background: var(--dash-canvas);
          border: 1px solid var(--dash-hairline);
          border-radius: var(--dash-radius-lg);
          padding: 24px 24px 20px;
          box-shadow: var(--dash-shadow-1);
          transition: box-shadow 0.15s ease;
        }

        .dash-stat-card::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: var(--accent, var(--dash-hairline));
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
          transition: box-shadow 0.15s ease;
        }

        .dash-panel:hover {
          box-shadow: var(--dash-shadow-2);
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

        .dash-chart-row {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 24px;
          margin-bottom: 24px;
        }

        @media (max-width: 800px) {
          .dash-chart-row {
            grid-template-columns: 1fr;
          }
        }

        .dash-trend-panel,
        .dash-donut-panel {
          margin-bottom: 0;
        }

        .dash-trend__svg {
          width: 100%;
          height: 80px;
          display: block;
        }

        .dash-trend__area {
          fill: var(--dash-primary-subdued);
          opacity: 0.35;
          stroke: none;
        }

        .dash-trend__line {
          fill: none;
          stroke: var(--dash-primary);
          stroke-width: 2;
          stroke-linejoin: round;
          stroke-linecap: round;
        }

        .dash-trend__caption {
          margin: 12px 0 0;
          font-size: 0.78rem;
        }

        .dash-donut {
          display: flex;
          align-items: center;
          gap: 20px;
          flex-wrap: wrap;
        }

        .dash-donut__total {
          font-family: var(--font-display);
          font-weight: 300;
          font-size: 1.4rem;
          fill: var(--dash-navy);
          font-feature-settings: "tnum";
        }

        .dash-donut__total-label {
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          fill: var(--dash-ink-mute);
        }

        .dash-donut__legend {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1 1 auto;
          min-width: 140px;
        }

        .dash-donut__legend li {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.85rem;
        }

        .dash-donut__dot {
          width: 8px;
          height: 8px;
          border-radius: var(--dash-radius-pill);
          flex: 0 0 auto;
        }

        .dash-donut__legend-label {
          color: var(--dash-ink-secondary);
        }

        .dash-donut__legend-value {
          margin-left: auto;
          font-feature-settings: "tnum";
          font-weight: 500;
          color: var(--dash-navy);
        }
      `}</style>
    </>
  );
}
