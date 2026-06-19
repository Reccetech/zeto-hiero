/**
 * Tutorial §8 — Withdraw (shielded -> public)
 * Bob spends his 40-unit note (with a zero-value change note) and calls withdraw(); the pool
 * burns the commitment and transfers 40 real HTS units to msg.sender (Bob).
 *
 * Runnable (needs the Hardhat project + compiled circuits):
 *   npx hardhat run examples/walkthrough/08-withdraw.ts --network hedera_testnet
 * Requires: step 07 (transfer) already run — Bob's note is read from .tutorial-state.json.
 */
import { ethers } from "hardhat";
import * as path from "path";
import * as dotenv from "dotenv";
import { newUTXO, ZERO_UTXO, prepareWithdrawProof } from "../../test/lib/zeto-witness";
import { loadUser, requirePool, readState } from "./_zeto";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TX_GAS = 3_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");

async function main() {
  const poolAddr = requirePool();
  const st = readState();
  if (!st.bobNote) throw new Error("No bobNote in state — run examples/walkthrough/07-transfer.ts first.");

  const bobWallet = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX!, ethers.provider);
  const Bob = await loadUser("Bob", bobWallet);
  const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, bobWallet);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

  const amount = Number(st.bobNote.value);
  // Reconstruct Bob's note (same owner key + salt => same commitment hash)
  const bobNote = newUTXO(amount, Bob, BigInt(st.bobNote.salt));
  const change = newUTXO(0, Bob);
  const wd = await prepareWithdrawProof(Bob, [bobNote, ZERO_UTXO], change);

  const wdTx = await pool.withdraw(
    BigInt(amount), [wd.inputCommitments[0]], wd.output, wd.encodedProof, "0x", ov);
  const rcpt = await wdTx.wait();

  console.log("--------------------------------- Withdraw (shielded -> public) ---------------------------------");
  console.log("Status               :", rcpt!.status === 1 ? "SUCCESS" : "FAILED");
  console.log("Transaction hash     :", wdTx.hash);
  console.log("Hashscan URL         :", `https://hashscan.io/testnet/transaction/${wdTx.hash}`);
  console.log("Proof gen            :", `${wd.ms}ms`);
  console.log("Gas used             :", rcpt!.gasUsed.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
