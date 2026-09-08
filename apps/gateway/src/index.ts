/**
 * KrishiChain gateway.
 *
 * The only component that talks to both the field and the chain — and it trusts neither.
 * Every record is verified before it is stored (ARCHITECTURE §2.3).
 *
 * Live: ingest, signature and chain verification, relay unwrapping, companion attestations,
 * the 2-of-3 consensus rules engine, Merkle batching, on-chain anchoring and the MQTT
 * fan-out that drives the twins dashboard.
 *
 * Anchors to the local chain only. A public mirror (Polygon Amoy) was built and then
 * deliberately descoped — see TEAM-PLAN.md §6 cut item 5. The demo path has always been
 * local by design (CLAUDE.md invariant 6); the local-only badge tells the truth about
 * exactly what it always told the truth about.
 */

import {
  ALERT_INTERVAL_SECONDS,
  CALM_INTERVAL_SECONDS,
  GatewayStore,
  OFFLINE_AFTER_MS,
  type StoredRecord,
} from "./store.js";
import {
  COMPANION_VERSION,
  ConsensusEngine,
  decodeRecord,
  hexToBytes,
  incidentToEpcisEvent,
  keccak256,
  NodeRole,
  recordToEpcisEvent,
  toEpcisDocument,
  Topics,
  ZERO_LOT,
  type CompanionAttestation,
  type Finding,
  type Hex,
  type NodeRoleValue,
  type RelayInfo,
  type SensorRecord,
} from "@krishichain/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import { z } from "zod";

import { AnchorService, loadDeployment, type AnchorRecord } from "./anchor.js";
import { MerkleBatcher, type ClosedBatch } from "./batcher.js";
import { LotService, TxQueue } from "./chain.js";
import {
  CompanionVerifier,
  MemoryDeviceDirectory,
  Verifier,
  type CompanionEvidence,
  type Outcome,
} from "./pipeline.js";
import { SwarmPublisher } from "./publisher.js";

// Repo-root .env, the same file the contracts workspace reads. Nobody should have to
// export variables by hand to get a working demo on a fresh clone. Safe here despite
// import hoisting: no imported module reads process.env at load time, and everything in
// this file that does runs below.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(REPO_ROOT, ".env") });

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";

