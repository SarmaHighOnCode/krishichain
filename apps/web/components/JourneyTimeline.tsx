/**
 * Ticket S2-02 — journey timeline. One entry per sensor reading, grouping long nominal runs
 * so a 60+ record demo lot doesn't become a firehose — every genesis/final reading and every
 * anomalous one (chain issue, flag, or cold-chain breach) is always shown individually.
 *
 * KNOWN GAP: `GET /lot/:lotId` (apps/gateway/src/index.ts) returns sensor readings only —
 * there is no custody/handoff data ("harvested by X", "picked up by Y"). That would come from
 * reading `LotRegistry`'s on-chain custody transfers, which is a gateway API change belonging
 * to another owner's ticket scope. This renders what the API actually returns today rather
 * than inventing custody events; plug real handoff entries in here once that endpoint exists.
 */

import { Flags, type ChainVerdict } from "@krishichain/core";

import { isBreaching, type LotRecordLike } from "../lib/incidents";

interface TimelineRecord extends LotRecordLike {
  ts: string;
  h: number;
  flags: number;
  verdict: ChainVerdict;
  anchored: boolean;
}

const MAX_VISIBLE = 25;
const EDGE_COUNT = 3;

function isAnomalous(record: TimelineRecord): boolean {
  return record.verdict !== "ACCEPT" || isBreaching(record) || (record.flags & Flags.LID_OPEN) !== 0;
}

function formatTimestamp(ts: string): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return "unsynced clock";
  return new Date(seconds * 1000).toLocaleString();
}

function flagLabels(flags: number): string[] {
  const labels: string[] = [];
  if (flags & Flags.LID_OPEN) labels.push("LID OPEN");
  if (flags & Flags.SHOCK) labels.push("SHOCK");
  if (flags & Flags.SENSOR_FAULT) labels.push("SENSOR FAULT");
  if (flags & Flags.BUFFERED) labels.push("BUFFERED (offline)");
  if (flags & Flags.BOOT) labels.push("BOOT");
  if (flags & Flags.LOT_BOUND) labels.push("LOT BOUND");
  if (flags & Flags.CAL) labels.push("CALIBRATION");
  return labels;
}

type Row = { type: "record"; record: TimelineRecord } | { type: "gap"; count: number };

function buildRows(records: TimelineRecord[]): Row[] {
  const keep = new Set<number>();
  records.forEach((record, index) => {
    const edge = index < EDGE_COUNT || index >= records.length - EDGE_COUNT;
    if (records.length <= MAX_VISIBLE || edge || isAnomalous(record)) keep.add(index);
  });

  const rows: Row[] = [];
  let collapsed = 0;
  records.forEach((record, index) => {
    if (keep.has(index)) {
      if (collapsed > 0) {
        rows.push({ type: "gap", count: collapsed });
        collapsed = 0;
      }
      rows.push({ type: "record", record });
    } else {
      collapsed += 1;
    }
  });
  if (collapsed > 0) rows.push({ type: "gap", count: collapsed });

  return rows;
}

export function JourneyTimeline({ records }: { records: TimelineRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ marginBottom: 0 }}>
          No readings recorded yet.
        </p>
      </div>
    );
  }

  const rows = buildRows(records);

  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: "var(--space-md)" }}>
        Journey · {records.length} readings
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row, index) =>
          row.type === "gap" ? (
            <li
              key={`gap-${index}`}
              style={{
                padding: `var(--space-xs) 0 var(--space-xs) var(--space-lg)`,
                borderLeft: "2px solid var(--color-hairline)",
              }}
            >
              <span
                className="muted"
                style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}
              >
                ⋮ {row.count} nominal reading{row.count === 1 ? "" : "s"} collapsed
              </span>
            </li>
          ) : (
            <TimelineEntry key={row.record.seq} record={row.record} />
          ),
        )}
      </ol>
    </div>
  );
}

function TimelineEntry({ record }: { record: TimelineRecord }) {
  const breach = isBreaching(record);
  const anomalous = record.verdict !== "ACCEPT";
  const flags = flagLabels(record.flags);
  const lineColor =
    anomalous || breach ? "var(--status-flagged)" : "var(--color-hairline)";
  const dotColor = anomalous
    ? "var(--status-unverifiable)"
    : breach
      ? "var(--status-flagged)"
      : "var(--status-verified)";

  return (
    <li
      style={{
        position: "relative",
        padding: "var(--space-sm) 0 var(--space-sm) var(--space-lg)",
        borderLeft: `2px solid ${lineColor}`,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "-5px",
          top: "1.15rem",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>seq {record.seq}</strong>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {formatTimestamp(record.ts)}
        </span>
      </div>
      <p style={{ margin: "var(--space-xxs) 0 0" }}>
        {(record.t / 10).toFixed(1)}&deg;C · {(record.h / 10).toFixed(1)}% RH
        {record.anchored ? "" : " · not yet anchored"}
      </p>
      {(anomalous || flags.length > 0) && (
        <p className="muted" style={{ margin: "var(--space-xxs) 0 0", fontSize: "0.8rem" }}>
          {[...(anomalous ? [record.verdict] : []), ...flags].join(" · ")}
        </p>
      )}
    </li>
  );
}
