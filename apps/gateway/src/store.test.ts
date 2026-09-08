/**
 * Lot rollup and badge semantics.
 *
 * `lotState` takes its chain lookups as injected functions precisely so this can be tested
 * without an RPC — which is the whole reason the store has no viem client in it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConsensusEngine,
  Flags,
  recordDigest,
  TimeQuality,
  ZERO_DIGEST,
  type Hex,
  type SensorRecord,
} from "@krishichain/core";

import { GatewayStore, type StoredRecord } from "./store.js";

const DEV: Hex = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const LOT: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";
const SIG: Hex = `0x${"11".repeat(64)}`;
const T0 = 1789012345;

function fresh(): GatewayStore {
  return new GatewayStore(new ConsensusEngine());
}

/** Append a record to a store, returning its digest. */
function push(
  store: GatewayStore,
  seq: number,
  overrides: Partial<SensorRecord> = {},
  verdict: StoredRecord["verdict"] = "ACCEPT",
): Hex {
  const record: SensorRecord = {
    v: 1,
    dev: DEV,
    seq,
    prev: ZERO_DIGEST,
    ts: BigInt(T0 + seq * 10),
    tsq: TimeQuality.FRESH,
    lot: LOT,
    t: 41,
    h: 800,
    lux: 0,
    flags: seq === 0 ? Flags.BOOT : 0,
    bat: 90,
    ...overrides,
  };
  const digest = recordDigest(record);
  store.addRecord({ record, digest, signature: SIG, verdict, receivedAt: Date.now() });
  return digest;
}

const never = () => false;
const always = () => true;

// ---------------------------------------------------------------------------
// The badge must not claim more than the chain has committed.
// ---------------------------------------------------------------------------

test("a closed batch alone is NOT enough to read VERIFIED", () => {
  // Regression, and the reason `isAnchored` was rewritten. It used to mean "this digest is
  // in a closed Merkle batch", which is a promise the gateway made to itself. A lot went
  // VERIFIED before any transaction landed, and stayed VERIFIED if that transaction failed.
  const store = fresh();
  push(store, 0);
  push(store, 1);

  assert.equal(store.lotState(LOT, never).badge, "PENDING_ANCHOR");
});

test("a confirmed anchor reads VERIFIED", () => {
  const store = fresh();
  push(store, 0);
  assert.equal(store.lotState(LOT, always).badge, "VERIFIED");
});

test("one unanchored record holds the whole lot at PENDING_ANCHOR", () => {
  const store = fresh();
  const first = push(store, 0);
  push(store, 1);

  // A lot is only as committed as its least-committed record.
  const partial = (digest: Hex) => digest.toLowerCase() === first.toLowerCase();
  assert.equal(store.lotState(LOT, partial).badge, "PENDING_ANCHOR");
});

test("a chain gap outranks a confirmed anchor", () => {
  // UNVERIFIABLE beats VERIFIED: anchoring a set of records we know has a hole in it does
  // not make the set trustworthy, it just timestamps our uncertainty.
  const store = fresh();
  push(store, 0);
  push(store, 2, {}, "CHAIN_GAP");

  assert.equal(store.lotState(LOT, always).badge, "UNVERIFIABLE");
});

test("an empty lot is never VERIFIED", () => {
  const store = fresh();
  const state = store.lotState(LOT, always);
  assert.equal(state.recordCount, 0);
  assert.notEqual(state.badge, "VERIFIED");
});
