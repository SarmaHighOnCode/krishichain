import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPANION_VERSION,
  CompanionFlags,
  CompanionKind,
  companionDigest,
  type CompanionAttestation,
} from "./companion.js";
import { ConsensusEngine, type Finding } from "./consensus.js";
import { deviceAddressFromPrivateKey, recordDigest } from "./crypto.js";
import {
  Flags,
  SENSOR_FAULT_TEMP,
  TimeQuality,
  ZERO_DIGEST,
  ZERO_LOT,
  type Hex,
  type SensorRecord,
} from "./types.js";

const NODE_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CAM_KEY: Hex = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const PHONE_KEY: Hex = "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1";

const NODE = deviceAddressFromPrivateKey(NODE_KEY);
const CAM = deviceAddressFromPrivateKey(CAM_KEY);
const PHONE = deviceAddressFromPrivateKey(PHONE_KEY);

const LOT: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";
const T0 = 1789012345;

function record(overrides: Partial<SensorRecord> = {}): SensorRecord {
  return {
    v: 1,
    dev: NODE,
    seq: 1,
    prev: ZERO_DIGEST,
    ts: BigInt(T0),
    tsq: TimeQuality.FRESH,
    lot: LOT,
    t: 41, // 4.1 C — comfortably inside the cold chain
    h: 812,
    lux: 0,
    flags: 0,
    bat: 87,
    ...overrides,
  };
}

function companion(overrides: Partial<CompanionAttestation> = {}): CompanionAttestation {
  return {
    v: COMPANION_VERSION,
    kind: CompanionKind.PHOTO,
    dev: CAM,
    seq: 1,
    ts: BigInt(T0),
    subjectDev: NODE,
    subjectSeq: 1,
    subject: recordDigest(record()),
    flags: CompanionFlags.LID_OPEN,
    payload: ZERO_DIGEST,
    ...overrides,
  };
}

const feed = (engine: ConsensusEngine, r: SensorRecord): Finding[] =>
  engine.observeRecord(r, recordDigest(r));

const witness = (engine: ConsensusEngine, c: CompanionAttestation, imu?: { peakMilliG: number; durationMs: number; sampleHz: number }): Finding[] =>
  engine.observeCompanion(c, companionDigest(c), LOT, imu);

const kinds = (findings: Finding[]) => findings.map((f) => f.kind);

// ---------------------------------------------------------------------------
// S1-14 acceptance: a single sensor spike does NOT flag.
// ---------------------------------------------------------------------------

test("one hot reading does not flag a lot", () => {
  const engine = new ConsensusEngine();
  const findings = feed(engine, record({ seq: 1, t: 180 })); // 18.0 C, one sample
  assert.deepEqual(kinds(findings), []);
});

test("a temperature spike that recovers immediately does not flag", () => {
  const engine = new ConsensusEngine();
  feed(engine, record({ seq: 1, t: 41, ts: BigInt(T0) }));
  feed(engine, record({ seq: 2, t: 180, ts: BigInt(T0 + 5) }));
  const back = feed(engine, record({ seq: 3, t: 44, ts: BigInt(T0 + 10) }));
  assert.deepEqual(kinds(back), []);
});

test("a lone lid-open is reported but does not flag", () => {
  const engine = new ConsensusEngine();
  const findings = feed(engine, record({ seq: 1, flags: Flags.LID_OPEN }));
  assert.deepEqual(kinds(findings), ["TAMPER"]);
  assert.equal(findings[0]!.severity, "info");
});

test("two signal classes from the SAME device is suspected, never a breach", () => {
  const engine = new ConsensusEngine();
  // One board reporting both a temperature excursion and an open lid is telling a coherent
  // story about itself. A faulty or compromised board can tell any story it likes.
  const findings = feed(engine, record({ seq: 1, t: 180, flags: Flags.LID_OPEN }));
  assert.deepEqual(kinds(findings), ["SUSPECTED_BREACH"]);
  assert.equal(findings[0]!.severity, "warn");
});

// ---------------------------------------------------------------------------
// S1-14 acceptance: 2-of-3 DOES flag, promptly.
// ---------------------------------------------------------------------------

test("temp + CAM lid from two devices in the window is a consensus breach", () => {
  const engine = new ConsensusEngine();

  const warm = feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));
  assert.deepEqual(kinds(warm), [], "one device alone must not be enough");

  const seen = witness(engine, companion({ ts: BigInt(T0 + 4), flags: CompanionFlags.LID_OPEN }));
  assert.deepEqual(kinds(seen), ["CONSENSUS_BREACH"]);

  const finding = seen[0]!;
  assert.equal(finding.severity, "breach");
  assert.deepEqual(finding.signals.sort(), ["LID", "TEMP"]);
  assert.equal(finding.devices.length, 2);
  assert.equal(finding.at - T0 <= 10, true, "must complete within 10 s of the causing record");
});

