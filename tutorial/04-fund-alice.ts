/**
 * Tutorial §4 — Fund Alice (treasury -> Alice token transfer)
 * Transaction: TransferTransaction.
 *
 * Independently runnable from the repo root (zeto-hiero/):
 *   npx ts-node tutorial/04-fund-alice.ts
 * Requires in .env: operator creds, ALICE_ACCOUNT_ID, and
 *   TOKEN_ID (or UNDERLYING_TOKEN_ADDRESS) — run 02 (and 03) first.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import {
  Client, AccountId, PrivateKey, Hbar, TokenId, TransferTransaction,
} from "@hiero-ledger/sdk";

// ── Config (self-contained) ────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function operatorClient() {
  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ACCOUNT_ID!);
  const operatorKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX!);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return { client, operatorId, operatorKey };
}

function resolveTokenId(): TokenId {
  if (process.env.TOKEN_ID) return TokenId.fromString(process.env.TOKEN_ID);
  if (process.env.UNDERLYING_TOKEN_ADDRESS)
    return TokenId.fromSolidityAddress(process.env.UNDERLYING_TOKEN_ADDRESS);
  throw new Error("Set TOKEN_ID or UNDERLYING_TOKEN_ADDRESS in .env (run 02-create-token.ts first).");
}

const ALICE_FUNDING = 1_000; // base units

async function main() {
  const { client, operatorId, operatorKey } = operatorClient();
  try {
    const tokenId = resolveTokenId();
    const aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID!);

    // Build and freeze for signing
    const txTransfer = await new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -ALICE_FUNDING)
      .addTokenTransfer(tokenId, aliceId, ALICE_FUNDING)
      .freezeWith(client);

    // Sign with the treasury (operator) key, then submit
    const signTxTransfer = await txTransfer.sign(operatorKey);
    const txTransferResponse = await signTxTransfer.execute(client);

    // Receipt
    const receiptTransferTx = await txTransferResponse.getReceipt(client);

    const statusTransferTx = receiptTransferTx.status;
    const txIdTransfer = txTransferResponse.transactionId.toString();

    console.log("-------------------------------- Fund Alice (token transfer) ------------------------------");
    console.log("Receipt status           :", statusTransferTx.toString());
    console.log("Transaction ID           :", txIdTransfer);
    console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txIdTransfer}`);
    console.log(`Funded Alice with ${ALICE_FUNDING} base units of ${tokenId.toString()}`);
  } catch (error) {
    console.error(error);
  } finally {
    client.close();
  }
}

main();
