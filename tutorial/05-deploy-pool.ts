/**
 * Tutorial §5 — Deploy the Shielded-Pool Service + setupHTS
 * Deploys the verifiers and the HederaZetoTokenLite UUPS proxy via ethers + the OZ upgrades
 * plugin, then calls setupHTS. Writes the pool address to tutorial/.tutorial-state.json.
 *
 * Runnable (needs the Hardhat project: artifacts, upgrades plugin, network config):
 *   npx hardhat run tutorial/05-deploy-pool.ts --network hedera_testnet
 * Requires in .env: operator account (hardhat signer) + UNDERLYING_TOKEN_ADDRESS (run 02 first).
 *
 * Why ethers, not the Hiero SDK: the pool is a UUPS proxy (upgrades.deployProxy deploys the
 * implementation + ERC1967Proxy + runs storage-layout checks), and the later deposit/transfer/
 * withdraw calls carry an ABI-encoded Groth16 proof struct. Both are far simpler via ethers.
 */
import { ethers, upgrades } from "hardhat";
import * as path from "path";
import * as dotenv from "dotenv";
import { writeState } from "./_zeto";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 3_000_000n;

async function deploy(name: string): Promise<string> {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy({ gasLimit: DEPLOY_GAS });
  await c.waitForDeployment(); // sequential — let the relay settle the nonce
  return await c.getAddress();
}

async function main() {
  const token = process.env.UNDERLYING_TOKEN_ADDRESS;
  if (!token) throw new Error("Missing UNDERLYING_TOKEN_ADDRESS in .env (run 02-create-token.ts first).");

  const [operator] = await ethers.getSigners();
  console.log(`Operator: ${operator.address}`);
  console.log(`Token:    ${token}\n`);

  // 1) Verifiers (ours match our trusted setup; batch is an unused placeholder)
  console.log("Deploying verifiers...");
  const anonEnc = await deploy("AnonEncVerifierMVP");
  const deposit = await deploy("DepositVerifierMVP");
  const withdraw = await deploy("WithdrawVerifierMVP");
  const batch = await deploy("MockGroth16Verifier");
  console.log(`  anon_enc=${anonEnc}\n  deposit=${deposit}\n  withdraw=${withdraw}`);

  const verifiersInfo = {
    verifier: anonEnc,
    depositVerifier: deposit,
    withdrawVerifier: withdraw,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: batch,
    batchWithdrawVerifier: batch,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  // 2) Pool (UUPS proxy)
  console.log("Deploying HederaZetoTokenLite proxy...");
  const Pool = await ethers.getContractFactory("HederaZetoTokenLite");
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto MVP Pool", "ZTEST", operator.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer"], txOverrides: { gasLimit: DEPLOY_GAS } },
  );
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();

  console.log("--------------------------------- Deploy pool (UUPS proxy) ---------------------------------");
  console.log("Pool address               :", poolAddr);
  console.log("Hashscan URL               :", `https://hashscan.io/testnet/contract/${poolAddr}`);

  // 3) Wire the HTS token to the pool
  const setupTx = await pool.setupHTS(token, { gasLimit: TX_GAS });
  const setupRcpt = await setupTx.wait();
  console.log("--------------------------------- setupHTS ---------------------------------");
  console.log("Status                     :", setupRcpt!.status === 1 ? "SUCCESS" : "FAILED");
  console.log("Transaction hash           :", setupTx.hash);
  console.log("Hashscan URL               :", `https://hashscan.io/testnet/transaction/${setupTx.hash}`);
  console.log("Gas used                   :", setupRcpt!.gasUsed.toString());

  writeState({ poolAddr, verifiers: { anonEnc, deposit, withdraw, batch } });
  console.log(`\nSaved poolAddr to tutorial/.tutorial-state.json for the next steps.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
