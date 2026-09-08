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

Three terminals:

```bash
npm run broker         # MQTT: tcp 1883 for nodes, ws 9001 for the browser
npm run dev:gateway    # :8080
npm run sim-swarm -- --breach
```

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
| `GET /lot/:lotId` | Everything the consumer page needs: badge, records, per-record companions and relay, incidents. |
| `GET /proof/:digest` | Merkle inclusion proof. 404 with `status: "PENDING_ANCHOR"` until the batch closes. |
| `GET /ops/summary` | Node table, counters, MQTT status. |
| `GET /ops/incidents` | Full incident list. |
| `GET /ops/nodes` | Health rows. |
| `POST /ops/interval` | `{ dev?, seconds }` — force the adaptive-sampling change on stage. |
| `POST /anchor/flush` | Close the open batch now, so nothing waits 60 s in front of judges. |

---

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
