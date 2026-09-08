/**
 * Ticket S2-05 — cold-chain chart. Hand-drawn inline SVG (no charting library — one series
 * doesn't earn a dependency), plotting `record.t` (deci-C) over the record sequence, with the
 * breach window shaded.
 *
 * Breach detection comes from `lib/incidents.ts` — the same function `Badge.tsx` uses — so the
 * chart and the badge can never disagree about whether a breach happened. No component here
 * hardcodes the old `record.t > 100` check.
 */

import { deriveIncidents, DEFAULT_TEMP_MAX_C, type LotRecordLike } from "../lib/incidents";

interface ChartRecord extends LotRecordLike {
  seq: number;
  t: number;
}

const WIDTH = 640;
const HEIGHT = 160;
const PAD_X = 8;
const PAD_Y = 16;

export function ColdChainChart({
  records,
  tempMaxC = DEFAULT_TEMP_MAX_C,
}: {
  records: ChartRecord[];
  tempMaxC?: number;
}) {
  if (records.length === 0) return null;

  const temps = records.map((record) => record.t / 10);
  const min = Math.min(...temps, tempMaxC);
  const max = Math.max(...temps, tempMaxC);
  const range = max - min || 1;

  const innerWidth = WIDTH - PAD_X * 2;
  const innerHeight = HEIGHT - PAD_Y * 2;

  const x = (index: number) =>
    PAD_X + (records.length === 1 ? innerWidth / 2 : (index / (records.length - 1)) * innerWidth);
  const y = (tempC: number) => PAD_Y + innerHeight - ((tempC - min) / range) * innerHeight;

  const path = records
    .map((record, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(record.t / 10).toFixed(1)}`)
    .join(" ");

  const { breached, breachStart, breachEnd } = deriveIncidents(records, { tempMaxC });

  const indexBySeq = new Map(records.map((record, index) => [record.seq, index]));
  const breachRect =
    breached && breachStart !== null && breachEnd !== null
      ? (() => {
          const x1 = x(indexBySeq.get(breachStart) ?? 0);
          const x2 = x(indexBySeq.get(breachEnd) ?? records.length - 1);
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          return { x: left - 3, width: Math.max(right - left + 6, 6) };
        })()
      : null;

  const thresholdY = y(tempMaxC);

  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
        Temperature · {records.length} readings
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={
          breached
            ? `Temperature chart with a cold-chain breach shaded from seq ${breachStart} to ${breachEnd}`
            : "Temperature chart, no cold-chain breach"
        }
      >
        {breachRect && (
          <rect
            x={breachRect.x}
            y={PAD_Y}
            width={breachRect.width}
            height={innerHeight}
            fill="var(--status-flagged-wash)"
          />
        )}
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={thresholdY}
          y2={thresholdY}
          stroke="var(--color-hairline)"
          strokeDasharray="4 4"
        />
        <path
          d={path}
          fill="none"
          stroke={breached ? "var(--status-flagged)" : "var(--status-verified)"}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
      <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
        Dashed line marks the {tempMaxC}&deg;C cold-chain threshold.
        {breached ? ` Breach shaded from seq ${breachStart} to ${breachEnd}.` : " No breach detected."}
      </p>
    </div>
  );
}
