# ADR-0001 — Sign on the device, not on the gateway

**Status:** Accepted · 2026-09-08

## Context

Sensor readings must reach a blockchain in a form that a third party can verify. The cheap and
obvious implementation is: node sends plain readings over WiFi, the gateway validates, signs and
anchors them. Almost every comparable project does this, because it keeps the microcontroller
trivial.

The literature on IoT + blockchain in food supply chains is consistent that this is exactly where
these systems fail: putting IoT output on a distributed ledger does not fix IoT data quality, it
makes bad data permanent. If the gateway is the first signer, then whoever controls the gateway
controls what is "true", and the ledger is a very expensive audit log of one party's claims.

## Decision

**Every record is signed on the ESP32**, with a secp256k1 private key generated on-device from
the hardware TRNG and stored in encrypted NVS. The key never leaves the chip. The gateway is a
*verifier*, never an author.

Additionally, records are hash-chained per device (`seq`, `prev`), so the gateway cannot silently
drop inconvenient readings either — omission becomes detectable, not just alteration.

## Consequences

**Good**
- The trust boundary sits at the physical observation, which is the only honest place for it.
- The gateway and the database become untrusted infrastructure; compromising them cannot forge or
  silently delete evidence.
- A consumer can verify without trusting our servers at all.
- It gives the project a defensible answer to the sharpest question a judge can ask.

**Costs**
- ~40 ms and a few hundred bytes of RAM per record on the ESP32 (measured in `H1-01`).
- Firmware complexity: key management, NVS encryption, chain state, crash-safe buffering. This is
  most of H1's workload.
- Key extraction from an unlocked ESP32 is feasible for a determined attacker. Mitigated by flash
  encryption and block-scoped on-chain revocation; fully addressed only by a secure element
  (ATECC608A), which is out of scope for this build.

## Alternatives rejected

- **Gateway-side signing** — deletes the thesis of the project.
- **TLS client certificates only** — proves the channel, not the record. A record extracted from
  a TLS session carries no evidence of origin.
- **Ed25519** — faster on-chip, but not verifiable by `ecrecover`, which would close the door on
  on-chain device-signature verification.
