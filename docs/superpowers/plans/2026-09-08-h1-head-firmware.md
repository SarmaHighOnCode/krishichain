# H1 HEAD Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the KrishiChain HEAD node firmware — on-device signing, per-device hash chain, crash-safe flash buffer, ESP-NOW receive-and-forward from a LEAF node, heartbeat, and adaptive sampling — with the protocol layer proven against the golden vectors on the host before any board is involved.

**Architecture:** Two roles share one library (`lib/krishi`). The LEAF signs and buffers its own records and ships them over ESP-NOW; the HEAD does the same for its own sensors *and* relays the LEAF's records byte-for-byte to the gateway over WiFi, never re-signing them. Everything that can be pure is pure — encoding, hashing, signing, chain logic, ring buffer (behind a flash interface), frame codec, and the sampling policy all compile and test natively via `pio test -e native`. Only the ESP-NOW radio driver and the `esp_partition` flash backend need hardware.

**Tech Stack:** PlatformIO Core 6.1.19 · pioarduino `platform-espressif32@55.03.311` (Arduino-ESP32 3.3.11 / ESP-IDF 5.5.5) · C++17 · `kmackay/micro-ecc` for secp256k1 · vendored keccak256 + SHA-256 · Unity test framework · ArduinoJson (native tests only, to read the golden vectors).

**Spec:**
- [docs/PROTOCOL.md](../../PROTOCOL.md) — record format, frozen at v1
- [docs/PROTOCOL-LINK.md](../../PROTOCOL-LINK.md) — ESP-NOW frame formats, ACK semantics, heartbeat, adaptive sampling rules
- [docs/adr/0005-espnow-link-protocol.md](../../adr/0005-espnow-link-protocol.md) — the link, its costs and its accepted weaknesses
- [docs/adr/0004-heterogeneous-swarm.md](../../adr/0004-heterogeneous-swarm.md) — the device classes this plan's HEAD/LEAF roles come from
- [docs/adr/0001-device-side-signing.md](../../adr/0001-device-side-signing.md) — why signing lives on the device
- [docs/HARDWARE.md](../../HARDWARE.md) §3 — pin map

## Global Constraints

- **Platform:** `platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.311/platform-espressif32.zip`. The official `platformio/espressif32` is stuck on Arduino core 2.x and unmaintained; `pioarduino` is not in the PlatformIO registry, so it installs by release URL only.
- **Never edit `packages/core/fixtures/vectors.json`** to make firmware pass. It is the referee between C++ and TypeScript. If they disagree, the C++ is wrong. A vector change is a protocol change requiring a `v` bump and both implementations updated in one PR.
- **The record format is frozen at v1.** No link-layer requirement may add a field to the 90-byte canonical record.
- **The HEAD never re-signs a forwarded record.** It copies `canonical` and `sig` byte-for-byte. This is the entire point of ADR-0005.
- **No dynamic allocation** in the sample → encode → sign → buffer path. Fixed buffers only.
- **ESP-NOW frames ≤ 250 bytes** (v1-compatible). Largest frame in this design is 158.
- **Durability before transmission, always.** Append to the ring buffer, then send. Advance chain state only after the buffer write succeeds.
- **Analog inputs on ADC1 only** (GPIO 32–39). ADC2 is dead whenever WiFi is active.
- C++17. Commits use Conventional Commits with the ticket ID in the body.

## File Structure

```
firmware/
├── platformio.ini                    MODIFY  pioarduino platform; node-head / node-leaf envs
├── lib/krishi/
│   ├── record.{h,cpp}                exists, unchanged — canonical 90-byte codec
│   ├── roles.h                       CREATE  role macros + shared build-time config
│   ├── crypto/
│   │   ├── keccak256.{h,c}           CREATE  vendored; Ethereum padding (0x01), NOT SHA3
│   │   ├── sha256.{h,c}              CREATE  vendored; needed for RFC 6979 HMAC
│   │   └── signer.{h,cpp}            CREATE  micro-ecc wrapper, low-s, address derivation
│   ├── identity.{h,cpp}              MODIFY h, CREATE cpp — keygen + KeyStore
│   ├── chain.{h,cpp}                 CREATE cpp — seq/prev state machine
│   ├── store/
│   │   ├── flash_store.h             CREATE  erase/read/write interface
│   │   ├── esp_flash_store.cpp       CREATE  esp_partition backend (device only)
│   │   └── file_flash_store.{h,cpp}  CREATE  in-memory backend with fault injection (host)
│   ├── ringbuffer.{h,cpp}            CREATE cpp — 256-byte slots, CRC32, scan recovery
│   ├── link/
│   │   ├── frame.{h,cpp}             CREATE  pure frame codec
│   │   └── espnow.{h,cpp}            CREATE  radio driver + core 2.x/3.x callback shim
│   ├── sampling.{h,cpp}              CREATE  pure adaptive-interval policy
│   └── uplink.{h,cpp}                MODIFY h, CREATE cpp — per-device HTTP batching
├── node-head/src/main.cpp            CREATE  (replaces node-transit)
├── node-leaf/src/main.cpp            CREATE  (replaces node-farm)
└── test/
    ├── test_record/                  exists
    ├── test_crypto/                  CREATE
    ├── test_chain/                   CREATE
    ├── test_ringbuffer/              CREATE
    ├── test_frame/                   CREATE
    └── test_sampling/                CREATE
```

**Why this shape:** the two things that will actually cost you a day are (a) a canonical-encoding or signature mismatch with the TypeScript side, and (b) a ring buffer that loses data on a power cut. Both are made host-testable here — the flash backend is an interface precisely so torn writes and power cuts can be *simulated* in a unit test rather than discovered by pulling a USB cable 100 times.

---

## Task 1: Toolchain bump and HEAD/LEAF role split

Nothing else compiles until the platform is right, and the ESP-NOW callback signature depends on the Arduino core major version.

**Files:**
- Modify: `firmware/platformio.ini`
- Create: `firmware/lib/krishi/roles.h`
- Move: `firmware/node-transit/` → `firmware/node-head/`, `firmware/node-farm/` → `firmware/node-leaf/`
- Modify: `firmware/lib/krishi/pins.h` (rename the role macros)

**Interfaces:**
- Consumes: nothing
- Produces: build macros `KRISHI_ROLE_HEAD` / `KRISHI_ROLE_LEAF`; `krishi::kSampleIntervalMsDefault`; envs `node-head`, `node-leaf`, `native`

- [ ] **Step 1: Move the two node directories and update pin macros**

```bash
cd firmware
git mv node-transit node-head
git mv node-farm node-leaf
```

In `lib/krishi/pins.h` replace `KRISHI_NODE_FARM` with `KRISHI_ROLE_LEAF` and `KRISHI_NODE_TRANSIT` with `KRISHI_ROLE_HEAD` (three occurrences: the two `#if defined(...)` guards, and nothing else). Keep every pin assignment and every ESP32 trap comment exactly as-is.

- [ ] **Step 2: Rewrite `firmware/platformio.ini`**

```ini
; KrishiChain node firmware
;
;   pio run -e node-head -t upload      HEAD: WiFi uplink + ESP-NOW receiver
;   pio run -e node-leaf -t upload      LEAF: ESP-NOW only, never associates
;   pio test -e native                  host tests, no board required
;
; Platform: pioarduino, NOT platformio/espressif32.
; The official platform is pinned to Arduino core 2.x and is not being updated.
; We need core 3.x for the ESP-IDF 5.x ESP-NOW API. pioarduino is not in the
; PlatformIO registry, so it installs by release URL.

[platformio]
default_envs = node-head

[env]
platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.311/platform-espressif32.zip
board = esp32dev
framework = arduino
monitor_speed = 115200
board_build.partitions = partitions.csv
build_flags =
    -std=gnu++17
    -DKRISHI_PROTOCOL_VERSION=1
build_unflags = -std=gnu++11
lib_deps =
    kmackay/micro-ecc @ ^1.0

[env:node-head]
build_flags =
    ${env.build_flags}
    -DKRISHI_ROLE_HEAD

[env:node-leaf]
build_flags =
    ${env.build_flags}
    -DKRISHI_ROLE_LEAF

; Host tests. No Arduino, no radio — the pure protocol code only.
[env:native]
platform = native
build_flags =
    -std=gnu++17
    -DKRISHI_NATIVE
    -DKRISHI_PROTOCOL_VERSION=1
lib_deps =
    kmackay/micro-ecc @ ^1.0
    bblanchon/ArduinoJson @ ^7.2.0
lib_compat_mode = off
test_framework = unity
```

- [ ] **Step 3: Create `firmware/lib/krishi/roles.h`**

```cpp
#pragma once
/**
 * Build-time role configuration. See docs/adr/0005-espnow-link-protocol.md.
 *
 * LEAF: ESP-NOW only. Never associates to WiFi. Signs and buffers its own records.
 * HEAD: WiFi STA + ESP-NOW. Signs its own records AND relays the LEAF's, byte-for-byte.
 */

#include <stdint.h>

#if !defined(KRISHI_ROLE_HEAD) && !defined(KRISHI_ROLE_LEAF) && !defined(KRISHI_NATIVE)
#error "Define KRISHI_ROLE_HEAD or KRISHI_ROLE_LEAF"
#endif

namespace krishi {

constexpr uint32_t kSampleIntervalMsDefault = 30000;
constexpr uint32_t kHeartbeatIntervalMs = 30000;
constexpr uint32_t kBeaconIntervalMs = 5000;

/** Max records in one HTTP batch to the gateway (PROTOCOL.md §3.2). */
constexpr size_t kMaxUplinkBatch = 100;

/** Consecutive unacked send cycles before a LEAF re-scans for the HEAD's channel. */
constexpr uint8_t kAckMissesBeforeRescan = 3;

#if defined(KRISHI_ROLE_HEAD)
constexpr bool kIsHead = true;
constexpr bool kIsLeaf = false;
#elif defined(KRISHI_ROLE_LEAF)
constexpr bool kIsHead = false;
constexpr bool kIsLeaf = true;
#else
constexpr bool kIsHead = false;
constexpr bool kIsLeaf = false;
#endif

}  // namespace krishi
```

