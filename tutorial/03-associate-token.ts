/**
 * Tutorial §3 — Associate Alice and Bob with the Token
 * Transaction: TokenAssociateTransaction (each account signs its own association).
 *
 * Independently runnable from the repo root (zeto-hiero/):
 *   npx ts-node tutorial/03-associate-token.ts
 * Requires in .env: operator creds, ALICE_/BOB_ account id + key, and
 *   TOKEN_ID (or UNDERLYING_TOKEN_ADDRESS) — run 01 and 02 first.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import {
  Client, AccountId, PrivateKey, Hbar, TokenId, TokenAssociateTransaction,
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

async function main() {
  const { client } = operatorClient();
  try {
    const tokenId = resolveTokenId();

    const actors = [
      { name: "Alice", id: AccountId.fromString(process.env.ALICE_ACCOUNT_ID!), key: PrivateKey.fromStringECDSA(process.env.ALICE_PRIVATE_KEY_HEX!) },
      { name: "Bob", id: AccountId.fromString(process.env.BOB_ACCOUNT_ID!), key: PrivateKey.fromStringECDSA(process.env.BOB_PRIVATE_KEY_HEX!) },
    ];

    for (const actor of actors) {
      // Build and freeze for signing
      const txTokenAssociate = await new TokenAssociateTransaction()
        .setAccountId(actor.id)
        .setTokenIds([tokenId])
        .freezeWith(client);

      // The account being associated must sign
      const signTxTokenAssociate = await txTokenAssociate.sign(actor.key);
      const txTokenAssociateResponse = await signTxTokenAssociate.execute(client);

      // Receipt
      const receiptTokenAssociateTx = await txTokenAssociateResponse.getReceipt(client);

      const statusTokenAssociateTx = receiptTokenAssociateTx.status;
      const txTokenAssociateId = txTokenAssociateResponse.transactionId.toString();

      console.log(`--------------------------------- Associate ${actor.name} ---------------------------------`);
      console.log("Receipt status           :", statusTokenAssociateTx.toString());
      console.log("Transaction ID           :", txTokenAssociateId);
      console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txTokenAssociateId}`);
    }
  } catch (error) {
    console.error(error);
  } finally {
    client.close();
  }
}

main();
