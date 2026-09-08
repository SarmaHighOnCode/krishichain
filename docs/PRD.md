# Product Requirements Document — KrishiChain

**Low-cost IoT blockchain nodes for farm-to-fork traceability**

| Field | Value |
|---|---|
| Event | IIC 2026 |
| Problem statement | 06 — AgriTech — *"Create affordable connected nodes that capture trusted data throughout the agricultural supply chain."* |
| Version | 1.0 |
| Date | 2026-09-08 |
| Status | Approved for build |
| Team | 4 (2 hardware, 2 software) |
| Hardware | 2 × ESP32 + PlatformIO toolchain, target BOM ≤ ₹750/node |
| Primary tool | Claude Code |

---

## 1. TL;DR

Enterprise food traceability works and costs lakhs per site. Cheap IoT data loggers cost
hundreds and prove nothing, because a CSV can be edited by anyone who touches it. Every
"blockchain for agriculture" pilot that fails, fails at the same seam: **the data was already
untrustworthy before it reached the chain.**

KrishiChain moves the trust boundary from the server down to the ₹750 node. Each node holds a
secp256k1 private key generated on-device that never leaves the chip. Every reading is signed
and hash-chained to its predecessor, so records cannot be silently dropped, reordered or
back-dated — including during the hours a rural node spends offline. A gateway verifies each
signature and the chain continuity, batches records into a Merkle tree, and anchors **one
transaction per 256+ readings** on-chain. A consumer scanning the crate's QR code gets
a phone-side proof verification that does not require trusting our backend.

This build anchors to a local chain, deliberately — the same contracts deploy unchanged to a
public network, and §12 R2 records why that trade was made and what it costs the claim.

The deliverable is two working physical nodes, four smart contracts, a verification gateway, a
consumer verification page and an ops dashboard — plus an honest, defensible account of exactly
what this system proves and what it does not.

---

## 2. The problem, stated precisely

India moves 300+ million tonnes of food a year through a chain with five to seven intermediaries
between farm and fork. Three specific failures repeat:

### 2.1 The paper gap
Handoffs are recorded after the fact, on paper slips, ledgers and WhatsApp photos. By the time a
claim ("harvested Tuesday, kept below 8 °C") is written down, the only evidence for it is
someone's memory and someone's incentive. Provenance is a *claim*, not evidence.

### 2.2 The cost gap
Traceability platforms priced for a Walmart supplier are structurally unavailable to a farmer
with three acres or an FPO with a ₹40,000 annual tech budget. The cheap alternative — a USB
temperature logger — produces a spreadsheet any party in the dispute can edit before handing it
over.

### 2.3 The trust gap (garbage in, garbage out)
This is the one most projects skip. A blockchain guarantees a record has not changed *since it
was written*. It guarantees nothing about the ten seconds before that. If a laptop script reads
a sensor, formats a row and posts it to a smart contract, then whoever controls that laptop
controls the "immutable" truth. The literature is blunt: putting IoT output on a distributed
ledger does not resolve IoT data-quality problems, it preserves them permanently.

**Our thesis:** the only place the trust boundary can honestly sit is *inside the device that
observed the physical world*. Everything downstream should be verifiable, not trusted.

---

## 3. What KrishiChain proves — and what it does not

An explicit trust boundary is a product feature. We state it up front, in the pitch and in the
UI, because a technical judge will find it in 30 seconds otherwise.

### We prove

| Claim | Mechanism |
|---|---|
| This reading came from device `0xAB…`, commissioned by a registered actor | On-device secp256k1 key + `DeviceRegistry` on-chain |
| The reading has not been altered since it left the device | ECDSA signature over a canonical digest |
| No reading was silently dropped, reordered or inserted | Per-device hash chain (`prev`, `seq`) verified at ingest |
| The data existed at anchor time and has not changed since | Merkle root anchored on-chain; client-side inclusion proof |
| This actor accepted custody of this lot at this time | EIP-191 signature from a registered actor key |
| Whether the device's clock was trustworthy for a given record | Explicit `tsq` time-quality field, never silently assumed |