- [ ] **Step 4: Verify the platform resolves and both roles build**

```bash
cd firmware
pio pkg install -e node-head
pio run -e node-head
pio run -e node-leaf
```

Expected: both succeed. The first run downloads ~250 MB of toolchain; allow 5–10 minutes.

**If the platform URL fails to download** (venue firewall, GitHub outage), fall back to the official platform and accept Arduino core 2.x:
```ini
platform = espressif32@6.9.0
```
Task 8 contains a compile-time shim so the ESP-NOW callback compiles on both cores. Nothing else in this plan depends on core 3.x.

- [ ] **Step 5: Confirm the existing native tests still pass**

```bash
cd firmware && pio test -e native
```
Expected: `test_record` passes, as before the move.

- [ ] **Step 6: Commit**

```bash
git add firmware/
git commit -m "build(fw): pioarduino platform and HEAD/LEAF role split

H1. Moves node-transit -> node-head and node-farm -> node-leaf per
ADR-0005. Switches to pioarduino platform-espressif32@55.03.311
(Arduino 3.3.11 / IDF 5.5.5); the official platform is pinned to
core 2.x and we need the IDF 5.x ESP-NOW API."
```

---

## Task 2: Vendored keccak256, verified against the golden vectors

**Files:**
- Create: `firmware/lib/krishi/crypto/keccak256.h`, `firmware/lib/krishi/crypto/keccak256.c`
- Test: `firmware/test/test_crypto/test_keccak.cpp`

**Interfaces:**
- Consumes: `krishi::encodeRecord` (from `record.h`)
- Produces: `void keccak256(const uint8_t* data, size_t len, uint8_t out[32]);`

> **The trap:** Keccak-256 as used by Ethereum is **not** SHA3-256. They are the same permutation with a different domain-separation byte — Keccak pads with `0x01`, SHA3 pads with `0x06`. Using an off-the-shelf SHA3 implementation produces confident, plausible, entirely wrong digests that fail only when the gateway rejects every signature. There is no keccak library in the PlatformIO registry (verified), so this is vendored.

- [ ] **Step 1: Write the failing test**

`firmware/test/test_crypto/test_keccak.cpp`:

```cpp
#include <unity.h>
#include <cstring>
#include "../../lib/krishi/crypto/keccak256.h"

static void hexToBytes(const char* hex, uint8_t* out, size_t len) {
  if (hex[0] == '0' && hex[1] == 'x') hex += 2;
  for (size_t i = 0; i < len; ++i) {
    auto nib = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return 0;
    };
    out[i] = static_cast<uint8_t>(nib(hex[i * 2]) << 4 | nib(hex[i * 2 + 1]));
  }
}

// Canonical empty-input digest for Keccak-256. If this returns
// a7ffc6f8bf1ed766...  you have built SHA3-256 instead (wrong padding byte).
void test_keccak_empty_input() {
  uint8_t out[32];
  uint8_t expected[32];
  hexToBytes("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", expected, 32);
  keccak256(nullptr, 0, out);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 32);
}

void test_keccak_abc() {
  uint8_t out[32];
  uint8_t expected[32];
  hexToBytes("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45", expected, 32);
  keccak256(reinterpret_cast<const uint8_t*>("abc"), 3, out);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 32);
}

// Crosses the 136-byte rate boundary, which is where a broken absorb loop shows up.
void test_keccak_200_bytes() {
  uint8_t input[200];
  for (size_t i = 0; i < sizeof(input); ++i) input[i] = static_cast<uint8_t>(i);
  uint8_t out[32];
  keccak256(input, sizeof(input), out);
  // Digest must at least be stable and non-zero; the vector test in Step 5 is the real check.
  uint8_t zero[32] = {0};
  TEST_ASSERT_FALSE(memcmp(out, zero, 32) == 0);
}
```

Add a runner `main()` at the bottom of the file calling `UNITY_BEGIN()`, the three `RUN_TEST`s, and `UNITY_END()`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd firmware && pio test -e native -f test_crypto
```
Expected: compile error, `keccak256.h` not found.

- [ ] **Step 3: Vendor the implementation**

Create `firmware/lib/krishi/crypto/keccak256.h`:

```c
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Keccak-256 as used by Ethereum.
 *
 * NOT SHA3-256. Same permutation, different domain separator: Keccak pads with
 * 0x01, SHA3-256 pads with 0x06. Substituting one for the other yields digests
 * that look fine and verify nowhere.
 */
