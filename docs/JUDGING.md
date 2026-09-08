# Judging Prep

Known panel: an **Amazon SDE** and a **fullstack developer/influencer**, among others. That mix
sets two distinct bars.

| Judge | What they will probe | What wins them |
|---|---|---|
| **Amazon SDE** | Failure modes, idempotency, scale, "what happens when this call times out", whether you can explain your own code | Concrete numbers, named trade-offs, an honest "we didn't do X and here's why" |
| **Fullstack influencer** | Whether the UI is designed or generated, whether the repo is real, whether the demo works on a phone | A distinctive interface, a clean commit history, a live URL that loads fast on mobile |

Both bars are met by the same thing: **a system that actually runs, explained by people who
actually understand it.**

---

## The questions you will get, and the answers

### "Why does this need a blockchain at all? A signed database does the same thing."

Honest answer, and it scores well: *a signed append-only log covers 80% of it.* A **public**
shared ledger would add three more things a private log cannot: no single party — including
us — can withhold or rewrite the commitment history; the disputing parties do not have to
agree on who hosts the log; a consumer or regulator can verify without our permission or our
uptime. In a supply chain the whole problem is that **the parties don't trust each other**.
That is the narrow case where a shared ledger earns its cost.

**Say this next part before they ask it, not after — it is item 6 on our own self-critique
list.** For this demo the chain is local, on this laptop, deliberately: a public testnet's
faucet or RPC being down on stage was a worse risk than the honesty cost of running local, and
the whole system is designed to survive with zero internet either way. Run as demoed, we are
the only party operating the chain, so the first two properties above do not fully hold today
— we say that plainly rather than let a judge catch it. What still holds, and what we show
live: verification is independent of the *server*. The browser reads the anchor root from a
separate chain-node process it queries directly — never from the gateway, never trusting our
API's word for it — so killing our backend mid-demo does not break verification. The
contracts are exactly what a public deployment would run; pointing them at Polygon Amoy is a
network config change, not a redesign, and it is the very next thing we would do. We use the
chain for exactly 32 bytes per 256 readings, not as a database.

### "Your sensor could just be sitting in a fridge next to the crate."

Correct, and we say so on stage. No cryptography closes that gap. We mitigate it with a physical
tamper seal whose ID is bound on-chain at commissioning, a lid/light channel, and actor
accountability — but we deliberately do not claim to have solved it. See PRD §3.

### "What happens when the device's clock is wrong?"

Every record carries `tsq`, an explicit time-quality field: never-synced, stale, or fresh. The
gateway also records its own receipt time, and the UI shows both. We never silently present an
unsynced device timestamp as fact. A DS3231 RTC is the hardware fix and it is in the tier-2 BOM.

### "What if a node's private key is extracted?"

`DeviceRegistry.revokeDevice` is **block-scoped** — `isActiveAt(dev, blockNumber)`. Records
signed before the revocation stay valid; everything after is marked untrusted. A boolean
`isActive` would either invalidate the device's whole history or none of it, and both answers
are wrong.

### "Your gateway could just drop batches it doesn't like."

It could drop them, but not silently: anchors chain to each other via `prevRoot`, so a missing
batch is a visible gap in the anchor sequence, exactly like a missing record is a gap in the
device chain. Withholding is detectable; altering is not possible.

### "What happens if the anchor transaction times out?"

An RPC timeout is not a failed transaction — this is the trap. The anchor service persists a
nonce high-water mark and treats a timeout as unknown-state, resolving it on the next tick
rather than re-sending. Otherwise you double-anchor. (`S1-09`)

### "How does it scale?"

Anchoring is O(1) per batch, independent of leaf count, so throughput scales with the gateway's
ingest, not the chain. One anchor per 60 s per gateway is ~1,440 tx/day regardless of whether it
serves 10 nodes or 10,000. The gateway is stateless apart from its store and shards by device.
The real ceiling is off-chain storage: ~2,880 records/node/day ≈ 260 KB/node/day.

### "Why not Hyperledger Fabric? That's the standard for food traceability."

It genuinely is, for production consortia, and we name it as our migration path. It is the wrong
tool for a hackathon: orderers, peers, CAs and channel config we cannot demo on a laptop with
the WiFi pulled. Our contracts are ~400 lines and the same logic ports to chaincode.

### "How much of this did Claude write?"

Answer plainly: we used Claude Code throughout, with a frozen protocol spec and golden test
vectors as the contract between the firmware and the backend, and every person can walk you
through their own files. Then **offer to walk them through one**. Prepare for this — it is the
question most likely to be asked in 2026, and hedging is what loses points, not the tool.

### "What's the business model?"

Per-node hardware at ₹750 with a ~₹1/crate-journey infrastructure cost. The buyer is the FPO or
the retail buyer, not the smallholder — they carry the rejection risk and the recall liability.
The wedge is dispute resolution: today a rejected truck is settled by argument. Pricing at
₹5/crate is still under 0.5% of crate value and replaces a process that costs both sides more.

### "What would you do with another month?"

Ranked, not hand-waved: (1) ATECC608A secure element so key extraction needs physical die
access, (2) deep-sleep duty cycling for multi-week battery life, (3) LoRa backhaul for farms with
no cellular, (4) EPCIS 2.0 conformance testing against OpenEPCIS, (5) a Fabric port for a
consortium pilot.

---

## Things to have ready on the table

- Both nodes, powered, labelled with their device addresses
- The BOM sheet with **real prices** (`H2-01`)
- The GitHub repo URL, as a QR
- `hardware/POWER.md` and `hardware/BENCHMARKS.md` open in a tab — real measurements settle
  arguments faster than any slide

## Self-critique to raise before they do

Naming these first converts each from a weakness into evidence of engineering judgement:

1. Two nodes is a demo, not a deployment. We have not tested 100 devices against one gateway.
2. The gateway is a single point of *availability* (not of integrity) in this build.
3. Calibration is two-point and linear; a real deployment needs periodic recertification.
4. We store raw records in SQLite on a laptop. Production needs Postgres and a retention policy.
5. We have not done a formal security review of the contracts, and we would not deploy them to
   mainnet without one.
6. The chain we anchor to for this demo is local, not public — we built and tested a Polygon
   Amoy path and deliberately dropped it (see the blockchain-necessity answer above for what
   that costs and what still holds without it).
