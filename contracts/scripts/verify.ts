/**
 * Verify the deployed contract source on PolygonScan — ticket S1-13.
 *
 *   npm run verify:amoy
 *
 * Without this, a judge who follows the explorer link from the consumer page lands on a
 * page of bytecode. With it they see `anchor(bytes32,uint32,bytes32)`, the NatSpec, and the
 * `prevRoot` check — they can read what we claim the contract does and confirm it does it.
 * That is the difference between "here is a hash on a blockchain" and "here is a verifiable
 * commitment scheme", and it costs one command.
 *
 * Reads the addresses the deploy script wrote, so the constructor arguments cannot drift
 * out of sync with what was actually deployed. Already-verified contracts are reported and
 * skipped rather than treated as failures.
 *
 * Requires POLYGONSCAN_API_KEY in .env (free from polygonscan.com/apis).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import hre from "hardhat";

interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: Record<string, string>;
}

async function main(): Promise<void> {
  const network = hre.network.name;
  const path = join(__dirname, "..", "..", "deployments", network, "addresses.json");

  let deployment: Deployment;
  try {
    deployment = JSON.parse(readFileSync(path, "utf8")) as Deployment;
  } catch {
    console.error(`no deployments/${network}/addresses.json — run the deploy first`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.POLYGONSCAN_API_KEY) {
    console.error("POLYGONSCAN_API_KEY is not set in .env — get a free one at polygonscan.com/apis");
    process.exitCode = 1;
    return;
  }

  const { ActorRegistry, DeviceRegistry, LotRegistry, BatchAnchor } = deployment.contracts;

  // Constructor arguments, straight from deploy.ts: ActorRegistry takes the admin, and the
  // other three take the ActorRegistry address.
  const targets: Array<{ name: string; address: string; args: unknown[] }> = [
    { name: "ActorRegistry", address: ActorRegistry!, args: [deployment.deployer] },
    { name: "DeviceRegistry", address: DeviceRegistry!, args: [ActorRegistry] },
    { name: "LotRegistry", address: LotRegistry!, args: [ActorRegistry] },
    { name: "BatchAnchor", address: BatchAnchor!, args: [ActorRegistry] },
  ];

  let failed = 0;
  for (const target of targets) {
    process.stdout.write(`  ${target.name.padEnd(16)} ${target.address}  `);
    try {
      await hre.run("verify:verify", { address: target.address, constructorArguments: target.args });
      console.log("verified");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Re-verifying is a no-op, not a problem — this runs more than once in practice.
      if (/already verified/i.test(message)) {
        console.log("already verified");
      } else {
        console.log(`FAILED — ${message.split("\n")[0]}`);
        failed += 1;
      }
    }
  }

  const explorer = deployment.chainId === 80002 ? "https://amoy.polygonscan.com" : "";
  if (failed === 0 && explorer) {
    console.log(`\nBatchAnchor: ${explorer}/address/${BatchAnchor}#code`);
  }
  if (failed > 0) {
    console.error(`\n${failed} contract(s) failed to verify`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
