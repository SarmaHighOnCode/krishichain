/**
 * Ticket S1-15 — a whole simulated swarm. UNBLOCKS S2.
 *
 * `sim-node.ts` fakes one node so the pipeline can be built without hardware. This fakes
 * the *swarm*: a HEAD that relays, a LEAF that reaches the gateway through it, a CAM that
 * witnesses what the others measure, and a phone acting as a virtual node. Real keys, real
 * signatures, real hash chains, real companion attestations. The gateway cannot tell any
 * of them from the boards on the bench, which is the entire point — S2 can build and demo
 * the twins dashboard while H1 and H2 still have soldering irons in their hands.
 *
 *   npm run broker            # in one terminal
 *   npm run dev:gateway       # in another
 *   npm run sim-swarm -- --breach
 *
 * Flags:
 *   --gateway <url>    default http://localhost:8080
 *   --count <n>        records per node (default 60)
 *   --interval <ms>    wall-clock delay between rounds (default 400)
 *   --step <s>         simulated seconds per round (default 10) — a 60-round run is 10
 *                      minutes of journey, so the cold-chain chart has a real shape
 *   --lot <hex16>      lot id
 *   --breach           run the 2-of-3 corroborated breach at the halfway point
 *   --gap-at <n>       LEAF silently drops this record -> gateway must report CHAIN_GAP
 *   --kill-at <n>      HEAD stops reporting -> its twin must grey within 5 s, and the LEAF
 *                      fails over to talking to the gateway directly
 *   --single-spike     one hot reading from one node and nothing else. Proves the rules
 *                      engine does NOT flag on it. Run this before demoing --breach.
 */

import {
  companionDigest,
  CompanionFlags,
  CompanionKind,
  COMPANION_VERSION,
  deviceAddressFromPrivateKey,
  Flags,
  imuEvidenceHash,
  keccak256,
  NodeRole,
  recordDigest,
  signCompanion,
  signRecord,
  TimeQuality,
  ZERO_DIGEST,
  type CompanionAttestation,
  type Hex,
  type ImuEvidence,
  type NodeRoleValue,
  type SensorRecord,
} from "../packages/core/src/index.js";

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => Number(flag(name, String(fallback)));

const GATEWAY = flag("gateway", "http://localhost:8080")!;
const COUNT = num("count", 60);
const INTERVAL = num("interval", 400);
const STEP = num("step", 10);
const LOT = (flag("lot", "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7") ?? "") as Hex;
const BREACH = has("breach");
const SINGLE_SPIKE = has("single-spike");
const GAP_AT = flag("gap-at") ? num("gap-at", -1) : -1;
const KILL_AT = flag("kill-at") ? num("kill-at", -1) : -1;

/**
 * Distinct keys per role so every device has its own identity and its own chain, exactly
 * as four physical boards would. These are well-known test keys — never fund them.
 */
const KEYS = {
  HEAD: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  LEAF: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
  CAM: "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1",
  PHONE: "0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913",
} as const;

/** A patch of farmland near Nashik. Gives the Leaflet map something real to draw. */
const ORIGIN = { lat: 19.9975, lon: 73.7898 };

interface WireRecord {
  seq: number;
  prev: Hex;
  ts: string;
  tsq: number;
  lot: Hex;
  t: number;
  h: number;
  lux: number;
  flags: number;
  bat: number;
  sig: Hex;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/** One simulated device: its own key, its own monotonic chain, its own opinions. */
class SimNode {
  readonly address: Hex;
  seq = 0;
  prev: Hex = ZERO_DIGEST;
  /** Digest of the last record it emitted — what a witness attests to. */
  lastDigest: Hex = ZERO_DIGEST;
  alive = true;
  battery: number;

  constructor(
    readonly name: string,
    readonly key: Hex,
    readonly role: NodeRoleValue,
    readonly position: { lat: number; lon: number },
    battery = 100,
  ) {
    this.address = deviceAddressFromPrivateKey(key);
    this.battery = battery;
  }