const hex = (bytes: number) => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`));

const canonicalRecordSchema = z
  .object({
    canonical: hex(90),
    sig: hex(64).optional(),
    signature: hex(64).optional(),
  })
  .transform((val) => ({
    canonical: val.canonical,
    sig: (val.sig ?? val.signature)!,
  }));

const explodedRecordSchema = z.object({
  seq: z.number().int().min(0).max(0xffffffff),
  prev: hex(32),
  ts: z.union([z.number(), z.string()]),
  tsq: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  lot: hex(16),
  t: z.number().int().min(-32768).max(32767),
  h: z.number().int().min(0).max(0xffff),
  lux: z.number().int().min(0).max(0xffff),
  flags: z.number().int().min(0).max(0x7f),
  bat: z.number().int().min(0).max(0xff),
  sig: hex(64),
});

/**
 * Routing metadata a HEAD adds when forwarding a LEAF's batch.
 *
 * Note what is NOT here: any ability to change `dev`, `sig`, `seq` or `prev`. A relay
 * carries bytes it cannot alter without invalidating them, so verification stays
 * end-to-end against the origin device's key and the relay never becomes a trusted party
 * (ADR-0004 §3). Everything in this object is a hint for the map and the health view.
 */
const relaySchema = z.object({
  by: hex(20),
  rssi: z.number().int().min(-127).max(0).optional(),
  hops: z.number().int().min(1).max(8).default(1),
  recvTs: z.number().int().min(0).optional(),
});

// PROTOCOL.md §3.2 accepts two equivalent shapes: the firmware's raw canonical bytes (no
// on-device decode/re-encode round trip) and the exploded per-field shape the simulators and
// sim-node.ts speak. Both resolve to the same SensorRecord before anything downstream —
// companions, consensus, batching — has to care which one arrived.
const recordSchema = z.union([canonicalRecordSchema, explodedRecordSchema]);

const ingestSchema = z.object({
  v: z.literal(1).optional().default(1),
  dev: hex(20),
  records: z.array(recordSchema).min(1).max(100),
  relay: relaySchema.optional(),
  /** How many records the node is still holding. Drives the buffer-depth gauge. */
  buffered: z.number().int().min(0).optional(),
  role: z.enum(["HEAD", "LEAF", "WITNESS", "VIRTUAL"]).optional(),
});

const companionSchema = z.object({
  kind: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  seq: z.number().int().min(0).max(0xffffffff),
  ts: z.union([z.number(), z.string()]),
  subjectDev: hex(20),
  subjectSeq: z.number().int().min(0).max(0xffffffff),
  subject: hex(32),
  flags: z.number().int().min(0).max(0xff),
  payload: hex(32),
  sig: hex(64),
  evidence: z
    .union([
      z.object({
        imu: z.object({
          peakMilliG: z.number().int().min(0).max(0xffff),
          durationMs: z.number().int().min(0).max(0xffff),
          sampleHz: z.number().int().min(0).max(0xffff),
        }),
      }),
      z.object({
        gps: z.object({
          latMicro: z.number().int().min(-90_000_000).max(90_000_000),
          lonMicro: z.number().int().min(-180_000_000).max(180_000_000),
          accuracyCm: z.number().int().min(0).max(0xffff),
          speedCmS: z.number().int().min(0).max(0xffff),
        }),
      }),
    ])
    .optional(),
});

const companionIngestSchema = z.object({
  v: z.literal(1),
  dev: hex(20),
  companions: z.array(companionSchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// State. Ticket S1-06 replaces the in-memory store with SQLite.
// ---------------------------------------------------------------------------

const devices = new MemoryDeviceDirectory();
const verifier = new Verifier(devices);
const companionVerifier = new CompanionVerifier(devices);

const consensus = new ConsensusEngine({
  tempMaxDeciC: Math.round(Number(process.env.TEMP_MAX_C ?? 10) * 10),
  tempMinDeciC: Math.round(Number(process.env.TEMP_MIN_C ?? 0) * 10),
  sustainSeconds: Number(process.env.TEMP_BREACH_SECONDS ?? 30),
  windowSeconds: Number(process.env.CONSENSUS_WINDOW_SECONDS ?? 60),
});

const store = new GatewayStore(consensus);
const proofs = new Map<string, ClosedBatch>();
const batches: ClosedBatch[] = [];

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const publisher = new SwarmPublisher(MQTT_URL, app.log);

// ---------------------------------------------------------------------------
// Anchoring — ticket S1-09.
//
// Optional on purpose. If no chain is deployed the gateway still ingests, verifies,
// chains and batches; lots simply stay at PENDING_ANCHOR. A missing local chain must
// degrade the demo, not stop it.
// ---------------------------------------------------------------------------

const NETWORK = process.env.ANCHOR_NETWORK ?? "localhost";
const deployment = loadDeployment(NETWORK, REPO_ROOT);

const RPC_URL = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_KEY = process.env.LOCAL_PRIVATE_KEY as Hex | undefined;

// One queue for every transaction this gateway sends. Anchoring and lot flagging share a
// signer, and two concurrent writes from one account race for the same nonce.
const txQueue = new TxQueue();

const anchorService =
  deployment?.contracts.BatchAnchor && CHAIN_KEY
    ? new AnchorService({
        rpcUrl: RPC_URL,
        privateKey: CHAIN_KEY,
        contract: deployment.contracts.BatchAnchor,
        chainId: deployment.chainId,
        statePath: process.env.ANCHOR_STATE_PATH ?? join(REPO_ROOT, "data", "anchor-state.json"),
        log: app.log,
        queue: txQueue,
        onUpdate: (record) => publishAnchor(record),
      })
    : undefined;

const lotService =
  deployment?.contracts.LotRegistry && CHAIN_KEY
    ? new LotService({
        rpcUrl: RPC_URL,
        privateKey: CHAIN_KEY,
        contract: deployment.contracts.LotRegistry,
        chainId: deployment.chainId,
        queue: txQueue,
        log: app.log,
      })
    : undefined;

function publishAnchor(record: AnchorRecord): void {
  const batch = batches.find((b) => b.index === record.index);
  publisher.anchor({
    index: record.index,
    root: record.root as Hex,
    prevRoot: record.prevRoot as Hex,
    leafCount: record.leafCount,
    closedAt: batch?.closedAt ?? record.updatedAt,
    reason: batch?.reason ?? "manual",
    status: record.status,
    ...(deployment ? { chainId: deployment.chainId } : {}),
    ...(record.txHash ? { txHash: record.txHash as Hex } : {}),
    ...(record.blockNumber ? { blockNumber: record.blockNumber } : {}),
    ...(record.error ? { error: record.error } : {}),
  });
  if (record.status === "ANCHORED") {
    for (const lot of store.lots()) publishLot(lot as Hex);
  }
}

const batcher = new MerkleBatcher({
  maxLeaves: Number(process.env.BATCH_MAX_LEAVES ?? 256),
  maxSeconds: Number(process.env.BATCH_MAX_SECONDS ?? 60),
  onBatch: (batch) => {
    batches.push(batch);
    for (const proof of batch.proofs) proofs.set(proof.digest.toLowerCase(), batch);
    app.log.info({ index: batch.index, root: batch.root, leaves: batch.leafCount }, "batch closed");

    publisher.anchor({
      index: batch.index,
      root: batch.root,
      prevRoot: batch.prevRoot,
      leafCount: batch.leafCount,
      closedAt: batch.closedAt,
      reason: batch.reason,
      status: "PENDING",
    });

    // Lots whose records just became provable move from PENDING_ANCHOR to VERIFIED.
    for (const lot of store.lots()) publishLot(lot as Hex);

    // The service queues internally, so batches anchor in order and never race for a
    // `prevRoot`.
    void anchorService?.submit(batch).catch((error) => {
      app.log.error({ err: String(error), index: batch.index }, "anchor submit threw");
    });
  },
});

/**
 * Has this record's commitment actually LANDED on a chain?
 *
 * Not "is it in a closed Merkle batch" — that was the old meaning and it was a lie by
 * omission. A closed batch is a promise the gateway made to itself; until the anchor
 * transaction confirms, nothing outside this process has committed to anything, and a
 * transaction that later fails would have left the badge reading VERIFIED forever
 * (CLAUDE.md invariant 5).
 *
 * Consequence worth knowing: with no chain configured, nothing ever reaches VERIFIED and
 * every lot sits at PENDING_ANCHOR. That is the honest answer, not a regression.
 */
const isAnchored = (digest: Hex): boolean => {
  const batch = proofs.get(digest.toLowerCase());
  if (!batch || !anchorService) return false;
  return anchorService.anchorFor(batch.index)?.status === "ANCHORED";
};

function publishLot(lot: Hex): void {
  publisher.lot(store.lotState(lot, isAnchored));
}

/**
 * Turn a rules-engine finding into an incident, publish it, and flag the lot on-chain when
 * the finding is severe enough to warrant it.
 *
 * Only `breach` severity flags. A `warn` is a story one device tells about itself and an
 * `info` is a single uncorroborated signal; neither is grounds for marking a farmer's
 * consignment as spoiled, but both are visible on the ops dashboard. Refusing to flag on
 * weak evidence is as much a part of the product as flagging on strong evidence.
 */
function handleFinding(finding: Finding): void {
  const willFlag = finding.severity === "breach" && store.markFlagged(finding.lot);

  const incident = store.recordIncident({
    kind: finding.kind,
    severity: finding.severity,
    lot: finding.lot,
    dev: finding.devices[0] ?? null,
    signals: finding.signals,
    devices: finding.devices,
    evidence: finding.evidence,
    at: finding.at,
    detail: finding.detail,
    flagged: willFlag,
  });

  app.log.warn(
    { kind: finding.kind, lot: finding.lot, signals: finding.signals, flagged: willFlag },
    finding.detail,
  );
  publisher.incident(incident);
  publishLot(finding.lot);

  if (willFlag) {
    // The on-chain flag. Fired without awaiting: the incident is already recorded and
    // published, so the dashboard shows the breach immediately and the chain write
    // catches up. A slow RPC must not delay the alert (S1-10 wants it inside 10 s).
    void lotService
      ?.flagLot(finding.lot, finding.kind, finding.evidence[0] ?? (`0x${"00".repeat(32)}` as Hex))
      .then((tx) => {
        if (tx) {
          incident.detail = `${incident.detail} · flagged on-chain ${tx.slice(0, 12)}`;
          publisher.incident(incident);
        }
      });

    // Adaptive sampling: everything watching this lot speeds up so the incident is
    // captured at higher resolution while it is still happening (ADR-0004 §4).
    for (const node of store.allNodes()) {
      store.seeNode(node.dev, { intervalSeconds: ALERT_INTERVAL_SECONDS });
      publisher.command(node.dev, {
        cmd: "INTERVAL",
        seconds: ALERT_INTERVAL_SECONDS,
        issuedAt: Date.now(),
        reason: `${finding.kind} on lot ${finding.lot.slice(0, 10)}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", async () => ({
  ok: true,
  records: store.records.length,
  companions: store.companions.length,
  quarantined: store.quarantine.length,
  batches: batches.length,
  pendingLeaves: batcher.pendingCount,
  mqtt: publisher.isConnected,
}));