test("temp + IMU shock from a phone is a consensus breach", () => {
  const engine = new ConsensusEngine();
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));

  const shock = witness(
    engine,
    companion({
      dev: PHONE,
      kind: CompanionKind.IMU,
      flags: CompanionFlags.SHOCK,
      ts: BigInt(T0 + 3),
    }),
    { peakMilliG: 3400, durationMs: 120, sampleHz: 100 },
  );
  assert.deepEqual(kinds(shock), ["CONSENSUS_BREACH"]);
});

test("all three classes across three devices still reports exactly one breach", () => {
  const engine = new ConsensusEngine();
  const all: Finding[] = [];
  all.push(...feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) })));
  all.push(...witness(engine, companion({ ts: BigInt(T0 + 2) })));
  all.push(
    ...witness(
      engine,
      companion({ dev: PHONE, kind: CompanionKind.IMU, flags: CompanionFlags.SHOCK, ts: BigInt(T0 + 4) }),
    ),
  );
  assert.deepEqual(kinds(all), ["CONSENSUS_BREACH"], "latched: one episode, one incident");
});

test("a breach supersedes the suspicion that preceded it", () => {
  const engine = new ConsensusEngine();
  const first = feed(engine, record({ seq: 1, t: 180, flags: Flags.LID_OPEN, ts: BigInt(T0) }));
  assert.deepEqual(kinds(first), ["SUSPECTED_BREACH"]);

  const second = witness(engine, companion({ ts: BigInt(T0 + 5) }));
  assert.deepEqual(kinds(second), ["CONSENSUS_BREACH"]);
});

test("one breach episode reports once, however long it runs", () => {
  // Regression. The latch used to be cleared by any in-range temperature reading, so a
  // breach driven by lid + shock re-fired on every cool record that followed it — four
  // identical CONSENSUS_BREACH incidents for one event in the first swarm run.
  const engine = new ConsensusEngine();
  const all: Finding[] = [];

  all.push(...feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) })));
  all.push(...witness(engine, companion({ ts: BigInt(T0 + 2) })));
  assert.deepEqual(kinds(all), ["CONSENSUS_BREACH"]);

  // Temperature recovers while the lid is still open, and the CAM keeps reporting it.
  for (let i = 1; i <= 6; i++) {
    all.push(...feed(engine, record({ seq: 1 + i, t: 45, ts: BigInt(T0 + i * 5) })));
    all.push(...witness(engine, companion({ seq: 1 + i, ts: BigInt(T0 + i * 5) })));
  }

  assert.deepEqual(kinds(all), ["CONSENSUS_BREACH"], "still exactly one incident");
});

test("a genuinely separate episode later reports again", () => {
  const engine = new ConsensusEngine({ windowSeconds: 60 });
  const first = [
    ...feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) })),
    ...witness(engine, companion({ ts: BigInt(T0 + 2) })),
  ];
  assert.deepEqual(kinds(first), ["CONSENSUS_BREACH"]);

  // The crate cools down and the lid is shut: the episode ends.
  assert.deepEqual(kinds(feed(engine, record({ seq: 2, t: 45, ts: BigInt(T0 + 30) }))), []);

  // An hour later it happens again. That is news, not an echo.
  const later = T0 + 3600;
  const second = [
    ...feed(engine, record({ seq: 3, t: 180, ts: BigInt(later) })),
    ...witness(engine, companion({ seq: 2, ts: BigInt(later + 2) })),
  ];
  assert.deepEqual(kinds(second), ["CONSENSUS_BREACH"]);
});

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

test("evidence outside the window does not corroborate", () => {
  const engine = new ConsensusEngine({ windowSeconds: 60 });
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));

  // Two minutes later. A warm reading at noon and an open lid at midnight are not a
  // corroborated event, however convenient that would be on stage.
  const late = witness(engine, companion({ ts: BigInt(T0 + 120) }));
  assert.equal(late.some((f) => f.kind === "CONSENSUS_BREACH"), false);
});

test("correlation uses signed device time, not arrival order", () => {
  const engine = new ConsensusEngine({ windowSeconds: 60 });

  // A node drains a ten-minute backlog in one burst: these arrive milliseconds apart but
  // describe events ten minutes apart. Windowing on arrival would fabricate consensus.
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));
  const later = witness(engine, companion({ ts: BigInt(T0 + 600) }));

  assert.equal(later.some((f) => f.kind === "CONSENSUS_BREACH"), false);
});

test("a device that never synced its clock cannot corroborate", () => {
  const engine = new ConsensusEngine();
  // tsq = UNSYNCED means the timestamp is a guess, so it cannot establish co-occurrence.
  // The reading is still ingested and still raises its own finding — it just does not vote.
  feed(engine, record({ seq: 1, t: 180, tsq: TimeQuality.UNSYNCED, ts: BigInt(T0) }));
  const seen = witness(engine, companion({ ts: BigInt(T0 + 2) }));

  assert.equal(seen.some((f) => f.kind === "CONSENSUS_BREACH"), false);
  assert.deepEqual(kinds(seen), ["TAMPER"]);
});

