"use client";

/**
 * Ticket S2-12 — Web twins: Leaflet field map + R3F crate twins + health cards, all live over
 * MQTT-WS. This is the client component `apps/web/app/ops/twins/page.tsx` renders; it owns the
 * MQTT connection lifecycle (via `useSwarmMqtt`) and lays the three pieces out inside the
 * existing ops shell (`app/ops/layout.tsx`).
 *
 * Leaflet and R3F both touch `window`/`document`/WebGL at import time, which crashes a Next.js
 * server render. Both are loaded here through `next/dynamic({ ssr: false })` rather than relying
 * on this file's own "use client" boundary — a client component still renders once on the
 * server for the initial HTML in the App Router, so the `ssr: false` on the dynamic import is
 * what actually keeps `FieldMap`/`CrateTwins` out of that server pass.
 *
 * Visual language matches components/OpsDashboard.tsx (S2-06/S2-07): same hero gradient, same
 * `.dash-panel`/`.dash-stat-card`/`.dash-table` shapes, same `--dash-*` tokens from
 * dashboard-theme.css and `.badge`/`--status-*` tokens from globals.css. Those classes live only
 * inside OpsDashboard.tsx's own scoped `<style>` block (this codebase doesn't have a shared
 * dashboard-components stylesheet yet), so the subset used here is reproduced in this file's own
 * `<style>` block rather than reaching into another ticket's component — same pattern, new file.
 */

import dynamic from "next/dynamic";
import { useMemo, type CSSProperties, type ReactNode } from "react";

import { BADGE_CLASS, BADGE_COLORS, BADGE_LABEL } from "./colors";
import { useSwarmMqtt, type ConnectionStatus } from "./useSwarmMqtt";

const FieldMap = dynamic(() => import("./FieldMap").then((m) => m.FieldMap), {
  ssr: false,
  loading: () => <div className="twins-canvas-placeholder">Loading field map…</div>,
});

const CrateTwins = dynamic(() => import("./CrateTwins").then((m) => m.CrateTwins), {
  ssr: false,
  loading: () => <div className="twins-canvas-placeholder">Loading crate twins…</div>,
});

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case "live":
      return <span className="badge badge--ok">live</span>;
    case "connecting":
      return <span className="badge badge--pending">connecting…</span>;
    case "error":
      return <span className="badge badge--bad">connection error</span>;
    case "reconnecting":
    default:
      return <span className="badge badge--flagged">reconnecting…</span>;
  }
}

function StatCard({ label, value, accentColor }: { label: string; value: ReactNode; accentColor: string }) {
  return (
    <div className="dash-stat-card" style={{ "--accent": accentColor } as CSSProperties}>
      <p className="dash-stat-card__label">{label}</p>
      <p className="dash-stat-card__value">{value}</p>
    </div>
  );
}