/** Commissioning helper. Ticket S1-06 reads DeviceRegistry on-chain instead. */
app.post("/devices", async (request, reply) => {
  const body = z
    .object({
      address: hex(20),
      role: z.enum(["HEAD", "LEAF", "WITNESS", "VIRTUAL"]).optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
    })
    .safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

  const address = body.data.address as Hex;
  devices.register(address);
  const info = store.seeNode(address, {
    role: (body.data.role ?? NodeRole.HEAD) as NodeRoleValue,
    ...(body.data.lat !== undefined ? { lat: body.data.lat } : {}),
    ...(body.data.lon !== undefined ? { lon: body.data.lon } : {}),
  });
  publisher.health(store.healthEvent(info));

  return { registered: address, role: info.role };
});

/** PROTOCOL.md §3.2 — batch upload from a node, optionally forwarded by a HEAD. */
app.post("/ingest", async (request, reply) => {
  const parsed = ingestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "malformed batch", detail: parsed.error.flatten() });
  }

  const { dev, records, relay, buffered, role } = parsed.data;
  const origin = dev as Hex;
  const relayInfo = relay as RelayInfo | undefined;
  const outcomes: Outcome[] = [];
  const findings: Finding[] = [];
  const touchedLots = new Set<string>();

  // A relay is a node too: hearing it forward someone else's traffic is evidence it is
  // alive, and the map needs it even when it has nothing of its own to report.
  if (relayInfo) {
    const head = store.seeNode(relayInfo.by, { role: NodeRole.HEAD });
    publisher.health(store.healthEvent(head));
  }

  for (const raw of records) {
    let record: SensorRecord;
    let sig: Hex;

    // PROTOCOL.md §3.2: the firmware posts raw canonical bytes (no on-device decode/
    // re-encode round trip); sim-node.ts and hand-built test payloads post exploded
    // fields. `origin` (the batch's `dev`) is authoritative either way — a relayed
    // canonical record's own `dev` byte is redundant with it by construction.
    if ("canonical" in raw) {
      record = decodeRecord(hexToBytes(raw.canonical));
      sig = raw.sig as Hex;
    } else {
      record = {
        v: 1,
        dev: origin,
        seq: raw.seq,
        prev: raw.prev as Hex,
        ts: BigInt(raw.ts),
        tsq: raw.tsq,
        lot: raw.lot as Hex,
        t: raw.t,
        h: raw.h,
        lux: raw.lux,
        flags: raw.flags,
        bat: raw.bat,
      };
      sig = raw.sig as Hex;
    }

    const outcome = verifier.ingest(record, sig);
    outcomes.push(outcome);

    if (outcome.status === "rejected") {
      store.quarantine.push({
        dev: origin,
        seq: record.seq,
        reason: outcome.reason,
        ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        receivedAt: Date.now(),
      });
      continue;
    }

    const entry: StoredRecord = {
      record,
      digest: outcome.digest,
      signature: sig,
      verdict: outcome.verdict,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(relayInfo ? { relay: relayInfo } : {}),
      receivedAt: Date.now(),
    };

    const firstSightingOfLot = store.recordsForLot(record.lot).length === 0;
    findings.push(...store.addRecord(entry));
    batcher.add(outcome.digest);
    touchedLots.add(record.lot.toLowerCase());

    // Open the lot on-chain the first time we see it. In the field a lot is created by a
    // node binding to a QR code, not by someone clicking a button, so the gateway is the
    // only component in a position to do this. Not awaited — ingest never waits on an RPC.
    if (firstSightingOfLot && record.lot !== ZERO_LOT) {
      void lotService?.ensureLot(record.lot, record.ts);
    }

    const info = store.node(origin);
    publisher.record({
      dev: origin,
      role: info?.role ?? NodeRole.HEAD,
      seq: record.seq,
      digest: outcome.digest,
      lot: record.lot,
      ts: record.ts.toString(),
      tsq: record.tsq,
      t: record.t,
      h: record.h,
      lux: record.lux,
      flags: record.flags,
      bat: record.bat,
      verdict: outcome.verdict,
      ...(relayInfo ? { relay: relayInfo } : {}),
      receivedAt: entry.receivedAt,
    });

    // A gap or a fork is never swallowed into a log line (CLAUDE.md invariant 5).
    if (outcome.verdict !== "ACCEPT" && outcome.verdict !== "DUPLICATE") {
      const incident = store.recordIncident({
        kind: outcome.verdict,
        severity: outcome.verdict === "CHAIN_FORK" ? "breach" : "warn",
        lot: record.lot,
        dev: origin,
        signals: [],
        devices: [origin],
        evidence: [outcome.digest],
        at: Number(record.ts),
        detail: outcome.detail ?? outcome.verdict,
        flagged: false,
      });
      publisher.incident(incident);
    }
  }

  const info = store.seeNode(origin, {
    ...(role ? { role: role as NodeRoleValue } : {}),
    ...(buffered !== undefined ? { bufferDepth: buffered } : {}),
  });
  publisher.health(store.healthEvent(info));

  for (const finding of findings) handleFinding(finding);
  for (const lot of touchedLots) publishLot(lot as Hex);

  const rejected = outcomes.filter((o) => o.status === "rejected");
  // An unregistered or revoked device gets 401 so the node stops retrying and buffers
  // instead of spinning (PROTOCOL.md §3.4).
  const unauthorised = rejected.some(
    (o) => o.status === "rejected" && o.reason !== "BAD_SIGNATURE",
  );

  const incidents = outcomes
    .filter((o) => o.status === "accepted" && o.verdict !== "ACCEPT")
    .map((o) => ({
      verdict: (o as { verdict: string }).verdict,
      detail: (o as { detail?: string }).detail,
    }));

  return reply.code(unauthorised ? 401 : 200).send({
    accepted: outcomes.filter((o) => o.status === "accepted").length,
    rejected: rejected.map((o) =>
      o.status === "rejected" ? { seq: o.record.seq, reason: o.reason } : null,
    ),
    incidents,
    findings: findings.map((f) => ({ kind: f.kind, severity: f.severity, detail: f.detail })),
    ackSeq: verifier.ackSeq(origin),
    intervalSeconds: info.intervalSeconds,
    serverTs: Math.floor(Date.now() / 1000),
  });
});

