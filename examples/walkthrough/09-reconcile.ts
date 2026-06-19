/**
 * Tutorial §9 — Reconcile Balances
 * Reads the public ERC-20 balances of Alice, Bob, and the pool, plus the pool's shieldedSupply,
 * and checks that total value is conserved (expected 1000 with the demo amounts).
 *
 * Runnable (needs the Hardhat project for the provider + pool ABI):
 *   npx hardhat run examples/walkthrough/09-reconcile.ts --network hedera_testnet
 * Requires: a deployed pool (step 05) in .tutorial-state.json and UNDERLYING_TOKEN_ADDRESS.
 */
import { ethers } from "hardhat";
import * as path from "path";
import * as dotenv from "dotenv";
import { requirePool } from "./_zeto";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"];

async function main() {
  const token = process.env.UNDERLYING_TOKEN_ADDRESS;
  if (!token) throw new Error("Missing UNDERLYING_TOKEN_ADDRESS in .env (run 02 first).");
  const poolAddr = requirePool();

  const aliceAddr = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX!).address;
  const bobAddr = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX!).address;

  const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
  const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr);

  const [aliceBal, bobBal, poolBal, shieldedSupply] = await Promise.all([
    erc20.balanceOf(aliceAddr),
    erc20.balanceOf(bobAddr),
    erc20.balanceOf(poolAddr),
    pool.shieldedSupply(token),
  ]);

  console.log("=== Final balances (base units) ===");
  console.log(`   Alice=${aliceBal}  Bob=${bobBal}  pool=${poolBal}  shieldedSupply=${shieldedSupply}`);
  console.log(`   reconcile (Alice+Bob+pool) = ${aliceBal + bobBal + poolBal} (expected 1000)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
