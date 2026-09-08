import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodePacked, keccak256, stringToHex, toBytes, type Address, type Hex } from "viem";

const COMMISSIONER_ROLE = keccak256(stringToHex("COMMISSIONER"));
const FARMER_ROLE = keccak256(stringToHex("FARMER"));
const TRANSPORTER_ROLE = keccak256(stringToHex("TRANSPORTER"));
const ANCHOR_ROLE = keccak256(stringToHex("ANCHOR"));

const LOT_A: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";
const LOT_B: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f8";
const PARENT: Hex = "0x018f2c9a7b3d4e5f8091a2b3c4d5e600";
const GTIN: Hex = "0x0890123456789012345678901234";
const DEVICE: Address = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23";

async function deployAll() {
  const [admin, farmer, transporter, outsider] = await hre.viem.getWalletClients();

  const actors = await hre.viem.deployContract("ActorRegistry", [admin!.account.address]);
  const devices = await hre.viem.deployContract("DeviceRegistry", [actors.address]);
  const lots = await hre.viem.deployContract("LotRegistry", [actors.address]);
  const anchors = await hre.viem.deployContract("BatchAnchor", [actors.address]);

  await actors.write.registerActor([admin!.account.address, COMMISSIONER_ROLE, "KrishiChain Ops"]);
  await actors.write.registerActor([farmer!.account.address, FARMER_ROLE, "Ramesh"]);
  await actors.write.registerActor([transporter!.account.address, TRANSPORTER_ROLE, "Iqbal"]);
  await actors.write.grantRole([ANCHOR_ROLE, admin!.account.address]);

  return { actors, devices, lots, anchors, admin, farmer, transporter, outsider };
}

describe("ActorRegistry", () => {
  it("registers an actor and grants the role", async () => {
    const { actors, farmer } = await loadFixture(deployAll);
    expect(await actors.read.isActive([farmer!.account.address])).to.equal(true);
    expect(await actors.read.hasRole([FARMER_ROLE, farmer!.account.address])).to.equal(true);
  });

  it("revokes an actor without erasing them", async () => {
    const { actors, farmer } = await loadFixture(deployAll);
    await actors.write.revokeActor([farmer!.account.address]);
    expect(await actors.read.isActive([farmer!.account.address])).to.equal(false);
    const record = await actors.read.getActor([farmer!.account.address]);
    expect(record.name).to.equal("Ramesh");
  });

  it("refuses a duplicate registration", async () => {
    const { actors, farmer } = await loadFixture(deployAll);
    await expect(
      actors.write.registerActor([farmer!.account.address, FARMER_ROLE, "Ramesh again"]),
    ).to.be.rejected;
  });
});

describe("DeviceRegistry", () => {
  it("commissions a device", async () => {
    const { devices } = await loadFixture(deployAll);
    await devices.write.registerDevice([DEVICE, keccak256(stringToHex("TRANSIT_V1")), keccak256(stringToHex("meta"))]);
    expect(await devices.read.isActive([DEVICE])).to.equal(true);
  });

  it("rejects commissioning by a non-commissioner", async () => {
    const { devices, farmer } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("DeviceRegistry", devices.address, {
      client: { wallet: farmer },
    });
    await expect(
      asFarmer.write.registerDevice([DEVICE, keccak256(stringToHex("TRANSIT_V1")), "0x".padEnd(66, "0") as Hex]),
    ).to.be.rejected;
  });

  it("scopes revocation by block, so earlier records stay valid", async () => {
    const { devices } = await loadFixture(deployAll);
    await devices.write.registerDevice([DEVICE, keccak256(stringToHex("TRANSIT_V1")), keccak256(stringToHex("meta"))]);
    const record = await devices.read.getDevice([DEVICE]);
    const commissioned = record.commissionedBlock;

    await devices.write.revokeDevice([DEVICE, keccak256(stringToHex("KEY_LEAK"))]);
    const revoked = (await devices.read.getDevice([DEVICE])).revokedBlock;

    // Signed before the leak: still genuine.
    expect(await devices.read.isActiveAt([DEVICE, commissioned])).to.equal(true);
    expect(await devices.read.isActiveAt([DEVICE, revoked - 1n])).to.equal(true);
    // Signed after: not trusted.
    expect(await devices.read.isActiveAt([DEVICE, revoked])).to.equal(false);
    expect(await devices.read.isActiveAt([DEVICE, revoked + 100n])).to.equal(false);
  });

  it("treats an unknown device as inactive at every block", async () => {
    const { devices } = await loadFixture(deployAll);
    expect(await devices.read.isActiveAt([DEVICE, 1n])).to.equal(false);
  });
});

