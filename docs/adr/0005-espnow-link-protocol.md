# ADR-0005 — ESP-NOW link protocol between LEAF and HEAD

**Status:** Accepted · 2026-09-08
**Refines:** [ADR-0004](0004-heterogeneous-swarm.md), which chose the HEAD/LEAF roles.
ADR-0004 decides *that* a LEAF relays through a HEAD and asserts that a relay never rewrites
`dev/sig/seq/prev`. This ADR specifies *how* that link behaves and what it costs.
**Supersedes:** the two-WiFi-node topology implied by ARCHITECTURE §2.1

## Context

The original scaffold had both ESP32s associating to WiFi and posting to the gateway
independently. That is convenient in a lab and wrong in a field: the premise of the whole
problem statement is that the farm end of the supply chain has no connectivity. A design where
every sensor needs a router does not describe the situation we claim to be solving.

LoRa was the obvious answer and was ruled out in `docs/HARDWARE.md` §2 as a six-hour risk with
an antenna that is easy to destroy. ESP-NOW costs nothing extra: it is connectionless 802.11
action frames between ESP32s, needs no AP, no association and no IP stack, and both radios are
already on the boards we have.

## Decision

Two roles, one shared library.

| | **LEAF** (`firmware/node-leaf`) | **HEAD** (`firmware/node-head`) |
|---|---|---|
| Was | `node-farm` | `node-transit` |
| Radio | ESP-NOW only, never associates to WiFi | WiFi STA **and** ESP-NOW |
| Signs its own records | Yes | Yes |
| Forwards others' records | No | Yes, **opaquely** |
| Uplink | None — talks only to HEAD | HTTP to the gateway |
| Power | Low: no association, no DHCP, no TLS | Mains or large cell |

**The load-bearing rule: the HEAD never re-signs anything.** It receives a LEAF's canonical 90
bytes plus its 64-byte signature, stores them byte-for-byte, and forwards them byte-for-byte.
It has no access to the LEAF's private key and no ability to produce a record on the LEAF's
behalf.

## Consequences

**This makes the thesis stronger, not just the topology more realistic.**

The HEAD is a relay we explicitly do not trust, and we can prove we do not need to:

- If the HEAD **alters** a forwarded record, the signature fails at the gateway and the record
  is quarantined.
- If the HEAD **drops** a forwarded record, the LEAF's hash chain shows a `CHAIN_GAP`.
- If the HEAD **invents** a record, it cannot sign it as the LEAF.
- If the HEAD **replays** old records, the gateway returns `DUPLICATE` and nothing changes.

That is a demonstrable claim about a real intermediary, which is a much better answer to "so
what does the blockchain actually buy you?" than a single node posting to a server. The relay
is the argument.

**Good**
- Field-plausible: the LEAF works where there is no WiFi at all, which is the actual problem.
- LEAF power drops substantially — no association, no DHCP lease, no TLS handshake.
- Removes the LoRa risk while keeping the "no connectivity at the farm" story.
- One more layer for the offline demo: pull the HEAD's WiFi and *both* nodes keep working, the
  LEAF still delivering to the HEAD's buffer over ESP-NOW.

**Costs**
- **Channel coupling.** ESP-NOW must run on the same radio channel as the HEAD's associated AP.
  If the AP roams channels, the link drops until the LEAF re-acquires. Handled by a BEACON +
  channel-scan re-acquisition in the link protocol.
- **250-byte frames.** ESP-NOW v2 (IDF ≥ 5.4) allows 1470, but we stay within the v1 limit —
  our largest frame is 158 bytes, so there is no reason to take the interop risk.
- **An application-level ACK is required.** ESP-NOW's send callback confirms the frame reached
  the radio, not that the gateway accepted the record. Without an app ACK carrying `ackSeq`,
  the LEAF can never safely free its buffer.
- **A spoofed ACK can cause data loss.** An attacker who forges an ACK from the HEAD's MAC can
  make the LEAF drop unsent records. This is *detectable* — the gateway sees a `CHAIN_GAP` —
  but not preventable at the link layer. Mitigated with ESP-NOW encryption (PMK + per-peer
  LMK); we have exactly one peer, far below the ESP32's six-encrypted-peer limit.

**Explicitly not solved:** ESP-NOW gives no delivery guarantee across a power loss on the HEAD.
Records already durably buffered on the LEAF survive; the LEAF simply retries until acked.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Both nodes on WiFi** (the scaffold) | Assumes away the problem we claim to solve. |
| **LoRa** | Best range story, worst time risk (`docs/HARDWARE.md` §2). Revisit post-hackathon; the link protocol is transport-agnostic, so swapping ESP-NOW for LoRa later is a driver change. |
| **HEAD re-signs forwarded records** | Destroys ADR-0001. The relay would become the author and we would be back to trusting infrastructure. |
| **HEAD as a WiFi AP the LEAF associates to** | Costs the LEAF its power advantage and adds a DHCP/IP stack for no gain. |
| **ESP-NOW v2 large frames** | We need 158 bytes. Nothing to buy. |
