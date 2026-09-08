import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deviceAddressFromPrivateKey,
  recordDigest,
  signRecord,
  TimeQuality,
  ZERO_DIGEST,
  type Hex,
  type SensorRecord,
} from "@krishichain/core";

import { MemoryDeviceDirectory, Verifier } from "./pipeline.js";

const KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEVICE = deviceAddressFromPrivateKey(KEY);
const LOT: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";

function makeRun(length: number, device = DEVICE): Array<{ record: SensorRecord; signature: Hex }> {
  const out: Array<{ record: SensorRecord; signature: Hex }> = [];
  let prev: Hex = ZERO_DIGEST;

  for (let seq = 0; seq < length; seq++) {
    const record: SensorRecord = {
      v: 1,
      dev: device,
      seq,
      prev,
      ts: BigInt(1789012345 + seq * 30),
      tsq: TimeQuality.FRESH,
      lot: LOT,
      t: 41,
      h: 812,
      lux: 0,
      flags: 0,
      bat: 90,
    };
    out.push({ record, signature: signRecord(record, KEY) });
    prev = recordDigest(record);
  }
  return out;
}

function readyVerifier() {
  const directory = new MemoryDeviceDirectory();
  directory.register(DEVICE);
  return { directory, verifier: new Verifier(directory) };
}

test("accepts a valid run from a registered device", () => {
  const { verifier } = readyVerifier();
  const outcomes = verifier.ingestBatch(makeRun(10));
  assert.equal(outcomes.every((o) => o.status === "accepted"), true);
  assert.equal(verifier.ackSeq(DEVICE), 9);
});

test("rejects a device that was never commissioned", () => {
  const verifier = new Verifier(new MemoryDeviceDirectory());
  const [outcome] = verifier.ingestBatch(makeRun(1));
  assert.equal(outcome?.status, "rejected");
  if (outcome?.status === "rejected") assert.equal(outcome.reason, "UNKNOWN_DEVICE");
});

test("rejects a revoked device", () => {
  const { directory, verifier } = readyVerifier();
  directory.revoke(DEVICE);
  const [outcome] = verifier.ingestBatch(makeRun(1));
  assert.equal(outcome?.status, "rejected");
  if (outcome?.status === "rejected") assert.equal(outcome.reason, "REVOKED_DEVICE");
});

test("rejects a record whose payload was altered after signing", () => {
  const { verifier } = readyVerifier();
  const [entry] = makeRun(1);
  // Someone edits the temperature in transit. The signature no longer covers it.
  const tampered = { ...entry!.record, t: 250 };
  const outcome = verifier.ingest(tampered, entry!.signature);
  assert.equal(outcome.status, "rejected");
  if (outcome.status === "rejected") assert.equal(outcome.reason, "BAD_SIGNATURE");
});

test("a dropped record surfaces as CHAIN_GAP and does not stop later records", () => {
  const { verifier } = readyVerifier();
  const run = makeRun(10);
  const withHole = run.filter((_, i) => i !== 5);

  const outcomes = verifier.ingestBatch(withHole);
  const gaps = outcomes.filter((o) => o.status === "accepted" && o.verdict === "CHAIN_GAP");

  assert.equal(gaps.length, 1, "exactly one gap reported");
  // Refusing the remainder would hand an attacker a cheap denial-of-evidence, so ingest continues.
  assert.equal(outcomes.every((o) => o.status === "accepted"), true);
});

test("a replayed batch is idempotent, not a fork", () => {
  const { verifier } = readyVerifier();
  const run = makeRun(5);
  verifier.ingestBatch(run);

  const replay = verifier.ingest(run[4]!.record, run[4]!.signature);
  assert.equal(replay.status, "accepted");
  if (replay.status === "accepted") assert.equal(replay.verdict, "DUPLICATE");
  assert.equal(verifier.ackSeq(DEVICE), 4);
});

test("ackSeq never runs ahead of what was accepted", () => {
  const { verifier } = readyVerifier();
  verifier.ingestBatch(makeRun(3));
  assert.equal(verifier.ackSeq(DEVICE), 2);
});
