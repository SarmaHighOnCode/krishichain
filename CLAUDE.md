# CLAUDE.md — working agreement for Claude Code on KrishiChain

Read this before touching anything. Then read the ticket in [TASKS.md](TASKS.md).

## What this project is

Low-cost IoT nodes (ESP32) that **sign and hash-chain their own sensor readings**, a gateway that
verifies them before storage, Merkle roots anchored on a blockchain, and a consumer page that
verifies inclusion proofs client-side. Farm-to-fork traceability where the trust boundary sits
inside the device, not on the server.

Full context: [docs/PRD.md](docs/PRD.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/PROTOCOL.md](docs/PROTOCOL.md)

## Hard invariants — never violate these

1. **Never change the canonical encoding or the golden vectors to make a test pass.**
   `packages/core/fixtures/vectors.json` is the referee between the C++ firmware and the
   TypeScript stack. If your code disagrees with a vector, your code is wrong. A genuine protocol
   change requires bumping `v` in PROTOCOL.md and updating both implementations in one PR.
2. **Signing happens on the device. Never move it to the gateway** "for convenience". That
   deletes the entire thesis of the project.
3. **The gateway verifies before it stores.** Never persist a record to the main store before
   signature and chain-continuity checks. Invalid records go to quarantine.
4. **Raw sensor data never goes on-chain.** Only identity, lifecycle and 32-byte commitments.
5. **`UNVERIFIABLE` is a real UI state.** Never swallow a verification failure into a log line or
   render it as "verified". Failing loudly is the product.
6. **The demo must work with no internet.** Never make the local-chain path depend on a remote
   RPC, a CDN font, or a hosted API.
7. **No secrets in the repo.** Private keys, RPC keys and mnemonics live in `.env` (gitignored).
   `.env.example` documents the names only.

## Repo layout

```
firmware/          ESP32, PlatformIO, C++17   — owner H1
  lib/krishi/      identity, record, chain, ringbuffer, uplink, crypto, sensors
  node-head/       ESP32 WiFi relay + ESP-NOW coordinator
  node-leaf/       ESP32-S2 sensor node (ESP-NOW, WiFi-direct fallback)
  node-cam/        ESP32-CAM witness node
  cam-bringup/     camera bring-up sketch
contracts/         Solidity 0.8.28, Hardhat 2.22 + viem   — owner S1
apps/gateway/      Fastify + TS + SQLite               — owner S1
apps/web/          Next.js 15 App Router + Tailwind    — owner S2
packages/core/     canonical encoding, merkle, verify, EPCIS  — owner S1
hardware/          BOM, power, calibration logs        — owner H2
scripts/           sim-node, seed, e2e-demo
docs/              PRD, architecture, protocol, team plan, demo script
```

## Commands

```bash
npm install              # once, at the repo root (npm workspaces)
npm run dev              # local chain + gateway + web, all three
npm test                 # all workspaces
npm run chain            # hardhat node only
npm run deploy:local     # deploy contracts to the local chain
npm run sim              # simulated node → gateway (no hardware needed)
npm run seed             # seed a demo lot journey
npm run e2e              # full pipeline test, no hardware
```

Firmware:

```bash
cd firmware && pio run -e node-head -t upload && pio device monitor -b 115200
cd firmware && pio test -e native      # host-side tests against the golden vectors
```

## Conventions

- **TypeScript** strict. No `any` in `packages/core`. Prefer `viem` over `ethers`.
- **Solidity** 0.8.28, OpenZeppelin for `AccessControl` and `MerkleProof`. Custom errors, not
  revert strings. NatSpec on every external function.
- **C++** C++17, no dynamic allocation in the record/sign/buffer path. Fixed buffers only.
- **Commits** Conventional Commits with a scope: `feat(gateway):`, `fix(fw):`, `docs(prd):`,
  `test(core):`, `chore(ci):`.
- **Branches** `<owner>/<ticket>-<slug>` — e.g. `s1/S1-08-merkle-batcher`.
- **One ticket, one PR.** `main` must stay demo-able at every commit.

## How to work a ticket

1. Read the ticket in `TASKS.md` — it has scope, files, acceptance criteria and **non-goals**.
2. Read the referenced section of `PROTOCOL.md` or `ARCHITECTURE.md` before writing code.
3. Write the test first where a golden vector or an acceptance criterion already defines the
   expected behaviour. Most tickets here have one.
4. Implement the smallest thing that satisfies the acceptance criteria.
5. Run `npm test` (and `pio test -e native` for firmware). Do not commit red.
6. Commit with the ticket ID in the body.

**Stay inside your ticket's file scope.** Four people and their agents are working in this repo
at once; edits outside your scope create merge conflicts someone else has to debug at 3 a.m. If
a ticket seems to require touching another owner's files, stop and flag it.

## Things that will bite you

- **ESP32 ADC2 is unusable while WiFi is on.** Analog sensors go on ADC1 (GPIO 32–39).
- **GPIO 6–11 are the SPI flash.** Using them bricks the boot.
- **secp256k1 `s` must be low-half normalised** or signature dedup and malleability checks break.
- **Merkle pairs are sorted** (`keccak256(min ‖ max)`) to match OpenZeppelin's `MerkleProof`.
  An unsorted implementation verifies fine in your own tests and fails on-chain.
- **The device address is `keccak256(pubkey[1:])[12:]`** — drop the `0x04` prefix byte first.
  This is the single most common bug in device-identity code.
- **Nonce management in the anchor service**: an RPC timeout is not a failed transaction. Persist
  a high-water mark or you will double-anchor.
- **DHT22 needs ~2 s between reads** and returns NaN if polled faster. Do not fight it.

## Verification discipline

Do not report a task complete on the basis that the code looks right. Run it. For firmware,
"compiles" is not "works" — say explicitly which parts were verified on hardware and which were
only tested natively. Every team member must be able to explain any line they ship; a judge will
ask.
