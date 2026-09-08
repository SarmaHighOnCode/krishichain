/**
 * Server-only helper for reading contract deployment addresses. Ticket S2-03.
 *
 * `deployments/<network>/addresses.json` is written by `contracts/scripts/deploy.ts`
 * (`deployments/localhost/` is gitignored and regenerated on every chain restart;
 * `deployments/amoy/` is committed so the web app can read it client-side-adjacent, i.e. here,
 * server-side, before handing the address down to the browser). On a fresh checkout nothing
 * has been deployed yet, so "the file doesn't exist" is an expected, non-error state — every
 * function here returns `null` rather than throwing.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type NetworkName = "localhost" | "amoy";

interface DeploymentAddresses {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    ActorRegistry: string;
    DeviceRegistry: string;
    LotRegistry: string;
    BatchAnchor: string;
  };
}

/**
 * Which `deployments/` subdirectory to read for a given chain id. Mirrors
 * `contracts/hardhat.config.ts`: 31337 is the local Hardhat node, anything else is treated as
 * Amoy (80002). Deliberately derived from `NEXT_PUBLIC_VERIFY_CHAIN_ID` rather than a second
 * env var, so the network and the chain id can never disagree.
 */
export function networkForChainId(chainId: number): NetworkName {
  return chainId === 31337 ? "localhost" : "amoy";
}

/**
 * Read `deployments/<network>/addresses.json` relative to the repo root (from `apps/web`,
 * that's `../../deployments/<network>/addresses.json`). Returns `null` — never throws — when
 * the file is missing, which is the normal state before `npm run deploy:local` /
 * `npm run deploy:amoy` has been run.
 */
export async function readDeployment(network: NetworkName): Promise<DeploymentAddresses | null> {
  try {
    const path = join(process.cwd(), "..", "..", "deployments", network, "addresses.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as DeploymentAddresses;
  } catch {
    return null;
  }
}

/** Convenience: just the `BatchAnchor` address the verify page needs, or `null`. */
export async function readBatchAnchorAddress(
  network: NetworkName,
): Promise<`0x${string}` | null> {
  const deployment = await readDeployment(network);
  const address = deployment?.contracts.BatchAnchor;
  return (address as `0x${string}` | undefined) ?? null;
}
