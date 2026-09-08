"use client";

/**
 * Ticket S2-03 — client-side inclusion proof verification.
 *
 * THE demo moment. The inclusion proof itself is now fetched server-side (see
 * `app/verify/[lotId]/page.tsx`), so this component never talks to our own gateway — it only
 * reads the anchor root from a PUBLIC RPC (`NEXT_PUBLIC_VERIFY_RPC_URL` → `BatchAnchor.getRoot`)
 * and recomputes the Merkle path locally. Verifying a proof against a root our own server
 * supplied would prove nothing, and a judge will ask.
 *
 * Success criterion: this still returns green with the gateway process killed — the proof was
 * already handed down as a prop, and the only network call left at click time is the RPC read.
 */

import {
  recordDigest,
  verifyProof,
  verifyRecord,
  type Hex,
  type SensorRecord,
  type TimeQualityValue,
} from "@krishichain/core";
import { useMemo, useState } from "react";
import { createPublicClient, http } from "viem";

import { batchAnchorAbi } from "../lib/batchAnchorAbi";

export interface InclusionProof {
  digest: Hex;
  root: Hex;
  proof: Hex[];
  index: number;
  leafCount: number;
  anchorIndex: number;
}

/** Exactly the fields needed to recompute the leaf and check the signature — the twelve
 *  canonical record fields plus the 64-byte `sig` (S2-03). A structural subset of
 *  `app/verify/[lotId]/page.tsx`'s `LotRecord`, so that widened interface satisfies this one
 *  without any adapting. */
export interface VerifiableRecord {
  v: number;
  dev: Hex;
  seq: number;
  prev: Hex;
  ts: string;
  tsq: number;
  lot: Hex;
  t: number;
  h: number;
  lux: number;
  flags: number;
  bat: number;
  sig: Hex;
}

type Status = "idle" | "checking" | "verified" | "failed";

