/**
 * Tutorial §7 — Private Transfer (shielded -> shielded)
 * Alice spends her 100-unit note into 40 (Bob) + 60 change (Alice). The anon_enc proof hides
 * the amounts and the Alice->Bob link; Bob recovers his note by decrypting the on-chain event.
 *
 * Runnable (needs the Hardhat project + compiled circuits):
 *   npx hardhat run examples/walkthrough/07-transfer.ts --network hedera_testnet
 * Requires: step 06 (deposit) already run — Alice's note is read from .tutorial-state.json.
 *
 * Persists Bob's recovered 40-unit note for step 08.
 */
import { ethers } from "hardhat";
import * as path from "path";
import * as dotenv from "dotenv";
import { newUTXO, ZERO_UTXO, prepareTransferProof, decryptNote } from "../../test/lib/zeto-witness";
import { loadUser, requirePool, readState, writeState } from "./_zeto";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TX_GAS = 3_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");

async function main() {
  const poolAddr = requirePool();
  const st = readState();
  if (!st.aliceNote) throw new Error("No aliceNote in state — run examples/walkthrough/06-deposit.ts first.");

  const aliceWallet = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX!, ethers.provider);
  const bobWallet = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX!, ethers.provider);
  const Alice = await loadUser("Alice", aliceWallet);
  const Bob = await loadUser("Bob", bobWallet);
  const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, aliceWallet);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

  // Reconstruct Alice's deposited note (same owner key + salt => same commitment hash)
  const utxo100 = newUTXO(Number(st.aliceNote.value), Alice, BigInt(st.aliceNote.salt));
  const utxoBob40 = newUTXO(40, Bob);
  const utxoAlice60 = newUTXO(60, Alice);
  const xfer = await prepareTransferProof(Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice]);

  const xferTx = await pool.transfer(
    [xfer.inputCommitments[0]],
    [xfer.outputCommitments[0], xfer.outputCommitments[1]],
    xfer.encryptionNonce,
    xfer.ecdhPublicKey,
    xfer.encryptedValues,
    xfer.encodedProof,
    "0x",
    ov,
  );
  const rcpt = await xferTx.wait();

  console.log("--------------------------------- Private Transfer (shielded) ---------------------------------");
  console.log("Status               :", rcpt!.status === 1 ? "SUCCESS" : "FAILED");
  console.log("Transaction hash     :", xferTx.hash);
  console.log("Hashscan URL         :", `https://hashscan.io/testnet/transaction/${xferTx.hash}`);
  console.log("Proof gen            :", `${xfer.ms}ms`);
  console.log("Gas used             :", rcpt!.gasUsed.toString());

  // Bob recovers his note from the UTXOTransferWithEncryptedValues event
  const evt = rcpt!.logs
    .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
  const recovered = decryptNote(
    Bob,
    evt!.args.encryptedValues.map((x: any) => BigInt(x)),
    BigInt(evt!.args.encryptionNonce),
    evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
    0, // Bob is output index 0
  );
  console.log("Bob decrypted note   :", `value=${recovered.value}`);

  // Persist Bob's spendable note for step 08
  writeState({ bobNote: { value: Number(recovered.value), salt: recovered.salt.toString() } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
