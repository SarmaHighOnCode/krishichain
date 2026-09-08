/**
 * Anchor service — ticket S1-09.
 *
 * These run against a real local chain because the property under test is a property of
 * the chain, not of our code in isolation: "did this transaction land?" can only be
 * answered by asking. Mocking the RPC here would test the mock.
 *
 * They skip cleanly when no chain is up, so `npm test` stays green on a fresh clone. To
 * run them for real:
 *
 *   npm run chain          # terminal 1
 *   npm run deploy:local   # terminal 2
 *   npm test -w @krishichain/gateway
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, type Address, type Hex } from "viem";

import { AnchorService, BATCH_ANCHOR_ABI, loadDeployment } from "./anchor.js";
import type { ClosedBatch } from "./batcher.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
/** Hardhat's first well-known dev account. Local chain only. */
const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const deployment = loadDeployment("localhost", REPO_ROOT);
const contract = deployment?.contracts.BatchAnchor;

const chain = {
  id: deployment?.chainId ?? 31337,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

async function chainIsUp(): Promise<boolean> {
  if (!contract) return false;
  try {
    const client = createPublicClient({ chain, transport: http(RPC, { timeout: 1500 }) });
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

const UP = await chainIsUp();
const SKIP = UP ? false : "no local chain — run `npm run chain` and `npm run deploy:local`";

function anchorCount(): Promise<number> {
  const client = createPublicClient({ chain, transport: http(RPC) });
  return client
    .readContract({ address: contract as Address, abi: BATCH_ANCHOR_ABI, functionName: "anchorCount" })
    .then(Number);
}

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let stateCounter = 0;
function freshService(): { service: AnchorService; statePath: string } {
  stateCounter += 1;
  const statePath = join(REPO_ROOT, "data", `anchor-test-${process.pid}-${stateCounter}.json`);
  rmSync(statePath, { force: true });
  return {
    statePath,
    service: new AnchorService({
      rpcUrl: RPC,
      privateKey: KEY,
      contract: contract as Address,
      chainId: deployment?.chainId ?? 31337,
      statePath,
      log: silent,
    }),
  };
}

/** A batch shaped like the batcher's output, chained onto whatever the chain already holds. */
async function nextBatch(index: number, seed: string): Promise<ClosedBatch> {
  const client = createPublicClient({ chain, transport: http(RPC) });
  const prevRoot =
    index === 0
      ? (`0x${"00".repeat(32)}` as Hex)
      : ((await client.readContract({
          address: contract as Address,
          abi: BATCH_ANCHOR_ABI,
          functionName: "getRoot",
          args: [BigInt(index - 1)],
        })) as Hex);

  return {
    index,
    root: `0x${seed.repeat(32).slice(0, 64)}` as Hex,
    prevRoot,
    leafCount: 4,
    proofs: [],
    closedAt: Date.now(),
    reason: "manual",
  };
}

test("anchors a batch and reports the transaction", { skip: SKIP }, async () => {
  const { service, statePath } = freshService();
  try {
    const index = await anchorCount();
    const record = await service.submit(await nextBatch(index, "a1"));

    assert.equal(record.status, "ANCHORED");
    assert.ok(record.txHash, "a landed anchor must carry its transaction hash");
    assert.equal(await anchorCount(), index + 1);
  } finally {
    rmSync(statePath, { force: true });
  }
});

test("writes its intent to disk before sending anything", { skip: SKIP }, async () => {
  // The high-water mark is the whole recovery mechanism: if the process dies between the
  // send and the receipt, the next start has to know this batch was in flight.
  const { service, statePath } = freshService();
  try {
    const index = await anchorCount();
    await service.submit(await nextBatch(index, "b2"));

    assert.ok(existsSync(statePath), "state file must exist after an anchor");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.highWater, index);
    assert.equal(state.anchors[String(index)].status, "ANCHORED");
  } finally {
    rmSync(statePath, { force: true });
  }
});

test("an RPC timeout does not become a double-anchor", { skip: SKIP }, async () => {
  // THE ticket S1-09 acceptance criterion. A timeout means we stopped waiting, not that
  // the transaction failed. Resending would push a second root into the anchor chain and
  // break the `prevRoot` continuity that makes a DROPPED batch detectable — so the naive
  // retry destroys the exact property anchoring exists to provide.
  const { service, statePath } = freshService();
  try {
    const index = await anchorCount();
    const batch = await nextBatch(index, "c3");
    await service.submit(batch);
    const afterFirst = await anchorCount();

    // Simulate the gateway never having learned the outcome.
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.anchors[String(index)].status = "PENDING";
    state.anchors[String(index)].error = "simulated RPC timeout";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(statePath, JSON.stringify(state));

    const recovered = new AnchorService({
      rpcUrl: RPC,
      privateKey: KEY,
      contract: contract as Address,
      chainId: deployment?.chainId ?? 31337,
      statePath,
      log: silent,
    });

    // Reconciling asks the chain and sends nothing.
    assert.equal(await recovered.reconcile(), 1);
    assert.equal(recovered.anchorFor(index)?.status, "ANCHORED");
    assert.equal(await anchorCount(), afterFirst, "reconcile must not send a transaction");

    // And a blind resubmit of the same batch must notice it already landed.
    const replayed = await recovered.submit(batch);
    assert.equal(replayed.status, "ANCHORED");
    assert.equal(await anchorCount(), afterFirst, "resubmitting must not anchor twice");
  } finally {
    rmSync(statePath, { force: true });
  }
});

test("the high-water mark survives a restart", { skip: SKIP }, async () => {
  const { service, statePath } = freshService();
  try {
    const index = await anchorCount();
    await service.submit(await nextBatch(index, "d4"));

    const restarted = new AnchorService({
      rpcUrl: RPC,
      privateKey: KEY,
      contract: contract as Address,
      chainId: deployment?.chainId ?? 31337,
      statePath,
      log: silent,
    });
    assert.equal(restarted.highWater, index);
    assert.equal(restarted.anchorFor(index)?.status, "ANCHORED");
  } finally {
    rmSync(statePath, { force: true });
  }
});

test("preflight reports a reachable chain and a funded signer", { skip: SKIP }, async () => {
  const { service, statePath } = freshService();
  try {
    const result = await service.preflight();
    assert.equal(result.ok, true, result.detail);
  } finally {
    rmSync(statePath, { force: true });
  }
});
