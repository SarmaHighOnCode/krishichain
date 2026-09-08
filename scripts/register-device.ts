/**
 * Commission a device — the `npm run device:register` in CLAUDE.md.
 *
 *   npm run device:register -- --address 0x7f3a…c21b --class HEAD
 *   npm run device:register -- --address 0x… --revoke --reason "lost in the field"
 *
 * A node prints its address once at commissioning (H1-02). This is what H1 and H2 run with
 * that address to make the gateway and the chain accept it. Without it the node uploads,
 * gets a 401, blinks its fault LED and buffers forever — which is correct behaviour and a
 * baffling ten minutes if you do not know this step exists.
 *
 * Writes to BOTH the on-chain DeviceRegistry (the durable record, block-scoped so a
 * revocation invalidates only records signed after it) and the running gateway (which
 * currently keeps its own in-memory directory until S1-06 reads the chain directly).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Hex } from "../packages/core/src/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const KEY = (process.env.LOCAL_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

const DEVICE_REGISTRY_ABI = [
  {
    type: "function",
    name: "registerDevice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "device", type: "address" },
      { name: "class_", type: "bytes32" },
      { name: "metaHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeDevice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "device", type: "address" },
      { name: "reason", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "device", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const address = flag("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("usage: npm run device:register -- --address 0x<20 bytes> [--class HEAD] [--revoke]");
    console.error("       classes: HEAD | LEAF | WITNESS | VIRTUAL");
    process.exit(1);
  }

  const deviceClass = (flag("class") ?? "HEAD").toUpperCase();
  const revoking = has("revoke");
  const reason = flag("reason") ?? "operator request";
  const lat = flag("lat");
  const lon = flag("lon");

  // ---- chain -------------------------------------------------------------
  let contract: Address | undefined;
  let chainId = 31337;
  try {
    const deployment = JSON.parse(
      readFileSync(join(REPO_ROOT, "deployments", "localhost", "addresses.json"), "utf8"),
    );
    contract = deployment.contracts.DeviceRegistry;
    chainId = deployment.chainId;
  } catch {
    console.warn("! no deployments/localhost/addresses.json — skipping the on-chain step");
  }

  if (contract) {
    const chain = {
      id: chainId,
      name: "local",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    } as Chain;
    const account = privateKeyToAccount(KEY);
    const publicClient = createPublicClient({ chain, transport: http(RPC) });
    const wallet = createWalletClient({ account, chain, transport: http(RPC) });

    try {
      const active = await publicClient.readContract({
        address: contract,
        abi: DEVICE_REGISTRY_ABI,
        functionName: "isActive",
        args: [address as Address],
      });

      if (revoking) {
        if (!active) {
          console.log("  chain: already inactive, nothing to revoke");
        } else {
          const hash = await wallet.writeContract({
            address: contract,
            abi: DEVICE_REGISTRY_ABI,
            functionName: "revokeDevice",
            args: [address as Address, keccak256(stringToHex(reason))],
            account,
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          // Block-scoped: records this device signed BEFORE now stay valid. Revocation is
          // not retroactive, or every past reading from a lost node would become suspect.
          console.log(`  chain: revoked  tx ${hash}`);
        }
      } else if (active) {
        console.log("  chain: already registered");
      } else {
        const hash = await wallet.writeContract({
          address: contract,
          abi: DEVICE_REGISTRY_ABI,
          functionName: "registerDevice",
          args: [
            address as Address,
            keccak256(stringToHex(deviceClass)),
            keccak256(stringToHex(`${deviceClass}:${address}`)),
          ],
          account,
          chain,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`  chain: registered as ${deviceClass}  tx ${hash}`);
      }
    } catch (error) {
      console.warn(`  chain: FAILED — ${error instanceof Error ? error.message : error}`);
    }
  }

  // ---- gateway -----------------------------------------------------------
  try {
    if (revoking) {
      console.log("  gateway: restart it to drop the device from the in-memory directory (S1-06)");
    } else {
      const body: Record<string, unknown> = { address, role: deviceClass };
      if (lat) body.lat = Number(lat);
      if (lon) body.lon = Number(lon);

      const response = await fetch(`${GATEWAY}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      console.log(
        response.ok
          ? `  gateway: registered as ${json.role}`
          : `  gateway: FAILED — ${JSON.stringify(json)}`,
      );
    }
  } catch {
    console.warn(`  gateway: not reachable at ${GATEWAY} — start it with \`npm run dev:gateway\``);
  }

  console.log(`\n${revoking ? "revoked" : "commissioned"} ${address}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
