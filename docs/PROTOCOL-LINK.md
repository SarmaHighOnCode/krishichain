# KrishiChain Link Protocol v1 (ESP-NOW)

The LEAF↔HEAD radio link. See [ADR-0005](adr/0005-espnow-link-protocol.md) for why this exists.

**This is versioned separately from [PROTOCOL.md](PROTOCOL.md).** The record format is frozen
at v1 and the link layer must never require changing it — the canonical 90 bytes travel through
here untouched. If you find yourself wanting to add a field to the record to make the link
work, you have made a mistake; add it to the frame instead.

Transport-agnostic by design: swapping ESP-NOW for LoRa later is a driver change, not a
protocol change.

---

## 1. Frame format

Every frame is a 4-byte header plus payload, big-endian, fixed-width. Max frame **250 bytes**
to stay inside the ESP-NOW v1 limit (IDF ≥ 5.4 allows 1470, but our largest frame is 158, so
there is no reason to take the interop risk).

```
[ magic:1 = 0x4B | ver:1 = 0x01 | type:1 | len:1 | payload:len ]
```

`len` is the payload length only, so payload ≤ 246. A frame whose `magic` or `ver` does not
match is dropped silently and counted — a stray frame from an unrelated ESP-NOW project on the
same channel must never reach the parser.

| Type | Name | Payload | Bytes | Direction | Encrypted |
|---|---|---|---|---|---|
| `0x01` | `RECORD` | `canonical(90) ‖ sig(64)` | 154 | LEAF → HEAD | yes |
| `0x02` | `ACK` | `dev(20) ‖ ackSeq(4) ‖ serverTs(8)` | 32 | HEAD → LEAF | yes |
| `0x03` | `BEACON` | `headDev(20) ‖ channel(1) ‖ uptimeS(4)` | 25 | HEAD → broadcast | no |
| `0x04` | `HEARTBEAT` | `dev(20) ‖ lastSeq(4) ‖ bufDepth(2) ‖ bat(1) ‖ state(1)` | 28 | LEAF → HEAD | yes |
| `0x05` | `TIMESYNC` | `unixSeconds(8) ‖ tsq(1)` | 9 | HEAD → LEAF | yes |

`RECORD` carries the canonical record, which already contains `dev` and `seq`. Do not duplicate
them in the frame; the signature covers the canonical bytes and nothing else.

---

## 2. The rule that matters

**The HEAD copies `canonical` and `sig` byte-for-byte and never regenerates either.**

The HEAD has no access to a LEAF's private key. It cannot author, alter, or re-sign a LEAF
record. Every way it could misbehave is detectable downstream:

| HEAD misbehaviour | What the gateway sees |
|---|---|
| Alters a forwarded record | Signature verification fails → quarantine |
| Drops a forwarded record | `CHAIN_GAP` in that LEAF's chain |
| Invents a record | Cannot produce a valid signature for that device |
| Replays old records | `DUPLICATE`, idempotent, nothing changes |
| Reorders records | Gateway sorts by `seq`; `prev` linkage still verifies |

This is why the relay does not need to be trusted, and it is the most demonstrable version of
the project's whole argument. Do not "optimise" it away.

---

## 3. Channel acquisition

ESP-NOW must run on the same radio channel as the HEAD's associated AP. This is the single
most common way an ESP-NOW-plus-WiFi build fails, and it fails *silently*.

**HEAD:**
1. Connect WiFi STA as normal.
2. Read the negotiated channel (`WiFi.channel()`).
3. Init ESP-NOW **after** association, with peers registered on `WIFI_IF_STA`.
4. Broadcast a `BEACON` every 5 s carrying that channel.

**LEAF:**
1. `WiFi.mode(WIFI_STA)` then `WiFi.disconnect()` — the radio must be up, but the LEAF never
   associates to anything.
2. If no bonded HEAD: scan channels 1–13, dwelling 200 ms each, listening for `BEACON`.
3. On `BEACON`: lock `esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE)`, register the HEAD as a
   peer, and persist `{headMac, channel}` in NVS.