  /**
   * Emit the next record on this device's chain.
   *
   * The chain advances even when the caller is about to throw the record away — that is
   * what makes a dropped record leave a visible hole rather than a seamless history.
   */
  emit(now: number, fields: { t: number; h: number; lux: number; flags?: number }): {
    record: SensorRecord;
    wire: WireRecord;
  } {
    const record: SensorRecord = {
      v: 1,
      dev: this.address,
      seq: this.seq,
      prev: this.prev,
      ts: BigInt(now),
      tsq: TimeQuality.FRESH,
      lot: LOT,
      t: fields.t,
      h: fields.h,
      lux: fields.lux,
      flags: (fields.flags ?? 0) | (this.seq === 0 ? Flags.BOOT : 0),
      bat: this.battery,
    };

    const digest = recordDigest(record);
    this.prev = digest;
    this.lastDigest = digest;
    this.seq += 1;
    if (this.seq % 10 === 0 && this.battery > 20) this.battery -= 1;

    return {
      record,
      wire: {
        seq: record.seq,
        prev: record.prev,
        ts: record.ts.toString(),
        tsq: record.tsq,
        lot: record.lot,
        t: record.t,
        h: record.h,
        lux: record.lux,
        flags: record.flags,
        bat: record.bat,
        sig: signRecord(record, this.key),
      },
    };
  }