### We do not prove

| Not proven | Why | What we ship to mitigate |
|---|---|---|
| The sensor was physically with the goods | A node in a fridge next to a crate outside reads the same | Tamper channel (lid/light/shock), physical seal ID bound to the lot at commissioning |
| The sensor is accurate | A miscalibrated DHT22 signs wrong numbers faithfully | Calibration record signed at commissioning; drift check at each handoff |
| The physical goods are the goods described | Cryptography cannot see tomatoes | Actor accountability: every claim is non-repudiably attributable to a named party |
| The farmer is honest | Out of scope for any technology | The system makes dishonesty *attributable*, which is the achievable goal |

> **Pitch line:** "We don't claim to make food honest. We make every claim about food
> attributable and non-repudiable, at a price a three-acre farmer can afford."

---

## 4. Users and jobs to be done

| # | Persona | Context | Job to be done | Success looks like |
|---|---|---|---|---|
| P1 | **Ramesh** — 3-acre tomato farmer, Nashik | Sells to an FPO; no laptop | "Prove my produce was harvested fresh and pre-cooled so I get the premium, not the spot price" | A ₹750 node he leaves in a crate; a QR sticker carrying his name to the buyer |
| P2 | **Sunita** — FPO operations manager | Aggregates 40 farmers into truck lots; answers to a retail buyer | "Prove the lot I shipped was intact when it left me, so rejections stop being my problem" | One dashboard; signed custody handoff at the dock in under 10 s |
| P3 | **Iqbal** — cold-chain transporter | Paid per trip, blamed for spoilage | "Prove the breach happened before I loaded — or never happened at all" | A gapless signed record no counterparty can edit |
| P4 | **Meera** — retail QA lead | Regulatory + recall exposure | "In a recall, find every lot that touched truck 27 between the 3rd and 5th — in minutes" | Query by device, lot, actor or time window; export an audit bundle |
| P5 | **Arjun** — consumer | In an aisle, 15 seconds of patience | "Is this actually what the label says?" | Scan → journey + a badge he can re-check himself |
| P6 | **Auditor / regulator** | Trusts nobody, including us | "Verify the claim without asking the vendor for permission" | Chain anchors + an open verify script; no KrishiChain account needed |

---

## 5. Product surfaces

KrishiChain is four surfaces over one verified event stream.

1. **The node** — a sealed ₹750 box in a crate. No screen in the field, one status LED. It
   observes, signs, chains, buffers and uploads.
2. **The gateway** — the only component talking to both the field and the chain. Verifies every
   record before it is ever stored. Batches and anchors.
3. **The ops surface** — dashboard for P2/P3/P4: live lots, live nodes, breach alerts, custody
   handoff, recall query, audit export.
4. **The consumer surface** — QR landing page for P5: the journey, the badge, and a "verify this
   yourself" panel that runs the proof in the browser.

---

## 6. Core flows

### 6.1 Device commissioning (once per node)

1. Node boots with empty NVS → generates a secp256k1 keypair from the hardware TRNG.
2. Private key is written to encrypted NVS and **never leaves the chip**. Public key + derived
   20-byte device address are printed over serial and shown as a QR on the OLED.
3. H2 records a calibration reading against a reference thermometer.
4. An actor holding `COMMISSIONER` calls `DeviceRegistry.registerDevice(addr, meta)` — binding
   the device to an owner, a device class and the calibration record hash.
5. Node writes genesis record `seq = 0`, `prev = 0x00…00`.

**Why this matters:** a device absent from `DeviceRegistry` cannot inject data. A device whose
key leaked can be revoked on-chain, and every record after the revocation block is marked
untrusted retroactively — without rewriting history.

### 6.2 Harvest (farm node)