void keccak256(const uint8_t* data, size_t len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
```

Create `firmware/lib/krishi/crypto/keccak256.c` implementing the standard Keccak-f[1600] sponge: 24 rounds, rate 136 bytes (1088 bits) for 256-bit output, capacity 512 bits. Use the public-domain "tiny sha3" structure but with `0x01` as the pad byte. The implementation needs: the 24 round constants, the rotation offsets, `theta`/`rho`/`pi`/`chi`/`iota` steps, an absorb loop over 136-byte blocks, and the final pad (`0x01` at the byte after the message, `0x80` OR'd into the last byte of the rate block).

Keep it in C, not C++, and keep the state as `uint64_t st[25]` — this file is performance-relevant, it runs on every sample.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd firmware && pio test -e native -f test_crypto
```
Expected: 3 passing. **If `test_keccak_empty_input` returns `a7ffc6f8...`, the pad byte is `0x06` — change it to `0x01`.**

- [ ] **Step 5: Add the golden-vector digest test**

Append to `test_keccak.cpp` a test that, for every entry in `packages/core/fixtures/vectors.json`, encodes the record with `krishi::encodeRecord` and asserts `keccak256(canonical, 90) == vector.digest`. Reuse the `loadVectors()` / `hydrate()` helpers already written in `firmware/test/test_record/test_record.cpp` — extract them into `firmware/test/vectors_helper.h` and include from both test files rather than duplicating.

This test is worth more than the other three combined: it proves the encoder and the hash agree with the TypeScript side simultaneously.

- [ ] **Step 6: Run and commit**

```bash
cd firmware && pio test -e native -f test_crypto
git add firmware/lib/krishi/crypto/ firmware/test/
git commit -m "feat(fw): vendored keccak256 verified against golden vectors

H1-03. Ethereum keccak (0x01 pad), not SHA3-256 (0x06). No keccak
library exists in the PlatformIO registry. Digest of every golden
vector's canonical encoding now matches the TypeScript side."
```

---

## Task 3: secp256k1 signing — micro-ecc, low-s, address derivation

**Files:**
- Create: `firmware/lib/krishi/crypto/sha256.h`, `firmware/lib/krishi/crypto/sha256.c`
- Create: `firmware/lib/krishi/crypto/signer.h`, `firmware/lib/krishi/crypto/signer.cpp`
- Test: `firmware/test/test_crypto/test_signer.cpp`

**Interfaces:**
- Consumes: `keccak256`
- Produces:
  ```cpp
  namespace krishi {
  bool deriveAddress(const uint8_t publicKey[65], uint8_t out[20]);
  bool derivePublicKey(const uint8_t privateKey[32], uint8_t out[65]);
  bool signDigest(const uint8_t privateKey[32], const uint8_t digest[32], uint8_t sig[64]);
  bool isLowS(const uint8_t sig[64]);
  }
  ```

> SHA-256 is vendored (not taken from mbedTLS) so the host and device builds run byte-identical code. RFC 6979 uses HMAC-SHA256 to derive `k`; if host and device used different SHA implementations, a signature mismatch would be maddening to diagnose.

- [ ] **Step 1: Write the failing test**

`firmware/test/test_crypto/test_signer.cpp`:

```cpp
#include <unity.h>
#include "../../lib/krishi/crypto/signer.h"
#include "../vectors_helper.h"

// The fixed test key from packages/core/fixtures/vectors.json.
static const char* kTestKeyHex =
    "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";

void test_address_matches_vectors() {
  uint8_t priv[32], pub[65], addr[20], expected[20];
  hexToBytes(kTestKeyHex, priv, 32);
  TEST_ASSERT_TRUE(krishi::derivePublicKey(priv, pub));
  TEST_ASSERT_TRUE(krishi::deriveAddress(pub, addr));
  hexToBytes(vectorsDeviceAddress(), expected, 20);   // "testDeviceAddress"
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, addr, 20);
}

void test_public_key_is_uncompressed() {
  uint8_t priv[32], pub[65];
  hexToBytes(kTestKeyHex, priv, 32);
  krishi::derivePublicKey(priv, pub);
  TEST_ASSERT_EQUAL_UINT8(0x04, pub[0]);
}

void test_every_signature_is_low_s() {
  // High-s signatures are valid ECDSA but malleable, which breaks dedup on the gateway.
  uint8_t priv[32], digest[32], sig[64];
  hexToBytes(kTestKeyHex, priv, 32);
  for (int i = 0; i < 32; ++i) {
    for (int b = 0; b < 32; ++b) digest[b] = static_cast<uint8_t>(i * 31 + b);
    TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, sig));
    TEST_ASSERT_TRUE_MESSAGE(krishi::isLowS(sig), "signer emitted a high-s signature");
  }
}

void test_signing_is_deterministic() {
  uint8_t priv[32], digest[32], a[64], b[64];
  hexToBytes(kTestKeyHex, priv, 32);
  for (int i = 0; i < 32; ++i) digest[i] = static_cast<uint8_t>(i);
  TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, a));
  TEST_ASSERT_TRUE(krishi::signDigest(priv, digest, b));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(a, b, 64);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd firmware && pio test -e native -f test_crypto
```
Expected: compile error, `signer.h` not found.

- [ ] **Step 3: Vendor SHA-256 and implement the signer**

`sha256.c` — standard FIPS 180-4 SHA-256, exposing:

```c
typedef struct { uint32_t state[8]; uint64_t bitlen; uint8_t buf[64]; size_t buflen; } sha256_ctx;
void sha256_init(sha256_ctx* ctx);
void sha256_update(sha256_ctx* ctx, const uint8_t* data, size_t len);
void sha256_final(sha256_ctx* ctx, uint8_t out[32]);
```

`signer.cpp`:

```cpp
#include "signer.h"

#include <string.h>
#include <uECC.h>

#include "keccak256.h"
#include "sha256.h"

namespace krishi {
namespace {

// micro-ecc needs a hash context for RFC 6979 deterministic signing.
// `tmp` must be 2 * result_size + block_size = 2*32 + 64 = 128 bytes.
struct Sha256Context {
  uECC_HashContext uECC;
  sha256_ctx ctx;
};

void initHash(const uECC_HashContext* base) {
  sha256_init(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx);
}
void updateHash(const uECC_HashContext* base, const uint8_t* message, unsigned size) {
  sha256_update(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx,
                message, size);
}
void finishHash(const uECC_HashContext* base, uint8_t* hash) {
  sha256_final(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx, hash);
}

// secp256k1 group order n, and n/2. micro-ecc does NOT normalise s; we must.
const uint8_t kOrder[32] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
    0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B, 0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x41};
const uint8_t kHalfOrder[32] = {
    0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x5D, 0x57, 0x6E, 0x73, 0x57, 0xA4, 0x50, 0x1D, 0xDF, 0xE9, 0x2F, 0x46, 0x68, 0x1B, 0x20, 0xA0};

int cmp32(const uint8_t* a, const uint8_t* b) { return memcmp(a, b, 32); }

/** s = n - s, big-endian, in place. */
void negateS(uint8_t* s) {
  uint8_t out[32];
  int borrow = 0;
  for (int i = 31; i >= 0; --i) {
    int diff = static_cast<int>(kOrder[i]) - s[i] - borrow;
    borrow = diff < 0;
    out[i] = static_cast<uint8_t>(diff + (borrow ? 256 : 0));
  }
  memcpy(s, out, 32);
}

}  // namespace

bool isLowS(const uint8_t sig[64]) { return cmp32(sig + 32, kHalfOrder) <= 0; }

bool derivePublicKey(const uint8_t privateKey[32], uint8_t out[65]) {
  out[0] = 0x04;  // uncompressed prefix; uECC emits the bare 64-byte X||Y
  return uECC_compute_public_key(privateKey, out + 1, uECC_secp256k1()) != 0;
}

bool deriveAddress(const uint8_t publicKey[65], uint8_t out[20]) {
  if (publicKey[0] != 0x04) return false;
  uint8_t hash[32];
  // Drop the 0x04 prefix before hashing. Forgetting this slice is THE classic
  // device-identity bug: it yields a plausible address that never matches.
  keccak256(publicKey + 1, 64, hash);
  memcpy(out, hash + 12, 20);
  return true;
}

bool signDigest(const uint8_t privateKey[32], const uint8_t digest[32], uint8_t sig[64]) {
  uint8_t tmp[128];
  Sha256Context context;
  context.uECC.init_hash = &initHash;
  context.uECC.update_hash = &updateHash;
  context.uECC.finish_hash = &finishHash;
  context.uECC.block_size = 64;
  context.uECC.result_size = 32;
  context.uECC.tmp = tmp;

  if (!uECC_sign_deterministic(privateKey, digest, 32, &context.uECC, sig, uECC_secp256k1())) {
    return false;
  }
  if (!isLowS(sig)) negateS(sig + 32);
  return true;
}

}  // namespace krishi
```

- [ ] **Step 4: Run to verify the tests pass**

```bash
cd firmware && pio test -e native -f test_crypto
```
Expected: all passing, including `test_address_matches_vectors`.

- [ ] **Step 5: Check byte-identity against the golden vector signatures — this is a spike**

Add a test asserting that for every vector, `signDigest(testPrivateKey, vector.digest) == vector.signature`.

**If it passes:** excellent, keep it as a permanent test and note it in the commit.

**If it fails but the signature still verifies** (check with `uECC_verify`, and confirm on the TypeScript side with `npm test -w @krishichain/core` after feeding the firmware output through a scratch script): micro-ecc's RFC 6979 `bits2octets` handling differs from `@noble/curves`. This is a known family of discrepancy and **it is not a blocker**. Do this instead:

1. Downgrade the byte-identity assertion to a `TEST_IGNORE_MESSAGE` explaining why.
2. Keep `test_signing_is_deterministic` (same input → same output on *this* implementation) and `test_every_signature_is_low_s`.
3. Add a test that `uECC_verify(pub, digest, sig)` succeeds for every vector digest.
4. Tell S1 and update `docs/PROTOCOL.md` §6 to say byte-identical signatures are not a cross-implementation requirement — verification is.

Byte-identity was never load-bearing: the gateway deduplicates on `(deviceId, seq)`, not on signature bytes. Determinism on a single implementation is what protects against a replay looking like a fork, and that is preserved either way.

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/krishi/crypto/ firmware/test/test_crypto/
git commit -m "feat(fw): secp256k1 signing with low-s normalisation

H1-04. micro-ecc RFC 6979 deterministic signing over vendored SHA-256,
with s normalised to the lower half of the curve order (micro-ecc does
not do this) and address derived as keccak256(pubkey[1:])[12:]."
```

---

## Task 4: Device identity — keygen, storage, and a host-testable KeyStore

**Files:**
- Modify: `firmware/lib/krishi/identity.h`
- Create: `firmware/lib/krishi/identity.cpp`
- Test: `firmware/test/test_crypto/test_identity.cpp`

**Interfaces:**
- Consumes: `derivePublicKey`, `deriveAddress`, `signDigest`, `encodeRecord`, `keccak256`
- Produces:
  ```cpp
  namespace krishi {
  class KeyStore {                       // abstract; lets identity be tested on the host
   public:
    virtual ~KeyStore() = default;
    virtual bool load(uint8_t privateKey[32]) = 0;
    virtual bool save(const uint8_t privateKey[32]) = 0;
    virtual bool clear() = 0;
  };
  class MemoryKeyStore : public KeyStore { /* host tests */ };
  class NvsKeyStore : public KeyStore { /* device, Preferences-backed */ };

  class Identity {
   public:
    bool begin(KeyStore& store);
    bool wasCommissionedThisBoot() const;
    const uint8_t* address() const;      // 20 bytes
    const uint8_t* publicKey() const;    // 65 bytes
    bool sign(const uint8_t digest[32], uint8_t out[64]) const;
    bool signRecord(const Record& record, uint8_t out[64]) const;
    static void digest(const uint8_t* data, size_t len, uint8_t out[32]);
  };
  }
  ```

- [ ] **Step 1: Write the failing test**

```cpp
void test_first_boot_generates_and_persists() {
  krishi::MemoryKeyStore store;
  krishi::Identity a;
  TEST_ASSERT_TRUE(a.begin(store));
  TEST_ASSERT_TRUE(a.wasCommissionedThisBoot());

  uint8_t first[20];
  memcpy(first, a.address(), 20);

  krishi::Identity b;                       // simulates a reboot
  TEST_ASSERT_TRUE(b.begin(store));
  TEST_ASSERT_FALSE(b.wasCommissionedThisBoot());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(first, b.address(), 20);
}

void test_two_devices_get_different_identities() {
  krishi::MemoryKeyStore s1, s2;
  krishi::Identity a, b;
  a.begin(s1);
  b.begin(s2);
  TEST_ASSERT_FALSE(memcmp(a.address(), b.address(), 20) == 0);
}

void test_sign_record_matches_manual_digest_then_sign() {
  krishi::MemoryKeyStore store;
  krishi::Identity id;
  id.begin(store);

  krishi::Record record;
  memcpy(record.dev, id.address(), 20);
  record.seq = 7;

  uint8_t canonical[krishi::kCanonicalLength];
  krishi::encodeRecord(record, canonical, sizeof(canonical));
  uint8_t digest[32], expected[64], actual[64];
  krishi::Identity::digest(canonical, sizeof(canonical), digest);
  TEST_ASSERT_TRUE(id.sign(digest, expected));
  TEST_ASSERT_TRUE(id.signRecord(record, actual));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, actual, 64);
}
```

- [ ] **Step 2: Run to verify it fails** — `pio test -e native -f test_crypto`, expect link errors.

- [ ] **Step 3: Implement `identity.cpp`**

Key points:
- On device, entropy comes from `esp_random()` (hardware TRNG, valid once WiFi or the RF subsystem is initialised — call `begin()` after `WiFi.mode()`). On host, use a seeded PRNG guarded by `#ifdef KRISHI_NATIVE` and never compiled into a device build.
- Reject a generated key that is zero or ≥ n; regenerate. (`uECC_compute_public_key` fails on an invalid key — loop until it succeeds, max 16 attempts.)
- `NvsKeyStore` uses `Preferences` with namespace `"krishi"`, key `"pk"`, `putBytes`/`getBytes`.
- `begin()` must print the address and public key **once** when `wasCommissionedThisBoot()` is true, and must never print the private key under any build flag.
- Call `uECC_set_rng()` with a wrapper over `esp_random()` on device; micro-ecc needs it for key generation (not for deterministic signing).

- [ ] **Step 4: Run to verify the tests pass** — `pio test -e native -f test_crypto`

- [ ] **Step 5: Confirm the private key never reaches the serial log**

```bash
grep -rn "private_key_\|privateKey" firmware/lib/krishi/identity.cpp | grep -i "print\|Serial"
```
Expected: no matches. This is FW-01's acceptance criterion and it is easier to keep true than to make true later.

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/krishi/identity.* firmware/test/test_crypto/
git commit -m "feat(fw): device identity with host-testable KeyStore

H1-02. TRNG keygen on device, seeded PRNG on host behind KRISHI_NATIVE.
Key persists across reboots, never printed after commissioning."
```

---

## Task 5: Hash chain state machine

**Files:**
- Modify: `firmware/lib/krishi/chain.h`
- Create: `firmware/lib/krishi/chain.cpp`
- Test: `firmware/test/test_chain/test_chain.cpp`

**Interfaces:**
- Consumes: `Identity::digest`, `encodeRecord`
- Produces:
  ```cpp
  namespace krishi {
  class ChainStore {                       // same host/device split as KeyStore
   public:
    virtual ~ChainStore() = default;
    virtual bool load(uint32_t& nextSeq, uint8_t prevDigest[32]) = 0;
    virtual bool save(uint32_t nextSeq, const uint8_t prevDigest[32]) = 0;
  };
  class MemoryChainStore : public ChainStore {};
  class NvsChainStore : public ChainStore {};

  class Chain {
   public:
    bool begin(ChainStore& store);
    uint32_t nextSeq() const;
    const uint8_t* prevDigest() const;
    void stamp(Record& record) const;                    // fills seq and prev
    bool advance(const uint8_t digest[32]);              // persists, then bumps
  };
  }
  ```

- [ ] **Step 1: Write the failing test**

```cpp
void test_genesis_has_zero_seq_and_zero_prev() {
  krishi::MemoryChainStore store;
  krishi::Chain chain;
  chain.begin(store);
  krishi::Record record;
  chain.stamp(record);
  uint8_t zeros[32] = {0};
  TEST_ASSERT_EQUAL_UINT32(0, record.seq);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zeros, record.prev, 32);
}

