"use client";

/**
 * A breach/tamper banner that cannot be hidden, rendered from `app/ops/layout.tsx` so it is
 * visible and persistent across every `/ops/*` route, not just one.
 *
 * Three states, all honest:
 *   - `status === "live"` and a lot is flagged: loud, high-contrast, no dismiss button. This
 *     must not be hideable by the user — that is an explicit requirement.
 *   - `status === "live"` and nothing is flagged: render nothing. An empty ops dashboard
 *     shouldn't carry a permanent "all clear" banner taking up space.
 *   - `status !== "live"` (still connecting, or the MQTT connection dropped): a small, clearly
 *     muted note. Silently rendering nothing here would let "we don't know" be mistaken for
 *     "everything's fine" — the same honesty CLAUDE.md invariant 5 requires of `UNVERIFIABLE`.
 */

import Link from "next/link";

import { useSwarmMqtt } from "./twins/useSwarmMqtt";

function truncateLot(lot: string): string {
  return lot.length <= 14 ? lot : `${lot.slice(0, 8)}…${lot.slice(-4)}`;
}

export function BreachBanner() {
  const { status, lots } = useSwarmMqtt();

  if (status === "live") {
    const flagged = Array.from(lots.values()).filter(
      (lot) => lot.flagged || lot.badge === "FLAGGED",
    );

    if (flagged.length === 0) return null;

    return (
      <div className="breach-banner" role="alert">
        <span className="breach-banner__title">FLAGGED — COLD CHAIN BREACH</span>
        <span className="breach-banner__lots">
          {flagged.map((lot, index) => (
            <span key={lot.lot}>
              {index > 0 && ", "}
              <Link href={`/verify/${lot.lot}`}>{truncateLot(lot.lot)}</Link>
            </span>
          ))}
        </span>

        <style>{`
          .breach-banner {
            width: 100%;
            box-sizing: border-box;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 12px;
            padding: 18px 32px;
            background: var(--status-flagged);
            color: #fff;
            font-family: var(--font-mono);
            font-size: 0.95rem;
            letter-spacing: 0.02em;
            border-bottom: 3px solid var(--status-unverifiable);
            animation: breach-banner-pulse 1.8s ease-in-out infinite;
          }

          .breach-banner__title {
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .breach-banner__lots {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
          }

          .breach-banner__lots a {
            color: #fff;
            text-decoration: underline;
            text-underline-offset: 2px;
          }

          .breach-banner__lots a:hover {
            text-decoration-thickness: 2px;
          }

          @keyframes breach-banner-pulse {
            0%,
            100% {
              box-shadow: inset 0 0 0 0 rgba(179, 0, 0, 0);
            }
            50% {
              box-shadow: inset 0 0 0 3px rgba(179, 0, 0, 0.65);
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="breach-banner breach-banner--muted">
      breach monitor offline — reconnecting
      <style>{`
        .breach-banner--muted {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 32px;
          background: var(--dash-canvas-soft, var(--color-stone));
          color: var(--dash-ink-mute, var(--color-slate-strong));
          font-family: var(--font-mono);
          font-size: 0.75rem;
          letter-spacing: 0.03em;
          border-bottom: 1px solid var(--dash-hairline, var(--color-hairline));
        }
      `}</style>
    </div>
  );
}
