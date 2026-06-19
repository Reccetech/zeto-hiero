/**
 * Tutorial §6 — Deposit (public -> shielded)
 * Alice approves the pool, builds a deposit proof locally, and calls deposit(). The pool pulls
 * the HTS tokens via transferFrom and mints a shielded commitment only Alice can spend.
 *
 * Runnable (needs the Hardhat project + compiled circuits in circuits/build/):
 *   npx hardhat run examples/walkthrough/06-deposit.ts --network hedera_testnet
 * Requires: steps 02 (token) + 04 (Alice funded) + 05 (pool deployed) already run.
 *
 * Persists Alice's 100-unit note (value + salt) to examples/walkthrough/.tutorial-state.json so step 07
 * can spend it (each step is a separate process; see _zeto.ts).
 */
import { ethers } from "hardhat";
import * as path from "path";
import * as dotenv from "dotenv";
import { newUTXO, ZERO_UTXO, prepareDepositProof } from "../../test/lib/zeto-witness";
import { loadUser, requirePool, writeState } from "./_zeto";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TX_GAS = 3_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");
const DEPOSIT = 100;
const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

async function main() {
  const token = process.env.UNDERLYING_TOKEN_ADDRESS;
  if (!token) throw new Error("Missing UNDERLYING_TOKEN_ADDRESS in .env (run 02 first).");
  const poolAddr = requirePool();

  const aliceWallet = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX!, ethers.provider);
  const Alice = await loadUser("Alice", aliceWallet);
  const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, aliceWallet);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

  // 1) Approve the pool to pull 100 base units
  const erc20 = new ethers.Contract(token, ERC20_ABI, aliceWallet);
  await (await erc20.approve(poolAddr, BigInt(DEPOSIT), ov)).wait();

  // 2) Build the note + deposit proof (real, client-side)
  const utxo100 = newUTXO(DEPOSIT, Alice);
  const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);

  // 3) Deposit
  const depTx = await pool.deposit(
    BigInt(DEPOSIT), [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov);
  const rcpt = await depTx.wait();

  console.log("--------------------------------- Deposit (public -> shielded) ---------------------------------");
  console.log("Status               :", rcpt!.status === 1 ? "SUCCESS" : "FAILED");
  console.log("Transaction hash     :", depTx.hash);
  console.log("Hashscan URL         :", `https://hashscan.io/testnet/transaction/${depTx.hash}`);
  console.log("Proof gen            :", `${dep.ms}ms`);
  console.log("Gas used             :", rcpt!.gasUsed.toString());
  console.log("Pool token balance   :", (await erc20.balanceOf(poolAddr)).toString());
  console.log("shieldedSupply       :", (await pool.shieldedSupply(token)).toString());

  // Persist Alice's spendable note for step 07
  writeState({ aliceNote: { value: DEPOSIT, salt: utxo100.salt.toString() } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
