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

import { verifyProof, type Hex } from "@krishichain/core";
import { useState } from "react";
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

type Status = "idle" | "checking" | "verified" | "failed";

function truncate(hex: string): string {
  return hex.length <= 20 ? hex : `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export function VerifyPanel({
  proof,
  anchorAddress,
  rpcUrl,
  network,
}: {
  /** Server-fetched inclusion proof, or `null` if the record isn't anchored yet (the
   *  gateway's real 404 "PENDING_ANCHOR" semantics — not a new state invented here). */
  proof: InclusionProof | null;
  /** `BatchAnchor` address read from `deployments/<network>/addresses.json`, or `null` if
   *  nothing has been deployed to this network yet. */
  anchorAddress: Hex | null;
  rpcUrl: string;
  network: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string>("");
  const [onChainRoot, setOnChainRoot] = useState<Hex | null>(null);

  async function run() {
    if (!proof || !anchorAddress) return;
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
      const ok = verifyProof(proof.digest, proof.proof, root);

      setStatus(ok ? "verified" : "failed");
      setDetail(
        ok
          ? "The record's Merkle path recomputes to the root read live from the chain — independent of the gateway."
          : "The record does not recompute to the on-chain root. The record was altered after anchoring, or the gateway's proof was wrong.",
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

  return (
    <div className="card">
      <button onClick={run} disabled={status === "checking"}>
        {status === "checking" ? "Verifying…" : "Verify independently"}
      </button>

      {status !== "idle" && (
        <div style={{ marginTop: "var(--space-md)" }}>
          <p className="muted" style={{ marginBottom: "var(--space-sm)" }}>
            {status === "verified" && <span className="badge badge--ok">Proof valid</span>}
            {status === "failed" && <span className="badge badge--bad">Proof invalid</span>}
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
    </div>
  );
}
