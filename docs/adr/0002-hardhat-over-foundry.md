# ADR-0002 — Hardhat 3 + viem, not Foundry

**Status:** Accepted · 2026-09-08

## Context

The team's machines have Node 24, npm 11, Python 3.12, Docker and PlatformIO. They do **not**
have Foundry, and the team is on Windows.

Foundry is the better contract toolchain in most respects — faster tests, fuzzing, Solidity-native
test authoring. But it is another toolchain to install, on Windows, at the start of a time-boxed
build, for four people.

## Decision

Use **Hardhat 3 with viem and TypeScript tests**, installed through the same `npm install` as
everything else.

## Consequences

**Good**
- One install step for the whole repo. A new machine is productive in under five minutes (NFR-11).
- `viem` is used identically in the contracts tests, the gateway and the browser — one mental
  model and one set of encoding helpers across the entire TypeScript stack.
- The gateway and the web app can import contract types directly from the same workspace.

**Costs**
- Slower tests than `forge test` (irrelevant at ~400 lines of Solidity).
- No built-in fuzzing. We compensate with property tests in `packages/core` for the Merkle code,
  which is where randomised testing actually pays here.
- Gas reporting is less ergonomic; the `anchor` ≤ 60k gas ceiling is asserted explicitly in a test
  rather than read off a report.

## Revisit if

Contract complexity grows past ~1,000 lines, or invariant testing on `LotRegistry`'s aggregation
graph becomes worth the toolchain cost.
