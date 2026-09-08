/**
 * Full-pipeline check, no hardware — the `npm run e2e` in CLAUDE.md.
 *
 * This is a TEST, not a demo: every step asserts, and the process exits non-zero if any
 * of them fails. It is what GATE-1 and GATE-2 should be run against before anyone says
 * the pipeline works, because "the demo looked right" is not evidence.
 *
 *   npm run chain && npm run deploy:local     # once
 *   npm run dev:gateway                       # terminal 2
 *   npm run e2e
 *
 * Uses freshly generated keys and a random lot on every run, so it is safe to run
 * repeatedly against a gateway that is already holding state from a demo.
 *
 * Anchoring steps are skipped, loudly, when no chain is configured — a missing chain
 * should not silently turn a red result green.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, type Address, type Chain } from "viem";
import { generatePrivateKey } from "viem/accounts";

import {
  companionDigest,
  COMPANION_VERSION,
  CompanionFlags,
  CompanionKind,
  deviceAddressFromPrivateKey,
  Flags,
  imuEvidenceHash,
  keccak256,
  recordDigest,
  signCompanion,
  signRecord,
  TimeQuality,
  verifyProof,
  ZERO_DIGEST,
  type CompanionAttestation,
  type Hex,
  type ImuEvidence,
  type SensorRecord,
} from "../packages/core/src/index.js";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ANCHOR_ABI = [
  {
    type: "function",
    name: "getRoot",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "verifyInclusion",
    stateMutability: "view",
    inputs: [
      { name: "index", type: "uint256" },
      { name: "leaf", type: "bytes32" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function skip(label: string, why: string): void {
  console.log(`  SKIP  ${label}  — ${why}`);
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const get = (path: string) => fetch(`${GATEWAY}${path}`).then((r) => r.json());

/** A device with its own key and its own chain. */
class Node {
  readonly key: Hex;
  readonly dev: Hex;
  seq = 0;
  prev: Hex = ZERO_DIGEST;
  lastDigest: Hex = ZERO_DIGEST;

  constructor() {
    this.key = generatePrivateKey();
    this.dev = deviceAddressFromPrivateKey(this.key);
  }

