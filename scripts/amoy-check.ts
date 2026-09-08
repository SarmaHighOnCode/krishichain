/**
 * Amoy readiness check — ticket S1-13, and the mitigation for risk R2.
 *
 *   npm run amoy:check
 *
 * TASKS.md says do the Amoy deploy at hour 30, not hour 46. The reason is that every way
 * this fails is slow to fix: faucets rate-limit, they sometimes require a mainnet balance,
 * and the official Polygon faucet is retired. Discovering an empty key at hour 45 means no
 * public explorer link at all.
 *
 * So this checks — without deploying anything — whether the Amoy path would actually work,
 * and says exactly what to do about each failure. Run it early and run it again the
 * morning of the demo.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { createPublicClient, formatEther, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(REPO_ROOT, ".env") });

const RPC = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";
const KEY = process.env.AMOY_PRIVATE_KEY;

/** Enough for a deploy plus a demo's worth of anchors, with room to spare. */
const RECOMMENDED_POL = 0.2;

const amoy = {
  id: 80002,
  name: "Polygon Amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as Chain;

let problems = 0;

function ok(msg: string): void {
  console.log(`  ok    ${msg}`);
}
function bad(msg: string, fix: string): void {
  problems += 1;
  console.log(`  FAIL  ${msg}`);
  console.log(`        -> ${fix}`);
}
function warn(msg: string, fix: string): void {
  console.log(`  warn  ${msg}`);
  console.log(`        -> ${fix}`);
}

async function main(): Promise<void> {
  console.log("Amoy readiness\n");

  if (!KEY) {
    bad(
      "AMOY_PRIVATE_KEY is not set",
      "generate a fresh key for this ONLY, put it in .env (gitignored), and fund it",
    );
    console.log("\nnothing else can be checked without a key.");
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
    bad("AMOY_PRIVATE_KEY is not a 32-byte hex key", "check for a stray quote or newline in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(KEY as `0x${string}`);
  ok(`key parses — address ${account.address}`);

  // -- RPC ------------------------------------------------------------------
  const client = createPublicClient({ chain: amoy, transport: http(RPC, { timeout: 15_000 }) });

  let chainId: number | undefined;
  try {
    chainId = await client.getChainId();
    if (chainId === 80002) ok(`RPC reachable — ${RPC} (chainId 80002)`);
    else bad(`RPC returned chainId ${chainId}, expected 80002`, `is AMOY_RPC_URL pointing at Amoy?`);
  } catch (error) {
    bad(
      `RPC unreachable — ${error instanceof Error ? error.message : error}`,
      "try an Alchemy or QuickNode Amoy URL; the public endpoint is rate-limited",
    );
  }

  // -- Balance --------------------------------------------------------------
  if (chainId === 80002) {
    try {
      const balance = await client.getBalance({ address: account.address });
      const pol = Number(formatEther(balance));
      if (balance === 0n) {
        bad(
          "signer has 0 POL — it cannot deploy or anchor",
          "fund it at https://faucets.chain.link/polygon-amoy or the QuickNode Amoy faucet. The official Polygon faucet is retired.",
        );
      } else if (pol < RECOMMENDED_POL) {
        warn(
          `signer has ${pol.toFixed(4)} POL — thin for a deploy plus a demo`,
          `top up to about ${RECOMMENDED_POL} POL`,
        );
      } else {
        ok(`signer funded — ${pol.toFixed(4)} POL`);
      }
    } catch (error) {
      bad(`could not read balance — ${error instanceof Error ? error.message : error}`, "retry, or change RPC");
    }
  }

  // -- Deployment -----------------------------------------------------------
  const addressesPath = join(REPO_ROOT, "deployments", "amoy", "addresses.json");
  if (!existsSync(addressesPath)) {
    warn(
      "not deployed to Amoy yet",
      "run `npm run deploy:amoy` once the key is funded, and COMMIT deployments/amoy/addresses.json — the web app reads it client-side",
    );
  } else {
    try {
      const deployment = JSON.parse(readFileSync(addressesPath, "utf8"));
      ok(`deployment found — BatchAnchor ${deployment.contracts.BatchAnchor}`);

      if (chainId === 80002) {
        const code = await client.getCode({ address: deployment.contracts.BatchAnchor as Address });
        if (code && code !== "0x") {
          ok("BatchAnchor has code at that address on Amoy");
          console.log(
            `        https://amoy.polygonscan.com/address/${deployment.contracts.BatchAnchor}`,
          );
        } else {
          bad(
            "no contract code at the recorded address",
            "the addresses file is stale — redeploy with `npm run deploy:amoy`",
          );
        }
      }
    } catch (error) {
      bad(`addresses.json unreadable — ${error instanceof Error ? error.message : error}`, "redeploy");
    }
  }

  console.log(
    problems === 0
      ? "\nAmoy path is ready."
      : `\n${problems} problem(s) to fix. The local demo is unaffected — Amoy is the shareable mirror, not the demo path.`,
  );
  if (problems > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