1. Farmer taps a crate's RFID tag / scans a QR to open a lot on the farm node.
2. Gateway calls `LotRegistry.createLot(lotId, farmerActor, gtin, geohash, harvestTs)`.
3. Farm node records ambient temp/humidity every 30 s through the pre-cool window, signing and
   chaining each record, tagged with `lotId`.

### 6.3 Aggregation (many crates → one truck lot)

`LotRegistry.aggregate(parentLotId, childLotIds[])` — a real agri primitive most hackathon
traceability demos skip. Forty farmers' crates become one shipment; the graph must stay
traversable in **both** directions, because recall runs backwards.

### 6.4 Transit (transit node)

1. Transit node is sealed into the cold box with the lot; seal ID recorded on-chain.
2. Records temp / humidity / lid-open / shock every 30 s.
3. **Offline is the normal case.** Records accumulate in a hash-chained flash ring buffer.
4. On reconnect the buffer drains in `seq` order. The gateway verifies continuity across the
   whole gap — the offline period is not a hole in the evidence, it is a verified run.
5. A threshold breach (> 10 °C for > 15 min, or a lid-open in transit) raises an incident. The
   gateway calls `LotRegistry.flagLot(lotId, reason, evidenceDigest)`.

### 6.5 Custody handoff

The receiving actor signs an EIP-191 message `{lotId, fromActor, toActor, ts, conditionAttested}`
from the dashboard. `LotRegistry.transferCustody` verifies it on-chain via `ecrecover`. A handoff
cannot be forged by the party holding the goods, and cannot be denied afterwards.

### 6.6 Consumer verification

1. Scan QR → `/verify/<lotId>`.
2. Page renders the journey timeline from the off-chain store.
3. **Verify independently** → the browser fetches the anchor root directly from the local chain
   node (a process independent of the gateway that served the record — see §12 R2, cut),
   recomputes `keccak256` up the Merkle path from the displayed records, compares roots.
4. Badge shows one of: `VERIFIED` · `PENDING ANCHOR` · `FLAGGED — COLD CHAIN BREACH` ·
   `UNVERIFIABLE — CHAIN GAP`.

`UNVERIFIABLE` is a first-class outcome. A traceability system that can only say "verified" is a
marketing asset, not a verification system.

---

## 7. Functional requirements

Priority: **P0** = demo fails without it · **P1** = demo is weak without it · **P2** = stretch.

### 7.1 Node firmware — owner **H1**

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FW-01 | On-device secp256k1 keypair generation from hardware TRNG | P0 | Fresh flash → unique address; key never appears in serial output after commissioning |
| FW-02 | Encrypted NVS key storage | P0 | `nvs` partition dump does not reveal the private key |
| FW-03 | Canonical record encoding per `PROTOCOL.md` | P0 | Firmware output byte-matches golden vectors in `packages/core/fixtures/` |
| FW-04 | ECDSA sign every record (deterministic, RFC 6979) | P0 | Gateway verifies 1000/1000; same input → same signature |
| FW-05 | Per-device hash chain (`seq`, `prev`) | P0 | Induced record deletion detected by the gateway 100% of the time |
| FW-06 | Flash ring buffer ≥ 720 records (6 h @ 30 s) | P0 | Power-cycle mid-buffer → no records lost, chain intact |
| FW-07 | Store-and-forward drain on reconnect, in `seq` order | P0 | 10-minute outage → full backlog uploads and verifies |
| FW-08 | NTP sync + explicit `tsq` time-quality flag | P0 | Records before first NTP sync marked `tsq=0`, never silently trusted |
| FW-09 | Sensor read: temperature + humidity | P0 | ±0.5 °C vs reference after calibration |
| FW-10 | Tamper channel: lid-open (LDR or reed) and/or shock | P1 | Lid open → flagged record within 2 s |
| FW-11 | Lot binding via RFID / QR / serial command | P1 | Crate tag → subsequent records carry `lotId` |
| FW-12 | Status LED + OLED state (BOOT/OK/OFFLINE/BUFFERING/BREACH) | P1 | Legible from 2 m on a demo table |
| FW-13 | Serial config (`WIFI`, `LOT`, `INTERVAL`) without reflash | P2 | Venue WiFi change costs zero minutes |
| FW-14 | Deep-sleep duty cycling + battery telemetry | P2 | Projected ≥ 72 h on 2000 mAh at 60 s interval |