  build(lot: Hex, ts: number, t: number, flags = 0): { record: SensorRecord; wire: any } {
    const record: SensorRecord = {
      v: 1,
      dev: this.dev,
      seq: this.seq,
      prev: this.prev,
      ts: BigInt(ts),
      tsq: TimeQuality.FRESH,
      lot,
      t,
      h: 800,
      lux: 0,
      flags: flags | (this.seq === 0 ? Flags.BOOT : 0),
      bat: 90,
    };
    this.lastDigest = recordDigest(record);
    this.prev = this.lastDigest;
    this.seq += 1;
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

  async send(lot: Hex, ts: number, t: number, flags = 0) {
    const { wire } = this.build(lot, ts, t, flags);
    return post("/ingest", { v: 1, dev: this.dev, records: [wire] });
  }
}

function randomLot(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

async function main(): Promise<void> {
  console.log(`e2e against ${GATEWAY}\n`);

  const health = await get("/health").catch(() => null);
  if (!health?.ok) {
    console.error("gateway is not responding — start it with `npm run dev:gateway`");
    process.exit(1);
  }

  const t0 = Math.floor(Date.now() / 1000);

  // -- 1. A signed record from a commissioned device is accepted --------------
  console.log("1. ingest and verification");
  const lotA = randomLot();
  const node = new Node();
  await post("/devices", { address: node.dev, role: "HEAD" });

  const first = await node.send(lotA, t0, 40);
  check("a signed record from a known device is accepted", first.json.accepted === 1);
  check("ackSeq advances to the accepted record", first.json.ackSeq === 0);

  // -- 2. An unknown device is refused ---------------------------------------
  const stranger = new Node();
  const strangerResult = await stranger.send(lotA, t0, 40);
  check("an uncommissioned device gets 401", strangerResult.status === 401);
  check("and is not stored", strangerResult.json.accepted === 0);

  // -- 3. A tampered payload is refused --------------------------------------
  const tamperNode = new Node();
  await post("/devices", { address: tamperNode.dev });
  const built = tamperNode.build(lotA, t0, 40);
  const forged = await post("/ingest", {
    v: 1,
    dev: tamperNode.dev,
    records: [{ ...built.wire, t: 999 }], // altered after signing
  });
  check("a record altered after signing is rejected", forged.json.accepted === 0);
  check(
    "and the rejection reason is the signature",
    forged.json.rejected?.[0]?.reason === "BAD_SIGNATURE",
    JSON.stringify(forged.json.rejected),
  );

  // -- 4. A gap is detected and does not stop ingest --------------------------
  console.log("\n2. hash chain");
  const gapNode = new Node();
  await post("/devices", { address: gapNode.dev });
  await gapNode.send(lotA, t0, 40);
  gapNode.build(lotA, t0 + 10, 40); // built, deliberately never sent
  const afterGap = await gapNode.send(lotA, t0 + 20, 40);
  check(
    "a dropped record surfaces as CHAIN_GAP",
    afterGap.json.incidents?.some((i: any) => i.verdict === "CHAIN_GAP"),
    JSON.stringify(afterGap.json.incidents),
  );
  check("and later records still ingest", afterGap.json.accepted === 1);

  // -- 5. Rules engine: a lone spike must NOT flag ----------------------------
  console.log("\n3. rules engine");
  const lotSpike = randomLot();
  const spikeNode = new Node();
  await post("/devices", { address: spikeNode.dev });
  await spikeNode.send(lotSpike, t0, 40);
  const spike = await spikeNode.send(lotSpike, t0 + 10, 210); // 21.0 C, once
  await spikeNode.send(lotSpike, t0 + 20, 41); // recovers
  check(
    "a single-sensor spike does NOT flag the lot",
    (spike.json.findings ?? []).length === 0,
    JSON.stringify(spike.json.findings),
  );

  // -- 6. Rules engine: 2-of-3 across two devices MUST flag -------------------
  const lotBreach = randomLot();
  const tempNode = new Node();
  const camNode = new Node();
  await post("/devices", { address: tempNode.dev, role: "HEAD" });
  await post("/devices", { address: camNode.dev, role: "WITNESS" });

  await tempNode.send(lotBreach, t0, 40);
  const warm = await tempNode.send(lotBreach, t0 + 10, 200); // out of range
  check("one hot device alone does not flag", (warm.json.findings ?? []).length === 0);

  const companion: CompanionAttestation = {
    v: COMPANION_VERSION,
    kind: CompanionKind.PHOTO,
    dev: camNode.dev,
    seq: 1,
    ts: BigInt(t0 + 12),
    subjectDev: tempNode.dev,
    subjectSeq: tempNode.seq - 1,
    subject: tempNode.lastDigest,
    flags: CompanionFlags.LID_OPEN,
    payload: keccak256(new TextEncoder().encode("frame")),
  };
  const witnessed = await post("/companion", {
    v: 1,
    dev: camNode.dev,
    companions: [
      {
        kind: companion.kind,
        seq: companion.seq,
        ts: companion.ts.toString(),
        subjectDev: companion.subjectDev,
        subjectSeq: companion.subjectSeq,
        subject: companion.subject,
        flags: companion.flags,
        payload: companion.payload,
        sig: signCompanion(companion, camNode.key),
      },
    ],
  });
  check(
    "temp + an independent CAM lid verdict IS a consensus breach",
    witnessed.json.findings?.some((f: any) => f.kind === "CONSENSUS_BREACH"),
    JSON.stringify(witnessed.json.findings),
  );

  // -- 7. A companion whose evidence contradicts its signature is refused -----
  const imu: ImuEvidence = { peakMilliG: 3400, durationMs: 120, sampleHz: 100 };
  const liar: CompanionAttestation = {
    ...companion,
    seq: 2,
    kind: CompanionKind.IMU,
    flags: CompanionFlags.SHOCK,
    payload: imuEvidenceHash(imu),
  };
  const lied = await post("/companion", {
    v: 1,
    dev: camNode.dev,
    companions: [
      {
        kind: liar.kind,
        seq: liar.seq,
        ts: liar.ts.toString(),
        subjectDev: liar.subjectDev,
        subjectSeq: liar.subjectSeq,
        subject: liar.subject,
        flags: liar.flags,
        payload: liar.payload,
        sig: signCompanion(liar, camNode.key),
        // Reports different numbers than it signed.
        evidence: { imu: { ...imu, peakMilliG: 10 } },
      },
    ],
  });
  check(
    "a witness that reports different numbers than it signed is refused",
    lied.json.results?.[0]?.reason === "PAYLOAD_MISMATCH",
    JSON.stringify(lied.json.results),
  );
  void companionDigest(liar);

  // -- 8. Merkle batching and proofs -----------------------------------------
  console.log("\n4. anchoring and proofs");
  await post("/anchor/flush", {});

  const lotData = await get(`/lot/${lotA}`);
  const sample = lotData.records?.[0];

  // Poll for THIS record's own anchor rather than sleeping a fixed interval or checking
  // "is anything anchored" — under concurrent load (another script hammering the gateway
  // at the same time) a different batch can confirm first and the loop would break early
  // while this specific proof is still PENDING, reporting a false SKIP. VERIFIED now means
  // the anchor transaction CONFIRMED, so racing the chain at all risks the on-chain
  // assertions below skipping themselves while the run still reports all-green — the worst
  // outcome for the one check nobody can afford to lose.
  if (sample) {
    for (let i = 0; i < 40; i++) {
      const proof = await get(`/proof/${sample.digest}`).catch(() => null);
      if (!proof || proof.error) break; // no chain configured; checks below skip honestly
      if (proof.anchors?.local?.status === "ANCHORED") break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  check("the lot query returns the stored records", Boolean(sample), JSON.stringify(lotData).slice(0, 120));

  const proof = sample ? await get(`/proof/${sample.digest}`) : null;
  check("every stored record has a retrievable inclusion proof", Boolean(proof?.root));

  if (proof?.root) {
    check(
      "the proof verifies locally against its own root",
      verifyProof(proof.digest, proof.proof, proof.root),
    );
    check(
      "a tampered leaf does not verify",
      !verifyProof(`0x${"de".repeat(32)}` as Hex, proof.proof, proof.root),
    );
  }

  // -- 8b. The lot payload must let a client recompute the leaf ITSELF ---------
  //
  // The S2-03 precondition. A browser that verifies the `digest` we handed it has proved
  // only that our arithmetic is self-consistent. It has to re-encode the twelve canonical
  // fields of the record it is DISPLAYING and derive the leaf independently — otherwise the
  // headline claim of the demo is theatre. This asserts the HTTP contract carries enough to
  // do that, using only fields from the response.
  if (sample) {
    const rebuilt: SensorRecord = {
      v: sample.v,
      dev: sample.dev,
      seq: sample.seq,
      prev: sample.prev,
      ts: BigInt(sample.ts),
      tsq: sample.tsq,
      lot: sample.lot,
      t: sample.t,
      h: sample.h,
      lux: sample.lux,
      flags: sample.flags,
      bat: sample.bat,
    };
    const independent = recordDigest(rebuilt);
    check(
      "a client can recompute the leaf from the lot payload alone (S2-03 precondition)",
      independent.toLowerCase() === String(sample.digest).toLowerCase(),
      `recomputed ${independent}, API said ${sample.digest}`,
    );

    // And the recomputed leaf — not the served one — must be the thing that proves.
    if (proof?.root) {
      check(
        "the INDEPENDENTLY recomputed leaf verifies against the anchored root",
        verifyProof(independent, proof.proof, proof.root),
      );
    }

    // Tamper with a displayed value and the recomputed leaf must stop matching. This is
    // what makes the number on screen trustworthy rather than merely printed.
    const lied = recordDigest({ ...rebuilt, t: rebuilt.t + 1 });
    check(
      "altering a displayed reading breaks the recomputed leaf",
      lied.toLowerCase() !== independent.toLowerCase() &&
        (!proof?.root || !verifyProof(lied, proof.proof, proof.root)),
    );
  }

  // -- 9. The proof verifies against the root READ FROM THE CHAIN -------------
  let contract: Address | undefined;
  let chainId = 31337;
  try {
    const deployment = JSON.parse(
      readFileSync(join(REPO_ROOT, "deployments", "localhost", "addresses.json"), "utf8"),
    );
    contract = deployment.contracts.BatchAnchor;
    chainId = deployment.chainId;
  } catch {
    /* no deployment */
  }

  if (!contract || proof?.anchor?.status !== "ANCHORED") {
    skip(
      "the proof verifies against the on-chain root",
      contract ? `batch not anchored (status ${proof?.anchor?.status})` : "no local deployment",
    );
  } else {
    const chain = {
      id: chainId,
      name: "local",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    } as Chain;
    const client = createPublicClient({ chain, transport: http(RPC) });

    const onChainRoot = await client.readContract({
      address: contract,
      abi: ANCHOR_ABI,
      functionName: "getRoot",
      args: [BigInt(proof.anchorIndex)],
    });
    check(
      "the gateway's root matches the root stored on-chain",
      String(onChainRoot).toLowerCase() === String(proof.root).toLowerCase(),
    );
    check(
      "the proof verifies locally against the ON-CHAIN root",
      verifyProof(proof.digest, proof.proof, onChainRoot as Hex),
    );

    const included = await client.readContract({
      address: contract,
      abi: ANCHOR_ABI,
      functionName: "verifyInclusion",
      args: [BigInt(proof.anchorIndex), proof.digest, proof.proof],
    });
    check("the contract itself confirms inclusion", included === true);

    const rejected = await client.readContract({
      address: contract,
      abi: ANCHOR_ABI,
      functionName: "verifyInclusion",
      args: [BigInt(proof.anchorIndex), `0x${"de".repeat(32)}`, proof.proof],
    });
    check("the contract rejects a tampered leaf", rejected === false);
  }

  // -- 10. Badges tell the truth ---------------------------------------------
  console.log("\n5. badges");
  const breachState = await get(`/lot/${lotBreach}`);
  check("a breached lot reads FLAGGED", breachState.badge === "FLAGGED", breachState.badge);

  const gapLot = await get(`/lot/${lotA}`);
  check(
    "a lot with a chain gap reads UNVERIFIABLE",
    gapLot.badge === "UNVERIFIABLE",
    `got ${gapLot.badge}`,
  );

  const cleanState = await get(`/lot/${lotSpike}`);
  check(
    "a lot with only a lone spike is NOT flagged",
    cleanState.flagged === false,
    `flagged=${cleanState.flagged}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  console.error("\nIs the stack up? `npm run chain`, `npm run deploy:local`, `npm run dev:gateway`.");
  process.exit(1);
});
