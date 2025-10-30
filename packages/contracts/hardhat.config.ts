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
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545/",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    },
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.binance.org/",
      accounts: PRIV_KEY ? [PRIV_KEY] : []
    }
  },
  etherscan: {
    // Hardhat Etherscan plugin supports BscScan using keys for 'bsc' and 'bscTestnet'
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || ""
    }
  }
};
export default config;
