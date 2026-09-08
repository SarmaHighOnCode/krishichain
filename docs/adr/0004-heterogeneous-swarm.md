# ADR-0004 — Heterogeneous swarm with laptop field base

**Status:** Accepted · 2026-09-08

## Context

Two identical ESP32s prove the trust thesis but undersell the problem statement:
a real farm-to-fork chain has crates, trucks, phones and cold boxes — not two
dev boards. We have ESP32 DevKit, ESP32-CAM, ESP32-S2 Lolin and Android phones
to use as virtual nodes. The laptop is the field base (dashboard + gateway +
local chain). Venue WiFi is hostile; rural connectivity is worse.

Unity was proposed for the dashboard. It buys 3D wow at the cost of a second
build chain, GPU dependence and a week we do not have. The web stack (Next.js
+ Leaflet + React Three Fiber) already in repo covers 2D map + 3D-lite twins.

## Decision

1. **Four device classes, one record format.** PROTOCOL v1 90-byte canonical
   record is frozen. CAM photo hashes, phone GPS/IMU and relay metadata ride
   as companion attestations linked by `(dev, seq, digest)` — never inside
   the canonical bytes. Golden vectors stay valid.
2. **Roles:** DevKit = HEAD (WiFi + ESP-NOW + buffer + forward), S2 Lolin =
   LEAF (sense + ESP-NOW, WiFi fallback only), ESP32-CAM = WITNESS (photo
   hash + lid verdict), phone PWA = VIRTUAL (GPS + IMU + camera backup,
   WiFi/MQTT direct; BLE advertise for proximity, never ESP-NOW).
3. **Transport fallback, swarm-style:** LEAF → ESP-NOW → HEAD normally; HEAD
   loss (missed heartbeats) → LEAF WiFi direct to laptop; no network → flash
   buffer. Heads emit heartbeats; leafs pick strongest RSSI. Original
   `dev,sig,seq,prev` is never rewritten by a relay — end-to-end verify holds.
4. **Swarm intelligence = 3 demoable behaviours:** 2-of-3 consensus breach
   (temp + CAM lid + IMU shock in same lot/geo window), adaptive sampling
   broadcast (`INTERVAL 30s→10s` on incident, back to 60s calm), custody
   follow by proximity (nearest node subscribes to lot on RSSI/BLE).
5. **Dashboard = web, not Unity.** Leaflet field grid + node pins, R3F
   box-per-crate twins (colour = temp, badge = proof state), MQTT-WS live
   feed. Unity relegated to P2 replay-only from logged MQTT, never live path.

## Consequences

**Good**
- Denser, cross-validated evidence per crate; one bad sensor cannot lie alone.
- Offline is normal: every hop buffers, every gap is detectable via hash chain.
- Phones add GPS + motion with zero BOM; S2 leafs add density at ~₹250.
- Web twins demo on any laptop/phone with no install.

**Costs**
- Relay wrapper + companion types in gateway ingest (S1).
- CAM photo-hash + S2 bring-up load on H2; HEAD/LEAF split load on H1.
- ESP-NOW channel discipline (one channel, ≤250 B payload) must be enforced.

## Alternatives rejected

- **Unity live dashboard** — build/GPU cost, no offline gain.
- **Phones over ESP-NOW** — impossible; phones lack ESP-NOW radios.
- **v2 canonical record with GPS/photo inside** — invalidates golden vectors
  and both implementations mid-build; companions give 90% value at 10% cost.