/**
 * Companion attestations from a CAM witness or a phone — ticket S1-14.
 *
 * Separate endpoint from `/ingest` because these are a different kind of claim: not "here
 * is what I measured" but "here is what I saw about someone else's measurement". They are
 * verified the same way and stored beside the record, never inside it.
 */
app.post("/companion", async (request, reply) => {
  const parsed = companionIngestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "malformed companions", detail: parsed.error.flatten() });
  }

  const witness = parsed.data.dev as Hex;
  const results: Array<{ seq: number; status: string; reason?: string }> = [];
  const findings: Finding[] = [];

  for (const raw of parsed.data.companions) {
    const companion: CompanionAttestation = {
      v: COMPANION_VERSION,
      kind: raw.kind,
      dev: witness,
      seq: raw.seq,
      ts: BigInt(raw.ts),
      subjectDev: raw.subjectDev as Hex,
      subjectSeq: raw.subjectSeq,
      subject: raw.subject as Hex,
      flags: raw.flags,
      payload: raw.payload as Hex,
    };

    const outcome = companionVerifier.ingest(
      companion,
      raw.sig as Hex,
      raw.evidence as CompanionEvidence,
    );

    if (outcome.status === "rejected") {
      store.quarantine.push({
        dev: witness,
        seq: raw.seq,
        reason: outcome.reason,
        ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
        receivedAt: Date.now(),
      });
      results.push({ seq: raw.seq, status: "rejected", reason: outcome.reason });
      continue;
    }

    const { stored, findings: found } = store.addCompanion({
      companion,
      digest: outcome.digest,
      signature: raw.sig as Hex,
      ...(outcome.imu !== undefined ? { imu: outcome.imu } : {}),
      receivedAt: Date.now(),
    });

    findings.push(...found);
    publisher.companion(store.companionEvent(stored, true));
    results.push({ seq: raw.seq, status: stored.lot ? "accepted" : "accepted-orphan" });
  }

  const info = store.seeNode(witness, { role: NodeRole.WITNESS });
  publisher.health(store.healthEvent(info));

  for (const finding of findings) handleFinding(finding);

  const unauthorised = results.some(
    (r) => r.reason === "UNKNOWN_DEVICE" || r.reason === "REVOKED_DEVICE",
  );

  return reply.code(unauthorised ? 401 : 200).send({
    accepted: results.filter((r) => r.status.startsWith("accepted")).length,
    results,
    findings: findings.map((f) => ({ kind: f.kind, severity: f.severity, detail: f.detail })),
    pendingSubjects: store.orphanCount,
    serverTs: Math.floor(Date.now() / 1000),
  });
});