describe("LotRegistry", () => {
  it("creates a lot at harvest", async () => {
    const { lots, farmer } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: farmer },
    });
    await asFarmer.write.createLot([LOT_A, GTIN, "tdr1x", 1789012345n]);

    const lot = await lots.read.getLot([LOT_A]);
    expect(lot.creator.toLowerCase()).to.equal(farmer!.account.address.toLowerCase());
    expect(lot.state).to.equal(1); // CREATED
  });

  it("rejects a lot from an unregistered actor", async () => {
    const { lots, outsider } = await loadFixture(deployAll);
    const asOutsider = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: outsider },
    });
    await expect(asOutsider.write.createLot([LOT_A, GTIN, "tdr1x", 1n])).to.be.rejected;
  });

  it("aggregates crates into a truck lot, both directions traversable", async () => {
    const { lots, farmer } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: farmer },
    });
    await asFarmer.write.createLot([LOT_A, GTIN, "tdr1x", 1n]);
    await asFarmer.write.createLot([LOT_B, GTIN, "tdr1x", 1n]);
    await asFarmer.write.createLot([PARENT, GTIN, "tdr1x", 1n]);
    await asFarmer.write.aggregate([PARENT, [LOT_A, LOT_B]]);

    expect(await lots.read.getChildren([PARENT])).to.deep.equal([LOT_A, LOT_B]);
    expect((await lots.read.getLot([LOT_A])).parent).to.equal(PARENT);
  });

  it("propagates a breach flag up the aggregation graph", async () => {
    const { lots, farmer } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: farmer },
    });
    await asFarmer.write.createLot([LOT_A, GTIN, "tdr1x", 1n]);
    await asFarmer.write.createLot([PARENT, GTIN, "tdr1x", 1n]);
    await asFarmer.write.aggregate([PARENT, [LOT_A]]);

    await asFarmer.write.flagLot([LOT_A, keccak256(stringToHex("COLD_CHAIN_BREACH")), keccak256(stringToHex("evidence"))]);

    // A tainted crate must not be laundered by mixing it into a bigger shipment.
    expect((await lots.read.getLot([PARENT])).flagged).to.equal(true);
  });

  it("requires the receiver's signature to transfer custody", async () => {
    const { lots, farmer, transporter } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: farmer },
    });
    await asFarmer.write.createLot([LOT_A, GTIN, "tdr1x", 1n]);

    const ts = 1789012400n;
    const chainId = BigInt(await hre.viem.getPublicClient().then((c) => c.getChainId()));
    const digest = keccak256(
      encodePacked(
        ["bytes16", "address", "address", "uint64", "address", "uint256"],
        [LOT_A, farmer!.account.address, transporter!.account.address, ts, lots.address, chainId],
      ),
    );
    const signature = await transporter!.signMessage({ message: { raw: toBytes(digest) } });

    await asFarmer.write.transferCustody([LOT_A, transporter!.account.address, ts, signature]);
    const lot = await lots.read.getLot([LOT_A]);
    expect(lot.custodian.toLowerCase()).to.equal(transporter!.account.address.toLowerCase());
  });

  it("rejects a handoff the receiver did not sign", async () => {
    const { lots, farmer, transporter, outsider } = await loadFixture(deployAll);
    const asFarmer = await hre.viem.getContractAt("LotRegistry", lots.address, {
      client: { wallet: farmer },
    });
    await asFarmer.write.createLot([LOT_A, GTIN, "tdr1x", 1n]);

    const ts = 1789012400n;
    const chainId = BigInt(await hre.viem.getPublicClient().then((c) => c.getChainId()));
    const digest = keccak256(
      encodePacked(
        ["bytes16", "address", "address", "uint64", "address", "uint256"],
        [LOT_A, farmer!.account.address, transporter!.account.address, ts, lots.address, chainId],
      ),
    );
    // Signed by someone who is not the named receiver.
    const forged = await outsider!.signMessage({ message: { raw: toBytes(digest) } });

    await expect(
      asFarmer.write.transferCustody([LOT_A, transporter!.account.address, ts, forged]),
    ).to.be.rejected;
  });
});

