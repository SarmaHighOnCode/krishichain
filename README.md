# KrishiChain

**Low-cost IoT blockchain nodes for farm-to-fork traceability.**
IIC 2026 · Problem Statement 06 · AgriTech

> Trust you can verify — from the farm gate to your fork.

---

## The one-paragraph version

Putting supply-chain data on a blockchain does not make it true. It makes it *immutable* —
and immutable garbage is still garbage. KrishiChain closes that gap by pushing cryptography
**down into ₹400–900 sensor nodes**: every temperature, humidity and tamper reading is signed on
the ESP32 by a private key that never leaves the chip, and each record is hash-chained to the
one before it. A heterogeneous swarm — ESP32 HEADs, S2 Lolin LEAFs, ESP32-CAM witnesses and
phone virtual-nodes — relays everything to a laptop field base with ESP-NOW → WiFi fallback,
so evidence gets out one way or another. See [ADR-0004](docs/adr/0004-heterogeneous-swarm.md). The result is a data stream that is **attributable** (this exact commissioned
device said this), **gapless** (records cannot be silently dropped or reordered, even while
offline), and **independently verifiable** (a consumer's phone recomputes a Merkle proof against
a root anchored on a public chain — without trusting our servers).

## What a judge can do in 90 seconds

1. Scan the QR on a tomato crate → see its journey: farm → aggregator → cold truck → retail.
2. Press **Verify independently** → the browser fetches the Merkle root from Polygon Amoy and
   recomputes the proof locally. Green badge = the data existed at anchor time, unaltered.
3. Open the cold box lid → the transit node logs a tamper + temperature excursion → the lot is
   flagged **COLD-CHAIN BREACH** on-chain within seconds, and the consumer page reflects it.
4. Pull the WiFi. The node keeps recording into its hash-chained flash buffer. Plug it back in →
   the entire gapless run uploads and verifies. Nothing was lost, nothing could be rewritten.

## Architecture at a glance

```mermaid
flowchart LR
  subgraph FIELD["Field / Cold chain"]
    N1["ESP32 · FARM NODE<br/>harvest env + lot commissioning"]
    N2["ESP32 · TRANSIT NODE<br/>cold chain + tamper"]
  end

  subgraph EDGE["Edge"]
    GW["Gateway<br/>verify sig · verify hash-chain<br/>EPCIS 2.0 events"]
  end

  subgraph OFFCHAIN["Off-chain"]
    DB[("Event store<br/>raw records + proofs")]
  end

  subgraph CHAIN["On-chain (Anvil + Polygon Amoy)"]
    C1["DeviceRegistry"]
    C2["ActorRegistry"]
    C3["LotRegistry"]
    C4["BatchAnchor<br/>Merkle roots"]
  end

  subgraph APPS["Surfaces"]
    W1["Consumer verify (QR)"]
    W2["Ops dashboard"]
  end

  N1 -->|"signed, hash-chained records"| GW
  N2 -->|"signed, hash-chained records"| GW
  GW --> DB
  GW -->|"1 tx per batch of 256+"| C4
  GW --> C3
  C1 -.->|"is this device commissioned?"| GW
  DB --> W1
  DB --> W2
  C4 -.->|"root fetched client-side"| W1
```

## Repository map

| Path | What lives here | Owner |
|---|---|---|
| `docs/` | PRD, architecture, protocol spec, team plan, demo script | All |
| `firmware/node-farm/` | ESP32 harvest/commissioning node (PlatformIO) | H1 |
| `firmware/node-transit/` | ESP32 cold-chain/tamper node (PlatformIO) | H1 |
| `firmware/lib/krishi/` | Shared C++ lib: identity, signing, hash chain, ring buffer | H1 |
| `contracts/` | Solidity (Hardhat + viem) | S1 |
| `apps/gateway/` | Fastify ingest, verification, Merkle batcher, anchor service | S1 |
| `apps/web/` | Next.js consumer verify + ops dashboard | S2 |
| `packages/core/` | Canonical encoding, Merkle, signature verify, EPCIS types | S1 |
| `hardware/` | BOM, wiring diagrams, enclosure, calibration logs | H2 |

## Quick start

```bash
npm install
npm run dev
```

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for the full setup, including firmware flashing and
the offline demo chain.

## Documents

| Doc | Read it when |
|---|---|
| [PRD.md](docs/PRD.md) | You want the what and the why. Start here. |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | You are writing code. |
| [PROTOCOL.md](docs/PROTOCOL.md) | You touch anything crossing device ↔ gateway ↔ chain. |
| [HARDWARE.md](docs/HARDWARE.md) | You are holding a soldering iron. |
| [TEAM-PLAN.md](docs/TEAM-PLAN.md) | You want to know what *you* are building today. |
| [TASKS.md](TASKS.md) | You are about to open Claude Code. |
| [DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) | It is pitch day. |
| [JUDGING.md](docs/JUDGING.md) | You want to know what they will ask and what we answer. |

## Team

| Role | Track | Owns |
|---|---|---|
| **H1** (Jaideep) | Hardware | Firmware, device identity, crypto, offline buffer, uplink |
| **H2** | Hardware | Sensors, power, enclosure, tamper rig, calibration, demo props |
| **S1** | Software | Contracts, gateway, Merkle/anchor pipeline, `packages/core` |
| **S2** | Software | Consumer verify UI, ops dashboard, QR/labels, pitch assets |

## Licence

MIT — see [LICENSE](LICENSE).
