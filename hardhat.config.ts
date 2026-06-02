import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-deploy";
import "hardhat-contract-sizer";
import * as dotenv from "dotenv";

dotenv.config();

const operatorKey = process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX;
const testnetRpc = process.env.HEDERA_TESTNET_RPC_URL ?? "https://testnet.hashio.io/api";
const mainnetRpc = process.env.HEDERA_MAINNET_RPC_URL ?? "https://mainnet.hashio.io/api";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      // Hedera runs Cancun EVM (PRD §5). Required for OZ Arrays.sol `mcopy` opcode
      // and matches upstream Zeto's compilation target.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    hedera_testnet: {
      url: testnetRpc,
      chainId: 296,
      accounts: operatorKey ? [operatorKey] : [],
      timeout: 120_000,
    },
    hedera_mainnet: {
      url: mainnetRpc,
      chainId: 295,
      accounts: operatorKey ? [operatorKey] : [],
      timeout: 120_000,
    },
  },
  namedAccounts: {
    deployer: { default: 0 },
  },
  paths: {
    sources: "contracts",
    tests: "test",
    deploy: "deploy",
    deployments: "deployments",
    cache: "cache",
    artifacts: "artifacts",
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
    strict: false,
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