describe("BatchAnchor", () => {
  it("anchors a root and chains to the previous one", async () => {
    const { anchors } = await loadFixture(deployAll);
    const rootA = keccak256(stringToHex("batch-a"));
    const rootB = keccak256(stringToHex("batch-b"));

    await anchors.write.anchor([rootA, 256, "0x".padEnd(66, "0") as Hex]);
    await anchors.write.anchor([rootB, 256, rootA]);

    expect(await anchors.read.anchorCount()).to.equal(2n);
    expect(await anchors.read.latestRoot()).to.equal(rootB);
  });

  it("rejects an anchor whose prevRoot does not match — a dropped batch is visible", async () => {
    const { anchors } = await loadFixture(deployAll);
    const rootA = keccak256(stringToHex("batch-a"));
    await anchors.write.anchor([rootA, 256, "0x".padEnd(66, "0") as Hex]);

    await expect(
      anchors.write.anchor([keccak256(stringToHex("batch-c")), 256, keccak256(stringToHex("wrong"))]),
    ).to.be.rejected;
  });

  it("rejects an anchor from an address without ANCHOR_ROLE", async () => {
    const { anchors, outsider } = await loadFixture(deployAll);
    const asOutsider = await hre.viem.getContractAt("BatchAnchor", anchors.address, {
      client: { wallet: outsider },
    });
    await expect(
      asOutsider.write.anchor([keccak256(stringToHex("x")), 1, "0x".padEnd(66, "0") as Hex]),
    ).to.be.rejected;
  });

  it("rejects an empty batch", async () => {
    const { anchors } = await loadFixture(deployAll);
    await expect(
      anchors.write.anchor([keccak256(stringToHex("x")), 0, "0x".padEnd(66, "0") as Hex]),
    ).to.be.rejected;
  });

  it("verifies a Merkle inclusion proof (two leaves, sorted pair)", async () => {
    const { anchors } = await loadFixture(deployAll);
    const a = keccak256(stringToHex("leaf-a"));
    const b = keccak256(stringToHex("leaf-b"));
    const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
    const root = keccak256(encodePacked(["bytes32", "bytes32"], [lo, hi]));

    await anchors.write.anchor([root, 2, "0x".padEnd(66, "0") as Hex]);
    expect(await anchors.read.verifyInclusion([0n, a, [b]])).to.equal(true);
    expect(await anchors.read.verifyInclusion([0n, keccak256(stringToHex("not-a-leaf")), [b]])).to.equal(false);
  });

  /**
   * SC-06. The whole cost model depends on this staying cheap (PRD §10.2, ADR-0003).
   *
   * 80k is close to the floor for this operation, not a slack budget:
   *   21,000  intrinsic transaction cost
   *   22,100  SSTORE of a fresh root slot
   *    5,000  array length update
   *   ~5,000  cross-contract role check against ActorRegistry
   *   ~2,000  event
   * Measured at ~75k. If this test starts failing, someone added storage to the hot
   * path — question that before raising the ceiling.
   */
  it("keeps anchor() under the 80,000 gas ceiling", async () => {
    const { anchors, admin } = await loadFixture(deployAll);
    const publicClient = await hre.viem.getPublicClient();
    const hash = await anchors.write.anchor([
      keccak256(stringToHex("gas-test")),
      256,
      "0x".padEnd(66, "0") as Hex,
    ]);
    const receipt = await publicClient.getTransactionReceipt({ hash });
    console.log(`      anchor() gas used: ${receipt.gasUsed}`);
    expect(Number(receipt.gasUsed)).to.be.lessThan(80_000);
    expect(admin).to.not.equal(undefined);
  });
});
