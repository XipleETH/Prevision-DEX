import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Normalize PRIVATE_KEY: allow 64-hex without 0x and auto-prefix it
const RAW_PK = (process.env.PRIVATE_KEY || "").trim();
const PRIV_KEY = RAW_PK ? (RAW_PK.startsWith("0x") ? RAW_PK : ("0x" + RAW_PK)) : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {},
    // BNB Chain (BSC) networks
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://bsc-testnet.publicnode.com",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    },
    bsc: {
      url: process.env.BSC_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    },
    // Legacy Base networks kept for compatibility if needed
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    },
    base: {
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    }
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || ""
    },
    customChains: [
      // BSC (etherscan plugin supports these IDs; endpoints known)
      {
        network: "bsc",
        chainId: 56,
        urls: {
          apiURL: "https://api.bscscan.com/api",
          browserURL: "https://bscscan.com"
        }
      },
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api-testnet.bscscan.com/api",
          browserURL: "https://testnet.bscscan.com"
        }
      },
      // Base (kept)
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  }
};
export default config;