  /** Sign a companion attestation about someone else's record. */
  witness(args: {
    kind: (typeof CompanionKind)[keyof typeof CompanionKind];
    now: number;
    subject: SimNode;
    flags: number;
    payload: Hex;
    companionSeq: number;
  }): { companion: CompanionAttestation; wire: Record<string, unknown> } {
    const companion: CompanionAttestation = {
      v: COMPANION_VERSION,
      kind: args.kind,
      dev: this.address,
      seq: args.companionSeq,
      ts: BigInt(args.now),
      subjectDev: args.subject.address,
      subjectSeq: args.subject.seq - 1,
      subject: args.subject.lastDigest,
      flags: args.flags,
      payload: args.payload,
    };

    return {
      companion,
      wire: {
        kind: companion.kind,
        seq: companion.seq,
        ts: companion.ts.toString(),
        subjectDev: companion.subjectDev,
        subjectSeq: companion.subjectSeq,
        subject: companion.subject,
        flags: companion.flags,
        payload: companion.payload,
        sig: signCompanion(companion, this.key),
      },
    };
  }
}

const head = new SimNode("HEAD  (DevKit)", KEYS.HEAD, NodeRole.HEAD, ORIGIN, 100);
const leaf = new SimNode("LEAF  (S2 Lolin)", KEYS.LEAF, NodeRole.LEAF, {
  lat: ORIGIN.lat + 0.0012,
  lon: ORIGIN.lon + 0.0009,
}, 78);
const cam = new SimNode("CAM   (witness)", KEYS.CAM, NodeRole.WITNESS, {
  lat: ORIGIN.lat + 0.0006,
  lon: ORIGIN.lon + 0.0014,
}, 64);
const phone = new SimNode("PHONE (virtual)", KEYS.PHONE, NodeRole.VIRTUAL, {
  lat: ORIGIN.lat - 0.0008,
  lon: ORIGIN.lon + 0.0004,
}, 91);

const nodes = [head, leaf, cam, phone];

/**
 * The gateway's default cold-chain ceiling, deci-degrees C (.env `TEMP_MAX_C`). The
 * simulator needs it to know when its own ramp actually becomes a breach signal.
 */
const TEMP_MAX_DECI = Math.round(Number(process.env.TEMP_MAX_C ?? 10) * 10);

/** Cold chain holds ~4 C, then climbs if a breach was asked for. */
function temperature(round: number): number {
  const base = 40 + Math.round(Math.sin(round / 6) * 4);
  if (SINGLE_SPIKE) return round === Math.floor(COUNT / 2) ? 210 : base;
  if (!BREACH) return base;
  const breachStart = Math.floor(COUNT * 0.5);
  if (round < breachStart) return base;
  return Math.min(base + Math.round((round - breachStart) * 30), 260);
}

/**
 * First round at which the ramp is genuinely outside the permitted range.
 *
 * The CAM and the phone corroborate from here rather than from an arbitrary offset, so the
 * demo shows the intended story — temperature AND lid AND shock — instead of whichever two
 * signals happened to line up. Derived rather than hard-coded so it stays correct at any
 * `--count`.
 */
function firstBreachRound(): number {
  for (let round = 0; round < COUNT; round++) {
    if (temperature(round) > TEMP_MAX_DECI) return round;
  }
  return -1;
}

async function main(): Promise<void> {
  console.log(`swarm -> ${GATEWAY}`);
  console.log(`lot ${LOT} · ${COUNT} rounds @ ${INTERVAL}ms · ${STEP}s simulated per round\n`);
  for (const node of nodes) {
    console.log(`  ${node.role.padEnd(8)} ${node.name.padEnd(18)} ${node.address}`);
  }
  console.log();
  if (BREACH) console.log("  scenario: 2-of-3 corroborated breach at the halfway point");
  if (SINGLE_SPIKE) console.log("  scenario: one lone temperature spike — must NOT flag the lot");
  if (GAP_AT >= 0) console.log(`  LEAF record ${GAP_AT} will be dropped -> expect CHAIN_GAP`);
  if (KILL_AT >= 0) console.log(`  HEAD goes silent at round ${KILL_AT} -> twin greys, LEAF fails over`);
  console.log();

  for (const node of nodes) {
    await post("/devices", {
      address: node.address,
      role: node.role,
      lat: node.position.lat,
      lon: node.position.lon,
    });
  }

  // A simulated clock, not the wall clock. Sixty rounds at ten seconds each is ten minutes
  // of journey, which gives the cold-chain chart a real shape and makes the consensus
  // window mean something. Correlation is on these timestamps because they are the ones
  // inside the signature.
  let now = Math.floor(Date.now() / 1000);
  let companionSeq = 0;
  let leafDirect = false;
  const breachRound = firstBreachRound();

  for (let round = 0; round < COUNT; round++) {
    const t = temperature(round);
    const notes: string[] = [];

    if (KILL_AT >= 0 && round === KILL_AT) {
      head.alive = false;
      leafDirect = true;
      notes.push("HEAD offline — LEAF failing over to WiFi direct");
    }

    // --- HEAD: senses and uplinks its own batch --------------------------------
    if (head.alive) {
      const { wire } = head.emit(now, { t, h: 800 + (round % 30), lux: 0 });
      const res = await post("/ingest", {
        v: 1,
        dev: head.address,
        records: [wire],
        role: NodeRole.HEAD,
        buffered: 0,
      });
      collectFindings(res.json, notes);
    }

    // --- LEAF: normally reaches the gateway through the HEAD --------------------
    const leafRound = leaf.emit(now, {
      t: t + 3, // a slightly different microclimate, as two real boards would read
      h: 790 + (round % 25),
      lux: 0,
    });

    if (round === GAP_AT) {
      notes.push(`LEAF dropped seq ${leafRound.record.seq} on purpose`);
    } else {
      const body: Record<string, unknown> = {
        v: 1,
        dev: leaf.address,
        records: [leafRound.wire],
        role: NodeRole.LEAF,
        buffered: 0,
      };
      // The relay wrapper. `dev` stays the LEAF's, and the signature is still the LEAF's:
      // the HEAD is carrying bytes it cannot alter (ADR-0004 §3).
      if (!leafDirect) {
        body.relay = { by: head.address, rssi: -58 - (round % 12), hops: 1, recvTs: now };
      }
      const res = await post("/ingest", body);
      collectFindings(res.json, notes);
    }

    // --- PHONE: a virtual node, sensing and reporting motion --------------------
    const shockNow = BREACH && breachRound >= 0 && round === breachRound;
    const { wire: phoneWire } = phone.emit(now, {
      t: t + 1,
      h: 805,
      lux: 120,
      flags: 0,
    });
    await post("/ingest", {
      v: 1,
      dev: phone.address,
      records: [phoneWire],
      role: NodeRole.VIRTUAL,
      buffered: 0,
    });

    // --- CAM: witnesses the HEAD's latest record --------------------------------
    // The lid verdict is inside the signed companion bytes, so the CAM attests to it and
    // the gateway is not asked to take our word for anything.
    const lidOpen = BREACH && breachRound >= 0 && round >= breachRound && round <= breachRound + 2;
    // The CAM witnesses whoever is still alive. When the HEAD drops it follows the LEAF,
    // which is the "nearest node picks up custody" behaviour of ADR-0004 §4 and keeps the
    // witness contributing evidence instead of going dark with its subject.
    const subject = head.alive ? head : leaf;
    if (subject.seq > 0 && (round % 3 === 0 || lidOpen)) {
      companionSeq += 1;
      const photoHash = keccak256(
        new TextEncoder().encode(`frame-${round}-${lidOpen ? "open" : "closed"}`),
      );
      const { wire } = cam.witness({
        kind: CompanionKind.PHOTO,
        now,
        subject,
        flags: lidOpen ? CompanionFlags.LID_OPEN : 0,
        payload: photoHash,
        companionSeq,
      });
      const res = await post("/companion", { v: 1, dev: cam.address, companions: [wire] });
      collectFindings(res.json, notes);
      if (lidOpen) notes.push("CAM: lid OPEN");
    }

    // --- PHONE IMU companion: the third signal ----------------------------------
    if (shockNow) {
      companionSeq += 1;
      const imu: ImuEvidence = { peakMilliG: 3400, durationMs: 140, sampleHz: 100 };
      const { wire } = phone.witness({
        kind: CompanionKind.IMU,
        now,
        subject: head.alive ? head : leaf,
        flags: CompanionFlags.SHOCK,
        payload: imuEvidenceHash(imu),
        companionSeq,
      });
      const res = await post("/companion", {
        v: 1,
        dev: phone.address,
        companions: [{ ...wire, evidence: { imu } }],
      });
      collectFindings(res.json, notes);
      notes.push("PHONE: shock");
    }

    const suffix = notes.length > 0 ? `   ${notes.join(" | ")}` : "";
    process.stdout.write(
      `round ${String(round).padStart(3)}  ${(t / 10).toFixed(1)}C${suffix}\n`,
    );

    now += STEP;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }

  await post("/anchor/flush", {});

  const summary = await fetch(`${GATEWAY}/ops/summary`).then((r) => r.json());
  console.log("\n--- gateway ---");
  console.log(`records      ${summary.records}`);
  console.log(`companions   ${summary.companions} (${summary.orphanCompanions} awaiting subject)`);
  console.log(`quarantined  ${summary.quarantined}`);
  console.log(`incidents    ${summary.incidents} (${summary.breaches} breach)`);
  console.log(`batches      ${summary.batches}, last root ${summary.lastRoot}`);
  console.log(`mqtt         ${summary.mqtt.connected ? "connected" : "DOWN"}, ${summary.mqtt.dropped} dropped`);

  const incidents = await fetch(`${GATEWAY}/ops/incidents`).then((r) => r.json());
  if (incidents.incidents.length > 0) {
    console.log("\n--- incidents ---");
    for (const incident of incidents.incidents) {
      console.log(
        `  [${incident.severity}] ${incident.kind}${incident.flagged ? " (FLAGGED)" : ""}: ${incident.detail}`,
      );
    }
  }

  console.log(`\nverify: http://localhost:3000/verify/${LOT}`);
}

/** Surface anything the gateway decided, so the console tells the same story as the UI. */
function collectFindings(json: any, notes: string[]): void {
  for (const finding of json?.findings ?? []) {
    notes.push(`${finding.kind}`);
  }
  for (const incident of json?.incidents ?? []) {
    if (incident.verdict && incident.verdict !== "ACCEPT") notes.push(incident.verdict);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("\nIs the gateway running? Try `npm run dev:gateway`.");
  process.exit(1);
});
