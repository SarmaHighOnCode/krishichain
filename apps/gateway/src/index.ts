/**
 * KrishiChain gateway.
 *
 * The only component that talks to both the field and the chain — and it trusts neither.
 * Every record is verified before it is stored (ARCHITECTURE §2.3).
 *
 * Live: ingest, signature and chain verification, relay unwrapping, companion attestations,
 * the 2-of-3 consensus rules engine, Merkle batching, on-chain anchoring and the MQTT
 * fan-out that drives the twins dashboard.
 * Remaining: S1-11 recall subtree, S1-12 EPCIS, S1-13 Amoy.
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
  NodeRole,
  Topics,
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

const recordSchema = z.object({
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

const ingestSchema = z.object({
  v: z.literal(1),
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

const anchorService =
  deployment?.contracts.BatchAnchor && process.env.LOCAL_PRIVATE_KEY
    ? new AnchorService({
        rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
        privateKey: process.env.LOCAL_PRIVATE_KEY as Hex,
        contract: deployment.contracts.BatchAnchor,
        chainId: deployment.chainId,
        statePath: process.env.ANCHOR_STATE_PATH ?? join(REPO_ROOT, "data", "anchor-state.json"),
        log: app.log,
        onUpdate: (record) => publishAnchor(record),
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

    // The local chain is the path the demo depends on, so it is awaited. The service
    // queues internally, so batches anchor in order and never race for a `prevRoot`.
    void anchorService?.submit(batch).catch((error) => {
      app.log.error({ err: String(error), index: batch.index }, "anchor submit threw");
    });
  },
});

const isAnchored = (digest: Hex): boolean => proofs.has(digest.toLowerCase());

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
    // TODO(S1-13): LotRegistry.flagLot(lot, reason, evidenceDigest) once the anchor
    // service owns a funded signer. The incident is already recorded and published, so
    // the demo shows the breach whether or not the chain write has landed yet.

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
    const record: SensorRecord = {
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

    const outcome = verifier.ingest(record, raw.sig as Hex);
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
      signature: raw.sig as Hex,
      verdict: outcome.verdict,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      ...(relayInfo ? { relay: relayInfo } : {}),
      receivedAt: Date.now(),
    };

    findings.push(...store.addRecord(entry));
    batcher.add(outcome.digest);
    touchedLots.add(record.lot.toLowerCase());

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
    records: records.map((entry) => ({
      seq: entry.record.seq,
      dev: entry.record.dev,
      ts: entry.record.ts.toString(),
      tsq: entry.record.tsq,
      t: entry.record.t,
      h: entry.record.h,
      lux: entry.record.lux,
      flags: entry.record.flags,
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

/** The inclusion proof the browser re-verifies against a root read from a public RPC. */
app.get<{ Params: { digest: string } }>("/proof/:digest", async (request, reply) => {
  const batch = proofs.get(request.params.digest.toLowerCase());
  if (!batch) return reply.code(404).send({ error: "not anchored yet", status: "PENDING_ANCHOR" });

  const entry = batch.proofs.find(
    (p) => p.digest.toLowerCase() === request.params.digest.toLowerCase(),
  );
  if (!entry) return reply.code(404).send({ error: "proof missing" });

  const anchored = anchorService?.anchorFor(batch.index);

  return {
    digest: entry.digest,
    root: entry.root,
    proof: entry.proof,
    index: entry.index,
    leafCount: entry.leafCount,
    anchorIndex: batch.index,
    // Everything the browser needs to read the root from a public RPC and check our work
    // without asking us anything (PROTOCOL.md §4.1). If `status` is not ANCHORED the page
    // must say PENDING ANCHOR rather than implying a commitment that does not exist yet.
    anchor: anchored
      ? {
          status: anchored.status,
          chainId: deployment?.chainId ?? null,
          contract: deployment?.contracts.BatchAnchor ?? null,
          txHash: anchored.txHash ?? null,
          blockNumber: anchored.blockNumber ?? null,
        }
      : { status: "PENDING", chainId: deployment?.chainId ?? null, contract: deployment?.contracts.BatchAnchor ?? null, txHash: null, blockNumber: null },
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
