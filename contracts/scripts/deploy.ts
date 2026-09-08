/**
 * Deploy the KrishiChain contract set and write the addresses where the gateway and web app
 * can find them.
 *
 *   npm run deploy:local   # hardhat node on 8545 — the offline demo path
 *   npm run deploy:amoy    # Polygon Amoy — the shareable, publicly verifiable path
 *
 * deployments/localhost/ is gitignored (regenerated on every chain restart);
 * deployments/amoy/ IS committed, because the web app reads those addresses to fetch
 * anchor roots client-side.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import hre from "hardhat";
import { keccak256, stringToHex } from "viem";

const ANCHOR_ROLE = keccak256(stringToHex("ANCHOR"));
const COMMISSIONER_ROLE = keccak256(stringToHex("COMMISSIONER"));

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("no wallet client — is AMOY_PRIVATE_KEY set in .env?");

  const admin = deployer.account.address;
  const network = hre.network.name;
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  console.log(`deploying to ${network} (chainId ${chainId}) as ${admin}`);

  const actors = await hre.viem.deployContract("ActorRegistry", [admin]);
  console.log(`  ActorRegistry  ${actors.address}`);

  const devices = await hre.viem.deployContract("DeviceRegistry", [actors.address]);
  console.log(`  DeviceRegistry ${devices.address}`);

  const lots = await hre.viem.deployContract("LotRegistry", [actors.address]);
  console.log(`  LotRegistry    ${lots.address}`);

  const anchorContract = await hre.viem.deployContract("BatchAnchor", [actors.address]);
  console.log(`  BatchAnchor    ${anchorContract.address}`);

  // The deployer is the ops actor: it commissions devices and anchors batches.
  await actors.write.registerActor([admin, COMMISSIONER_ROLE, "KrishiChain Ops"]);
  await actors.write.grantRole([ANCHOR_ROLE, admin]);
  console.log("  ops actor registered with COMMISSIONER + ANCHOR roles");

  const out = {
    network,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: admin,
    contracts: {
      ActorRegistry: actors.address,
      DeviceRegistry: devices.address,
      LotRegistry: lots.address,
      BatchAnchor: anchorContract.address,
    },
  };

  const dir = join(__dirname, "..", "..", "deployments", network);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "addresses.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`\nwrote deployments/${network}/addresses.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
