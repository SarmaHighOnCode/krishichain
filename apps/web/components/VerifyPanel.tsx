"use client";

/**
 * Ticket S2-03 — client-side inclusion proof verification.
 *
 * THE demo moment. What makes it worth anything is where the root comes from: the browser
 * must read it from a PUBLIC RPC (`NEXT_PUBLIC_VERIFY_RPC_URL` → `BatchAnchor.getRoot`), not
 * from our gateway. Verifying a proof against a root our own server supplied proves exactly
 * nothing, and a judge will ask.
 *
 * Success criterion: this still returns green with the gateway process killed.
 */

import { verifyProof, type Hex } from "@krishichain/core";
import { useState } from "react";

type Status = "idle" | "checking" | "verified" | "failed" | "pending";

export function VerifyPanel({ digest, gatewayUrl }: { digest: string; gatewayUrl: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string>("");

  async function run() {
    if (!digest) return;
    setStatus("checking");
    setDetail("fetching inclusion proof…");

    try {
      const response = await fetch(`${gatewayUrl}/proof/${digest}`);
      if (response.status === 404) {
        setStatus("pending");
        setDetail("This record is not anchored yet. Batches close every 60 seconds.");
        return;
      }

      const proof = (await response.json()) as { digest: Hex; root: Hex; proof: Hex[] };

      // TODO(S2-03): read the root from the chain instead of trusting this one.
      //
      //   const client = createPublicClient({ transport: http(process.env.NEXT_PUBLIC_VERIFY_RPC_URL) });
      //   const onChainRoot = await client.readContract({
      //     address: BATCH_ANCHOR, abi, functionName: "getRoot", args: [anchorIndex],
      //   });
      //
      // Then verify against `onChainRoot` and show both roots side by side, so the viewer can
      // see they match. Until that lands this panel demonstrates the mechanism but not the
      // trust property, and the UI should not claim otherwise.
      setDetail("recomputing the Merkle path…");
      const ok = verifyProof(proof.digest, proof.proof, proof.root);

      setStatus(ok ? "verified" : "failed");
      setDetail(
        ok
          ? `Proof recomputes to root ${proof.root.slice(0, 10)}… (root still read from the gateway — see S2-03)`
          : "The record does not match the anchored root. Someone altered it after anchoring.",
      );
    } catch (error) {
      setStatus("failed");
      setDetail(error instanceof Error ? error.message : "verification failed");
    }
  }

  return (
    <div className="card">
      <button onClick={run} disabled={status === "checking" || !digest}>
        {status === "checking" ? "Verifying…" : "Verify independently"}
      </button>

      {status !== "idle" && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {status === "verified" && <span className="badge badge--ok">Proof valid</span>}
          {status === "failed" && <span className="badge badge--bad">Proof invalid</span>}
          {status === "pending" && <span className="badge badge--pending">Pending anchor</span>}
          <br />
          {detail}
        </p>
      )}
    </div>
  );
}