/** Everything the consumer page needs for one lot. Ticket S1-11 adds the recall subtree. */
app.get<{ Params: { lotId: string } }>("/lot/:lotId", async (request, reply) => {
  const lotId = request.params.lotId.toLowerCase() as Hex;
  const records = store.recordsForLot(lotId);
  if (records.length === 0) return reply.code(404).send({ error: "unknown lot" });

  const state = store.lotState(lotId, isAnchored);

  return {
    lotId,
    badge: state.badge,
    flagged: state.flagged,
    recordCount: records.length,
    devices: state.devices,
    incidents: store.incidents.filter((i) => i.lot?.toLowerCase() === lotId),
    // EVERY canonical field, not just the ones worth displaying (PROTOCOL.md §1.1).
    //
    // `v`, `prev`, `lot` and `bat` are here for the browser, not for the UI. S2-03 has to
    // recompute the leaf from the record it is SHOWING the user — re-encode those twelve
    // fields, keccak them, and prove that hash is in the anchored tree. Verifying the
    // `digest` we handed over instead would only prove our own arithmetic is consistent,
    // which is worth nothing to someone deciding whether to trust us.
    //
    // So these four are load-bearing even though nothing renders them. Do not "tidy" them
    // away as unused: dropping any one of them silently reduces the money moment of the
    // demo to theatre.
    records: records.map((entry) => ({
      v: entry.record.v,
      seq: entry.record.seq,
      dev: entry.record.dev,
      prev: entry.record.prev,
      ts: entry.record.ts.toString(),
      tsq: entry.record.tsq,
      lot: entry.record.lot,
      t: entry.record.t,
      h: entry.record.h,
      lux: entry.record.lux,
      flags: entry.record.flags,
      bat: entry.record.bat,
      digest: entry.digest,
      verdict: entry.verdict,
      anchored: isAnchored(entry.digest),
      ...(entry.relay ? { relay: entry.relay } : {}),
      companions: store.companionsFor(entry.digest).map((c) => ({
        dev: c.companion.dev,
        kind: c.companion.kind,
        flags: c.companion.flags,
        payload: c.companion.payload,
        digest: c.digest,
      })),
    })),
  };
});

/** Every lot we know about. The ops dashboard's index and the demo's lot picker. */
app.get("/lots", async () => ({
  lots: store.lots().map((lot) => store.lotState(lot as Hex, isAnchored)),
}));

/**
 * Unsigned CAM photo upload — BENCH TESTING ONLY, not part of the trust protocol.
 *
 * The real witness path is POST /companion with a signed PHOTO attestation (payload =
 * keccak of the frame, verified against the device key in pipeline.ts). That needs
 * working on-device ECDSA, which currently panics the ESP32 (tinycrypt/micro-ecc
 * symbol collision — see firmware/platformio.ini). Until that is fixed, this endpoint
 * lets the minimal node-cam prove WiFi + camera + HTTP end to end: it POSTs the raw
 * JPEG bytes, we hash them server-side and return the digest the companion WOULD carry.
 * No signature check, no store write, nothing anchored — just the hash, for the demo.
 *
 * Lid verdict (bench-tuned on H2-04: sealed box reads mean <15, open room light >80,
 * threshold 40): we decode the JPEG here, take the mean luma, and report shut vs OPEN.
 * Done server-side so the ESP stays dumb — no image math on the constrained board.
 */