### 7.2 Contracts — owner **S1**

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| SC-01 | `DeviceRegistry`: register / revoke / lookup | P0 | Unregistered device rejected at ingest; revocation is block-scoped |
| SC-02 | `ActorRegistry`: role-based actors (OZ `AccessControl`) | P0 | Only `COMMISSIONER` registers devices; only registered actors transfer custody |
| SC-03 | `LotRegistry`: create, aggregate, transferCustody, flag, finalize | P0 | Full lifecycle tested; aggregation graph traversable both ways |
| SC-04 | `BatchAnchor`: `anchor(root, leafCount, prevRoot)` + anchor chaining | P0 | Anchors form their own hash chain; gaps detectable on-chain |
| SC-05 | On-chain custody signature verification (`ecrecover`, EIP-191) | P1 | Forged handoff reverts |
| SC-06 | Gas budget: anchor ≤ 80,000 gas | P1 | Asserted in CI; measured 74,775 |
| SC-07 | ~~Identical deploy to local chain and Polygon Amoy~~ | — | **Cut** — §12 R2. Deploy targets the local chain only; addresses written to `deployments/`. |
| SC-08 | ≥ 90% line coverage on `LotRegistry` and `BatchAnchor` | P1 | CI gate |

### 7.3 Gateway — owner **S1**

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| GW-01 | `POST /ingest` — batch record upload | P0 | ≥ 100 records/request; idempotent on `(deviceId, seq)` |
| GW-02 | Signature verification against `DeviceRegistry` | P0 | Bad signature → `401`, quarantined, never in the main store |
| GW-03 | Hash-chain continuity verification per device | P0 | Gap → `CHAIN_GAP` incident raised and surfaced; later records still ingest |
| GW-04 | Merkle batching (256 leaves or 60 s, whichever first) | P0 | Every stored record has a retrievable inclusion proof |
| GW-05 | Anchor service → `BatchAnchor` with retry + nonce management | P0 | Survives an RPC outage; resumes without double-anchoring |
| GW-06 | EPCIS 2.0 event projection | P1 | Events validate against the EPCIS 2.0 JSON schema |
| GW-07 | Threshold rules engine → incidents → `flagLot` | P0 | Breach detected ≤ 10 s after the causing record arrives |
| GW-08 | `GET /lot/:id` (journey + proofs), `GET /proof/:digest` | P0 | Consumer page renders entirely from these |
| GW-09 | Recall query by device / actor / time window / lot ancestry | P1 | Returns the full aggregation subtree |
| GW-10 | Audit bundle export (JSON + proofs + verify script) | P2 | A third party verifies offline from the bundle alone |

### 7.4 Web — owner **S2**

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| UI-01 | `/verify/:lotId` consumer page: journey timeline + badge | P0 | < 1.5 s P95 on 4G; readable at 360 px |
| UI-02 | **Client-side proof verification** against a public RPC | P0 | Works with the gateway process killed; < 200 ms verify |
| UI-03 | Four honest badge states incl. `UNVERIFIABLE` | P0 | Each state reachable in the demo |
| UI-04 | Cold-chain chart with the breach window highlighted | P0 | Breach obvious without reading numbers |
| UI-05 | Ops dashboard: live nodes, buffer depth, last-seen, incidents | P0 | Updates ≤ 5 s after ingest |
| UI-06 | Custody handoff with wallet signature | P1 | Completes in < 10 s on a phone |
| UI-07 | QR / crate label generator | P1 | Printable A4 label sheet |
| UI-08 | Map view of the lot journey | P2 | Geohash → pins |
| UI-09 | WCAG 2.1 AA on the consumer page | P1 | Contrast + keyboard nav pass |

