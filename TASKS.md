# TASKS — the ticket board

Every ticket is written to be pasted straight into Claude Code. Format:

```
<ID> · <title>            [owner] [priority] [est]
Scope     — what to build
Files     — where it lives
Depends   — what must exist first
Accept    — how we know it is done
Non-goals — what NOT to build (this line prevents most scope creep)
```

Priorities: **P0** demo fails without it · **P1** demo is weak without it · **P2** stretch.

---

## Hour 0–2 · Whole team — seams frozen

### `T0-01` · Repo bootstrap and clean install [S1] [P0] [30m]
- **Scope** Everyone clones, `npm install`, `npm test` green on all four machines.
- **Accept** Four green terminals. Any machine that fails is fixed before anything else starts.

### `T0-02` · Protocol walkthrough [ALL] [P0] [30m]
- **Scope** Read `docs/PROTOCOL.md` aloud together, §1–§4. Argue now, not at hour 30.
- **Accept** Every person can state what `prev`, `seq`, `tsq` and `ackSeq` do without looking.

### `T0-03` · PlatformIO blink on both boards [H1] [P0] [30m]
- **Accept** Both ESP32s flash and blink. Board that fails is replaced now, not on demo day.

---

## Swarm delta (ADR-0004) — heterogeneous nodes, web twins

### `H1-14` · HEAD relay + heartbeat + adaptive interval [H1] [P0] [3h]
- **Scope** ESP-NOW receive + forward preserving `dev,sig,seq,prev`; heartbeat
  broadcast; obey gateway `INTERVAL` command (30 s → 10 s on incident).
- **Accept** LEAF batch forwarded byte-identical; interval switch observed live.
- **Non-goals** No CAM code, no phone code.

### `H2-11` · LEAF (S2 Lolin) bring-up [H2] [P0] [3h]
- **Scope** Sense T/H/light, ESP-NOW send to HEAD, WiFi-direct fallback,
  flash buffer. Pin map entry in `docs/HARDWARE.md`.
- **Accept** Auto-failover HEAD-loss → WiFi direct demonstrated once.
- **Non-goals** No signing-algorithm change; reuse `lib/krishi`.

### `H2-12` · CAM witness (photo-hash + lid verdict) [H2] [P1] [3h]
- **Scope** Capture → `keccak256(photo)` + lid open/closed verdict as signed
  companion attestation linked by `(dev, seq, digest)`. No raw photo on-chain.
- **Accept** Companion verifies against record digest on gateway.
- **Non-goals** No image streaming, no on-device ML.

### `S1-14` · Companion ingest + consensus breach [S1] [P0] [4h]
- **Scope** Accept relay wrappers + CAM/IMU companions; 2-of-3 breach rule
  (temp + CAM lid + IMU shock, same lot/window) → `flagLot`.
- **Accept** Single-sensor spike does NOT flag; 2-of-3 DOES within 10 s.
- **Non-goals** No canonical-record change.

### `S1-15` · MQTT broker + `sim-swarm.ts` [S1] [P0] [3h] — **UNBLOCKS S2**
- **Scope** Mosquitto on laptop; `sim-swarm` fakes HEAD/LEAF/CAM/VIRTUAL with
  real keys/signatures, gap/breach injection.
- **Accept** `npm run sim-swarm` drives twins dashboard with no hardware.

### `S2-12` · Web twins (map + 3D-lite + health) [S2] [P0] [5h]
- **Scope** Leaflet field map + R3F box-per-crate twins + health cards, live
  over MQTT-WS. Web, not Unity.
- **Accept** Node kill → twin greys in ≤ 5 s; breach → twin + badge update.
- **Non-goals** No Unity build.

### `S2-13` · Phone PWA virtual-node [S2] [P1] [4h]
- **Scope** PWA speaks `POST /ingest` with soft key, streams GPS/IMU, BLE
  advertise for proximity custody.
- **Accept** Phone record verifies end-to-end like any ESP.

---

## H1 · Firmware (Jaideep)

> **H1 scope was extended on 2026-09-08** to a HEAD/LEAF split over ESP-NOW
> ([ADR-0004](docs/adr/0004-head-leaf-esp-now.md)), adding receive-and-forward, heartbeat and
> adaptive sampling. The executable breakdown now lives in
> [docs/superpowers/plans/2026-09-08-h1-head-firmware.md](docs/superpowers/plans/2026-09-08-h1-head-firmware.md)
> (13 tasks, TDD, host-testable through Task 7). New tickets: H1-14 frame codec, H1-15 ESP-NOW
> transport, H1-16 ACK fan-out, H1-17 heartbeat, H1-18 adaptive sampling. Gateway dependency:
> **S1-14 `POST /heartbeat`**.


### `H1-01` · secp256k1 signing benchmark [P0] [1h]
- **Scope** Minimal sketch: micro-ecc `uECC_secp256k1`, sign a fixed 32-byte digest 100×, report
  mean ms and stack high-water mark. Also benchmark keccak256 on 90 bytes.