const LID_MEAN_THRESHOLD = Number(process.env.CAM_LID_THRESHOLD ?? 40);
app.post("/cam/photo", async (request, reply) => {
  const body = request.body as { bytes?: number[]; seq?: number; dev?: string } | undefined;
  if (!body?.bytes || !Array.isArray(body.bytes) || body.bytes.length === 0) {
    return reply.code(400).send({ error: "expected { bytes: number[], seq?: number, dev?: string }" });
  }
  const bytes = new Uint8Array(body.bytes);
  const digest = keccak256(bytes);
  let mean: number | null = null;
  let lid: "shut" | "OPEN" | "unknown" = "unknown";
  try {
    const { decode } = await import("jpeg-js");
    const img = decode(bytes, { useTArray: true });
    const data = img.data as Uint8Array;
    let acc = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 64) {
      acc += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    mean = n === 0 ? 0 : Math.round(acc / n);
    lid = mean > LID_MEAN_THRESHOLD ? "OPEN" : "shut";
  } catch {
    // Not a decodable JPEG (truncated frame, wrong bytes) — digest still returned.
  }
  app.log.info({ bytes: bytes.length, seq: body.seq ?? null, dev: body.dev ?? null, digest, mean, lid }, "cam photo received");
  return { ok: true, bytes: bytes.length, digest, mean, lid };
});

/**
 * The recall query — ticket S1-11.
 *
 * A recall runs BACKWARDS. The useful question is not "where did this crate go?" but
 * "which farms fed the lot on truck 27?", because that is what decides how much produce
 * has to be pulled. The aggregation graph is traversable in both directions on-chain, and
 * this endpoint walks both and joins each lot to what we actually observed.
 *
 * Degrades honestly: with no chain we still report this lot from local state and say so,
 * rather than implying an empty subtree means an uncontaminated one.
 */
app.get<{ Params: { lotId: string } }>("/lot/:lotId/recall", async (request, reply) => {
  const lotId = request.params.lotId.toLowerCase() as Hex;

  if (!lotService) {
    const local = store.recordsForLot(lotId);
    if (local.length === 0) return reply.code(404).send({ error: "unknown lot" });
    return {
      lot: lotId,
      chainAvailable: false,
      note: "no chain configured — aggregation graph unavailable, showing this lot only",
      onChain: null,
      ancestors: [],
      descendants: [],
      affected: [summarise(lotId)],
    };
  }

  const [onChain, ancestors, descendants] = await Promise.all([
    lotService.getLot(lotId),
    lotService.ancestors(lotId),
    lotService.descendants(lotId),
  ]);

  if (!onChain && store.recordsForLot(lotId).length === 0) {
    return reply.code(404).send({ error: "unknown lot" });
  }

  // Descendants are the recall set: everything that was rolled INTO this lot. Ancestors
  // matter too — if this crate was folded into a bigger shipment, that shipment is
  // implicated as well, which is why LotRegistry.flagLot propagates upward.
  const affectedLots = [lotId, ...descendants, ...ancestors];
  const affected = affectedLots.map((lot) => summarise(lot as Hex));

  return {
    lot: lotId,
    chainAvailable: true,
    onChain: onChain ?? null,
    ancestors,
    descendants,
    affected,
    summary: {
      lots: affectedLots.length,
      records: affected.reduce((n, a) => n + a.recordCount, 0),
      devices: new Set(affected.flatMap((a) => a.devices)).size,
      flaggedLots: affected.filter((a) => a.flagged).length,
      breaches: affected.reduce((n, a) => n + a.breaches, 0),
    },
  };
});

function summarise(lot: Hex): {
  lot: Hex;
  badge: string;
  recordCount: number;
  devices: string[];
  flagged: boolean;
  breaches: number;
  firstSeen: string | null;
  lastSeen: string | null;
} {
  const state = store.lotState(lot, isAnchored);
  const records = store.recordsForLot(lot);
  const incidents = store.incidents.filter((i) => i.lot?.toLowerCase() === lot.toLowerCase());
  return {
    lot,
    badge: state.badge,
    recordCount: state.recordCount,
    devices: state.devices,
    flagged: state.flagged,
    breaches: incidents.filter((i) => i.severity === "breach").length,
    firstSeen: records[0]?.record.ts.toString() ?? null,
    lastSeen: records[records.length - 1]?.record.ts.toString() ?? null,
  };
}

