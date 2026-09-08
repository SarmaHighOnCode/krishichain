# KrishiChain Wire Protocol v1

**This document is the contract between H1 (firmware) and S1 (gateway/contracts).**
It is frozen on Day 0. Golden test vectors live in `packages/core/fixtures/vectors.json`
and are asserted by **both** the C++ and the TypeScript test suites.

> **Invariant:** changing any byte of the canonical encoding requires bumping `v`,
> regenerating fixtures, and updating both implementations in the same PR. There is no
> such thing as a "small tweak" here — a mismatch costs a day and is invisible until
> integration.

---

## 1. The record

Every observation a node makes is one **record**. Records are the atoms of the system:
signed individually, chained per device, batched into Merkle trees, anchored on-chain.

### 1.1 Fields

| Field | Type | Bytes | Description |
|---|---|---|---|
| `v` | uint8 | 1 | Protocol version. `1`. |
| `dev` | bytes20 | 20 | Device address = `keccak256(pubkey_uncompressed[1:])[12:]` |
| `seq` | uint32 BE | 4 | Monotonic per device. Genesis = `0`. Never reused, never skipped. |
| `prev` | bytes32 | 32 | `digest` of record `seq-1`. Genesis = 32 zero bytes. |
| `ts` | uint64 BE | 8 | Unix seconds, the **device's belief** about the time. |
| `tsq` | uint8 | 1 | Time quality. `0` = never synced, `1` = NTP stale (> 1 h), `2` = NTP fresh. |
| `lot` | bytes16 | 16 | Lot ULID this record belongs to. All-zero = unbound. |
| `t` | int16 BE | 2 | Temperature, deci-°C. `254` = 25.4 °C. `-32768` = sensor fault. |
| `h` | uint16 BE | 2 | Relative humidity, deci-%. `655` = 65.5%. `0xFFFF` = sensor fault. |
| `lux` | uint16 BE | 2 | Ambient light, lux, clamped. Tamper signal inside a sealed box. |
| `flags` | uint8 | 1 | Bitfield, see §1.2. |
| `bat` | uint8 | 1 | Battery, percent 0–100. `0xFF` = mains powered. |
| | | **90** | **Total canonical payload** |

### 1.2 `flags` bitfield

| Bit | Name | Meaning |
|---|---|---|
| 0 | `LID_OPEN` | Lid/seal sensor reports open at capture time |
| 1 | `SHOCK` | Accelerometer threshold exceeded since the previous record |
| 2 | `SENSOR_FAULT` | At least one sensor returned a fault value |
| 3 | `BUFFERED` | Record was written to flash while offline, not sent live |
| 4 | `BOOT` | First record after a boot (power loss or reset happened) |
| 5 | `LOT_BOUND` | This record is the one that bound `lot` |
| 6 | `CAL` | This record is a calibration reading |
| 7 | reserved | Must be 0 |

`BOOT` matters: a power cut is not a chain gap, but it *is* something an auditor must see.

### 1.3 Canonical encoding

The canonical byte string is the **concatenation of the fields in exactly the table order of
§1.1, big-endian, with no padding, no delimiters and no field names**. 90 bytes, fixed length.

```
canonical = v ‖ dev ‖ seq ‖ prev ‖ ts ‖ tsq ‖ lot ‖ t ‖ h ‖ lux ‖ flags ‖ bat
digest    = keccak256(canonical)
sig       = secp256k1_sign_rfc6979(devicePrivKey, digest)   // 64 bytes: r ‖ s
```

Fixed-length canonical encoding is chosen deliberately over CBOR/JSON: there is exactly one
valid serialisation of a given record, so C++ and TypeScript cannot disagree, and the firmware
needs no serialiser at all — it writes a packed struct.

**Signature normalisation:** `s` MUST be in the lower half of the curve order
(`s <= n/2`); if not, the signer emits `n - s`. This eliminates signature malleability and makes
the digest→signature mapping one-to-one for deduplication.

---

## 2. The per-device hash chain

```
record[0].prev = 0x0000…0000
record[n].prev = keccak256(canonical(record[n-1]))
```

The gateway maintains `(last_seq, last_digest)` per device and enforces:

| Condition | Result |
|---|---|
| `seq == last_seq + 1` and `prev == last_digest` | **Accept** |
| `seq <= last_seq` | **Duplicate** — idempotent no-op if the digest matches, `CHAIN_FORK` incident if it does not |
| `seq > last_seq + 1` | **`CHAIN_GAP` incident.** Record is stored and marked `unverifiable_gap`; ingest continues |
| `prev != last_digest` at the right `seq` | **`CHAIN_FORK` incident.** The device is emitting a divergent history — quarantine and alert |

**Why this is the heart of the project:** signatures alone let an operator drop the inconvenient
readings and present a set of individually-valid records. The hash chain makes the *set* itself
attestable. An omission becomes a visible, on-record event rather than silence.

A `CHAIN_GAP` is never hidden. It surfaces on the ops dashboard and flips the consumer badge to
`UNVERIFIABLE`.

---

## 3. Uplink

### 3.1 Transport

`POST /ingest` — plain HTTP to the local gateway on the venue LAN. Confidentiality is not a
requirement (the payload is signed, not secret, and is destined for a public commitment);
integrity comes from the signature, not from TLS. Production deployments front the gateway with
TLS at the edge.

### 3.2 Request

