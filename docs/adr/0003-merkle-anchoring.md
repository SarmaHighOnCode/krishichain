# ADR-0003 — Merkle-batch anchoring, raw data off-chain

**Status:** Accepted · 2026-09-08

## Context

A node sampling every 30 s produces ~2,880 records/day. A three-day crate journey is ~8,640
records. The naive design writes each reading to a smart contract.

At ~30 gwei on Polygon, one such write costs roughly ₹0.028. That is **≈ ₹240 per crate** — far
above the margin on the crate itself, and it permanently publishes farm-level telemetry that is
commercially sensitive to the farmer.

The problem statement asks for *low-cost* nodes. Transaction cost is as much a part of that as
the BOM.

## Decision

Raw records live off-chain. The gateway builds a Merkle tree over record digests — sorted-pair
keccak256, matching OpenZeppelin's `MerkleProof` — and anchors **one root per 256 records or 60
seconds**, whichever comes first. Anchors themselves chain via `prevRoot`.

## Consequences

**Good**
- Cost per traced record falls to ≈ ₹0.00018; a full crate journey costs about ₹1.5, under 0.2%
  of goods value. (Measured: `anchor()` = 74,775 gas.)
- Anchoring is O(1) in leaf count, so chain cost is independent of node count or sampling rate.
- **Selective disclosure** comes free: a farmer can prove one crate's cold chain to a buyer
  without publishing the rest of the farm's telemetry.
- Proofs verify identically on-chain, in the gateway and in the browser.

**Costs**
- A record is only anchored after its batch closes — up to 60 s of `PENDING ANCHOR`. The UI
  states this honestly rather than hiding it.
- Off-chain availability becomes our responsibility: losing the record store means the on-chain
  root proves nothing about data nobody has. Integrity is protected; availability is not.
- Proof storage adds ~8 hashes per record (~256 bytes), roughly doubling the store. Acceptable at
  260 KB/node/day.

## Alternatives rejected

- **Every reading on-chain** — ₹240/crate, and it leaks commercial data.
- **IPFS for raw records** — a pinning dependency and a live demo failure mode, for integrity we
  already get from digests.
- **One anchor per lot at the end of the journey** — cheapest of all, but a breach would only
  become provable after delivery, which is exactly when it stops being useful.