/** One device's history and current chain position. Ops uses this to chase a silent node. */
app.get<{ Params: { dev: string } }>("/device/:dev", async (request, reply) => {
  const dev = request.params.dev.toLowerCase() as Hex;
  const info = store.node(dev);
  const records = store.records.filter((r) => r.record.dev.toLowerCase() === dev);
  if (!info && records.length === 0) return reply.code(404).send({ error: "unknown device" });

  return {
    dev,
    health: info ? store.healthEvent(info) : null,
    chain: verifier.chainState(dev),
    recordCount: records.length,
    companionsWitnessed: store.companions.filter((c) => c.companion.dev.toLowerCase() === dev).length,
    incidents: store.incidents.filter((i) => i.dev?.toLowerCase() === dev),
    records: records.slice(-100).map((entry) => ({
      seq: entry.record.seq,
      ts: entry.record.ts.toString(),
      t: entry.record.t,
      digest: entry.digest,
      verdict: entry.verdict,
      anchored: isAnchored(entry.digest),
    })),
  };
});

/**
 * EPCIS 2.0 projection — ticket S1-12.
 *
 * We do not invent an event vocabulary. EPCIS 2.0 is the standard behind FSMA 204 and
 * EUDR, so a real supply-chain system could ingest this without a bespoke adapter — which
 * is most of the difference between a demo and a product.
 */
app.get<{ Params: { lotId: string } }>("/lot/:lotId/epcis", async (request, reply) => {
  const lotId = request.params.lotId.toLowerCase() as Hex;
  const records = store.recordsForLot(lotId);
  if (records.length === 0) return reply.code(404).send({ error: "unknown lot" });

  const events = records.map((entry) => recordToEpcisEvent(entry.record, entry.digest));

  // Breaches become their own inspecting/damaged events rather than being folded into a
  // sensor reading: a recall system needs to see the finding, not re-derive it.
  for (const incident of store.incidents) {
    if (incident.lot?.toLowerCase() !== lotId) continue;
    if (incident.severity !== "breach") continue;
    events.push(incidentToEpcisEvent(lotId, incident.at, incident.kind, incident.evidence[0]));
  }

  events.sort((a, b) => a.eventTime.localeCompare(b.eventTime));

  reply.header("content-type", "application/ld+json");
  return toEpcisDocument(events);
});

/** The inclusion proof the browser re-verifies against a root read from a public RPC. */
app.get<{ Params: { digest: string } }>("/proof/:digest", async (request, reply) => {
  const batch = proofs.get(request.params.digest.toLowerCase());
  if (!batch) return reply.code(404).send({ error: "not anchored yet", status: "PENDING_ANCHOR" });

  const entry = batch.proofs.find(
    (p) => p.digest.toLowerCase() === request.params.digest.toLowerCase(),
  );
  if (!entry) return reply.code(404).send({ error: "proof missing" });

  const anchored = anchorService?.anchorFor(batch.index);

  const local = {
    status: anchored?.status ?? "PENDING",
    chainId: deployment?.chainId ?? null,
    contract: deployment?.contracts.BatchAnchor ?? null,
    txHash: anchored?.txHash ?? null,
    blockNumber: anchored?.blockNumber ?? null,
    rpcUrl: RPC_URL,
  };

  return {
    digest: entry.digest,
    root: entry.root,
    proof: entry.proof,
    index: entry.index,
    leafCount: entry.leafCount,
    anchorIndex: batch.index,

    // Everything the browser needs to read the root from the chain and check our work
    // without asking us anything (PROTOCOL.md §4.1). If `status` is not ANCHORED the page
    // must say PENDING ANCHOR and must not imply a commitment that does not exist yet.
    anchors: { local },

    /** @deprecated Use `anchors.local`. Kept so existing callers do not break. */
    anchor: local,
  };
});

/** Anchor state, for the ops dashboard and for debugging a stuck chain write. */
app.get("/ops/anchors", async () => {
  if (!anchorService) {
    return { enabled: false, reason: "no deployment found or LOCAL_PRIVATE_KEY unset", anchors: [] };
  }
  return {
    enabled: true,
    network: NETWORK,
    chainId: deployment?.chainId,
    contract: deployment?.contracts.BatchAnchor,
    signer: anchorService.signer,
    highWater: anchorService.highWater,
    anchors: anchorService.all(),
  };
});

/** Resolve anchors whose outcome we never learned. Never sends a transaction. */
app.post("/ops/reconcile", async () => {
  if (!anchorService) return { enabled: false, resolved: 0 };
  return { enabled: true, resolved: await anchorService.reconcile() };
});

/** Force-close the open batch. Used by the demo script so nothing waits 60 s on stage. */
app.post("/anchor/flush", async () => {
  const batch = await batcher.close("manual");
  return { closed: batch?.index ?? null, root: batch?.root ?? null };
});

app.get("/ops/summary", async () => {
  const now = Date.now();
  return {
    records: store.records.length,
    companions: store.companions.length,
    orphanCompanions: store.orphanCount,
    quarantined: store.quarantine.length,
    batches: batches.length,
    pendingLeaves: batcher.pendingCount,
    lastRoot: batcher.lastRoot,
    incidents: store.incidents.length,
    breaches: store.incidents.filter((i) => i.severity === "breach").length,
    mqtt: { connected: publisher.isConnected, dropped: publisher.droppedCount },
    nodes: store.allNodes().map((info) => ({
      ...store.healthEvent(info, now),
      relayedBy: info.relayedBy ?? null,
    })),
  };
});