// The whole run must reproduce the digests in the golden vectors' chain section.
void test_run_reproduces_golden_chain() {
  krishi::MemoryChainStore store;
  krishi::Chain chain;
  chain.begin(store);

  for (JsonObjectConst entry : vectorsChainRun()) {
    krishi::Record record = hydrate(entry["record"]);
    // seq/prev come from the chain, not from the fixture: that is what we are testing.
    krishi::Record stamped = record;
    chain.stamp(stamped);
    TEST_ASSERT_EQUAL_UINT32(record.seq, stamped.seq);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(record.prev, stamped.prev, 32);

    uint8_t canonical[krishi::kCanonicalLength], digest[32], expected[32];
    krishi::encodeRecord(record, canonical, sizeof(canonical));
    krishi::Identity::digest(canonical, sizeof(canonical), digest);
    hexToBytes(entry["digest"], expected, 32);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, digest, 32);
    chain.advance(digest);
  }
}

void test_reboot_resumes_at_the_right_seq() {
  krishi::MemoryChainStore store;
  {
    krishi::Chain chain;
    chain.begin(store);
    for (int i = 0; i < 5; ++i) {
      uint8_t digest[32];
      memset(digest, i, 32);
      chain.advance(digest);
    }
  }
  krishi::Chain resumed;                      // simulates a power cut
  resumed.begin(store);
  uint8_t last[32];
  memset(last, 4, 32);
  TEST_ASSERT_EQUAL_UINT32(5, resumed.nextSeq());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(last, resumed.prevDigest(), 32);
}
```

- [ ] **Step 2: Run to verify it fails** — `pio test -e native -f test_chain`

- [ ] **Step 3: Implement `chain.cpp`** — trivial state plus persistence; the only subtlety is that `advance()` must `save()` **before** updating the in-memory state, and return false if the save failed, so a failed persist never silently desynchronises RAM from flash.

- [ ] **Step 4: Run to verify the tests pass**

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/krishi/chain.* firmware/test/test_chain/
git commit -m "feat(fw): per-device hash chain state machine

H1-05. Reproduces the golden vectors' chain run digest-for-digest and
resumes at the correct seq after a simulated power cut."
```

---

## Task 6: Crash-safe flash ring buffer

The offline demo lives here. This is the task most likely to take longer than estimated; do not compress it.

**Files:**
- Create: `firmware/lib/krishi/store/flash_store.h`
- Create: `firmware/lib/krishi/store/file_flash_store.h`, `firmware/lib/krishi/store/file_flash_store.cpp`
- Create: `firmware/lib/krishi/store/esp_flash_store.cpp`
- Modify: `firmware/lib/krishi/ringbuffer.h`
- Create: `firmware/lib/krishi/ringbuffer.cpp`
- Test: `firmware/test/test_ringbuffer/test_ringbuffer.cpp`

**Interfaces:**
- Consumes: `encodeRecord`, `decodeRecord`
- Produces:
  ```cpp
  namespace krishi {
  class FlashStore {
   public:
    virtual ~FlashStore() = default;
    virtual size_t sectorSize() const = 0;       // 4096 on ESP32
    virtual size_t sectorCount() const = 0;
    virtual bool eraseSector(size_t sector) = 0;
    virtual bool write(size_t offset, const uint8_t* data, size_t len) = 0;
    virtual bool read(size_t offset, uint8_t* out, size_t len) const = 0;
  };

  class MemoryFlashStore : public FlashStore {   // host; supports fault injection
   public:
    MemoryFlashStore(size_t sectors, size_t sectorSize = 4096);
    void failNextWriteAfter(size_t bytes);       // simulates a power cut mid-write
    void setPowerCutPending(bool pending);
  };

  constexpr size_t kSlotSize = 256;
  constexpr size_t kSlotsPerSector = 16;         // 4096 / 256

  struct BufferStats { uint32_t count, capacity, oldestSeq, newestSeq, tornSlots, overwritten; };

  class RingBuffer {
   public:
    bool begin(FlashStore& flash);
    bool append(const Record& record, const uint8_t signature[64]);
    size_t peek(Record* records, uint8_t* signatures, size_t max) const;
    bool releaseThrough(const uint8_t dev[20], uint32_t ackSeq);
    bool isEmpty() const;
    BufferStats stats() const;
  };
  }
  ```

**Slot layout (256 bytes, 16 per 4096-byte sector):**

```
[ magic:2 = 0x4B52 | len:2 = 154 | canonical:90 | sig:64 | crc32:4 | state:1 | pad:93 ]
```

163 bytes used of 256. `state` is 0xFF = pending, 0x00 = released; it sits OUTSIDE the CRC (which covers bytes 2..157) because it is written after the fact. NOR flash lets a 1 bit become a 0 without an erase, so releasing a slot is a single-byte write. This is what makes per-device release possible: the HEAD buffer holds records from several devices and `seq` is per-device, so a bare ackSeq would release another node's data. The padding buys sector alignment, which is what makes erase-before-write tractable; at 2048 slots in a 512 KB partition that is 17 hours at 30 s and far longer once sampling is adaptive — well past the 720-record requirement (FW-06).

> **Policy decision, state it in the code comment:** when the buffer is full of unacknowledged records, the oldest is overwritten and `stats().overwritten` increments. Overwriting produces a `CHAIN_GAP` the gateway will detect and report. Refusing to record would produce silent blindness. **A detectable gap always beats an invisible hole** — and the counter means an operator sees it on the dashboard rather than discovering it in a dispute.

- [ ] **Step 1: Write the failing tests**

```cpp
void test_append_then_peek_returns_the_record() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  TEST_ASSERT_TRUE(buffer.begin(flash));
  TEST_ASSERT_TRUE(buffer.isEmpty());

  krishi::Record record;
  record.seq = 1;
  record.t = 41;
  uint8_t sig[64];
  memset(sig, 0xAB, sizeof(sig));
  TEST_ASSERT_TRUE(buffer.append(record, sig));

  krishi::Record out[4];
  uint8_t sigs[4 * 64];
  TEST_ASSERT_EQUAL_size_t(1, buffer.peek(out, sigs, 4));
  TEST_ASSERT_EQUAL_UINT32(1, out[0].seq);
  TEST_ASSERT_EQUAL_INT16(41, out[0].t);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(sig, sigs, 64);
}

void test_peek_does_not_consume() {
  // The tail advances ONLY on releaseThrough(). A gateway crash mid-batch must lose nothing.
  /* append 3, peek 3 twice, assert both return 3 */
}

void test_release_through_advances_the_tail() {
  /* append seq 0..9, releaseThrough(4), assert peek starts at seq 5 and count == 5 */
}

void test_recovery_after_reopen_finds_every_record() {
  /* append 20, destroy the RingBuffer, begin() again on the same flash,
     assert stats().count == 20 and peek returns them oldest-first */
}

void test_torn_write_is_skipped_not_fatal() {
  krishi::MemoryFlashStore flash(8);
  krishi::RingBuffer buffer;
  buffer.begin(flash);

  krishi::Record record;
  uint8_t sig[64] = {0};
  for (int i = 0; i < 5; ++i) { record.seq = i; buffer.append(record, sig); }

  flash.failNextWriteAfter(80);            // power cut 80 bytes into slot 5
  record.seq = 5;
  buffer.append(record, sig);

  krishi::RingBuffer recovered;            // reboot
  TEST_ASSERT_TRUE(recovered.begin(flash));
  TEST_ASSERT_EQUAL_UINT32(5, recovered.stats().count);      // the 5 good ones
  TEST_ASSERT_EQUAL_UINT32(1, recovered.stats().tornSlots);  // and we SAW the bad one
}

void test_wraparound_overwrites_oldest_and_counts_it() {
  /* 2 sectors = 32 slots; append 40; assert count == 32, overwritten == 8,
     and oldestSeq == 8 */
}
```

- [ ] **Step 2: Run to verify they fail** — `pio test -e native -f test_ringbuffer`

- [ ] **Step 3: Implement `MemoryFlashStore`**

Backed by a `std::vector<uint8_t>` initialised to `0xFF`. `write()` must emulate NOR flash: it may only clear bits, so `data[i] &= incoming[i]`; writing to a non-erased byte silently corrupts, exactly like real flash. `failNextWriteAfter(n)` writes `n` bytes then returns false, leaving a partial slot — that is the torn write.

- [ ] **Step 4: Implement `ringbuffer.cpp`**

- `begin()` scans every slot; a slot is valid iff `magic == 0x4B52`, `len == 154`, and CRC32 over the first 158 bytes matches. Track the highest contiguous `seq` for the head and the lowest for the tail.
- `append()` computes the target slot; if it is the first slot of a sector, `eraseSector()` first (this is where `overwritten` increments if the erased sector held unreleased slots).
- Write order within a slot: **payload and CRC first, magic last.** A slot whose magic is present is a slot whose body is complete. This is what makes a torn write detectable rather than ambiguous.
- `releaseThrough()` only moves the tail pointer; it does not erase. Erasure happens lazily on the next wrap into that sector.

- [ ] **Step 5: Run to verify the tests pass** — `pio test -e native -f test_ringbuffer`

- [ ] **Step 6: Implement `esp_flash_store.cpp`** (guarded by `#ifndef KRISHI_NATIVE`)