export function TwinsDashboard() {
  const { status, health, lots, incidents } = useSwarmMqtt();

  const nodes = useMemo(() => Array.from(health.values()).sort((a, b) => a.dev.localeCompare(b.dev)), [health]);
  const lotList = useMemo(() => Array.from(lots.values()).sort((a, b) => a.lot.localeCompare(b.lot)), [lots]);

  const onlineCount = nodes.filter((n) => n.online).length;
  const flaggedLots = lotList.filter((l) => l.flagged).length;

  const metaText =
    status === "connecting"
      ? "connecting to broker…"
      : status === "error"
        ? "could not reach the broker"
        : `${nodes.length} node${nodes.length === 1 ? "" : "s"} known · ${lotList.length} lot${lotList.length === 1 ? "" : "s"} known`;

  return (
    <>
      <div className="dash-hero">
        <div className="dash-hero__intro">
          <p className="dash-hero__eyebrow">KrishiChain · Twins</p>
          <h2 className="dash-hero__title">Live swarm twins.</h2>
          <p className="dash-hero__sub muted">
            Field map and 3D-lite crate twins, live over MQTT — retained health and lot state on
            connect, then every update as it happens.
          </p>
          <div className="dash-hero__meta">
            <ConnectionBadge status={status} />
            <span className="muted dash-hero__updated">{metaText}</span>
          </div>
        </div>
      </div>

      <div className="twins-stat-grid">
        <StatCard label="Nodes online" value={`${onlineCount} / ${nodes.length}`} accentColor="var(--dash-primary)" />
        <StatCard label="Active lots" value={lotList.length} accentColor="var(--dash-navy-900)" />
        <StatCard
          label="Flagged lots"
          value={flaggedLots}
          accentColor={flaggedLots > 0 ? "var(--status-flagged)" : "var(--dash-hairline)"}
        />
        <StatCard
          label="Incidents (this session)"
          value={incidents.length}
          accentColor={incidents.length > 0 ? "var(--status-unverifiable)" : "var(--dash-hairline)"}
        />
      </div>

      <div className="dash-panel twins-map-panel">
        <p className="dash-panel__title">Field map</p>
        {nodes.length > 0 ? (
          <div className="twins-canvas-frame">
            <FieldMap nodes={nodes} />
          </div>
        ) : (
          <p className="muted dash-panel__empty">
            No node health has arrived yet. Start <code>npm run broker</code> and{" "}
            <code>npm run sim-swarm</code> (or power up a board) to see markers here.
          </p>
        )}
      </div>

      <div className="dash-panel twins-crates-panel">
        <p className="dash-panel__title">Crate twins</p>
        {lotList.length > 0 ? (
          <>
            <div className="twins-canvas-frame twins-canvas-frame--crates">
              <CrateTwins lots={lotList} />
            </div>
            <ul className="twins-legend">
              {lotList.map((lot) => (
                <li key={lot.lot} className="twins-legend__item">
                  <span className="twins-legend__swatch" style={{ background: BADGE_COLORS[lot.badge] }} aria-hidden="true" />
                  <code className="twins-legend__lot" title={lot.lot}>
                    {lot.lot.slice(0, 10)}…
                  </code>
                  <span className={`badge ${BADGE_CLASS[lot.badge]}`}>{BADGE_LABEL[lot.badge]}</span>
                  <span className="muted twins-legend__temp">
                    {lot.lastTempDeciC !== null ? `${(lot.lastTempDeciC / 10).toFixed(1)}°C` : "no reading yet"}
                  </span>
                  <span className="muted twins-legend__updated">updated {new Date(lot.updatedAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted dash-panel__empty">
            No lot state has arrived yet. A lot appears here once a node binds one and the
            gateway republishes its state.
          </p>
        )}
      </div>

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

        .twins-stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
          color: var(--dash-navy);
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

        .twins-canvas-frame {
          height: 420px;
          border-radius: var(--dash-radius-md);
          overflow: hidden;
          border: 1px solid var(--dash-hairline);
        }

        .twins-canvas-frame--crates {
          height: 340px;
          margin-bottom: 16px;
        }

        .twins-canvas-placeholder {
          height: 100%;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--dash-canvas-soft);
          color: var(--dash-ink-mute);
          font-family: var(--font-mono);
          font-size: 0.8rem;
        }

        /* Offline-safe "field" backdrop for Leaflet — see FieldMap.tsx's comment on why there
           is no remote TileLayer. Two overlaid repeating-linear-gradients stand in for a plotted
           field without fetching a single byte over the network. */
        .twins-field-map.leaflet-container {
          background-color: #edf7e6;
          background-image:
            repeating-linear-gradient(0deg, rgba(0, 60, 51, 0.06) 0, rgba(0, 60, 51, 0.06) 1px, transparent 1px, transparent 40px),
            repeating-linear-gradient(90deg, rgba(0, 60, 51, 0.06) 0, rgba(0, 60, 51, 0.06) 1px, transparent 1px, transparent 40px);
        }

        .twins-marker {
          background: transparent;
          border: none;
        }

        .twins-legend {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .twins-legend__item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--dash-radius-sm);
          border: 1px solid var(--dash-hairline);
          flex-wrap: wrap;
        }

        .twins-legend__swatch {
          width: 10px;
          height: 10px;
          border-radius: var(--dash-radius-pill);
          flex: 0 0 auto;
        }

        .twins-legend__lot {
          font-size: 0.85rem;
          color: var(--dash-ink-secondary);
        }

        .twins-legend__temp,
        .twins-legend__updated {
          font-size: 0.78rem;
          margin-left: auto;
        }

        .twins-legend__updated {
          margin-left: 0;
        }
      `}</style>
    </>
  );
}