### 7.5 Hardware build — owner **H2**

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| HW-01 | Two assembled nodes, BOM ≤ ₹750 each | P0 | Costed BOM in `hardware/BOM.md` with real prices |
| HW-02 | Farm node: temp + humidity (+ soil moisture if available) | P0 | Runs 4 h unattended without a reset |
| HW-03 | Transit node: temp + humidity + lid/light + shock | P0 | Lid-open detected reliably inside a closed box |
| HW-04 | Battery operation ≥ 6 h continuous | P0 | Measured and logged in `hardware/POWER.md` |
| HW-05 | Sealed enclosure with a visible physical seal ID | P1 | Seal ID matches the on-chain record |
| HW-06 | Calibration vs a reference thermometer | P1 | ≤ ±0.5 °C after offset correction; logged and signed |
| HW-07 | Demo rig: cold box, ice packs, crates, printed labels | P0 | Full demo runs end to end twice without intervention |
| HW-08 | Spare parts + a pre-flashed backup board | P0 | A dead board costs ≤ 3 minutes on stage |

---

## 8. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Node unit BOM | ≤ ₹750 (≈ $8.50) |
| NFR-02 | Anchor cost per record | ≤ ₹0.0002 at 256 leaves/batch |
| NFR-03 | Capture → consumer-visible (online) | ≤ 60 s P95 |
| NFR-04 | Capture → verifiable (anchored) | ≤ 5 min P95 |
| NFR-05 | Offline buffer depth | ≥ 720 records (6 h @ 30 s) |
| NFR-06 | Gateway ingest throughput | ≥ 500 records/s on a laptop |
| NFR-07 | Client-side proof verification | < 200 ms |
| NFR-08 | Node power | ≥ 6 h on battery; ≥ 72 h duty-cycled (P2) |
| NFR-09 | Demo independence | Full demo runs with **no internet**, on the local chain |
| NFR-10 | Gap detection | 100% of induced gaps flagged |
| NFR-11 | New-dev setup | `npm install && npm run dev` under 5 minutes |

---

## 9. Data model

### 9.1 The on-chain / off-chain split

The single most important design decision: **raw data never goes on-chain.** On-chain we store
only identity, lifecycle state and commitments.

| Data | Where | Why |
|---|---|---|
| Raw sensor records | Off-chain (SQLite → Postgres) | Volume (~2,880 records/node/day) and privacy — farm telemetry is commercially sensitive |
| Record digests | Off-chain, in a Merkle tree | Enables selective disclosure: prove one reading without publishing the rest |
| Merkle roots | **On-chain** | 32 bytes commits to 256+ records |
| Device pubkeys + status | **On-chain** | Must be globally auditable and revocable |
| Actor identities + roles | **On-chain** | Determines who may claim what |
| Lot lifecycle + custody | **On-chain** | These are the disputed facts; must be non-repudiable |
| Breach flags | **On-chain** | Must not be quietly deleted by the party at fault |

**Selective disclosure matters commercially:** a farmer can prove to a buyer that one specific
crate stayed cold without revealing his whole farm's yield telemetry to a competitor. That falls
out of the Merkle design for free.

### 9.2 GS1 EPCIS 2.0 mapping

We do not invent an event vocabulary. Every KrishiChain event projects to a GS1 EPCIS 2.0 event
(ratified June 2022; JSON-LD; the basis of FSMA 204 and EUDR compliance). This is what makes the
project credible to anyone who works in supply chain for a living.

| KrishiChain event | EPCIS type | `bizStep` | `disposition` |
|---|---|---|---|
| Device commissioned | ObjectEvent | `commissioning` | `active` |
| Lot created at harvest | ObjectEvent | `commissioning` | `in_progress` |
| Crates → truck lot | AggregationEvent | `packing` | `in_progress` |
| Custody handoff (out) | ObjectEvent | `shipping` | `in_transit` |
| Custody handoff (in) | ObjectEvent | `receiving` | `in_progress` |
| Sensor observation | ObjectEvent + `sensorElementList` | `sensor_reporting` | `in_transit` |
| Cold-chain breach | ObjectEvent | `inspecting` | `damaged` |
| Retail arrival | ObjectEvent | `retail_selling` | `sellable_accessible` |

