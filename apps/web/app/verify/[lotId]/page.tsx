/**
 * Consumer verification page — tickets S2-02, S2-03, S2-04, S2-05.
 *
 * This is the highest-value screen in the project. Built mobile-first: a judge will open it on
 * their own phone, and the moment that lands is watching a proof recompute in their browser
 * (docs/DEMO-SCRIPT.md, 1:15).
 *
 * Two rules the design must respect:
 *
 *   1. Render the journey BEFORE verification finishes, then upgrade the badge. Verification
 *      is progressive enhancement, never a blocking spinner — a page that white-screens on an
 *      RPC hiccup fails the one demo moment that matters.
 *   2. `UNVERIFIABLE` is a designed state, not an error path. A traceability system that can
 *      only say "verified" is a marketing asset, not a verification system (PRD §6.6).
 */

import { type ChainVerdict } from "@krishichain/core";

import { Badge, decideVerificationStatus } from "../../../components/Badge";
import { ColdChainChart } from "../../../components/ColdChainChart";
import { JourneyTimeline } from "../../../components/JourneyTimeline";
import { VerifyPanel, type InclusionProof } from "../../../components/VerifyPanel";
import { networkForChainId, readBatchAnchorAddress } from "../../../lib/deployments";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";
// Local chain by default — a public Amoy mirror was built and deliberately dropped
// (TEAM-PLAN.md §6, cut item 5). The fallback below must match that decision, not the
// network we no longer deploy to: defaulting to a chain with nothing anchored on it would
// make the verification button silently fail for anyone whose env isn't fully set.
const RPC_URL = process.env.NEXT_PUBLIC_VERIFY_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_VERIFY_CHAIN_ID ?? "31337");

interface LotRecord {
  v: number;
  dev: `0x${string}`;
  seq: number;
  prev: `0x${string}`;
  ts: string;
  tsq: number;
  /** Per-record canonical `lot` field — always equal to the lot this page is showing, but it
   *  is one of the twelve canonically-encoded fields, so S2-03's leaf recomputation needs it
   *  read from the record itself rather than assumed from the URL. */
  lot: `0x${string}`;
  t: number;
  h: number;
  lux: number;
  flags: number;
  bat: number;
  /** The record's own 64-byte r||s signature (apps/gateway/src/index.ts's `/lot/:lotId`
   *  handler, previously withheld — see commit d9d4d3a). Needed so the browser can verify the
   *  signature itself instead of trusting the gateway's `verdict`. */
  sig: `0x${string}`;
  digest: `0x${string}`;
  verdict: ChainVerdict;
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

/**
 * Server-side proof fetch (S2-03). Moving this off the browser is what makes "still works with
 * the gateway killed" true: by the time the page renders, the proof (if any) is already in
 * hand, and the browser's only remaining network call is the public RPC read in VerifyPanel.
 */
async function fetchProof(digest: string): Promise<InclusionProof | null> {
  if (!digest) return null;
  try {
    const response = await fetch(`${GATEWAY}/proof/${digest}`, { cache: "no-store" });
    // Covers the gateway's real 404 "not anchored yet" response along with any other failure —
    // both resolve to the same honest "nothing to verify against yet" state in VerifyPanel.
    if (!response.ok) return null;
    return (await response.json()) as InclusionProof;
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

  const network = networkForChainId(CHAIN_ID);
  const firstDigest = lot.records[0]?.digest ?? "";

  const [proof, anchorAddress] = await Promise.all([
    fetchProof(firstDigest),
    readBatchAnchorAddress(network),
  ]);

  const anchoredCount = lot.records.filter((record) => record.anchored).length;
  const status = decideVerificationStatus(lot.records);

  return (
    <main>
      <h1>Lot journey</h1>
      <p className="muted">
        <code>{lot.lotId}</code>
      </p>

      <div className="card">
        <Badge status={status} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {lot.recordCount} records · {anchoredCount} anchored
        </p>
      </div>

      <VerifyPanel
        proof={proof}
        record={lot.records[0] ?? null}
        anchorAddress={anchorAddress}
        rpcUrl={RPC_URL}
        network={network}
      />

      <ColdChainChart records={lot.records} />

      <JourneyTimeline records={lot.records} />
    </main>
  );
}