function truncate(hex: string): string {
  return hex.length <= 20 ? hex : `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

function StepBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return <span className={`badge ${ok ? "badge--ok" : "badge--bad"}`}>{ok ? okLabel : badLabel}</span>;
}

export function VerifyPanel({
  proof,
  record,
  anchorAddress,
  rpcUrl,
  network,
}: {
  /** Server-fetched inclusion proof, or `null` if the record isn't anchored yet (the
   *  gateway's real 404 "PENDING_ANCHOR" semantics — not a new state invented here). */
  proof: InclusionProof | null;
  /** The first record of the lot, exactly as rendered on screen — the browser must recompute
   *  the leaf from THESE fields, never trust `proof.digest` (docs/SWARM-API.md, S2-03). */
  record: VerifiableRecord | null;
  /** `BatchAnchor` address read from `deployments/<network>/addresses.json`, or `null` if
   *  nothing has been deployed to this network yet. */
  anchorAddress: Hex | null;
  rpcUrl: string;
  network: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string>("");
  const [onChainRoot, setOnChainRoot] = useState<Hex | null>(null);

  // Step A — signature. Entirely offline: no RPC, no gateway call. Recomputed from the exact
  // fields rendered on screen, checked against the `dev` claimed inside the (also signed)
  // record — never the gateway's own `verdict` field.
  const sensorRecord: SensorRecord | null = useMemo(() => {
    if (!record) return null;
    return {
      v: record.v,
      dev: record.dev,
      seq: record.seq,
      prev: record.prev,
      ts: BigInt(record.ts),
      tsq: record.tsq as TimeQualityValue,
      lot: record.lot,
      t: record.t,
      h: record.h,
      lux: record.lux,
      flags: record.flags,
      bat: record.bat,
    };
  }, [record]);

  const sigResult = useMemo(
    () => (sensorRecord && record ? verifyRecord(sensorRecord, record.sig) : null),
    [sensorRecord, record],
  );

  // Step B — leaf recomputation. `leaf` is keccak256 of the canonical encoding of the fields
  // actually displayed. Comparing it to `proof.digest` (the gateway's own claim) surfaces a
  // finding if they disagree — the record on screen would not be the one that got anchored.
  const leaf = useMemo(() => (sensorRecord ? recordDigest(sensorRecord) : null), [sensorRecord]);
  const leafMatchesGateway = leaf !== null && proof !== null && leaf.toLowerCase() === proof.digest.toLowerCase();

  async function run() {
    if (!proof || !anchorAddress || !leaf) return;
    setStatus("checking");
    setDetail("reading the anchor root from the chain…");
    setOnChainRoot(null);

    try {
      const client = createPublicClient({ transport: http(rpcUrl) });
      const root = await client.readContract({
        address: anchorAddress,
        abi: batchAnchorAbi,
        functionName: "getRoot",
        args: [BigInt(proof.anchorIndex)],
      });
      setOnChainRoot(root);

      setDetail("recomputing the Merkle path…");
      // The fix: verify the LOCALLY RECOMPUTED leaf against the chain's root, not
      // `proof.digest`. Verifying the gateway's own digest against the gateway's own claimed
      // proof would only prove our arithmetic is self-consistent — circular, and worthless to
      // someone deciding whether to trust us.
      const ok = verifyProof(leaf, proof.proof, root);

      setStatus(ok ? "verified" : "failed");
      setDetail(
        ok
          ? "The recomputed leaf's Merkle path resolves to the root read live from the chain — independent of the gateway."
          : "The recomputed leaf does not resolve to the on-chain root. The record was altered after anchoring, or the gateway's proof was wrong.",
      );
    } catch (error) {
      setStatus("failed");
      setDetail(
        error instanceof Error
          ? `RPC read failed: ${error.message}`
          : "RPC read failed — the chain is unreachable.",
      );
    }
  }

  // UNVERIFIABLE-adjacent state, not an error path: nothing to verify against yet.
  if (!proof) {
    return (
      <div className="card">
        <span className="badge badge--pending">Pending anchor</span>
        <p className="muted" style={{ marginBottom: 0 }}>
          This record is not anchored yet — there is no inclusion proof to check. Batches close
          every 60 seconds, or force one early with <code>POST /anchor/flush</code>.
        </p>
      </div>
    );
  }

  // Also a real, honestly-rendered state: the mechanism is correct, but there is nothing
  // on-chain yet for this network, so nothing can be independently verified.
  if (!anchorAddress) {
    const deployCommand = network === "localhost" ? "npm run deploy:local" : "npm run deploy:amoy";
    return (
      <div className="card">
        <span className="badge badge--bad">Not deployed</span>
        <p className="muted" style={{ marginBottom: 0 }}>
          <code>BatchAnchor</code> is not deployed to <code>{network}</code> yet — run{" "}
          <code>{deployCommand}</code>. The proof below is real, but there is no on-chain root to
          check it against, so it cannot be called verified.
        </p>
      </div>
    );
  }

  // Defensive only: the gateway never returns a proof without a corresponding record, so this
  // should be unreachable in practice — but a component must not crash on a null it was
  // structurally allowed to receive.
  if (!record || !sensorRecord || !sigResult || leaf === null) {
    return (
      <div className="card">
        <span className="badge badge--bad">No record to verify</span>
        <p className="muted" style={{ marginBottom: 0 }}>
          The gateway returned an inclusion proof but no record fields to check it against.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <ol
        className="verify-steps"
        style={{ listStyle: "none", margin: "0 0 var(--space-md)", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
      >
        <li>
          <StepBadge ok={sigResult.ok} okLabel="Step A · Signature valid" badLabel="Step A · Signature INVALID" />
          <p className="muted" style={{ margin: "var(--space-xxs) 0 0", fontSize: "0.82rem" }}>
            {sigResult.ok
              ? `Recomputed offline, no network call: the signature recovers to ${truncate(sigResult.address)}, matching the record's claimed device ${truncate(record.dev)}.`
              : `Recomputed offline: the signature does NOT recover to ${truncate(record.dev)} (${sigResult.reason}). This record may not have come from the device it claims to.`}
          </p>
        </li>

        <li>
          <StepBadge
            ok={leafMatchesGateway}
            okLabel="Step B · Leaf matches gateway digest"
            badLabel="Step B · Leaf MISMATCH"
          />
          <p className="muted" style={{ margin: "var(--space-xxs) 0 0", fontSize: "0.82rem" }}>
            {leafMatchesGateway
              ? "Re-encoding the fields shown on this page and hashing them reproduces the digest the gateway reported."
              : "Re-encoding the fields shown on this page does NOT reproduce the digest the gateway reported — the record on screen does not match what the gateway anchored."}
          </p>
        </li>

        <li>
          <button onClick={run} disabled={status === "checking"}>
            {status === "checking" ? "Verifying…" : "Step C · Verify against the chain"}
          </button>

          {status !== "idle" && (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
                {status === "verified" && <span className="badge badge--ok">Merkle proof valid</span>}
                {status === "failed" && <span className="badge badge--bad">Merkle proof invalid</span>}
                {status === "checking" && <span className="badge badge--pending">Checking…</span>}
                <br />
                {detail}
              </p>

              <dl style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.8 }}>
                <div>
                  <dt className="muted" style={{ display: "inline" }}>
                    Gateway said root:{" "}
                  </dt>
                  <dd style={{ display: "inline", margin: 0 }}>
                    <code>{truncate(proof.root)}</code>
                  </dd>
                </div>
                <div>
                  <dt className="muted" style={{ display: "inline" }}>
                    Chain says root:{" "}
                  </dt>
                  <dd style={{ display: "inline", margin: 0 }}>
                    <code>{onChainRoot ? truncate(onChainRoot) : "—"}</code>
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}