// ---------------------------------------------------------------------------
// Sustained single-source route
// ---------------------------------------------------------------------------

test("a sustained excursion on one device breaches without corroboration", () => {
  const engine = new ConsensusEngine({ sustainSeconds: 30 });
  assert.deepEqual(kinds(feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }))), []);
  assert.deepEqual(kinds(feed(engine, record({ seq: 2, t: 185, ts: BigInt(T0 + 15) }))), []);

  const sustained = feed(engine, record({ seq: 3, t: 190, ts: BigInt(T0 + 31) }));
  assert.deepEqual(kinds(sustained), ["COLD_CHAIN_BREACH"]);
  assert.equal(sustained[0]!.severity, "breach");
});

test("recovering resets the excursion clock", () => {
  const engine = new ConsensusEngine({ sustainSeconds: 30 });
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));
  feed(engine, record({ seq: 2, t: 40, ts: BigInt(T0 + 10) })); // back in range
  const warmAgain = feed(engine, record({ seq: 3, t: 180, ts: BigInt(T0 + 20) }));
  assert.deepEqual(kinds(warmAgain), [], "the clock restarts, it does not carry over");

  const stillWarm = feed(engine, record({ seq: 4, t: 180, ts: BigInt(T0 + 45) }));
  assert.deepEqual(kinds(stillWarm), [], "25 s in, not yet 30");
});

test("under-temperature is a breach too — frozen is also spoiled", () => {
  const engine = new ConsensusEngine({ tempMinDeciC: 0, sustainSeconds: 30 });
  feed(engine, record({ seq: 1, t: -50, ts: BigInt(T0) }));
  const sustained = feed(engine, record({ seq: 2, t: -60, ts: BigInt(T0 + 31) }));
  assert.deepEqual(kinds(sustained), ["COLD_CHAIN_BREACH"]);
});

// ---------------------------------------------------------------------------
// Things that must never be mistaken for a breach
// ---------------------------------------------------------------------------

test("a sensor fault is not a deep freeze", () => {
  const engine = new ConsensusEngine();
  // SENSOR_FAULT_TEMP is -32768, which sails past any naive "below minimum" comparison and
  // reports a -3276.8 C cold chain failure that never happened.
  const findings = feed(
    engine,
    record({ seq: 1, t: SENSOR_FAULT_TEMP, flags: Flags.SENSOR_FAULT, ts: BigInt(T0) }),
  );
  assert.deepEqual(kinds(findings), []);

  const later = feed(
    engine,
    record({ seq: 2, t: SENSOR_FAULT_TEMP, flags: Flags.SENSOR_FAULT, ts: BigInt(T0 + 300) }),
  );
  assert.deepEqual(kinds(later), [], "a faulted sensor never accumulates an excursion");
});

test("an unbound record contributes nothing — there is no lot to flag", () => {
  const engine = new ConsensusEngine();
  const findings = feed(engine, record({ seq: 1, t: 180, flags: Flags.LID_OPEN, lot: ZERO_LOT }));
  assert.deepEqual(kinds(findings), []);
});

test("an IMU whose own numbers do not support its SHOCK bit does not vote", () => {
  const engine = new ConsensusEngine({ shockMilliG: 2000 });
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));

  const weak = witness(
    engine,
    companion({ dev: PHONE, kind: CompanionKind.IMU, flags: CompanionFlags.SHOCK, ts: BigInt(T0 + 2) }),
    { peakMilliG: 150, durationMs: 20, sampleHz: 100 }, // a bump, not an impact
  );
  assert.equal(weak.some((f) => f.kind === "CONSENSUS_BREACH"), false);
});

test("two lots do not corroborate each other", () => {
  const engine = new ConsensusEngine();
  const otherLot: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5aaaa";
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));

  const elsewhere = engine.observeCompanion(
    companion({ ts: BigInt(T0 + 2) }),
    companionDigest(companion({ ts: BigInt(T0 + 2) })),
    otherLot,
  );
  assert.equal(elsewhere.some((f) => f.kind === "CONSENSUS_BREACH"), false);
});

test("the snapshot reports what is currently corroborating", () => {
  const engine = new ConsensusEngine();
  feed(engine, record({ seq: 1, t: 180, ts: BigInt(T0) }));
  witness(engine, companion({ ts: BigInt(T0 + 2) }));

  const snap = engine.snapshot(LOT, T0 + 5);
  assert.deepEqual(snap.signals.sort(), ["LID", "TEMP"]);
  assert.equal(snap.devices.length, 2);

  const stale = engine.snapshot(LOT, T0 + 600);
  assert.deepEqual(stale.signals, [], "the window closes");
});