EPCIS 2.0's native `sensorElementList` is designed for exactly our payload — temperature,
humidity, device ID, time. We populate it directly rather than bolting sensor data on the side.

### 9.3 Identifiers

| Concept | Format | Example |
|---|---|---|
| Device ID | 20-byte address from `keccak256(pubkey)[12:]` | `0x7f3a…c21b` |
| Lot ID | 16-byte ULID, rendered GS1 SGTIN-style | `01/08901234567890/10/L2609081` |
| Actor ID | Ethereum address | `0x9c2b…4e10` |
| Record digest | `keccak256(canonical_record)` | `0x4a1f…` |
| Seal ID | Human-readable, printed on the tamper seal | `KC-SEAL-0042` |

Full wire format, canonical encoding and golden test vectors: **[PROTOCOL.md](PROTOCOL.md)**.

---

## 10. Unit economics

The problem statement says *low-cost*. That has two meanings, and we answer both with numbers.

### 10.1 Hardware cost per node

| Item | Qty | ₹ (est.) |
|---|---|---|
| ESP32 DevKit v1 (WROOM-32) | 1 | 300 |
| DHT22 temperature + humidity | 1 | 150 |
| LDR + reed switch (tamper) | 1 | 40 |
| SSD1306 0.96" OLED (demo only) | 1 | 120 |
| TP4056 + 18650 cell + holder | 1 | 180 |
| Enclosure, seal, wiring, perfboard | 1 | 110 |
| **Total — demo config** | | **≈ ₹900** |
| **Total — field config (no OLED)** | | **≈ ₹780** |
| **Total — volume (ESP32-C3, 1k units)** | | **≈ ₹420** |

An ESP32-C3-MINI at volume drops compute to ~₹120, putting a field node under ₹450 — below one
day's mandi commission on a single truck lot. That is the affordability argument.

### 10.2 Blockchain cost per record

| Parameter | Value |
|---|---|
| Anchor transaction gas | **74,775 (measured)** |
| Polygon gas price (typical) | ~30 gwei |
| Cost per anchor | ~0.00224 POL ≈ ₹0.045 |
| Records per anchor | 256 |
| **Cost per traced record** | **≈ ₹0.00018** |
| Records per crate per journey (3 days @ 30 s) | ~8,640 |
| **Blockchain cost per traced crate** | **≈ ₹1.5** (34 anchors) |
| Typical crate value | ₹800–1,500 |
| **Traceability overhead** | **< 0.2% of goods value** |

Naively writing each reading on-chain costs ~₹0.028 × 8,640 ≈ **₹240 per crate** — many times the
freight margin, which is precisely why on-chain-everything pilots die. Merkle batching is not an
optimisation; it is the reason the product can exist.

---

## 11. Success metrics

### Demo-day (must all be green)

- [ ] Two physical nodes running, both registered on-chain
- [ ] End-to-end: harvest → aggregate → transit → breach → retail → consumer scan
- [ ] WiFi-pull test: ≥ 5 min offline, full gapless backlog verified on reconnect
- [ ] Tamper test: lid opened → flagged on the consumer page within 10 s
- [ ] Client-side verification succeeds with the gateway process killed
- [ ] Hand-edit a record in the DB → badge flips to `UNVERIFIABLE`

### Engineering

- [ ] `npm install && npm run dev` works on a clean machine in < 5 min
- [ ] CI green: contracts, core, gateway, web, firmware build
- [ ] ≥ 90% coverage on `LotRegistry` + `BatchAnchor`
- [ ] Golden protocol vectors pass in both C++ and TypeScript

---