- **Files** `firmware/bench/sign_bench/`
- **Accept** A number in `hardware/BENCHMARKS.md`. If signing > 150 ms, raise it immediately —
  the sampling interval or the algorithm choice changes.
- **Non-goals** No WiFi, no sensors, no storage. This is a spike.

### `H1-02` · Device identity [P0] [3h]
- **Scope** Generate a secp256k1 keypair from `esp_random()`; persist to encrypted NVS; derive
  the device address as `keccak256(pubkey_uncompressed[1:])[12:]`; print it once at commissioning.
- **Files** `firmware/lib/krishi/identity.{h,cpp}`
- **Accept** Fresh flash → unique stable address that survives reboots. Private key never printed
  after the commissioning line. Address matches what `viem` derives from the same pubkey.
- **Non-goals** No ATECC608A. No key rotation.

### `H1-03` · Canonical record packing [P0] [2h]
- **Scope** Pack the 90-byte record exactly per PROTOCOL §1.3. Fixed struct, big-endian, no
  allocation.
- **Files** `firmware/lib/krishi/record.{h,cpp}`
- **Depends** `S1-02` (vectors)
- **Accept** Native test passes **every** vector in `packages/core/fixtures/vectors.json`, byte
  for byte, including the sensor-fault sentinels and the boundary record.
- **Non-goals** No JSON, no CBOR. Do not "improve" the layout.

### `H1-04` · Sign + low-`s` normalisation [P0] [2h]
- **Accept** Deterministic (RFC 6979): same input → same 64-byte signature. `s <= n/2` always.
  Every vector's expected signature reproduced exactly. `viem` verifies each one.

### `H1-05` · Hash chain state [P0] [3h]
- **Scope** Maintain `(seq, prevDigest)` in NVS. Genesis `seq=0`, `prev=0x00…`. Commit chain
  state **after** the buffer slot write.
- **Accept** Reboot mid-run continues at the correct `seq` with the correct `prev`. A forced
  power cut replays at most one record and never breaks the chain.

### `H1-06` · Flash ring buffer [P0] [4h]
- **Scope** Crash-safe circular buffer in a dedicated flash partition. Slot format
  `[magic|len|payload|crc32]`. Recover head/tail by scan on boot; skip torn writes.
- **Accept** ≥ 720 slots. 100 random power cuts (`H1-13`) → zero chain breaks, zero lost
  acknowledged records.
- **Non-goals** No compression, no wear-levelling beyond the ring.

### `H1-07` · Uplink + `ackSeq` flow control [P0] [3h]
- **Accept** Batches ≤ 100 records; only advances the tail on `200` + `ackSeq`; exponential
  backoff 2 s → 60 s on 5xx; **stops uploading and blinks fault on `401`**.

### `H1-08` · Store-and-forward drain [P0] [2h]
- **Accept** **The demo test:** pull WiFi for 10 minutes, restore it → the entire backlog uploads
  oldest-first and the gateway reports zero gaps.

### `H1-09` · Sensor layer + DHT22 [P0] [2h]
- **Accept** One interface, two implementations (real + fake for native tests). Respects the 2 s
  DHT22 limit; a fault emits the sentinel value with `flags.SENSOR_FAULT`, never a fabricated
  reading.

### `H1-10` · Tamper channel [P1] [2h] · `H1-11` · Lot binding [P1] [2h] · `H1-12` · LED/OLED states [P1] [2h]
### `H1-13` · Power-cut soak, 100 cycles [P0] [2h]
- **Accept** Automated script, results logged. This turns "crash-safe" from a claim into evidence.

---

## H2 · Physical build

### `H2-01` · Inventory + BOM audit [P0] [1h]
- **Scope** List what is physically present; fill real prices into `hardware/BOM.md`; resolve
  every "substitute" column in `docs/HARDWARE.md`; report gaps to the team **in hour 1**.
- **Accept** PRD §10.1 has real numbers, not estimates.

### `H2-02` · Node A build (farm) [P0] [3h] · `H2-03` · Node B build (transit) [P0] [3h]
- **Accept** Soldered, strain-relieved, labelled with the device address prefix. Runs 4 h without
  a reset.

### `H2-04` · Calibration [P1] [2h]
- **Accept** Two-point (ice bath + room), offset in deci-°C, ≤ ±0.5 °C after correction, logged
  in `hardware/CALIBRATION.md` with the reference instrument named.

### `H2-05` · Power characterisation [P0] [2h]
- **Accept** `hardware/POWER.md` with measured mA per state and projected battery life. Include
  the energy cost of one signature — it is a memorable slide.

### `H2-06` · Enclosure + tamper seal [P1] [2h] · `H2-07` · Cold box rig [P0] [2h]
- **Accept (H2-07)** A breach can be induced on demand and lands in **60–120 s**, repeatably.
  Timed and written down.

### `H2-08` · Crates, QR labels, staging [P0] [2h] (with S2)
### `H2-09` · Backup board, flashed + registered [P0] [1h] — **do this by hour 30**
### `H2-10` · Two timed dry runs [P0] [2h]

---

## S1 · Chain, gateway, core

