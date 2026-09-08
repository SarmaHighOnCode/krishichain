import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPANION_LENGTH,
  COMPANION_MAGIC,
  COMPANION_VERSION,
  CompanionFlags,
  CompanionKind,
  companionDigest,
  decodeCompanion,
  decodeGpsEvidence,
  decodeImuEvidence,
  encodeCompanion,
  encodeGpsEvidence,
  encodeImuEvidence,
  imuEvidenceHash,
  signCompanion,
  verifyCompanion,
  type CompanionAttestation,
} from "./companion.js";
import { deviceAddressFromPrivateKey, keccak256, recordDigest } from "./crypto.js";
import { encodeRecord } from "./record.js";
import { CANONICAL_LENGTH, Flags, TimeQuality, ZERO_DIGEST, type Hex, type SensorRecord } from "./types.js";

const CAM_KEY: Hex = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const NODE_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CAM = deviceAddressFromPrivateKey(CAM_KEY);
const NODE = deviceAddressFromPrivateKey(NODE_KEY);

const subjectRecord: SensorRecord = {
  v: 1,
  dev: NODE,
  seq: 42,
  prev: ZERO_DIGEST,
  ts: 1789012345n,
  tsq: TimeQuality.FRESH,
  lot: "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7",
  t: 41,
  h: 812,
  lux: 0,
  flags: 0,
  bat: 87,
};

function photoCompanion(overrides: Partial<CompanionAttestation> = {}): CompanionAttestation {
  return {
    v: COMPANION_VERSION,
    kind: CompanionKind.PHOTO,
    dev: CAM,
    seq: 7,
    ts: 1789012346n,
    subjectDev: subjectRecord.dev,
    subjectSeq: subjectRecord.seq,
    subject: recordDigest(subjectRecord),
    flags: CompanionFlags.LID_OPEN,
    payload: keccak256(new TextEncoder().encode("pretend-jpeg-bytes")),
    ...overrides,
  };
}

test("a companion round-trips through its canonical encoding", () => {
  const companion = photoCompanion();
  const bytes = encodeCompanion(companion);
  assert.equal(bytes.length, COMPANION_LENGTH);
  assert.deepEqual(decodeCompanion(bytes), companion);
});

test("a companion signature verifies against the witness address", () => {
  const companion = photoCompanion();
  const sig = signCompanion(companion, CAM_KEY);
  assert.equal(verifyCompanion(companion, sig).ok, true);
});

test("a companion does not verify against the node it witnesses", () => {
  const companion = photoCompanion();
  const sig = signCompanion(companion, NODE_KEY);
  const result = verifyCompanion(companion, sig);
  assert.equal(result.ok, false);
});

test("flipping the lid verdict invalidates the signature — the verdict is signed, not asserted", () => {
  const companion = photoCompanion({ flags: CompanionFlags.LID_OPEN });
  const sig = signCompanion(companion, CAM_KEY);

  const rewritten = { ...companion, flags: 0 };
  assert.equal(verifyCompanion(rewritten, sig).ok, false);
});

test("swapping the photo hash invalidates the signature", () => {
  const companion = photoCompanion();
  const sig = signCompanion(companion, CAM_KEY);

  const rewritten = { ...companion, payload: keccak256(new TextEncoder().encode("other-jpeg")) };
  assert.equal(verifyCompanion(rewritten, sig).ok, false);
});

test("the companion is bound to one specific record digest", () => {
  const companion = photoCompanion();
  const sig = signCompanion(companion, CAM_KEY);

  const otherSubject = recordDigest({ ...subjectRecord, seq: 43 });
  assert.equal(verifyCompanion({ ...companion, subject: otherSubject }, sig).ok, false);
});

test("companion and record domains cannot collide", () => {
  // Both are keccak256 over a fixed-length byte string signed by the same kind of key, so
  // if the encodings could ever produce identical bytes a witness signature would be
  // replayable as a sensor reading. Length and magic byte both separate them.
  assert.notEqual(COMPANION_LENGTH, CANONICAL_LENGTH);
  assert.equal(encodeCompanion(photoCompanion())[0], COMPANION_MAGIC);
  assert.notEqual(encodeRecord(subjectRecord)[0], COMPANION_MAGIC);
});

test("a companion whose magic byte is wrong is refused, not parsed", () => {
  const bytes = encodeCompanion(photoCompanion());
  bytes[0] = 0x01;
  assert.throws(() => decodeCompanion(bytes), /magic/);
});

test("a truncated companion is refused", () => {
  const bytes = encodeCompanion(photoCompanion());
  assert.throws(() => decodeCompanion(bytes.subarray(0, COMPANION_LENGTH - 1)), /124 bytes/);
});

test("IMU evidence round-trips and hashes to the signed payload", () => {
  const imu = { peakMilliG: 3400, durationMs: 120, sampleHz: 100 };
  assert.deepEqual(decodeImuEvidence(encodeImuEvidence(imu)), imu);

  const companion = photoCompanion({
    kind: CompanionKind.IMU,
    flags: CompanionFlags.SHOCK,
    payload: imuEvidenceHash(imu),
  });
  const sig = signCompanion(companion, CAM_KEY);
  assert.equal(verifyCompanion(companion, sig).ok, true);

  // A witness that reports different numbers than it signed is caught by recomputing.
  const lied = { ...imu, peakMilliG: 100 };
  assert.notEqual(imuEvidenceHash(lied), companion.payload);
});

test("GPS evidence round-trips, including southern and western hemispheres", () => {
  const gps = { latMicro: -33_868_820, lonMicro: -70_650_000, accuracyCm: 450, speedCmS: 1200 };
  assert.deepEqual(decodeGpsEvidence(encodeGpsEvidence(gps)), gps);
});

test("the digest changes when any signed field changes", () => {
  const base = photoCompanion();
  const baseline = companionDigest(base);
  const mutations: Array<Partial<CompanionAttestation>> = [
    { seq: 8 },
    { ts: 1789012347n },
    { subjectSeq: 43 },
    { flags: base.flags | CompanionFlags.DEGRADED },
    { kind: CompanionKind.IMU },
  ];
  for (const mutation of mutations) {
    assert.notEqual(companionDigest({ ...base, ...mutation }), baseline);
  }
});

test("a record flag and a companion flag are independent namespaces", () => {
  // Both are bitfields on 8 bits and both have a "lid open" concept. They are separate
  // enums on purpose; asserting the values here stops a future edit from quietly
  // assuming one can be passed where the other is expected.
  assert.equal(Flags.LID_OPEN, 1 << 0);
  assert.equal(CompanionFlags.LID_OPEN, 1 << 0);
  assert.equal(Flags.SHOCK, 1 << 1);
  assert.equal(CompanionFlags.SHOCK, 1 << 1);
});
