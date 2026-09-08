/**
 * The golden vectors are the referee. If one of these fails, the implementation is wrong —
 * not the vector. The firmware runs the equivalent suite natively (`pio test -e native`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkChain, EMPTY_CHAIN_STATE, verifyRun } from "./chain.js";
import { recordDigest, verifyRecord } from "./crypto.js";
import { buildTree, verifyProof } from "./merkle.js";
import { decodeRecord, encodeRecordHex, hexToBytes } from "./record.js";
import { CANONICAL_LENGTH, type Hex, type SensorRecord } from "./types.js";

interface RawRecord extends Omit<SensorRecord, "ts"> {
  ts: string;
}

interface Vectors {
  protocolVersion: number;
  canonicalLength: number;
  testDeviceAddress: Hex;
  records: Array<{ name: string; why: string; record: RawRecord; canonical: Hex; digest: Hex; signature: Hex }>;
  chain: { run: Array<{ record: RawRecord; digest: Hex }> };
  merkle: { leaves: Hex[]; root: Hex; proofs: Array<{ index: number; digest: Hex; proof: Hex[] }> };
}

const vectors: Vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "vectors.json"), "utf8"),
);

const hydrate = (raw: RawRecord): SensorRecord => ({ ...raw, ts: BigInt(raw.ts) });

test("every record vector encodes to its canonical bytes", () => {
  for (const vector of vectors.records) {
    const record = hydrate(vector.record);
    assert.equal(encodeRecordHex(record), vector.canonical, `canonical mismatch: ${vector.name}`);
    assert.equal(
      hexToBytes(vector.canonical).length,
      CANONICAL_LENGTH,
      `wrong length: ${vector.name}`,
    );
  }
});

test("every record vector round-trips through decode", () => {
  for (const vector of vectors.records) {
    const record = hydrate(vector.record);
    assert.deepEqual(decodeRecord(hexToBytes(vector.canonical)), record, `round-trip: ${vector.name}`);
  }
});

test("every record vector produces its expected digest", () => {
  for (const vector of vectors.records) {
    assert.equal(recordDigest(hydrate(vector.record)), vector.digest, `digest: ${vector.name}`);
  }
});

test("every record vector signature verifies against the device address", () => {
  for (const vector of vectors.records) {
    const result = verifyRecord(hydrate(vector.record), vector.signature);
    assert.equal(result.ok, true, `signature: ${vector.name}`);
    if (result.ok) {
      assert.equal(result.address.toLowerCase(), vectors.testDeviceAddress.toLowerCase());
    }
  }
});

test("the reference run verifies as a gapless chain", () => {
  const run = vectors.chain.run.map((entry) => hydrate(entry.record));
  const result = verifyRun(run);
  assert.equal(result.ok, true, `unexpected failures: ${JSON.stringify(result.failures)}`);
});

test("dropping a record from the run is detected as a gap", () => {
  const run = vectors.chain.run.map((entry) => hydrate(entry.record));
  const withHole = run.filter((_, i) => i !== 4);
  const result = verifyRun(withHole);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.check.verdict, "CHAIN_GAP");
  assert.equal(result.failures[0]?.check.missing, 1);
});

test("replaying the last record is an idempotent duplicate, not a fork", () => {
  const run = vectors.chain.run.map((entry) => hydrate(entry.record));
  const { state } = verifyRun(run);
  const replay = checkChain(state, run[run.length - 1]!);
  assert.equal(replay.verdict, "DUPLICATE");
});

test("a genesis record with a non-zero prev is a fork", () => {
  const genesis = hydrate(vectors.chain.run[0]!.record);
  const tampered: SensorRecord = { ...genesis, prev: `0x${"ab".repeat(32)}` };
  assert.equal(checkChain(EMPTY_CHAIN_STATE, tampered).verdict, "CHAIN_FORK");
});

test("merkle root and every proof match the vectors", () => {
  const tree = buildTree(vectors.merkle.leaves);
  assert.equal(tree.root, vectors.merkle.root);
  for (const entry of vectors.merkle.proofs) {
    assert.equal(
      verifyProof(entry.digest, entry.proof, vectors.merkle.root),
      true,
      `proof ${entry.index}`,
    );
  }
});
