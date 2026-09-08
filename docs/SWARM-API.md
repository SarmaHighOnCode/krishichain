# Swarm API — the S1 → S2 seam

Everything the twins dashboard (`S2-12`), the phone PWA (`S2-13`) and the consumer page
need from the gateway. Types live in `packages/core/src/swarm.ts` and
`packages/core/src/companion.ts` — **import them, do not retype them**, so a shape change
breaks a build instead of a demo.

```ts
import { Topics, Badge, NodeRole, badgeFor,
         type RecordEvent, type HealthEvent, type IncidentEvent,
         type LotStateEvent, type AnchorEvent } from "@krishichain/core";
```

---

## Running it with no hardware

```bash
npm run chain          # terminal 1 — local chain
npm run deploy:local   # once, after the chain is up
npm run broker         # terminal 2 — MQTT: tcp 1883 nodes, ws 9001 browser
npm run dev:gateway    # terminal 3 — :8080
npm run sim-swarm -- --breach
```

Then:

```bash
npm run e2e      # 23 assertions across the whole pipeline. Exits non-zero on failure.
npm run seed     # three smallholdings aggregated into a truck lot, one breaches
```

The chain is optional — with no deployment the gateway still ingests, verifies, chains and
batches, and lots stay at `PENDING_ANCHOR`.

The simulator is four devices with real secp256k1 keys, real signatures and real hash
chains. The gateway cannot tell it from the boards on the bench.

| Flag | What it demonstrates |
|---|---|
| `--breach` | The 2-of-3 corroborated breach. Lot flips to `FLAGGED`. |
| `--single-spike` | One 21 °C reading on one node. **Zero incidents** — the rules engine refusing to flag on weak evidence. |
| `--gap-at 8` | LEAF drops a record. `CHAIN_GAP` incident, badge goes `UNVERIFIABLE`, later records still ingest. |
| `--kill-at 10` | HEAD stops. Its twin must grey within 5 s; the LEAF fails over to direct and its relay hop disappears. |
| `--count`, `--interval`, `--step` | Length, wall-clock pace, and simulated seconds per round. |

`--step` matters: 60 rounds × 10 s is ten minutes of journey in about 25 seconds of
wall clock, so the cold-chain chart has a real shape.

---

## MQTT

Broker: `ws://localhost:9001` from the browser, `mqtt://localhost:1883` from Node.
No auth — nothing on this bus is secret, and every record carries its own signature.

| Topic | Payload | Retained | Notes |
|---|---|---|---|
| `krishi/v1/node/<dev>/record` | `RecordEvent` | no | Every accepted record. |
| `krishi/v1/node/<dev>/health` | `HealthEvent` | **yes** | Also republished every 2.5 s so `online` goes false on silence. |
| `krishi/v1/node/<dev>/companion` | `CompanionEvent` | no | CAM and phone attestations. |
| `krishi/v1/lot/<lot>/state` | `LotStateEvent` | **yes** | Badge, temp range, signals. |
| `krishi/v1/incident` | `IncidentEvent` | no | Gaps, forks, breaches. |
| `krishi/v1/anchor` | `AnchorEvent` | no | Batch closed / anchored. |
| `krishi/v1/cmd/<dev>` | `CommandEvent` | no | Gateway → node. Adaptive sampling. |

Subscribe with the wildcards in `Topics`: `Topics.allRecords`, `Topics.allHealth`,
`Topics.allCompanions`, `Topics.allLots`.

Retained lot and health messages mean **a browser opening mid-demo sees the current state
immediately** instead of an empty screen waiting for the next event. Build for that: do
not assume you saw the first message.

`GET /topics` returns this table at runtime if you would rather read it from the gateway.

### Two things to get right

**`online` is computed, not reported.** A dead node cannot tell you it is dead. The
gateway republishes health every 2.5 s and flips `online: false` after 5 s of silence
(`OFFLINE_AFTER_MS`). Grey the twin on that field; do not run your own timer.

**Timestamps are strings.** `ts` is unix seconds as a decimal string, because it is a
`uint64` on the wire. `receivedAt` / `lastSeenAt` / `updatedAt` are gateway wall-clock
milliseconds and are plain numbers. Do not mix them — device time is when it happened,
gateway time is when we heard about it, and a buffered node makes those minutes apart.

---

## HTTP