The gateway accepts two equivalent wire formats for batches (up to 100 records per request):

1. **Canonical wire format (Firmware / Zero-Derive Relay)**: Nodes post raw canonical bytes and signatures directly without unpacking or re-encoding on device:
```jsonc
{
  "v": 1,
  "dev": "0x7f3a…c21b",
  "records": [
    {
      "canonical": "0x017f3a…", // 90-byte hex canonical record
      "sig": "0x<64 bytes r‖s>"
    }
  ]
}
```

2. **Exploded fields format (Simulators / Web tools)**:
```jsonc
{
  "v": 1,
  "dev": "0x7f3a…c21b",
  "records": [
    {
      "seq": 1042,
      "prev": "0x9c1e…",
      "ts": 1789012345,
      "tsq": 2,
      "lot": "0x018f2c…",
      "t": 41,          // 4.1 °C
      "h": 812,         // 81.2 %
      "lux": 0,
      "flags": 0,
      "bat": 87,
      "sig": "0x<64 bytes r‖s>"
    }
  ]
}
```

Batch size: up to 100 records per request. The node drains its buffer oldest-first and only
advances its read pointer after a `200`.

### 3.3 Response

```jsonc
{
  "accepted": 100,
  "rejected": [],
  "incidents": [],
  "ackSeq": 1141,        // node may free everything <= this
  "serverTs": 1789012400 // node uses this to re-derive clock offset
}
```

`ackSeq` is the whole flow-control mechanism: the node keeps records until acknowledged, so a
gateway crash mid-batch loses nothing.

### 3.4 Error semantics

| HTTP | Meaning | Node behaviour |
|---|---|---|
| 200 | Accepted (possibly with incidents) | Advance read pointer to `ackSeq` |
| 400 | Malformed | Log, drop the batch, raise `BOOT` flag on next record |
| 401 | Signature invalid or device not registered | **Stop uploading**, blink fault LED, keep buffering |
| 429 | Backpressure | Exponential backoff, 2 s → 60 s |
| 5xx / timeout | Gateway down | Keep buffering, retry with jitter |

Note the asymmetry: the node never deletes unacknowledged data on an error. Data loss is a worse
failure than duplication, because duplication is idempotent here and loss is permanent.

---

## 4. Merkle batching

Leaves are record digests. The tree uses **sorted-pair keccak256**, matching OpenZeppelin's
`MerkleProof` so proofs verify identically on-chain, in the gateway and in the browser.

```
leaf        = keccak256(canonical(record))          // 32 bytes
parent(a,b) = keccak256(min(a,b) ‖ max(a,b))
```

Odd node at a level is promoted unchanged to the next level.

A batch closes on **256 leaves or 60 seconds, whichever comes first**, then:

```solidity
BatchAnchor.anchor(bytes32 root, uint32 leafCount, bytes32 prevRoot)
```

`prevRoot` chains the anchors themselves, so a gateway operator cannot quietly omit an entire
batch — the anchor sequence has the same gap-detection property as the device chain, one level up.

### 4.1 Inclusion proof

```jsonc
{
  "digest": "0x4a1f…",
  "root":   "0x77b2…",
  "proof":  ["0x…", "0x…", "0x…"],
  "anchor": { "chainId": 80002, "txHash": "0x…", "blockNumber": 12345678 }
}
```

The consumer page verifies this **entirely client-side**: recompute the leaf from the displayed
record, walk the proof, compare to the root read straight from the chain via a public RPC. Our
server is never asked to vouch for anything.

---

## 5. Device commissioning payload

Signed once, at commissioning, with `flags.CAL` set:

```jsonc
{
  "dev": "0x7f3a…c21b",
  "pubkey": "0x04…",           // 65-byte uncompressed
  "class": "TRANSIT_V1",
  "firmwareHash": "0x…",       // keccak256 of the flashed binary
  "calibration": { "refTempC": 4.0, "readTempC": 4.3, "offsetDeciC": -3 },
  "sealId": "KC-SEAL-0042",
  "attestation": "0x<sig over keccak256 of the above>"
}
```

`firmwareHash` lets an auditor confirm which firmware produced a given record run — the missing
link in most "trusted sensor" claims.

---

## 6. Golden vectors

`packages/core/fixtures/vectors.json` holds, for each of ≥ 20 cases:

- the field values
- the expected 90-byte canonical hex
- the expected `digest`
- a fixed test private key and the expected deterministic `sig`
- for chain cases: expected accept/reject verdict and incident type

Cases must include: genesis, normal, negative temperature, sensor fault sentinels, lid-open,
buffered backlog, `tsq=0`, gap, fork, duplicate, malleable-`s` rejection, and an all-max-values
boundary record.

**Definition of done for FW-03 and GW-02:** both implementations pass every vector, byte for
byte. Neither side is allowed to "fix" a vector to make its own implementation pass; a vector
change is a protocol change.

> **Note on RFC 6979 Signature Interoperability:** C++ `micro-ecc` and TypeScript `@noble/curves` both implement deterministic RFC 6979 DSA/ECDSA nonce generation. Slight implementation variances in `bits2octets` padding bit manipulation between libraries can yield different 64-byte signature outputs (`sig`) for specific digest patterns. Cross-implementation signature byte-identity is neither guaranteed nor required for security; public key recovery and signature verification (`secp256k1_verify` / `recoverPublicKey`) are 100% interoperable and verified across both stacks.
