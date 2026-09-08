/**
 * Ticket S1-02 — golden vector generator. THIS BLOCKS H1. Ship it in hour 2.
 *
 * Writes packages/core/fixtures/vectors.json, the referee between the C++ firmware and the
 * TypeScript stack. Both sides test against this file; neither side may edit it to make its
 * own implementation pass. A vector change is a protocol change (PROTOCOL.md §6).
 *
 *   npm run gen:vectors
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BATTERY_MAINS,
  buildTree,
  deviceAddressFromPrivateKey,
  encodeRecordHex,
  Flags,
  getProof,
  PROTOCOL_VERSION,
  recordDigest,
  SENSOR_FAULT_HUMIDITY,
  SENSOR_FAULT_TEMP,
  signRecord,
  TimeQuality,
  ZERO_DIGEST,
  ZERO_LOT,
  type Hex,
  type SensorRecord,
} from "../packages/core/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages", "core", "fixtures", "vectors.json");

/** Fixed test key. Test-only, never funded, safe to commit — that is the point of a vector. */
const TEST_PRIVATE_KEY: Hex = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const DEV = deviceAddressFromPrivateKey(TEST_PRIVATE_KEY);
const LOT: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";

const base: SensorRecord = {
  v: PROTOCOL_VERSION,
  dev: DEV,
  seq: 1,
  prev: `0x${"11".repeat(32)}`,
  ts: 1789012345n,
  tsq: TimeQuality.FRESH,
  lot: LOT,
  t: 41,
  h: 812,
  lux: 0,
  flags: 0,
  bat: 87,
};

const make = (over: Partial<SensorRecord>): SensorRecord => ({ ...base, ...over });

interface Case {
  name: string;
  why: string;
  record: SensorRecord;
}

const cases: Case[] = [
  { name: "genesis", why: "seq 0 with a zero prev digest", record: make({ seq: 0, prev: ZERO_DIGEST, flags: Flags.BOOT }) },
  { name: "nominal_cold_chain", why: "the ordinary case: 4.1C, 81.2%RH, in a sealed box", record: base },
  { name: "negative_temperature", why: "int16 sign handling — a frozen chain at -18.5C", record: make({ t: -185 }) },
  { name: "temp_sensor_fault", why: "sentinel, not a fabricated reading", record: make({ t: SENSOR_FAULT_TEMP, flags: Flags.SENSOR_FAULT }) },
  { name: "humidity_sensor_fault", why: "uint16 sentinel", record: make({ h: SENSOR_FAULT_HUMIDITY, flags: Flags.SENSOR_FAULT }) },
  { name: "lid_open_tamper", why: "the tamper channel fires; lux jumps", record: make({ flags: Flags.LID_OPEN, lux: 340 }) },
  { name: "shock_detected", why: "MPU6050 threshold crossed", record: make({ flags: Flags.SHOCK }) },
  { name: "buffered_offline", why: "written to flash while disconnected", record: make({ flags: Flags.BUFFERED, tsq: TimeQuality.STALE }) },
  { name: "unsynced_clock", why: "never reached NTP — the timestamp is a guess and says so", record: make({ tsq: TimeQuality.UNSYNCED, ts: 0n }) },
  { name: "boot_after_power_cut", why: "a power cut is not a chain gap, but an auditor must see it", record: make({ flags: Flags.BOOT | Flags.BUFFERED }) },
  { name: "lot_binding", why: "the record that bound the lot", record: make({ flags: Flags.LOT_BOUND, seq: 5 }) },
  { name: "calibration_record", why: "signed at commissioning, hashed into DeviceRegistry", record: make({ flags: Flags.CAL, seq: 0, prev: ZERO_DIGEST, t: 40 }) },
  { name: "unbound_lot", why: "no lot yet — all-zero lot field", record: make({ lot: ZERO_LOT }) },
  { name: "mains_powered", why: "bat sentinel 0xFF", record: make({ bat: BATTERY_MAINS }) },
  { name: "battery_empty", why: "bat 0 is a real value, not a sentinel", record: make({ bat: 0 }) },
  { name: "all_flags_set", why: "every defined flag at once; bit 7 stays clear", record: make({ flags: 0x7f }) },
  { name: "max_seq", why: "uint32 boundary", record: make({ seq: 0xffffffff }) },
  { name: "max_values", why: "upper boundary of every numeric field", record: make({ seq: 0xfffffffe, ts: 0xffffffffn, t: 32767, h: 0xfffe, lux: 0xffff, flags: 0x7f, bat: 100 }) },
  { name: "min_values", why: "lower boundary of every numeric field", record: make({ seq: 0, prev: ZERO_DIGEST, ts: 0n, tsq: TimeQuality.UNSYNCED, t: -32767, h: 0, lux: 0, flags: 0, bat: 0 }) },
  { name: "high_lux_daylight", why: "clamped ambient light in the open", record: make({ lux: 65000, flags: Flags.LID_OPEN }) },
];

/** A short valid run, used by both sides to test chain continuity. */
function buildRun(length: number): SensorRecord[] {
  const run: SensorRecord[] = [];
  let prev: Hex = ZERO_DIGEST;
  for (let seq = 0; seq < length; seq++) {
    const record = make({
      seq,
      prev,
      ts: 1789012345n + BigInt(seq * 30),
      t: 40 + (seq % 7),
      flags: seq === 0 ? Flags.BOOT : 0,
    });
    run.push(record);
    prev = recordDigest(record);
  }
  return run;
}

const run = buildRun(8);
const leaves = run.map(recordDigest);
const tree = buildTree(leaves);

const serialise = (r: SensorRecord) => ({ ...r, ts: r.ts.toString() });

const vectors = {
  $comment:
    "GOLDEN VECTORS — the contract between firmware (C++) and gateway (TypeScript). " +
    "Never edit this file to make an implementation pass. See docs/PROTOCOL.md §6.",
  protocolVersion: PROTOCOL_VERSION,
  canonicalLength: 90,
  testPrivateKey: TEST_PRIVATE_KEY,
  testDeviceAddress: DEV,
  generatedBy: "npm run gen:vectors",
  records: cases.map(({ name, why, record }) => ({
    name,
    why,
    record: serialise(record),
    canonical: encodeRecordHex(record),
    digest: recordDigest(record),
    signature: signRecord(record, TEST_PRIVATE_KEY),
  })),
  chain: {
    why: "A valid 8-record run plus the mutations a gateway must catch (PROTOCOL.md §2).",
    run: run.map((r) => ({ record: serialise(r), digest: recordDigest(r) })),
    expectations: [
      { name: "full_run", drop: [], expect: "ACCEPT_ALL" },
      { name: "dropped_middle_record", drop: [4], expect: "CHAIN_GAP" },
      { name: "reordered", swap: [3, 5], expect: "CHAIN_FORK" },
      { name: "replayed_last", replayLast: true, expect: "DUPLICATE" },
      { name: "genesis_with_nonzero_prev", expect: "CHAIN_FORK" },
    ],
  },
  merkle: {
    why: "Sorted-pair keccak256, OpenZeppelin MerkleProof compatible (PROTOCOL.md §4).",
    leaves,
    root: tree.root,
    proofs: leaves.map((digest, index) => ({ index, digest, proof: getProof(tree, index) })),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");

console.log(`wrote ${OUT}`);
console.log(`  device address : ${DEV}`);
console.log(`  record vectors : ${vectors.records.length}`);
console.log(`  chain run      : ${run.length} records`);
console.log(`  merkle root    : ${tree.root}`);