### `S1-01` · `packages/core` canonical codec [P0] [2h]
- **Accept** `encode`/`decode`/`digest` round-trip; mirrors PROTOCOL §1.3 exactly.

### `S1-02` · Golden vector generator [P0] [2h] — **BLOCKS H1, ship by hour 2**
- **Scope** Generate ≥ 20 vectors: genesis, normal, negative temp, sensor faults, lid-open,
  buffered, `tsq=0`, gap, fork, duplicate, high-`s` rejection, all-max boundary. Each with field
  values, canonical hex, digest, a fixed test key and the expected signature.
- **Files** `scripts/gen-vectors.ts`, `packages/core/fixtures/vectors.json`
- **Accept** Committed and announced in the team channel. H1 is blocked until this lands.

### `S1-03` · `ActorRegistry` + `DeviceRegistry` [P0] [3h]
- **Accept** Role-gated registration; `isActiveAt(dev, blockNo)` is **block-scoped** so a
  revocation invalidates only records signed after it. Tests cover before/after revocation.

### `S1-04` · `LotRegistry` + `BatchAnchor` [P0] [4h]
- **Accept** Full lifecycle: create → aggregate → transferCustody → flag → finalize. Aggregation
  graph traversable both ways. Anchors chain via `prevRoot`. `anchor` ≤ 80k gas, asserted (measured ~75k).

### `S1-05` · `sim-node.ts` [P0] [2h] — **UNBLOCKS S2**
- **Scope** A fake node speaking the real protocol: real keys, real signatures, real chain,
  configurable gap/fork/breach injection.
- **Accept** `npm run sim -- --breach --gap-at 40` drives a full journey with no hardware.

### `S1-06` · Ingest + signature verification [P0] [3h]
- **Accept** Pipeline order per ARCHITECTURE §2.3 (device-known check **before** signature
  verification). Bad signature → 401 + quarantine, never the main store.

### `S1-07` · Chain state machine + incidents [P0] [3h]
- **Accept** All four verdicts (accept/gap/fork/duplicate) with 100% branch coverage. A gap
  raises `CHAIN_GAP` and ingest of later records still proceeds.

### `S1-08` · Merkle batcher [P0] [3h]
- **Accept** Sorted-pair keccak matching OZ `MerkleProof`. Closes at 256 leaves or 60 s. Every
  stored record has a retrievable proof. Property test: 1,000 random trees, every leaf verifies.

### `S1-09` · Anchor service [P0] [3h]
- **Accept** Persisted nonce high-water mark; survives an RPC timeout without double-anchoring;
  writes local chain synchronously and Amoy asynchronously.

### `S1-10` · Rules engine [P0] [2h] — breach ≤ 10 s after the causing record
### `S1-11` · Query API [P0] [3h] · `S1-12` · EPCIS projection [P1] [3h]
### `S1-13` · Amoy deploy + funded key [P1] [2h] — **hour 30, not hour 46**

---

## S2 · Web

### `S2-01` · Design language [P0] [3h]
- **Scope** Type scale, colour system, badge design, spacing. Make a deliberate aesthetic choice —
  agricultural, tactile, evidence-y. Not a default component-library grid.
- **Accept** One page proves the system. Dark and light both work.
- **Non-goals** No component library dump. No dashboard template.

### `S2-02` · `/verify/[lotId]` journey timeline [P0] [4h] — mobile-first, 360 px
### `S2-03` · Client-side Merkle verification [P0] [4h]
- **Scope** Browser fetches the anchor root from a **public RPC directly**, recomputes the leaf
  from the displayed record, walks the proof.
- **Accept** Works with the gateway process killed. < 200 ms. The verification steps are
  *visible* to the user — this is the money moment of the demo.

### `S2-04` · Four badge states [P0] [2h]
- **Accept** `VERIFIED`, `PENDING ANCHOR`, `FLAGGED`, `UNVERIFIABLE` — each designed, each
  reachable in the demo. `UNVERIFIABLE` must look deliberate, not broken.

### `S2-05` · Cold-chain chart [P0] [3h] — breach window shaded; obvious without reading numbers
### `S2-06` · Ops dashboard [P0] [4h] — node health, buffer depth, last-seen, incidents
### `S2-07` · Live updates [P1] [1h] — 3 s polling. **Do not build a socket layer.**
### `S2-08` · QR + label sheet [P1] [2h] · `S2-09` · Custody handoff [P1] [3h]
### `S2-10` · Mobile pass [P0] [2h] · `S2-11` · Deck + 90-second script [P0] [3h]

---

## Integration gates

### `GATE-1` · Hour 20 [ALL] [P0] [3h]
- [ ] A physical node's record passes signature + chain verification on the real gateway
- [ ] A batch anchors on the local chain
- [ ] The consumer page renders one real reading with a green badge

### `GATE-2` · Hour 38 [ALL] [P0] [4h]
- [ ] Full demo run end to end, twice, timed
- [ ] Offline test · tamper test · unverifiable test all pass
- [ ] Amoy live with an explorer link
- [ ] Backup board ready, fallback video recorded

**Code freeze: hour 44.**
