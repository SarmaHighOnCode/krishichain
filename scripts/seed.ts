/**
 * Seed a realistic multi-farm journey — ticket S1-11.
 *
 *   npm run seed
 *
 * Three smallholders' crates, each sensed by its own node, rolled into one truck lot, and
 * then one of them breaches. That last step is the point: `LotRegistry.flagLot` propagates
 * upward, so a breach in a single crate taints the shipment it was mixed into. A
 * traceability demo that cannot answer "what else is affected?" is a dashboard, not a
 * recall system.
 *
 * Leaves the stack in a state where the recall query has something to traverse:
 *
 *   curl localhost:8080/lot/<truck>/recall
 *
 * Requires: `npm run chain`, `npm run deploy:local`, `npm run dev:gateway`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const KEY = (process.env.LOCAL_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const AGGREGATE_ABI = [
  {
    type: "function",
    name: "aggregate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parent", type: "bytes16" },
      { name: "children", type: "bytes16[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLot",
    stateMutability: "view",
    inputs: [{ name: "lotId", type: "bytes16" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "custodian", type: "address" },
          { name: "state", type: "uint8" },
          { name: "flagged", type: "bool" },
          { name: "harvestTs", type: "uint64" },
          { name: "createdAt", type: "uint64" },
          { name: "parent", type: "bytes16" },
          { name: "gtin", type: "bytes14" },
          { name: "geohash", type: "string" },
        ],
      },
    ],
  },
] as const;

/** Three farms and the truck they all load onto. */
const FARMS = [
  {
    name: "Kadam smallholding",
    lot: "0x018f2c0000000000000000000000a001" as Hex,
    key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
    geohash: "tdr1v",
  },
  {
    name: "Pawar smallholding",
    lot: "0x018f2c0000000000000000000000a002" as Hex,
    key: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d" as Hex,
    geohash: "tdr1w",
  },
  {
    name: "Shinde smallholding",
    lot: "0x018f2c0000000000000000000000a003" as Hex,
    key: "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1" as Hex,
    geohash: "tdr1x",
  },
];

const TRUCK = {
  name: "Truck 27",
  lot: "0x018f2c0000000000000000000000b027" as Hex,
  key: "0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913" as Hex,
};

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json().catch(() => ({}));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Emit `count` signed records on one device's chain, into one lot. */
async function run(
  key: Hex,
  lot: Hex,
  count: number,
  startTs: number,
  temp: (i: number) => number,
  flagsFor: (i: number) => number = () => 0,
): Promise<void> {
  const dev = deviceAddressFromPrivateKey(key);
  await post("/devices", { address: dev, role: "HEAD" });

  let prev: Hex = ZERO_DIGEST;
  for (let seq = 0; seq < count; seq++) {
    const record: SensorRecord = {
      v: 1,
      dev,
      seq,
      prev,
      ts: BigInt(startTs + seq * 10),
      tsq: TimeQuality.FRESH,
      lot,
      t: temp(seq),
      h: 800 + (seq % 20),
      lux: 0,
      flags: flagsFor(seq) | (seq === 0 ? Flags.BOOT : 0),
      bat: 95 - seq,
    };
    prev = recordDigest(record);

    await post("/ingest", {
      v: 1,
      dev,
      records: [
        {
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
          sig: signRecord(record, key),
        },
      ],
    });
  }
}

/** Wait for the gateway's asynchronous on-chain lot creation to land. */
async function waitForLot(client: any, contract: Address, lot: Hex, tries = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const info = await client.readContract({
        address: contract,
        abi: AGGREGATE_ABI,
        functionName: "getLot",
        args: [lot],
      });
      if (Number(info.state) !== 0) return true;
    } catch {
      /* keep waiting */
    }
    await wait(400);
  }
  return false;
}

async function main(): Promise<void> {
  const deployPath = join(REPO_ROOT, "deployments", "localhost", "addresses.json");
  let contract: Address | undefined;
  let chainId = 31337;
  try {
    const deployment = JSON.parse(readFileSync(deployPath, "utf8"));
    contract = deployment.contracts.LotRegistry;
    chainId = deployment.chainId;
  } catch {
    console.error("no deployments/localhost/addresses.json — run `npm run deploy:local` first");
    process.exit(1);
  }

  const chain = {
    id: chainId,
    name: "local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as Chain;
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account: privateKeyToAccount(KEY), chain, transport: http(RPC) });

  const t0 = Math.floor(Date.now() / 1000) - 3600;

  console.log("seeding three smallholdings\n");
  for (const farm of FARMS) {
    // Kadam's crate warms up on the way to the collection point and stays warm — a
    // sustained excursion on one device, which is a breach by the slow route.
    const warms = farm.lot === FARMS[0]!.lot;
    await run(
      farm.key,
      farm.lot,
      12,
      t0,
      (i) => (warms && i >= 6 ? 120 + i * 8 : 40 + (i % 5)),
      () => 0,
    );
    console.log(`  ${farm.name.padEnd(22)} ${farm.lot}${warms ? "   <- this one warms up" : ""}`);
  }

  console.log(`\nloading ${TRUCK.name}`);
  await run(TRUCK.key, TRUCK.lot, 8, t0 + 200, (i) => 42 + (i % 4));

  console.log("\nwaiting for the gateway to open the lots on-chain");
  const all = [...FARMS.map((f) => f.lot), TRUCK.lot];
  for (const lot of all) {
    const ok = await waitForLot(publicClient, contract!, lot);
    console.log(`  ${lot}  ${ok ? "created" : "NOT created — is the chain running?"}`);
    if (!ok) process.exit(1);
  }

  console.log("\naggregating the three crates into the truck lot");
  const hash = await wallet.writeContract({
    address: contract!,
    abi: AGGREGATE_ABI,
    functionName: "aggregate",
    args: [TRUCK.lot, FARMS.map((f) => f.lot)],
    account: privateKeyToAccount(KEY),
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  aggregate tx ${hash}`);

  await post("/anchor/flush", {});
  await wait(1500);

  const recall = await fetch(`${GATEWAY}/lot/${TRUCK.lot}/recall`).then((r) => r.json());
  console.log(`\n--- recall on ${TRUCK.name} ---`);
  console.log(`on-chain state   ${recall.onChain?.state}`);
  console.log(`flagged          ${recall.onChain?.flagged}`);
  console.log(`fed by           ${recall.descendants?.length ?? 0} lots`);
  for (const a of recall.affected ?? []) {
    console.log(`  ${a.lot}  ${String(a.badge).padEnd(14)} ${a.recordCount} records  breaches=${a.breaches}`);
  }
  console.log(`\nsummary  ${JSON.stringify(recall.summary)}`);
  console.log(`\nThe warm crate flags itself, and the flag propagates up to the truck lot:`);
  console.log(`a breach in one smallholder's produce taints the shipment it was mixed into.`);
  console.log(`\nverify: http://localhost:3000/verify/${TRUCK.lot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("\nIs the stack up? `npm run chain`, `npm run deploy:local`, `npm run dev:gateway`.");
  process.exit(1);
});
