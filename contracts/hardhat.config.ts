import "@nomicfoundation/hardhat-toolbox-viem";

import { config as loadEnv } from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "..", ".env") });

const AMOY_PRIVATE_KEY = process.env.AMOY_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin 5.x uses `mcopy`, which needs Cancun. Hardhat still defaults to Paris.
      // Polygon (and its Amoy testnet) is Cancun-enabled, so this is safe for our targets.
      evmVersion: "cancun",
      // Anchoring runs constantly; every gas unit there is multiplied by thousands of batches.
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      // Deterministic accounts and instant mining — this is the demo path (NFR-09).
      chainId: 31337,
    },
    localhost: {
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: AMOY_PRIVATE_KEY ? [AMOY_PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "INR",
  },
  etherscan: {
    apiKey: { polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? "" },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts",
  },
};

export default config;