```cpp
const esp_partition_t* partition = esp_partition_find_first(
    ESP_PARTITION_TYPE_DATA, static_cast<esp_partition_subtype_t>(0x40), "krishibuf");
```
Then `esp_partition_erase_range` (4096-aligned), `esp_partition_write`, `esp_partition_read`. Return false rather than aborting if the partition is missing — a HEAD with a bad partition table should report a fault state, not boot-loop.

- [ ] **Step 7: Verify it builds for the device**

```bash
cd firmware && pio run -e node-head
```

- [ ] **Step 8: Commit**

```bash
git add firmware/lib/krishi/store/ firmware/lib/krishi/ringbuffer.* firmware/test/test_ringbuffer/
git commit -m "feat(fw): crash-safe flash ring buffer behind a FlashStore interface

H1-06. 256-byte slots, 16 per sector, CRC32-validated, magic written
last so torn writes are detectable. MemoryFlashStore emulates NOR
semantics and injects power cuts, so recovery is unit-tested rather
than discovered by pulling a USB cable."
```

---

## Task 7: Link frame codec

Pure, allocation-free, fully host-testable. Building this before touching the radio means that when ESP-NOW misbehaves you already know the parser is correct, which halves the search space.

**Files:**
- Create: `firmware/lib/krishi/link/frame.h`, `firmware/lib/krishi/link/frame.cpp`
- Create: `firmware/lib/krishi/endian.h` (lifted from `record.cpp`, see Step 3)
- Test: `firmware/test/test_frame/test_frame.cpp`

**Interfaces:**
- Consumes: `kCanonicalLength`, `kSignatureLength`, `kAddressLength` (from `record.h`)
- Produces:
  ```cpp
  namespace krishi {
  constexpr uint8_t kFrameMagic = 0x4B;
  constexpr uint8_t kLinkVersion = 0x01;
  constexpr size_t kFrameHeaderLength = 4;
  constexpr size_t kMaxFrameLength = 250;

  enum FrameType : uint8_t {
    kFrameRecord = 0x01, kFrameAck = 0x02, kFrameBeacon = 0x03,
    kFrameHeartbeat = 0x04, kFrameTimesync = 0x05,
  };

  struct RecordFrame    { uint8_t canonical[90]; uint8_t sig[64]; };
  struct AckFrame       { uint8_t dev[20]; uint32_t ackSeq; uint64_t serverTs; };
  struct BeaconFrame    { uint8_t headDev[20]; uint8_t channel; uint32_t uptimeS; };
  struct HeartbeatFrame { uint8_t dev[20]; uint32_t lastSeq; uint16_t bufDepth;
                          uint8_t bat; uint8_t state; };
  struct TimesyncFrame  { uint64_t unixSeconds; uint8_t tsq; };

  size_t encodeRecordFrame(const RecordFrame&, uint8_t* out, size_t cap);
  size_t encodeAckFrame(const AckFrame&, uint8_t* out, size_t cap);
  size_t encodeBeaconFrame(const BeaconFrame&, uint8_t* out, size_t cap);
  size_t encodeHeartbeatFrame(const HeartbeatFrame&, uint8_t* out, size_t cap);
  size_t encodeTimesyncFrame(const TimesyncFrame&, uint8_t* out, size_t cap);

  /** Returns the FrameType, or 0 if the frame is not ours / malformed. */
  uint8_t frameType(const uint8_t* frame, size_t len);
  bool decodeRecordFrame(const uint8_t* frame, size_t len, RecordFrame& out);
  bool decodeAckFrame(const uint8_t* frame, size_t len, AckFrame& out);
  bool decodeBeaconFrame(const uint8_t* frame, size_t len, BeaconFrame& out);
  bool decodeHeartbeatFrame(const uint8_t* frame, size_t len, HeartbeatFrame& out);
  bool decodeTimesyncFrame(const uint8_t* frame, size_t len, TimesyncFrame& out);
  }
  ```

- [ ] **Step 1: Write the failing tests**

```cpp
void test_record_frame_round_trips() {
  krishi::RecordFrame in;
  for (int i = 0; i < 90; ++i) in.canonical[i] = static_cast<uint8_t>(i);
  for (int i = 0; i < 64; ++i) in.sig[i] = static_cast<uint8_t>(0xC0 + i);

  uint8_t frame[krishi::kMaxFrameLength];
  size_t len = krishi::encodeRecordFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_size_t(158, len);                  // 4 header + 154 payload
  TEST_ASSERT_EQUAL_UINT8(krishi::kFrameRecord, krishi::frameType(frame, len));

  krishi::RecordFrame out;
  TEST_ASSERT_TRUE(krishi::decodeRecordFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.canonical, out.canonical, 90);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(in.sig, out.sig, 64);
}

void test_every_frame_fits_espnow_v1_limit() {
  uint8_t frame[300];
  krishi::RecordFrame r{};
  krishi::AckFrame a{};
  krishi::BeaconFrame b{};
  krishi::HeartbeatFrame h{};
  krishi::TimesyncFrame t{};
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeRecordFrame(r, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeAckFrame(a, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeBeaconFrame(b, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeHeartbeatFrame(h, frame, sizeof(frame)));
  TEST_ASSERT_LESS_OR_EQUAL_size_t(250, krishi::encodeTimesyncFrame(t, frame, sizeof(frame)));
}

void test_ack_frame_round_trips_big_endian() {
  krishi::AckFrame in{};
  memset(in.dev, 0xAB, 20);
  in.ackSeq = 0x01020304;
  in.serverTs = 0x0102030405060708ULL;

  uint8_t frame[64];
  size_t len = krishi::encodeAckFrame(in, frame, sizeof(frame));
  TEST_ASSERT_EQUAL_UINT8(0x01, frame[4 + 20]);        // ackSeq MSB first
  krishi::AckFrame out{};
  TEST_ASSERT_TRUE(krishi::decodeAckFrame(frame, len, out));
  TEST_ASSERT_EQUAL_UINT32(in.ackSeq, out.ackSeq);
  TEST_ASSERT_EQUAL_UINT64(in.serverTs, out.serverTs);
}

// A stray frame from an unrelated ESP-NOW project on the same channel must never
// reach the parser. A venue will have several.
void test_foreign_frames_are_rejected() {
  uint8_t junk[32] = {0};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(junk, sizeof(junk)));

  uint8_t wrongMagic[32] = {0x00, 0x01, 0x01, 0x02};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(wrongMagic, sizeof(wrongMagic)));

  uint8_t wrongVersion[32] = {0x4B, 0x02, 0x01, 0x02};
  TEST_ASSERT_EQUAL_UINT8(0, krishi::frameType(wrongVersion, sizeof(wrongVersion)));

  uint8_t truncated[6] = {0x4B, 0x01, 0x01, 154, 0x00, 0x00};   // len field lies
  krishi::RecordFrame out;
  TEST_ASSERT_FALSE(krishi::decodeRecordFrame(truncated, sizeof(truncated), out));
}

void test_encode_refuses_a_short_buffer() {
  krishi::RecordFrame r{};
  uint8_t tiny[10];
  TEST_ASSERT_EQUAL_size_t(0, krishi::encodeRecordFrame(r, tiny, sizeof(tiny)));
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd firmware && pio test -e native -f test_frame
```
Expected: compile error, `frame.h` not found.

- [ ] **Step 3: Extract the endian helpers, then implement `frame.cpp`**

`record.cpp` already has `put16`/`put32`/`put64`/`get16`/`get32`/`get64` in an anonymous namespace. Move them into `firmware/lib/krishi/endian.h` as `inline` functions in `namespace krishi::endian`, and include from both `record.cpp` and `frame.cpp`. Writing a second copy is how the two files drift apart.

Every decode must check, in this order: total length >= 4, `magic`, `ver`, `type`, and finally `4 + len == actual length`. Return false on the first failure.

- [ ] **Step 4: Run to verify they pass**

```bash
cd firmware && pio test -e native -f test_frame && pio test -e native -f test_record
```
Expected: both pass. Re-running `test_record` catches an endian-extraction mistake immediately.

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/krishi/link/frame.* firmware/lib/krishi/endian.h firmware/lib/krishi/record.cpp firmware/test/test_frame/
git commit -m "feat(fw): ESP-NOW link frame codec

H1-14. Pure, host-tested codec for RECORD/ACK/BEACON/HEARTBEAT/TIMESYNC
per docs/PROTOCOL-LINK.md. Largest frame is 158 bytes, inside the
ESP-NOW v1 250-byte limit. Endian helpers lifted to endian.h so the
record and frame codecs cannot drift."
```

---

## Task 8: ESP-NOW transport — channel acquisition and receive

The first task that needs hardware. Everything it depends on is already proven on the host.

**Files:**
- Create: `firmware/lib/krishi/link/espnow.h`, `firmware/lib/krishi/link/espnow.cpp`
- Create: `hardware/LINK-TEST.md`
- Test: manual, on two boards

**Interfaces:**
- Consumes: `frame.h`, `roles.h`
- Produces:
  ```cpp
  namespace krishi {
  struct ReceivedFrame { uint8_t mac[6]; uint8_t data[kMaxFrameLength]; uint8_t len; };

  class EspNowLink {
   public:
    bool beginHead(uint8_t channel);      // call AFTER WiFi association
    bool beginLeaf();                     // scans for a BEACON, then locks the channel
    bool addPeer(const uint8_t mac[6], uint8_t channel, bool encrypt);
    bool send(const uint8_t mac[6], const uint8_t* frame, size_t len);
    bool broadcast(const uint8_t* frame, size_t len);
    bool pop(ReceivedFrame& out);         // drain from loop(), never from the callback
    uint8_t channel() const;
    uint32_t droppedForeign() const;
    uint32_t queueOverflows() const;
  };
  }
  ```

> **Two traps, both silent:**
>
> 1. **The receive callback runs in the WiFi task.** Doing flash writes, HTTP, or anything slow inside it will stall the radio or panic. The callback must only `memcpy` into a fixed ring and return. All real work happens in `loop()` via `pop()`.
> 2. **ESP-NOW must use the same channel as the associated AP.** On the HEAD, init ESP-NOW *after* `WiFi.begin()` succeeds and pass `WiFi.channel()`. On the LEAF, `WiFi.mode(WIFI_STA)` then `WiFi.disconnect()` — the radio must be on but never associated — then scan for a BEACON.

- [ ] **Step 1: Write the Arduino-core compatibility shim**

Top of `espnow.h`:

```cpp
#include <esp_now.h>
#include <esp_wifi.h>
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif

// Arduino-ESP32 3.x (ESP-IDF 5.x) changed the receive callback signature from
// (const uint8_t* mac, ...) to (const esp_now_recv_info_t* info, ...).
// We target 3.x via pioarduino, but this shim keeps the espressif32@6.9.0
// fallback compiling if the platform cannot be downloaded (Task 1, Step 4).
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
#define KRISHI_RECV_FN(fn) \
  void fn(const esp_now_recv_info_t* src, const uint8_t* data, int len)
#define KRISHI_SRC_MAC(src) ((src)->src_addr)
#else
#define KRISHI_RECV_FN(fn) void fn(const uint8_t* src, const uint8_t* data, int len)
#define KRISHI_SRC_MAC(src) (src)
#endif
```

- [ ] **Step 2: Implement the callback and the receive queue**

```cpp
namespace {
constexpr size_t kRxQueueSize = 16;
volatile size_t rxHead = 0;
volatile size_t rxTail = 0;
ReceivedFrame rxQueue[kRxQueueSize];
volatile uint32_t droppedForeign_ = 0;
volatile uint32_t queueOverflows_ = 0;
}  // namespace

KRISHI_RECV_FN(onEspNowRecv) {
  // WiFi task context. memcpy and return. Nothing else. No Serial, no flash, no HTTP.
  if (len <= 0 || static_cast<size_t>(len) > kMaxFrameLength) return;
  if (frameType(data, static_cast<size_t>(len)) == 0) { droppedForeign_++; return; }

  const size_t next = (rxHead + 1) % kRxQueueSize;
  if (next == rxTail) { queueOverflows_++; return; }   // full: drop newest, and COUNT it

  memcpy(rxQueue[rxHead].mac, KRISHI_SRC_MAC(src), 6);
  memcpy(rxQueue[rxHead].data, data, static_cast<size_t>(len));
  rxQueue[rxHead].len = static_cast<uint8_t>(len);
  rxHead = next;
}
```

`queueOverflows()` and `droppedForeign()` get surfaced on the dashboard. A silently lossy radio queue is exactly the kind of thing that makes a demo mysteriously flaky at hour 40.

- [ ] **Step 3: Implement `beginHead()`**

```
esp_now_init()
esp_now_register_recv_cb(onEspNowRecv)
esp_now_register_send_cb(onEspNowSent)       // track per-peer failure counts
esp_now_set_pmk(kPmk)                         // 16-byte build-time constant
add the broadcast peer FF:FF:FF:FF:FF:FF on `channel`, unencrypted
```

Broadcast peers cannot be encrypted — that is fine, BEACON carries no authority, only a channel hint.

- [ ] **Step 4: Implement `beginLeaf()` — channel scan**

```
WiFi.mode(WIFI_STA); WiFi.disconnect();      // radio up, never associated
if NVS holds {headMac, channel}:
    esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE)
    addPeer(headMac, channel, encrypt=true)
    return true
for ch in 1..13:
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE)
    listen 200 ms for a BEACON frame
    on BEACON: persist {headMac, channel}; addPeer(...); return true
return false
```

**`beginLeaf()` returning false must not stop `loop()` from capturing and buffering.** Losing the link is never a reason to stop recording — that inversion is the whole point of the ring buffer.

- [ ] **Step 5: Manual two-board test, recorded in `hardware/LINK-TEST.md`**

| Check | Pass criterion |
|---|---|
| Channel acquisition | LEAF locks within 5 s of HEAD boot |
| Frame integrity | A RECORD sent by LEAF arrives at HEAD's `pop()` byte-identical |
| HEAD outage | With HEAD powered off, LEAF keeps buffering; re-acquires within 15 s of its return |
| Foreign traffic | `droppedForeign()` counts stray frames on a busy 2.4 GHz band without misparsing any |
| Range | Note the distance at which delivery degrades — feeds the pitch |

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/krishi/link/espnow.* hardware/LINK-TEST.md
git commit -m "feat(fw): ESP-NOW transport with channel acquisition

H1-15. Callback does memcpy-and-return into a fixed ring; all work
happens in loop(). HEAD inits after association and beacons its
channel; LEAF scans 1-13 and locks, and keeps buffering when the link
is down. Compile-time shim covers the Arduino core 2.x/3.x callback
signature change."
```

---

## Task 9: HEAD forward-and-uplink — per-device batching and ACK fan-out

**Files:**
- Modify: `firmware/lib/krishi/uplink.h`
- Create: `firmware/lib/krishi/uplink.cpp`
- Test: `firmware/test/test_uplink/test_grouping.cpp`

**Interfaces:**
- Consumes: `RingBuffer::peek`, `RingBuffer::releaseThrough(dev, ackSeq)`, `EspNowLink::send`, `frame.h`
- Produces:
  ```cpp
  namespace krishi {
  enum class UplinkResult { kOk, kNoNetwork, kMalformed, kUnauthorised, kBackoff, kServerError };
  struct UplinkResponse { UplinkResult result; uint32_t ackSeq; uint64_t serverTs; uint32_t accepted; };

  /** Pure: splits a mixed-device peek into contiguous per-device runs. Host-tested. */
  size_t groupByDevice(const Record* records, size_t count,
                       size_t* runStarts, size_t* runLengths, size_t maxRuns);

  class Uplink {
   public:
    bool begin(const char* gatewayUrl);
    UplinkResponse sendBatch(const uint8_t* canonicalBlock, const uint8_t* signatureBlock,
                             size_t count, const uint8_t dev[20]);
    bool isOnline() const;
    uint32_t backoffMs() const;
  };
  }
  ```

> **The forwarding invariant, restated because this is the file where it would be violated:** the HEAD serialises the `canonical` bytes it received and the `sig` it received. Note that `sendBatch` takes raw byte blocks, not `Record` structs — deliberately. If it took structs and re-encoded them, a future protocol field the HEAD's `record.h` did not know about would be silently dropped and every forwarded signature would break. **Forward the bytes.** And never call `Identity::sign` for a record whose `dev` is not our own address.

- [ ] **Step 1: Write the failing test for grouping**

```cpp
void test_groups_mixed_devices_into_runs() {
  krishi::Record records[6];
  uint8_t devA[20], devB[20];
  memset(devA, 0xAA, 20);
  memset(devB, 0xBB, 20);
  // A A B B B A -> three runs. peek() returns buffer order, not device order.
  const uint8_t* pattern[6] = {devA, devA, devB, devB, devB, devA};
  for (int i = 0; i < 6; ++i) memcpy(records[i].dev, pattern[i], 20);

  size_t starts[8], lengths[8];
  size_t runs = krishi::groupByDevice(records, 6, starts, lengths, 8);
  TEST_ASSERT_EQUAL_size_t(3, runs);
  TEST_ASSERT_EQUAL_size_t(0, starts[0]);  TEST_ASSERT_EQUAL_size_t(2, lengths[0]);
  TEST_ASSERT_EQUAL_size_t(2, starts[1]);  TEST_ASSERT_EQUAL_size_t(3, lengths[1]);
  TEST_ASSERT_EQUAL_size_t(5, starts[2]);  TEST_ASSERT_EQUAL_size_t(1, lengths[2]);
}

void test_single_device_is_one_run() {
  krishi::Record records[5];
  uint8_t dev[20];
  memset(dev, 0xCC, 20);
  for (int i = 0; i < 5; ++i) memcpy(records[i].dev, dev, 20);
  size_t starts[4], lengths[4];
  TEST_ASSERT_EQUAL_size_t(1, krishi::groupByDevice(records, 5, starts, lengths, 4));
  TEST_ASSERT_EQUAL_size_t(5, lengths[0]);
}

void test_empty_input_is_zero_runs() {
  size_t starts[4], lengths[4];
  TEST_ASSERT_EQUAL_size_t(0, krishi::groupByDevice(nullptr, 0, starts, lengths, 4));
}

void test_run_count_is_capped_at_maxruns() {
  // Alternating devices with maxRuns=2 must stop at 2 rather than overflow the caller's array.
  krishi::Record records[6];
  for (int i = 0; i < 6; ++i) memset(records[i].dev, i % 2 ? 0xAA : 0xBB, 20);
  size_t starts[2], lengths[2];
  TEST_ASSERT_EQUAL_size_t(2, krishi::groupByDevice(records, 6, starts, lengths, 2));
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd firmware && pio test -e native -f test_uplink
```

- [ ] **Step 3: Implement `groupByDevice`, then run to verify it passes**

A linear scan comparing each record's `dev` with the previous one, stopping at `maxRuns`.

- [ ] **Step 4: Implement `sendBatch`**

Build the JSON body per PROTOCOL.md §3.2 into a fixed `char` buffer. **No `String`, no ArduinoJson on device** — the shape is static and heap fragmentation over a three-day run is a real failure mode. Map HTTP status to `UplinkResult` exactly as PROTOCOL.md §3.4 specifies, and honour the asymmetry: never discard unacknowledged data on an error.

- [ ] **Step 5: Implement the HEAD uplink cycle**

```
peek up to kMaxUplinkBatch records (mixed devices) from the ring buffer
groupByDevice(...)
for each run:
    response = sendBatch(canonicalBlock + start, signatureBlock + start, length, dev)
    switch response.result:
      kOk:
          ringBuffer.releaseThrough(dev, response.ackSeq)
          if dev != identity.address():
              link.send(bondedMacFor(dev), encodeAckFrame({dev, ackSeq, serverTs}))
      kUnauthorised:
          mark the device faulted; do NOT ack; KEEP the data
          // Silently dropping an unregistered device's records would hide the
          // misconfiguration, which is the opposite of what this system is for.
      default:
          keep everything, apply backoff
```

- [ ] **Step 6: Verify the device build, run the tests, and commit**

```bash
cd firmware && pio run -e node-head && pio test -e native -f test_uplink
git add firmware/lib/krishi/uplink.* firmware/test/test_uplink/
git commit -m "feat(fw): HEAD per-device uplink batching and ACK fan-out

H1-07/H1-16. One POST per device keeps ingest v1 frozen. Forwarded
records are serialised from the bytes received, never re-encoded or
re-signed (ADR-0005). ACK frames let a LEAF free its buffer only after
the gateway has actually accepted the records."
```

