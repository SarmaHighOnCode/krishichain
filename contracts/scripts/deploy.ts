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

  /**
   * A public testnet only needs the anchor.
   *
   * Amoy exists to answer one question — "is this Merkle root committed somewhere we do
   * not control?" — and only `BatchAnchor` answers it (plus `ActorRegistry`, because
   * `anchor()` is role-gated). Device commissioning and the lot lifecycle are business
   * logic that runs against the local chain, so deploying them to a testnet spends real
   * faucet POL on contracts nothing will ever call.
   *
   * That is not a rounding error. Measured at 50 gwei on Amoy:
   *
   *     full        3,528,935 gas   0.176 POL
   *     anchor-only 1,415,574 gas   0.071 POL   <- LotRegistry alone is 0.075
   *
   * Faucets drip 0.1 POL per day. Anchor-only is the difference between deploying today
   * and waiting on a second faucet claim tomorrow.
   */
  const scope = process.env.DEPLOY_SCOPE ?? (network === "localhost" || network === "hardhat" ? "full" : "anchor");
  const anchorOnly = scope === "anchor";

  console.log(`deploying to ${network} (chainId ${chainId}) as ${admin}`);
  console.log(`scope: ${anchorOnly ? "anchor-only (ActorRegistry + BatchAnchor)" : "full"}`);

  const actors = await hre.viem.deployContract("ActorRegistry", [admin]);
  console.log(`  ActorRegistry  ${actors.address}`);

  const devices = anchorOnly ? undefined : await hre.viem.deployContract("DeviceRegistry", [actors.address]);
  if (devices) console.log(`  DeviceRegistry ${devices.address}`);

  const lots = anchorOnly ? undefined : await hre.viem.deployContract("LotRegistry", [actors.address]);
  if (lots) console.log(`  LotRegistry    ${lots.address}`);

  const anchorContract = await hre.viem.deployContract("BatchAnchor", [actors.address]);
  console.log(`  BatchAnchor    ${anchorContract.address}`);

  // The deployer is the ops actor: it commissions devices and anchors batches.
  await actors.write.registerActor([admin, COMMISSIONER_ROLE, "KrishiChain Ops"]);
  await actors.write.grantRole([ANCHOR_ROLE, admin]);
  console.log("  ops actor registered with COMMISSIONER + ANCHOR roles");

  const out = {
    network,
    chainId,
    scope,
    deployedAt: new Date().toISOString(),
    deployer: admin,
    contracts: {
      ActorRegistry: actors.address,
      ...(devices ? { DeviceRegistry: devices.address } : {}),
      ...(lots ? { LotRegistry: lots.address } : {}),
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
