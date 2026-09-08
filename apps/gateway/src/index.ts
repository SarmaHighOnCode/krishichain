/**
 * KrishiChain gateway.
 *
 * The only component that talks to both the field and the chain — and it trusts neither.
 * Every record is verified before it is stored (ARCHITECTURE §2.3).
 *
 * Current state: ingest + verification + Merkle batching are live against an in-memory
 * store, which is enough to drive the simulator and the web app end to end.
 * Remaining tickets: S1-09 anchor service, S1-10 rules engine, S1-11 query API, S1-12 EPCIS.
 */

import { decodeRecord, hexToBytes, type Hex, type SensorRecord } from "@krishichain/core";
import Fastify from "fastify";
import { z } from "zod";

import { MerkleBatcher, type ClosedBatch } from "./batcher.js";
import { MemoryDeviceDirectory, Verifier, type Outcome } from "./pipeline.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);

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

const ingestSchema = z.object({
  v: z.literal(1),
  dev: hex(20),
  records: z.array(recordSchema).min(1).max(100),
});

// ---------------------------------------------------------------------------
// State. Ticket S1-06 replaces these with SQLite and an on-chain DeviceRegistry read.
// ---------------------------------------------------------------------------

const devices = new MemoryDeviceDirectory();
const verifier = new Verifier(devices);

interface StoredRecord {
  record: SensorRecord;
  digest: Hex;
  signature: Hex;
  verdict: string;
  receivedAt: number;
}

const store: StoredRecord[] = [];
const quarantine: Array<{ record: SensorRecord; reason: string; receivedAt: number }> = [];
const proofs = new Map<string, ClosedBatch>();
const batches: ClosedBatch[] = [];

const batcher = new MerkleBatcher({
  maxLeaves: Number(process.env.BATCH_MAX_LEAVES ?? 256),
  maxSeconds: Number(process.env.BATCH_MAX_SECONDS ?? 60),
  onBatch: (batch) => {
    batches.push(batch);
    for (const proof of batch.proofs) proofs.set(proof.digest.toLowerCase(), batch);
    app.log.info({ index: batch.index, root: batch.root, leaves: batch.leafCount }, "batch closed");
    // TODO(S1-09): anchor service — BatchAnchor.anchor(root, leafCount, prevRoot) with a
    // persisted nonce high-water mark. An RPC timeout is NOT a failed transaction; treat it
    // as unknown-state and resolve on the next tick, or you will double-anchor.
  },
});

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", async () => ({
  ok: true,
  records: store.length,
  quarantined: quarantine.length,
  batches: batches.length,
  pendingLeaves: batcher.pendingCount,
}));

/** Commissioning helper. Ticket S1-06 reads DeviceRegistry on-chain instead. */
app.post("/devices", async (request, reply) => {
  const body = z.object({ address: hex(20) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

  devices.register(body.data.address as Hex);
  return { registered: body.data.address };
});

/** PROTOCOL.md §3.2 — batch upload from a node. */
app.post("/ingest", async (request, reply) => {
  const parsed = ingestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "malformed batch", detail: parsed.error.flatten() });
  }

  const { dev, records } = parsed.data;
  const outcomes: Outcome[] = [];

  for (const raw of records) {
    const record: SensorRecord = {
      v: 1,
      dev: dev as Hex,
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
      quarantine.push({ record, reason: outcome.reason, receivedAt: Date.now() });
      continue;
    }

    store.push({
      record,
      digest: outcome.digest,
      signature: raw.sig as Hex,
      verdict: outcome.verdict,
      receivedAt: Date.now(),
    });
    batcher.add(outcome.digest);

    // TODO(S1-10): rules engine — cold-chain threshold and tamper flags raise an incident and
    // call LotRegistry.flagLot within 10 s of the causing record (GW-07).
  }

  const rejected = outcomes.filter((o) => o.status === "rejected");
  // An unregistered or revoked device gets 401 so the node stops retrying and buffers
  // instead of spinning (PROTOCOL.md §3.4).
  const unauthorised = rejected.some(
    (o) => o.status === "rejected" && o.reason !== "BAD_SIGNATURE",
  );

  const incidents = outcomes
    .filter((o) => o.status === "accepted" && o.verdict !== "ACCEPT")
    .map((o) => ({ verdict: (o as { verdict: string }).verdict, detail: (o as { detail?: string }).detail }));

  const body = {
    accepted: outcomes.filter((o) => o.status === "accepted").length,
    rejected: rejected.map((o) => (o.status === "rejected" ? { seq: o.record.seq, reason: o.reason } : null)),
    incidents,
    ackSeq: verifier.ackSeq(dev as Hex),
    serverTs: Math.floor(Date.now() / 1000),
  };

  return reply.code(unauthorised ? 401 : 200).send(body);
});

/** Everything the consumer page needs for one lot. Ticket S1-11 adds the recall subtree. */
app.get<{ Params: { lotId: string } }>("/lot/:lotId", async (request, reply) => {
  const lotId = request.params.lotId.toLowerCase();
  const records = store.filter((entry) => entry.record.lot.toLowerCase() === lotId);
  if (records.length === 0) return reply.code(404).send({ error: "unknown lot" });

  return {
    lotId,
    recordCount: records.length,
    records: records.map((entry) => ({
      seq: entry.record.seq,
      ts: entry.record.ts.toString(),
      tsq: entry.record.tsq,
      t: entry.record.t,
      h: entry.record.h,
      lux: entry.record.lux,
      flags: entry.record.flags,
      digest: entry.digest,
      verdict: entry.verdict,
      anchored: proofs.has(entry.digest.toLowerCase()),
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

  return {
    digest: entry.digest,
    root: entry.root,
    proof: entry.proof,
    index: entry.index,
    leafCount: entry.leafCount,
    anchorIndex: batch.index,
    // TODO(S1-09): include { chainId, txHash, blockNumber } once anchoring is live.
  };
});

/** Force-close the open batch. Used by the demo script so nothing waits 60 s on stage. */
app.post("/anchor/flush", async () => {
  const batch = await batcher.close("manual");
  return { closed: batch?.index ?? null, root: batch?.root ?? null };
});

app.get("/ops/summary", async () => ({
  records: store.length,
  quarantined: quarantine.length,
  batches: batches.length,
  pendingLeaves: batcher.pendingCount,
  lastRoot: batcher.lastRoot,
  incidents: store.filter((entry) => entry.verdict !== "ACCEPT").length,
}));

// Keep the unused-import linter honest about helpers the next tickets will need.
void decodeRecord;
void hexToBytes;

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`KrishiChain gateway listening on :${PORT}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