## 12. Risks

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Venue WiFi blocks the node or the RPC | High | High | Local chain + phone hotspot + gateway on the demo laptop; the whole demo runs offline by design (NFR-09) | H1 |
| R2 | ~~Faucet dry / Amoy RPC down on demo day~~ | — | — | **Retired.** A public Amoy mirror was built and deliberately dropped (§13, and see the "why blockchain at all" answer in `JUDGING.md` for the honest cost of that decision) — the demo runs local-only, so this risk no longer applies | S1 |
| R3 | A board dies on stage | Med | High | Pre-flashed spare board (HW-08) + recorded fallback video | H2 |
| R4 | secp256k1 signing too slow on ESP32 | Low | High | Benchmark **day 1** (~40 ms expected with micro-ecc); fallback to Ed25519 verified off-chain only | H1 |
| R5 | DHT22 flaky / 2 s sampling | Med | Med | Retry + last-good with a staleness flag; SHT31 substitute if available | H2 |
| R6 | Firmware ↔ gateway encoding mismatch eats a day | High | High | **Golden vectors frozen on day 0**; both sides test the same fixture file | H1 + S1 |
| R7 | Scope creep into an app nobody demos | High | Med | The scope ladder (§13) is binding; P2 only after every P0 is green | All |
| R8 | Clock skew makes timestamps meaningless | Med | Med | Explicit `tsq`; gateway records its own receipt time; UI shows both | H1 |
| R9 | Two hardware people blocked on one soldering iron | Med | Med | H1 on a dev board at a desk, H2 owns the bench; split firmware vs physical | H1/H2 |
| R10 | Judges see "another blockchain demo" | Med | High | Lead with the GIGO critique and the offline hash-chain test — the parts nobody else has | All |

---

## 13. Scope ladder

**Must (P0) — no demo without these**
Device identity + signing + hash chain · flash buffer + store-and-forward · gateway verification ·
Merkle batching + anchoring · 4 contracts on the local chain · consumer verify page with
client-side proof · ops dashboard · breach detection · 2 physical nodes.

**Should (P1)**
RFID/QR lot binding · custody handoff with wallet signature · EPCIS 2.0 projection · recall
query · calibration records · label printing.

**Could (P2)**
Deep-sleep power optimisation · LoRa backhaul · map view · audit bundle export · multi-tenant FPO
accounts · Hindi/Marathi localisation.

**Won't (this cycle)**
Mainnet · token/payments · native mobile app · ML spoilage prediction · Hyperledger Fabric ·
zero-knowledge proofs of freshness (great slide, wrong week).

---

## 14. Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Exact peripherals in hand (RFID? GPS? LoRa? OLED?) — the BOM assumes the tier-0 kit | H2 | Day 0 |
| Q2 | Hackathon duration; may hardware be pre-built off-site? | H1 | Day 0 |
| Q3 | Venue power / soldering restrictions? | H2 | Day 0 |
| Q4 | Judging rubric weights — if business viability is heavy, §10 leads the deck | All | Before deck |

---

## Appendix A — Why not the obvious alternatives

| Alternative | Why not |
|---|---|
| **Hyperledger Fabric** | The academic default for food traceability and genuinely the right enterprise answer — but it needs an orderer, peers, CAs and channel config. Unstandable in a hackathon and impossible to demo on a laptop with the WiFi pulled. We name it as the production migration path. |
| **Write every reading on-chain** | ₹240/crate (§10.2), and it permanently publishes commercially sensitive farm telemetry. |
| **Sign on the gateway instead of the node** | Destroys the entire thesis. Whoever owns the gateway owns the truth, and we are back to immutable garbage. |
| **IPFS for raw records** | Adds a pinning dependency and a demo failure mode for no gain at our data volume. Digests + proofs already give integrity. |
| **A custom PoA sidechain** | We would spend the hackathon building consensus instead of the product, and judges rightly discount home-made chains. |
| **Ed25519 instead of secp256k1** | Faster on-chip, but not natively verifiable by `ecrecover`, closing the door on on-chain device-signature checks. secp256k1 keeps the option open. |