---

## Task 10: Heartbeat

**Files:**
- Create: `firmware/lib/krishi/heartbeat.h`, `firmware/lib/krishi/heartbeat.cpp`
- Test: `firmware/test/test_heartbeat/test_heartbeat.cpp`
- **Depends on gateway ticket S1-14** (`POST /heartbeat`). Tell S1 when this task starts; the firmware side is fully testable before the endpoint exists.

**Interfaces:**
- Consumes: `frame.h`, `EspNowLink`, `RingBuffer::stats`
- Produces:
  ```cpp
  namespace krishi {
  struct NodeLiveness { uint8_t dev[20]; uint32_t lastSeq; uint16_t bufDepth;
                        uint8_t bat; uint8_t state; uint32_t ageMs; };
  class HeartbeatTracker {
   public:
    void observe(const HeartbeatFrame& frame, uint32_t nowMs);
    size_t snapshot(NodeLiveness* out, size_t max, uint32_t nowMs) const;
    bool isStale(const uint8_t dev[20], uint32_t nowMs, uint32_t timeoutMs) const;
  };
  }
  ```

> **A heartbeat is not evidence.** It is unsigned, it is in no hash chain, and it must never be rendered as a sensor reading or stored alongside records. It exists so the dashboard can tell "quiet because nothing is happening" from "dead" — which matters much more once sampling is adaptive and a healthy node may legitimately stay silent for five minutes. Everything a heartbeat claims is unauthenticated. Never let one influence a verdict. The entire project exists because someone trusted an unsigned reading.

- [ ] **Step 1: Write the failing tests**

```cpp
void test_tracker_records_liveness() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  frame.lastSeq = 42;
  frame.bufDepth = 7;
  tracker.observe(frame, 1000);

  krishi::NodeLiveness out[4];
  TEST_ASSERT_EQUAL_size_t(1, tracker.snapshot(out, 4, 1500));
  TEST_ASSERT_EQUAL_UINT32(42, out[0].lastSeq);
  TEST_ASSERT_EQUAL_UINT16(7, out[0].bufDepth);
  TEST_ASSERT_EQUAL_UINT32(500, out[0].ageMs);
}

void test_node_goes_stale_after_the_timeout() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  tracker.observe(frame, 1000);
  TEST_ASSERT_FALSE(tracker.isStale(frame.dev, 60000, 90000));
  TEST_ASSERT_TRUE(tracker.isStale(frame.dev, 200000, 90000));
}

void test_repeat_heartbeats_update_rather_than_duplicate() {
  krishi::HeartbeatTracker tracker;
  krishi::HeartbeatFrame frame{};
  memset(frame.dev, 0xAA, 20);
  frame.lastSeq = 1;
  tracker.observe(frame, 1000);
  frame.lastSeq = 9;
  tracker.observe(frame, 2000);

  krishi::NodeLiveness out[4];
  TEST_ASSERT_EQUAL_size_t(1, tracker.snapshot(out, 4, 2000));
  TEST_ASSERT_EQUAL_UINT32(9, out[0].lastSeq);
}

void test_unknown_device_is_stale() {
  krishi::HeartbeatTracker tracker;
  uint8_t unknown[20];
  memset(unknown, 0xFF, 20);
  TEST_ASSERT_TRUE(tracker.isStale(unknown, 1000, 90000));
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd firmware && pio test -e native -f test_heartbeat
```

- [ ] **Step 3: Implement the tracker**

A fixed array of at most 8 entries matched on `dev`. No allocation. A ninth node evicts the stalest entry rather than being dropped.

- [ ] **Step 4: Run to verify they pass, then wire the emitters**

- LEAF: every `kHeartbeatIntervalMs`, send a `HEARTBEAT` frame to the bonded HEAD **regardless of the current sampling interval**. Heartbeat cadence being independent of sampling cadence is the entire point.
- HEAD: every `kHeartbeatIntervalMs`, `POST /heartbeat` with its own liveness plus `tracker.snapshot(...)`.

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/krishi/heartbeat.* firmware/test/test_heartbeat/
git commit -m "feat(fw): node heartbeat and liveness tracking

H1-17. Unsigned, non-evidential liveness so the dashboard can tell a
quiet adaptive-sampling node from a dead one. Kept strictly out of the
record path per docs/PROTOCOL-LINK.md section 5."
```

---

## Task 11: Adaptive sampling interval

A pure policy function with no I/O, so every rule in PROTOCOL-LINK §6 becomes a unit test. Build it here rather than inline in `loop()`, where it would be untestable and would quietly rot. Fully self-contained — a good task to run in parallel or to slot in while a toolchain downloads.

**Files:**
- Create: `firmware/lib/krishi/sampling.h`, `firmware/lib/krishi/sampling.cpp`
- Test: `firmware/test/test_sampling/test_sampling.cpp`

**Interfaces:**
- Consumes: `Flags` (from `record.h`)
- Produces:
  ```cpp
  namespace krishi {
  struct SamplingConfig {
    uint32_t minMs = 10000;
    uint32_t maxMs = 300000;
    int16_t deltaThresholdDeciC = 5;     // 0.5 C of movement is "unstable"
    int16_t breachTempDeciC = 100;       // 10.0 C, matches the gateway rule
    int16_t proximityBandDeciC = 20;     // within 2.0 C of breach is "unstable"
    uint8_t stableSamplesBeforeSlowing = 3;
  };
  struct SamplingState {
    uint32_t intervalMs = 30000;
    uint8_t stableCount = 0;
    int16_t lastT = 0;
    uint8_t lastFlags = 0;
    bool primed = false;
  };
  uint32_t nextInterval(SamplingState& state, int16_t t, uint8_t flags, const SamplingConfig& cfg);
  bool requiresImmediateSample(const SamplingState& state, uint8_t flags);
  }
  ```

- [ ] **Step 1: Write the failing tests — one per rule**

```cpp
static const krishi::SamplingConfig kCfg{};

void test_stable_readings_slow_down_after_three_samples() {
  krishi::SamplingState s;
  s.intervalMs = 30000;
  s.lastT = 41;
  s.primed = true;
  for (int i = 0; i < 3; ++i) krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(45000, s.intervalMs);           // 30000 * 1.5
}

void test_interval_never_exceeds_max() {
  krishi::SamplingState s;
  s.lastT = 41;
  s.primed = true;
  for (int i = 0; i < 100; ++i) krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.maxMs, s.intervalMs);
}

void test_a_moving_temperature_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.primed = true;
  krishi::nextInterval(s, 60, 0, kCfg);                     // +1.9 C, well over 0.5
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

