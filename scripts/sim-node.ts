/**
 * Ticket S1-05 — a simulated node that speaks the real protocol. UNBLOCKS S2.
 *
 * Real keys, real signatures, real hash chain, real 90-byte canonical records. The gateway
 * cannot tell it apart from an ESP32, which means the software track can build and demo the
 * entire pipeline while the hardware is still on the bench. That is the single reason the two
 * tracks do not block each other (docs/TEAM-PLAN.md §1).
 *
 *   npm run sim
 *   npm run sim -- --breach --gap-at 40 --interval 200 --count 300
 *
 * Flags:
 *   --gateway <url>   default http://localhost:8080
 *   --count <n>       records to send (default 120)
 *   --interval <ms>   delay between records (default 250)
 *   --lot <hex16>     lot id (default a fixed demo lot)
 *   --breach          drive temperature past the cold-chain threshold partway through
 *   --gap-at <seq>    silently drop this record -- the gateway must report CHAIN_GAP
 *   --offline-at <seq> stop uploading for 10 records, then drain the backlog
 *   --tamper-at <seq> set LID_OPEN and spike lux
 */

import {
  deviceAddressFromPrivateKey,
  Flags,
  recordDigest,
  signRecord,
  TimeQuality,
  ZERO_DIGEST,
  type Hex,
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
const COUNT = num("count", 120);
const INTERVAL = num("interval", 250);
const LOT = (flag("lot", "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7") ?? "") as Hex;
const BREACH = has("breach");
const GAP_AT = flag("gap-at") ? num("gap-at", -1) : -1;
const OFFLINE_AT = flag("offline-at") ? num("offline-at", -1) : -1;
const TAMPER_AT = flag("tamper-at") ? num("tamper-at", -1) : -1;

// A distinct simulator key so simulated records are never confused with a real node's.
const PRIVATE_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEVICE = deviceAddressFromPrivateKey(PRIVATE_KEY);

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

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/** Cold chain that holds ~4 °C, then breaks if --breach is set. */
function temperature(seq: number): number {
  const base = 40 + Math.round(Math.sin(seq / 8) * 4); // 4.0 °C ± 0.4
  if (!BREACH) return base;
  if (seq < COUNT * 0.5) return base;
  const climb = (seq - COUNT * 0.5) * 2.2; // ~0.22 °C per record
  return Math.min(base + Math.round(climb), 280);
}

async function main() {
  console.log(`simulated node ${DEVICE}`);
  console.log(`gateway ${GATEWAY} · ${COUNT} records @ ${INTERVAL}ms · lot ${LOT}`);
  if (BREACH) console.log("  cold-chain breach will start at the halfway point");
  if (GAP_AT >= 0) console.log(`  record ${GAP_AT} will be dropped -> expect CHAIN_GAP`);
  if (OFFLINE_AT >= 0) console.log(`  going offline at seq ${OFFLINE_AT} for 10 records`);
  if (TAMPER_AT >= 0) console.log(`  lid-open tamper at seq ${TAMPER_AT}`);

  await post("/devices", { address: DEVICE });

  let prev: Hex = ZERO_DIGEST;
  let buffered: WireRecord[] = [];
  let offlineUntil = -1;

  for (let seq = 0; seq < COUNT; seq++) {
    const offline = OFFLINE_AT >= 0 && seq >= OFFLINE_AT && seq < OFFLINE_AT + 10;
    if (offline && offlineUntil < 0) offlineUntil = OFFLINE_AT + 10;

    let flags = 0;
    if (seq === 0) flags |= Flags.BOOT;
    if (offline) flags |= Flags.BUFFERED;
    if (seq === TAMPER_AT) flags |= Flags.LID_OPEN;

    const record: SensorRecord = {
      v: 1,
      dev: DEVICE,
      seq,
      prev,
      ts: BigInt(Math.floor(Date.now() / 1000)),
      tsq: TimeQuality.FRESH,
      lot: LOT,
      t: temperature(seq),
      h: 800 + (seq % 40),
      lux: seq === TAMPER_AT ? 420 : 0,
      flags,
      bat: Math.max(20, 100 - Math.floor(seq / 10)),
    };

    // The chain always advances, even for a record we are about to "lose". That is the point:
    // a dropped record leaves a hole the gateway can see, not a seamless history.
    const digest = recordDigest(record);
    prev = digest;

    if (seq === GAP_AT) {
      console.log(`  seq ${seq}: dropped on purpose`);
      continue;
    }

    const wire: WireRecord = {
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
      sig: signRecord(record, PRIVATE_KEY),
    };

    buffered.push(wire);

    if (offline) {
      process.stdout.write(`  seq ${seq}: buffering (${buffered.length} held)\r`);
      await new Promise((resolve) => setTimeout(resolve, INTERVAL));
      continue;
    }

    const { status, json } = await post("/ingest", { v: 1, dev: DEVICE, records: buffered });
    const body = json as { accepted?: number; incidents?: Array<{ verdict: string }>; ackSeq?: number };

    if (status === 200) {
      const incidents = body.incidents?.map((i) => i.verdict).filter((v) => v !== "ACCEPT") ?? [];
      const note = incidents.length > 0 ? `  <-- ${incidents.join(", ")}` : "";
      console.log(
        `  seq ${seq}: sent ${buffered.length} (${(record.t / 10).toFixed(1)}C) ack=${body.ackSeq}${note}`,
      );
      buffered = [];
    } else if (status === 401) {
      console.error(`  seq ${seq}: 401 — device not registered. Keeping the buffer, stopping.`);
      break;
    } else {
      console.warn(`  seq ${seq}: gateway returned ${status}; keeping ${buffered.length} buffered`);
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }

  await post("/anchor/flush", {});
  console.log(`\ndone. lot ${LOT}`);
  console.log(`view: http://localhost:3000/verify/${LOT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("\nIs the gateway running? Try `npm run dev:gateway`.");
  process.exit(1);
});
