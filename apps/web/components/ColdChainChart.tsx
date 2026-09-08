/**
 * Ticket S2-05 — cold-chain chart. Hand-drawn inline SVG (no charting library — a couple of
 * series doesn't earn a dependency), plotting `record.t` (deci-C) and `record.h` (deci-%RH)
 * over the record sequence, with the breach window shaded.
 *
 * Breach detection comes from `lib/incidents.ts` — the same function `Badge.tsx` uses — so the
 * chart and the badge can never disagree about whether a breach happened. No component here
 * hardcodes the old `record.t > 100` check.
 *
 * Sensor-fault readings (PROTOCOL.md §1.1's `t = -32768` / `h = 65535` sentinels — real, live
 * data from the Android virtual-node feature, not a hypothetical) are excluded from both
 * series' min/max/path so one fault reading can't blow out the axis, but their x-position is
 * still marked with a small "x" so the gap reads as "no real reading here", not silently
 * missing data.
 */

import { isSensorFault, deriveIncidents, DEFAULT_TEMP_MAX_C, type LotRecordLike } from "../lib/incidents";

interface ChartRecord extends LotRecordLike {
  seq: number;
  t: number;
  h: number;
  flags: number;
  tsq: number;
}

const WIDTH = 640;
const CHART_HEIGHT = 160;
const TSQ_STRIP_HEIGHT = 16;
const HEIGHT = CHART_HEIGHT + TSQ_STRIP_HEIGHT;
const PAD_X = 8;
const PAD_Y = 16;

/** Builds one or more disconnected path segments, so a fault reading breaks the line instead
 *  of the chart interpolating straight across a sensor failure. */
function buildPath(
  records: ChartRecord[],
  x: (index: number) => number,
  y: (value: number) => number,
  valueOf: (record: ChartRecord) => number,
): string {
  let d = "";
  let penDown = false;
  records.forEach((record, index) => {
    if (isSensorFault(record)) {
      penDown = false;
      return;
    }
    d += `${penDown ? "L" : "M"}${x(index).toFixed(1)},${y(valueOf(record)).toFixed(1)} `;
    penDown = true;
  });
  return d.trim();
}

export function ColdChainChart({
  records,
  tempMaxC = DEFAULT_TEMP_MAX_C,
}: {
  records: ChartRecord[];
  tempMaxC?: number;
}) {
  if (records.length === 0) return null;

  const nonFault = records.filter((record) => !isSensorFault(record));
  const temps = nonFault.map((record) => record.t / 10);
  const min = Math.min(...temps, tempMaxC);
  const max = Math.max(...temps, tempMaxC);
  const range = max - min || 1;

  const innerWidth = WIDTH - PAD_X * 2;
  const innerHeight = CHART_HEIGHT - PAD_Y * 2;

  const x = (index: number) =>
    PAD_X + (records.length === 1 ? innerWidth / 2 : (index / (records.length - 1)) * innerWidth);
  const yTemp = (tempC: number) => PAD_Y + innerHeight - ((tempC - min) / range) * innerHeight;
  // Humidity has a fixed, real-world 0-100% scale (deci-percent from the API, per
  // PROTOCOL.md §1.1) — not data-driven, so a run of uniformly dry or humid readings doesn't
  // make the chart look artificially dramatic.
  const yHumidity = (pctRH: number) => PAD_Y + innerHeight - (pctRH / 100) * innerHeight;

  const tempPath = buildPath(records, x, yTemp, (r) => r.t / 10);
  const humidityPath = buildPath(records, x, yHumidity, (r) => r.h / 10);

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

  const thresholdY = yTemp(tempMaxC);
  const faultRecords = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isSensorFault(record));

  // tsq === 2 (FRESH) is the expected case and gets no marker at all — only the degraded
  // states (0 = never synced, 1 = stale) earn a mark, and 0 is the louder of the two.
  const tsqMarks = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.tsq === 0 || record.tsq === 1);

  const faultCount = faultRecords.length;

  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
        Temperature &amp; humidity · {records.length} readings
        {faultCount > 0 ? ` · ${faultCount} sensor fault${faultCount === 1 ? "" : "s"}` : ""}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={
          breached
            ? `Temperature and humidity chart with a cold-chain breach shaded from seq ${breachStart} to ${breachEnd}`
            : "Temperature and humidity chart, no cold-chain breach"
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
        {humidityPath && (
          <path
            d={humidityPath}
            fill="none"
            stroke="var(--color-action-blue)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            strokeLinejoin="round"
          />
        )}
        {tempPath && (
          <path
            d={tempPath}
            fill="none"
            stroke={breached ? "var(--status-flagged)" : "var(--status-verified)"}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}
        {/* Fault markers: a small grey "x" at the fault's x-position, so a sensor failure reads
            as "no real reading here" rather than a silent gap in the timeline. */}
        {faultRecords.map(({ record, index }) => (
          <text
            key={`fault-${record.seq}`}
            x={x(index)}
            y={PAD_Y + innerHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--color-slate-strong)"
            aria-hidden="true"
          >
            &#215;
          </text>
        ))}
        {/* tsq strip beneath the chart: an amber/red dot for a degraded clock, nothing for the
            expected fresh-sync case (tsq === 2), so the strip stays quiet when there's nothing
            to say. */}
        {tsqMarks.map(({ record, index }) => (
          <circle
            key={`tsq-${record.seq}`}
            cx={x(index)}
            cy={CHART_HEIGHT + TSQ_STRIP_HEIGHT / 2}
            r={record.tsq === 0 ? 3 : 2}
            fill={record.tsq === 0 ? "var(--status-unverifiable)" : "var(--status-flagged)"}
            opacity={record.tsq === 0 ? 1 : 0.7}
          >
            <title>{record.tsq === 0 ? "clock never synced" : "clock stale"}</title>
          </circle>
        ))}
      </svg>
      <div
        style={{
          display: "flex",
          gap: "var(--space-md)",
          flexWrap: "wrap",
          alignItems: "center",
          fontSize: "0.78rem",
          marginBottom: "var(--space-sm)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 16,
              height: 2,
              background: breached ? "var(--status-flagged)" : "var(--status-verified)",
            }}
          />
          <span className="muted">Temperature</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 16,
              height: 0,
              borderTop: "2px dashed var(--color-action-blue)",
            }}
          />
          <span className="muted">Humidity</span>
        </span>
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
        Dashed grey line marks the {tempMaxC}&deg;C cold-chain threshold.
        {breached ? ` Breach shaded from seq ${breachStart} to ${breachEnd}.` : " No breach detected."}
        {faultCount > 0 ? ` "×" marks a sensor-fault reading (excluded from both lines).` : ""}
      </p>
    </div>
  );
}