// The anti-gaming rule: the interval collapses BEFORE a breach, not after.
void test_approaching_the_threshold_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 81;
  s.primed = true;
  krishi::nextInterval(s, 82, 0, kCfg);                     // 8.2 C: inside the 2 C band
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_any_flag_change_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.lastFlags = 0;
  s.primed = true;
  krishi::nextInterval(s, 41, krishi::kFlagLidOpen, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_sensor_fault_resets_to_minimum() {
  krishi::SamplingState s;
  s.intervalMs = kCfg.maxMs;
  s.lastT = 41;
  s.primed = true;
  krishi::nextInterval(s, 41, krishi::kFlagSensorFault, kCfg);
  TEST_ASSERT_EQUAL_UINT32(kCfg.minMs, s.intervalMs);
}

void test_lid_open_demands_an_immediate_sample() {
  krishi::SamplingState s;
  s.lastFlags = 0;
  TEST_ASSERT_TRUE(krishi::requiresImmediateSample(s, krishi::kFlagLidOpen));
  s.lastFlags = krishi::kFlagLidOpen;
  TEST_ASSERT_FALSE(krishi::requiresImmediateSample(s, krishi::kFlagLidOpen));  // already known
}

void test_first_observation_does_not_look_unstable() {
  // Without `primed`, lastT == 0 would read as a 4.1 C jump on the very first sample
  // and pin every node to the minimum interval forever.
  krishi::SamplingState s;
  krishi::nextInterval(s, 41, 0, kCfg);
  TEST_ASSERT_EQUAL_UINT32(30000, s.intervalMs);
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd firmware && pio test -e native -f test_sampling
```

- [ ] **Step 3: Implement `sampling.cpp`**

```cpp
uint32_t nextInterval(SamplingState& state, int16_t t, uint8_t flags, const SamplingConfig& cfg) {
  const bool flagsChanged = state.primed && flags != state.lastFlags;
  const int delta = static_cast<int>(t) - static_cast<int>(state.lastT);
  const bool moved = state.primed && (delta >= cfg.deltaThresholdDeciC ||
                                      delta <= -cfg.deltaThresholdDeciC);
  const bool nearBreach = t >= static_cast<int16_t>(cfg.breachTempDeciC - cfg.proximityBandDeciC);
  const bool alarming = (flags & (kFlagLidOpen | kFlagShock | kFlagSensorFault)) != 0;

  if (flagsChanged || moved || nearBreach || alarming) {
    state.intervalMs = cfg.minMs;
    state.stableCount = 0;
  } else if (++state.stableCount >= cfg.stableSamplesBeforeSlowing) {
    state.stableCount = 0;
    const uint32_t slower = state.intervalMs + state.intervalMs / 2;   // x1.5, integer maths
    state.intervalMs = slower > cfg.maxMs ? cfg.maxMs : slower;
  }

  state.lastT = t;
  state.lastFlags = flags;
  state.primed = true;
  return state.intervalMs;
}

bool requiresImmediateSample(const SamplingState& state, uint8_t flags) {
  return state.primed && flags != state.lastFlags;
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd firmware && pio test -e native -f test_sampling
```

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/krishi/sampling.* firmware/test/test_sampling/
git commit -m "feat(fw): adaptive sampling interval policy

H1-18. Pure policy, one test per rule in PROTOCOL-LINK section 6.
Bounded 10s-300s; collapses to the minimum on movement, flag change,
sensor fault, or proximity to the breach threshold, so the interval
shortens BEFORE an excursion rather than after it. Sampling density
stays auditable from ts deltas, so no record field was needed."
```

---

## Task 12: HEAD and LEAF main loops

**Files:**
- Modify: `firmware/node-head/src/main.cpp`
- Modify: `firmware/node-leaf/src/main.cpp`

**Interfaces:**
- Consumes: everything above
- Produces: two working binaries

- [ ] **Step 1: Write the HEAD loop**

Order matters and mirrors ARCHITECTURE §2.1:

```
setup:
  Serial, pins, LED = BOOT
  WiFi.begin(ssid, pass); wait for association
  identity.begin(nvsKeyStore)                  // after RF is up: esp_random() needs it
  chain.begin(nvsChainStore)
  ringBuffer.begin(espFlashStore)
  link.beginHead(WiFi.channel())               // AFTER association: channel must match
  uplink.begin(gatewayUrl)
  ntpSync()                                    // sets the clock and tsq
  print the device address; if newly commissioned, print the register command
  LED = OK

loop:
  // 1. Drain the radio queue. Never do this inside the callback.
  while (link.pop(frame)):
      switch frameType(frame):
        kFrameRecord:    decode -> ringBuffer.append(canonical, sig)   // bytes, not re-encoded
        kFrameHeartbeat: tracker.observe(...)
        default:         ignore

  // 2. Our own sensors, on the adaptive schedule.
  if (millis() - lastSample >= sampling.intervalMs
      || requiresImmediateSample(sampling, readFlagsNow())):
      record = readSensors()
      chain.stamp(record)
      encodeRecord -> Identity::digest -> identity.sign
      ringBuffer.append(record, sig)           // durable BEFORE any transmission
      chain.advance(digest)
      nextInterval(sampling, record.t, record.flags, samplingCfg)
      lastSample = millis()

  // 3. Uplink, batched per device, with ACK fan-out to LEAFs.
  if (millis() - lastUplink >= uplinkIntervalMs): runUplinkCycle()

  // 4. Beacon and heartbeat.
  if (millis() - lastBeacon >= kBeaconIntervalMs): link.broadcast(beaconFrame())
  if (millis() - lastHeartbeat >= kHeartbeatIntervalMs): postHeartbeat()

  updateLed()
```

- [ ] **Step 2: Write the LEAF loop**

Same shape minus WiFi, uplink and beacon. It sends `RECORD` frames to the bonded HEAD and frees its buffer only on a matching `ACK`. After `kAckMissesBeforeRescan` consecutive unacked cycles, call `link.beginLeaf()` again to re-acquire the channel. Capture and buffer unconditionally, link up or down.

- [ ] **Step 3: Implement the LED state machine (FW-12)**

`BOOT` / `OK` / `OFFLINE` / `BUFFERING` / `BREACH` / `FAULT` as visibly distinct blink patterns. Judges read the LED before they read the screen; make the states distinguishable across a demo table, not just in a logic analyser.

- [ ] **Step 4: Add serial configuration (FW-13)**

`WIFI <ssid> <pass>` · `GW <url>` · `LOT <hex32>` · `INTERVAL <ms>` · `CAL <offsetDeciC>` · `STATUS` · `ERASE`. Persist to NVS. Changing the venue WiFi must not cost a reflash — at a hackathon it will need changing at least twice.

- [ ] **Step 5: Build both, run the full native suite, and commit**

```bash
cd firmware && pio run -e node-head && pio run -e node-leaf && pio test -e native
git add firmware/node-head firmware/node-leaf
git commit -m "feat(fw): HEAD and LEAF main loops

H1-12/H1-13. Radio drained in loop() not in the callback; records
durable before transmission; adaptive sampling with forced capture on
flag transitions; LED state machine and serial config."
```

---

## Task 13: Soak test and benchmarks

Turns the PRD's claims into measurements. `hardware/BENCHMARKS.md` open in a browser tab settles an argument with a judge faster than any slide.

**Files:**
- Create: `firmware/test/test_soak/test_powercut.cpp`
- Create: `hardware/BENCHMARKS.md`
- Create: `scripts/soak-powercut.md`

- [ ] **Step 1: Write the host-side power-cut soak**

```cpp
void test_100_random_power_cuts_never_break_the_chain() {
  krishi::MemoryFlashStore flash(16);
  uint32_t nextSeq = 0;

  for (int cycle = 0; cycle < 100; ++cycle) {
    krishi::RingBuffer buffer;
    TEST_ASSERT_TRUE(buffer.begin(flash));

    const int writes = 1 + (rand() % 20);
    for (int i = 0; i < writes; ++i) {
      if (rand() % 10 == 0) flash.failNextWriteAfter(rand() % 160);   // cut mid-slot
      krishi::Record record;
      record.seq = nextSeq;
      uint8_t sig[64] = {0};
      if (buffer.append(record, sig)) nextSeq++;
    }

    // Reopening must always succeed, and must never claim a record it cannot return.
    krishi::RingBuffer reopened;
    TEST_ASSERT_TRUE(reopened.begin(flash));
    const krishi::BufferStats stats = reopened.stats();
    TEST_ASSERT_TRUE(stats.count <= stats.capacity);

    krishi::Record out[64];
    uint8_t sigs[64 * 64];
    const size_t got = reopened.peek(out, sigs, 64);
    TEST_ASSERT_TRUE(got <= stats.count);
    for (size_t i = 1; i < got; ++i) {
      TEST_ASSERT_TRUE_MESSAGE(out[i].seq > out[i - 1].seq, "peek must return ascending seq");
    }
  }
}
```

This is `H1-13`'s acceptance criterion made repeatable. **The hardware soak still happens** — simulated flash is not real flash — but it should confirm what the host test already proved rather than discover it at hour 40.

- [ ] **Step 2: Run it**

```bash
cd firmware && pio test -e native -f test_soak
```

- [ ] **Step 3: On-device benchmarks, recorded in `hardware/BENCHMARKS.md`**

| Measurement | Why it matters |
|---|---|
| keccak256 over 90 bytes (µs) | Per-sample cost |
| `signDigest` (ms), mean of 100 | The original H1-01 spike; > 150 ms changes the design |
| Stack high-water mark during signing | Fixed buffers only — confirm no overflow |
| Ring-buffer append (ms), including the flash write | Bounds the minimum sampling interval |
| ESP-NOW round trip LEAF -> HEAD -> ACK (ms) | Link budget |
| Current draw per state (mA) | Feeds `hardware/POWER.md` |
| **Energy per signed record (mJ)** | "Trustworthy sensing costs X% more battery than untrustworthy sensing" — the number a hardware-literate judge remembers |

- [ ] **Step 4: Commit**

```bash
git add firmware/test/test_soak/ hardware/BENCHMARKS.md scripts/soak-powercut.md
git commit -m "test(fw): 100-cycle power-cut soak and on-device benchmarks

H1-13/H1-01. Turns the crash-safety and signing-cost claims into
measurements rather than assertions."
```

---

## Execution order and parallelism

Tasks 1–7 are host-only and need no board. Tasks 8, 9 and 12 need hardware; Task 13 needs both.

**Critical path:** 1 → 2 → 3 → 5 → 6 → 9 → 12.

Tasks 4, 7, 10 and 11 can be done in any order once 1–3 land. Task 11 (adaptive sampling) is entirely self-contained — the natural thing to hand to a second worker, or to do while the toolchain downloads.

**Do Tasks 2 and 3 before anything else that matters.** If keccak or the signature is wrong, every later test is measuring the wrong thing, and the failure surfaces as "the gateway rejects everything" at integration gate 1.

---

## Self-review

**Spec coverage.** Every section of PROTOCOL-LINK.md maps to a task: §1 frames → Task 7; §2 the no-re-signing rule → Tasks 9 and 12; §3 channel acquisition → Task 8; §4 ACK semantics → Tasks 6 and 9; §5 heartbeat → Task 10; §6 adaptive sampling → Task 11. PROTOCOL.md §1–§3 → Tasks 2, 3, 5, 6, 9. The requested H1 scope — signing, hash-chain, buffer, ESP-NOW receive+forward, heartbeat, adaptive interval — maps to Tasks 3, 5, 6, 8/9, 10, 11.

**Consistency fix applied.** Task 6's `releaseThrough` originally took only an `ackSeq`. That is wrong: the HEAD's buffer holds records from several devices and `seq` is per-device, so a bare `ackSeq` would release another node's records. Task 6 now specifies `releaseThrough(const uint8_t dev[20], uint32_t ackSeq)` and a per-slot `state` byte, which Task 9 depends on.

**Type consistency.** `Uplink::sendBatch` takes raw `canonicalBlock`/`signatureBlock` pointers rather than `Record*`, deliberately (Task 9) — the HEAD must forward bytes, not re-encode. `RingBuffer::peek` correspondingly fills parallel record and signature blocks.

**Known open risk, deliberately left open.** Task 3 Step 5 may find micro-ecc's RFC 6979 does not reproduce `@noble/curves` byte-for-byte. The fallback is written into that step and is a documentation change, not a redesign — byte-identity was never load-bearing, because the gateway deduplicates on `(deviceId, seq)`.

**Cross-team dependency.** Task 10 needs `POST /heartbeat` (gateway ticket S1-14), which does not exist yet.

**Reconciled with ADR-0004 (heterogeneous swarm), which landed in parallel.** Three additions
are specified in PROTOCOL-LINK §7 and fold into existing tasks rather than adding new ones:
- **WiFi-direct fallback** when the HEAD is unreachable → Task 8, `beginLeaf()` gains step 3 of
  the §7.1 ladder, and Task 12's LEAF loop reuses the HEAD's `Uplink` unchanged.
- **RSSI-based HEAD selection** across multiple BEACONs → Task 8, Step 4: bond to the strongest,
  and only re-bond on the re-acquisition path.
- **Broadcast interval override** → Task 11 gains `effectiveInterval = min(local, broadcast)`
  with a 5-minute expiry. The asymmetry is a security property, not an implementation detail: a
  broadcast may only ever make a node sample *faster*, because BEACON frames are unauthenticated
  and a spoofed slow-down would blind the fleet with one packet. Add a test for it:
  `test_broadcast_override_can_only_shorten_the_interval`.