app.get("/ops/incidents", async () => ({ incidents: store.incidents }));

app.get("/ops/nodes", async () => {
  const now = Date.now();
  return { nodes: store.allNodes().map((info) => store.healthEvent(info, now)) };
});

/** Manual adaptive-sampling control, so the behaviour can be shown on demand. */
app.post("/ops/interval", async (request, reply) => {
  const body = z
    .object({ dev: hex(20).optional(), seconds: z.number().int().min(1).max(3600) })
    .safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

  const targets = body.data.dev
    ? [store.node(body.data.dev as Hex)].filter((n) => n !== undefined)
    : store.allNodes();

  for (const node of targets) {
    store.seeNode(node.dev, { intervalSeconds: body.data.seconds });
    publisher.command(node.dev, {
      cmd: "INTERVAL",
      seconds: body.data.seconds,
      issuedAt: Date.now(),
      reason: "operator request",
    });
  }

  return { updated: targets.map((n) => n.dev), seconds: body.data.seconds };
});

// ---------------------------------------------------------------------------
// Liveness. A node that stops reporting must go grey on the dashboard within 5 s
// (S2-12 acceptance) — which means the gateway has to notice silence, not just
// react to traffic. Nothing else would ever publish that transition.
// ---------------------------------------------------------------------------

const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const info of store.allNodes()) {
    publisher.health(store.healthEvent(info, now));
  }
}, Math.max(1000, Math.floor(OFFLINE_AFTER_MS / 2)));
heartbeat.unref();

// ---------------------------------------------------------------------------
// Flag reconciliation. The chain flags lots we never called flagLot on: rolling a
// tainted crate into a shipment taints the shipment, inside `aggregate()`, with no
// event naming the parent. Without this poll the gateway would serve VERIFIED for a
// lot the chain has already condemned — invariant 5, from an angle that is easy to miss
// because every one of our own code paths looks correct.
// ---------------------------------------------------------------------------

if (lotService) {
  const flagPoll = setInterval(() => {
    const known = store.lots().filter((lot) => !store.isFlagged(lot as Hex)) as Hex[];
    if (known.length === 0) return;

    void lotService
      .flaggedAmong(known)
      .then((flagged) => {
        for (const lot of flagged) {
          if (!store.markFlagged(lot)) continue;
          app.log.warn({ lot }, "lot flagged on-chain by aggregation — badge updated");
          const incident = store.recordIncident({
            kind: "CONSENSUS_BREACH",
            severity: "breach",
            lot,
            dev: null,
            signals: [],
            devices: [],
            evidence: [],
            at: Math.floor(Date.now() / 1000),
            detail: "tainted by an aggregated child lot — flag propagated on-chain",
            flagged: true,
          });
          publisher.incident(incident);
          publishLot(lot);
        }
      })
      .catch(() => {
        /* the chain is optional; a poll failure must never disturb ingest */
      });
  }, Number(process.env.FLAG_POLL_SECONDS ?? 5) * 1000);
  flagPoll.unref();
}

// Calm everything back down once a demo is reset.
app.post("/ops/calm", async () => {
  for (const node of store.allNodes()) {
    store.seeNode(node.dev, { intervalSeconds: CALM_INTERVAL_SECONDS });
    publisher.command(node.dev, {
      cmd: "INTERVAL",
      seconds: CALM_INTERVAL_SECONDS,
      issuedAt: Date.now(),
      reason: "calm",
    });
  }
  return { seconds: CALM_INTERVAL_SECONDS };
});

app.get("/topics", async () => ({
  prefix: "krishi/v1",
  broker: { tcp: MQTT_URL, ws: process.env.MQTT_WS_URL ?? "ws://127.0.0.1:9001" },
  subscribe: {
    records: Topics.allRecords,
    health: Topics.allHealth,
    companions: Topics.allCompanions,
    lots: Topics.allLots,
    incidents: Topics.incident,
    anchors: Topics.anchor,
  },
}));

publisher.start();

if (anchorService) {
  // Anything left PENDING by a previous run is resolved against the chain before we take
  // new traffic, so a crash mid-anchor never becomes a double-anchor.
  void anchorService.reconcile().then(async (resolved) => {
    const pre = await anchorService.preflight();

    // Pick up the anchor chain where the contract left it. A gateway restart must not
    // rewind the batcher to index 0 against a chain that is already past it.
    if (pre.ok) {
      try {
        const head = await anchorService.chainHead();
        batcher.resume(head.nextIndex, head.prevRoot as Hex);
        if (head.nextIndex > 0) {
          app.log.info(head, "resumed the anchor chain from on-chain state");
        }
      } catch (error) {
        app.log.warn({ err: String(error) }, "could not read the anchor head");
      }
    }

    app.log.info(
      { network: NETWORK, resolved, ...pre },
      pre.ok ? "anchoring enabled" : "anchoring configured but not reachable",
    );
  });
} else {
  app.log.warn(
    "anchoring disabled — no deployment or no LOCAL_PRIVATE_KEY. Records still verify and batch; lots stay PENDING_ANCHOR.",
  );
}

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`KrishiChain gateway listening on :${PORT}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
