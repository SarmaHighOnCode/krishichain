/**
 * Consumer verification page — tickets S2-02, S2-03, S2-04.
 *
 * This is the highest-value screen in the project. Build it mobile-first: a judge will open
 * it on their own phone, and the moment that lands is watching a proof recompute in their
 * browser (docs/DEMO-SCRIPT.md, 1:15).
 *
 * Two rules the design must respect:
 *
 *   1. Render the journey BEFORE verification finishes, then upgrade the badge. Verification
 *      is progressive enhancement, never a blocking spinner — a page that white-screens on an
 *      RPC hiccup fails the one demo moment that matters.
 *   2. `UNVERIFIABLE` is a designed state, not an error path. A traceability system that can
 *      only say "verified" is a marketing asset, not a verification system (PRD §6.6).
 */

import { VerifyPanel } from "../../../components/VerifyPanel";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

interface LotRecord {
  seq: number;
  ts: string;
  tsq: number;
  t: number;
  h: number;
  lux: number;
  flags: number;
  digest: string;
  verdict: string;
  anchored: boolean;
}

interface LotResponse {
  lotId: string;
  recordCount: number;
  records: LotRecord[];
}

async function fetchLot(lotId: string): Promise<LotResponse | null> {
  try {
    const response = await fetch(`${GATEWAY}/lot/${lotId}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as LotResponse;
  } catch {
    return null;
  }
}

export default async function VerifyPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  const lot = await fetchLot(lotId);

  if (!lot) {
    return (
      <main>
        <h1>Lot not found</h1>
        <p className="muted">
          Nothing recorded for <code>{lotId}</code>. Is the gateway running? Try{" "}
          <code>npm run sim</code>.
        </p>
      </main>
    );
  }

  const breached = lot.records.some((record) => (record.flags & 0b1) !== 0 || record.t > 100);
  const unverifiable = lot.records.some((record) => record.verdict !== "ACCEPT");
  const anchored = lot.records.filter((record) => record.anchored).length;

  return (
    <main>
      <h1>Lot journey</h1>
      <p className="muted">
        <code>{lot.lotId}</code>
      </p>

      <div className="card">
        {unverifiable ? (
          <span className="badge badge--bad">Unverifiable — chain gap</span>
        ) : breached ? (
          <span className="badge badge--flagged">Flagged — cold chain breach</span>
        ) : anchored === lot.records.length ? (
          <span className="badge badge--ok">Verified</span>
        ) : (
          <span className="badge badge--pending">Pending anchor</span>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          {lot.recordCount} records · {anchored} anchored
        </p>
      </div>

      {/* TODO(S2-03): the browser must read the anchor root from a PUBLIC RPC, not from our
          API, and recompute the proof locally. Verifying against a root our own server hands
          us proves nothing. */}
      <VerifyPanel digest={lot.records[0]?.digest ?? ""} gatewayUrl={GATEWAY} />

      {/* TODO(S2-02): replace this table with the designed timeline.
          TODO(S2-05): cold-chain chart with the breach window shaded. */}
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr className="muted" style={{ textAlign: "left" }}>
              <th>seq</th>
              <th>temp</th>
              <th>rh</th>
              <th>state</th>
            </tr>
          </thead>
          <tbody>
            {lot.records.slice(-20).map((record) => (
              <tr key={record.seq}>
                <td>{record.seq}</td>
                <td>{(record.t / 10).toFixed(1)}&deg;C</td>
                <td>{(record.h / 10).toFixed(1)}%</td>
                <td className="muted">
                  {record.verdict}
                  {(record.flags & 0b1) !== 0 ? " · LID OPEN" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