4. **Re-acquire** after 3 consecutive send cycles with no `ACK`. An AP that roams channels
   silently breaks the link, and a node that never re-scans just stops reporting.

Records continue to be captured and buffered throughout acquisition. Losing the link is never
a reason to stop recording.

---

## 4. Delivery and acknowledgement

The ESP-NOW send callback confirms the frame reached the peer's radio. It says nothing about
whether the gateway accepted the record, so it must not be used to free anything.

```
LEAF                          HEAD                         GATEWAY
 |  append to ring buffer      |                            |
 |  RECORD --------------->    |                            |
 |                             | append to forward queue    |
 |                             | POST /ingest (per device)  |
 |                             | -------------------------> |
 |                             | <----------- 200 {ackSeq}  |
 |  <---------------- ACK      |                            |
 |  release ≤ ackSeq           |                            |
```

**Rules:**
- The LEAF appends to its own flash ring buffer **before** transmitting, always.
- The LEAF frees a record only on an `ACK` whose `ackSeq ≥ record.seq`, **and** whose source MAC
  is the bonded HEAD.
- The HEAD holds forwarded records in its own durable queue until the gateway returns 200.
- The HEAD batches by device: one `POST /ingest` per `dev`, because ingest v1 takes a single
  device per request. This keeps the record protocol frozen. (A future `{v, batches:[...]}`
  shape would save round trips; not worth a protocol break now.)
- On HTTP 401 the HEAD stops uploading for that device and does **not** ACK — the device is not
  in `DeviceRegistry` and silently dropping its data would hide the misconfiguration.

**Known weakness (accepted, disclosed):** a forged `ACK` from a spoofed HEAD MAC makes a LEAF
drop unsent records. It causes *detectable* loss — the gateway reports a `CHAIN_GAP` — but the
link layer cannot prevent it. Mitigated by enabling ESP-NOW encryption (PMK + per-peer LMK);
we have exactly one peer, well under the ESP32's six-encrypted-peer limit. Broadcast `BEACON`
frames cannot be encrypted, which is fine — they carry no authority, only a channel hint.

---

## 5. Heartbeat

`HEARTBEAT` exists so the ops dashboard can distinguish "nothing is happening" from "the node
is dead", which matters much more once sampling is adaptive (§6) and a healthy node may
legitimately stay quiet for five minutes.

**A heartbeat is not evidence.** It is unsigned, it is not part of any hash chain, and it must
never be rendered as a sensor reading or stored alongside records. The gateway keeps heartbeats
in a separate table and the UI shows them only as liveness.

Everything a heartbeat reports (`lastSeq`, `bufDepth`, `bat`, `state`) is a *claim* by an
unauthenticated frame. Treat it as a hint for operators, never as an input to a verdict. If it
ever seems tempting to trust one, remember that the entire project exists because someone
trusted an unsigned reading.

Cadence: LEAF → HEAD every 30 s regardless of sampling interval. HEAD → gateway aggregated
every 30 s via `POST /heartbeat` (gateway ticket `S1-14`).

---

## 6. Adaptive sampling interval

A cold chain that is holding steady does not need a reading every 30 seconds; one that is
drifting toward a threshold needs readings faster than that. Adaptive sampling cuts LEAF power
and cuts the number of records the whole pipeline carries, without losing the events that
matter.

**Bounds:** `MIN = 10 s`, `MAX = 300 s`, start at 30 s.

**Unstable** — reset immediately to `MIN` — if any of:
- `|t − t_prev| ≥ 5` deci-°C (0.5 °C of movement between samples)
- `t` is within 20 deci-°C (2.0 °C) of the breach threshold
- any bit in `flags` changed since the previous record
- `LID_OPEN`, `SHOCK`, or `SENSOR_FAULT` is set

**Stable** — after 3 consecutive stable samples, `interval = min(interval × 1.5, MAX)`.

**Forced out-of-cycle sample:** any flag transition triggers an immediate capture rather than
waiting for the next tick. Opening the lid must produce a record within 2 s (FW-10), and that
requirement outranks any power saving.

### Why this cannot be used to hide a breach

The obvious attack is to sample slowly through a temperature excursion so the evidence is
thin. Three things prevent it:

1. **Approaching the threshold is itself an instability trigger.** The interval collapses to
   10 s *before* a breach, not after.
2. **Sampling density is auditable.** Every record carries `ts` and they are hash-chained in
   order, so the gaps between samples are visible to anyone reading the run. Sparse sampling
   during an excursion is conspicuous, not hidden.
3. **The policy is in firmware whose hash is registered on-chain** at commissioning
   (`firmwareHash` in PROTOCOL.md §5). An auditor can confirm which sampling policy produced a
   given run.

Deliberately **not** added to the record: an "interval" field. It would be redundant with `ts`
deltas and would mean breaking a frozen protocol to express something already derivable.

---

## 7. Reconciliation with the swarm ADR

[ADR-0004](adr/0004-heterogeneous-swarm.md) landed alongside this document and adds three
behaviours that touch the link layer. They compose with §1–§6 rather than replacing anything,
but the seams need stating or the firmware and the gateway will disagree.

### 7.1 WiFi fallback when the HEAD is gone

ADR-0004 §3: `LEAF → ESP-NOW → HEAD` normally; on HEAD loss the LEAF goes WiFi-direct to the
laptop; with no network at all it falls back to the flash buffer.

This is an *addition* to §3's channel re-acquisition, and the ordering matters:

```
1. bonded HEAD reachable?          -> ESP-NOW (cheapest, no association)
2. no ACK for kAckMissesBeforeRescan cycles
     -> re-scan channels 1..13 for a BEACON        (§3)
3. still nothing, and WiFi credentials are configured
     -> associate and POST /ingest directly, exactly as a HEAD does
4. no network at all
     -> keep buffering; this is the normal state, not an error
```

Step 3 costs the LEAF its power advantage, so it is a fallback and never the default. Note that
a LEAF on the WiFi path uses the *same* `POST /ingest` and the same records — the gateway cannot
tell, and must not care, which transport a record arrived over. That is the point of signing at
the source.

### 7.2 Multiple HEADs and RSSI selection

ADR-0004 §3: "heads emit heartbeats; leafs pick strongest RSSI." Our `BEACON` (§1, type `0x03`)
already serves this. Two clarifications:

- A LEAF that hears `BEACON`s from several HEADs during a scan bonds to the **strongest RSSI**,
  not the first heard.
- Re-bonding is allowed only on the re-acquisition path (§3 step 2), never mid-run, because
  switching HEADs while records are in flight splits the unacked set across two relays.

Either HEAD forwarding the same record is harmless — the gateway dedupes on `(dev, seq)` — so
the cost of a wrong choice is a retransmission, not a correctness failure.

### 7.3 Broadcast interval override vs. local adaptive policy

ADR-0004 §4 specifies a swarm behaviour: on an incident, broadcast `INTERVAL 30s→10s`, returning
to 60s when calm. §6 of this document specifies a *local* policy on each node.

**They are two layers, and the local one wins on the safe side:**

```
effectiveInterval = min(localAdaptiveInterval, broadcastOverrideInterval)
```

A broadcast can make a node sample *faster* than its local policy chose. It can never make one
sample slower than its local policy demands. This asymmetry is deliberate: a broadcast frame is
unauthenticated (§5), so accepting one that *reduces* evidence would hand an attacker a way to
blind the fleet with a single spoofed packet. Accepting one that increases evidence costs
battery and nothing else.

The override expires after 5 minutes without renewal, so a lost "back to calm" broadcast
degrades to fast sampling rather than to permanent silence.

### 7.4 Companion attestations are not link-layer business

ADR-0004 §1 puts CAM photo hashes, phone GPS and IMU data in companion attestations keyed by
`(dev, seq, digest)`, deliberately outside the canonical record. Nothing in this link protocol
carries them: the CAM and phone classes reach the gateway over WiFi/MQTT, not ESP-NOW (phones
have no ESP-NOW radio at all). If a companion attestation ever needs to cross the ESP-NOW link,
it gets its own frame type — it must never be smuggled inside a `RECORD` frame, which is defined
as exactly `canonical(90) ‖ sig(64)` and nothing else.