| Route | Purpose |
|---|---|
| `POST /devices` | Commission `{ address, role?, lat?, lon? }`. |
| `POST /ingest` | Node batch, optional `relay` wrapper. |
| `POST /companion` | Witness attestations. |
| `GET /lots` | Every known lot with its badge and temperature range. |
| `GET /lot/:lotId` | Everything the consumer page needs: badge, records, per-record companions and relay, incidents. |
| `GET /lot/:lotId/recall` | **The recall query.** Aggregation graph both directions, joined to what we observed. |
| `GET /lot/:lotId/epcis` | GS1 EPCIS 2.0 document (`application/ld+json`). |
| `GET /device/:dev` | One device's health, chain position and recent records. |
| `GET /proof/:digest` | Merkle inclusion proof plus `anchor: { status, chainId, contract, txHash, blockNumber }`. |
| `GET /ops/summary` | Node table, counters, MQTT status. |
| `GET /ops/incidents` | Full incident list. |
| `GET /ops/nodes` | Health rows. |
| `GET /ops/anchors` | Anchor state and the high-water mark. |
| `POST /ops/interval` | `{ dev?, seconds }` — force the adaptive-sampling change on stage. |
| `POST /ops/reconcile` | Resolve anchors whose outcome was never learned. Never sends a transaction. |
| `POST /anchor/flush` | Close the open batch now, so nothing waits 60 s in front of judges. |

### The recall query

`GET /lot/:lotId/recall` answers the question a recall actually asks — not "where did this
crate go?" but **"which farms fed the lot on truck 27?"**, because that decides how much
produce gets pulled.

```bash
npm run seed     # three smallholdings -> one truck lot, one of them breaches
curl localhost:8080/lot/0x018f2c0000000000000000000000b027/recall
```

Returns `onChain` (state, custodian, flagged, parent), `descendants` (everything rolled
into this lot), `ancestors` (every shipment this lot was folded into), and `affected` — each
of those joined to its badge, record count, devices and breaches.

`LotRegistry.flagLot` propagates **upward**, and `aggregate()` taints a parent the moment a
flagged child is rolled in. So a breach in one smallholder's crate flags the whole truck
lot, automatically, on-chain. The gateway polls for that (`FLAG_POLL_SECONDS`) because no
event names the parent — without the poll the truck would read `VERIFIED` while the chain
said otherwise.

---

## Anchoring: two chains, two different questions

Every batch is anchored **twice**, and the two answer different questions:

| | Question it answers | Speed | Drives |
|---|---|---|---|
| **Local** (Hardhat, 31337) | "Can we vouch for this?" | Instant | The `badge` |
| **Amoy** (Polygon testnet, 80002) | "Can a stranger check it without us?" | Seconds to a minute | `publicAnchor` |

Amoy is the **verification target** — a root on a chain we do not control is the only
version of this claim that means anything to a judge. Local is the **offline fallback** that
keeps the demo alive when the venue WiFi is hostile (invariant 6).

**`VERIFIED` means the local anchor transaction has CONFIRMED** — not that a Merkle batch
closed. Those are different claims and only the first is worth anything; a closed batch is a
promise the gateway made to itself. With no chain configured nothing reaches `VERIFIED` and
lots sit at `PENDING_ANCHOR`, which is the honest answer rather than a bug.

The public status rides separately on `LotStateEvent.publicAnchor`, so a slow testnet never
drags the badge backwards:

```ts
publicAnchor?: {
  chainId: number;
  status: "PENDING" | "ANCHORED" | "FAILED";
  contract?: Hex; txHash?: Hex; blockNumber?: string;
  explorerUrl?: string;   // ready to put in front of a judge
}
```

Absent `publicAnchor` means no mirror is configured. **Render that as "local only", never as
a failure** — it is a normal setup.

`GET /proof/:digest` returns `anchors: { local, public }`. The proof is identical on both
chains — same leaves, same tree, same batch index; only the root's *location* differs. So:
verify against `anchors.public` when it is `ANCHORED`, fall back to `anchors.local` when the
public chain is unreachable, and show `PENDING ANCHOR` when neither has landed. A lot is only
as committed as its least-committed record, so one pending record holds the whole lot at
pending rather than letting a majority round it up.

## Client-side verification (S2-03)

`GET /lot/:lotId` returns **all twelve canonical fields** per record — `v`, `dev`, `seq`,
`prev`, `ts`, `tsq`, `lot`, `t`, `h`, `lux`, `flags`, `bat` — not just the ones worth
displaying. Four of them render nowhere; they are there so the browser can do this:

```ts
import { recordDigest, verifyProof } from "@krishichain/core";

// 1. Recompute the leaf from the record you are SHOWING the user.
const leaf = recordDigest({ ...r, ts: BigInt(r.ts) });

// 2. Read the root from the chain — NOT from `proof.root`.
const root = await client.readContract({
  address: proof.anchors.public.contract,   // or .local when offline
  abi: [{ type: "function", name: "getRoot", stateMutability: "view",
          inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "bytes32" }] }],
  functionName: "getRoot",
  args: [BigInt(proof.anchorIndex)],
});

// 3. Walk the proof up to that root.
verifyProof(leaf, proof.proof, root);
```

**Step 1 is the one that matters and the easy one to skip.** Verifying the `digest` the
gateway handed you proves only that our arithmetic is self-consistent — worth nothing to
someone deciding whether to trust us. Re-encoding the twelve fields is what makes the
temperature *on screen* the thing that was signed and anchored. Change one displayed
reading and the recomputed leaf stops matching; that is the whole demo.

Do not `await` this before rendering the journey. Verification is progressive enhancement:
draw the page, then upgrade the badge. A page that white-screens on an RPC hiccup loses the
one moment that matters.

The e2e suite asserts this contract end to end ("a client can recompute the leaf from the
lot payload alone"), so if a field ever goes missing it fails there rather than in a demo.

## Badges

Use `badgeFor()` from core rather than reimplementing the precedence.

| Badge | Meaning |
|---|---|
| `VERIFIED` | Signature, chain and Merkle inclusion all check out against an on-chain root. |
| `PENDING_ANCHOR` | Verified locally, batch not yet anchored. An honest intermediate state, not a spinner. |
| `FLAGGED` | A breach was recorded. The data is sound; the produce is not. |
| `UNVERIFIABLE` | Chain gap, fork, or a proof that does not verify. |

`UNVERIFIABLE` **outranks** `FLAGGED`. If the chain has a hole we cannot honestly claim to
know the produce went bad — only that we cannot account for it. It must look deliberate,
not broken (`S2-04`).

The gateway's own `badge` is a summary. The claim that actually matters is `S2-03`:
the browser recomputing the leaf and walking the proof against a root read **straight from
a public RPC**. The gateway never vouches for that, and the page should not imply it does.

---

## Companions

A companion is a signed statement by one device about **another device's record**, linked
by `(subjectDev, subjectSeq, subject)` where `subject` is the record digest.

The 90-byte canonical record is frozen (PROTOCOL §1.3) and the golden vectors referee it
between C++ and TypeScript, so a photo hash cannot go inside it. Companions carry that
evidence alongside, with their own 124-byte canonical encoding and their own signature.

```
kind 1 PHOTO   payload = keccak256(image).  Image never leaves the device.
kind 2 IMU     payload = keccak256(8-byte struct).  Evidence sent in the clear.
kind 3 GPS     payload = keccak256(12-byte struct). Evidence sent in the clear.
```

Verdict bits are in `flags` **inside the signed region** — `LID_OPEN`, `SHOCK`,
`DEGRADED`, `GPS_FIX`. So "the camera saw the lid open" is attested by the camera, not
asserted by our server. Say that on the UI; it is the whole point.

For a phone virtual node (`S2-13`): sign with the soft key, `POST /ingest` for readings and
`POST /companion` for GPS/IMU. A phone record verifies exactly like an ESP32's — there is
no separate code path, and there must not be one.

---

## Consensus, in one paragraph

A single sensor can be wrong. Two independent routes reach a breach:

1. **Sustained** — one device out of range for `TEMP_BREACH_SECONDS` (30 s in demo config).
   Slow but robust: noise does not persist.
2. **Consensus** — two different *classes* of signal (`TEMP`, `LID`, `SHOCK`) from two
   different *devices* inside a 60 s window. Fast and high-confidence.

Two classes from **one** device is `SUSPECTED_BREACH` — reported, never auto-flagged,
because a faulty board can tell any story it likes about itself. A lone signal is `TAMPER`
at `info`. Only `breach` severity flags a lot.

Correlation uses the **signed device timestamp**, not arrival time: a node draining a
ten-minute backlog in one POST must not manufacture consensus out of unrelated events. A
device that has never synced its clock (`tsq = 0`) still raises findings but cannot
corroborate, because its timestamp cannot establish co-occurrence.

Run `--single-spike` before demoing `--breach`. Showing that the system *declines* to flag
is more convincing than showing that it flags.
