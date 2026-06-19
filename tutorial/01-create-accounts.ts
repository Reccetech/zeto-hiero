/**
 * Tutorial §1 — Create New Hedera Accounts (Alice and Bob)
 * Transaction: AccountCreateTransaction (ECDSA key + EVM alias).
 *
 * Independently runnable from the repo root (zeto-hiero/):
 *   npx ts-node tutorial/01-create-accounts.ts
 * Requires in .env: HEDERA_OPERATOR_ACCOUNT_ID, HEDERA_OPERATOR_PRIVATE_KEY_HEX
 *
 * Prints ALICE_/BOB_ .env lines to copy into ./.env for the later steps.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import { Client, AccountId, PrivateKey, Hbar, AccountCreateTransaction } from "@hiero-ledger/sdk";

// ── Config (self-contained) ────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function operatorClient() {
  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ACCOUNT_ID!);
  const operatorKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX!);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return { client, operatorId, operatorKey };
}

// Create an ECDSA account with an EVM alias, then resolve its on-chain EVM address.
async function createAccount(name: string, initBalanceHbar: number, client: Client) {
  // Generate a new key for the account
  const accountPrivateKey = PrivateKey.generateECDSA();
  const accountPublicKey = accountPrivateKey.publicKey;

  const txCreateAccount = new AccountCreateTransaction()
    .setECDSAKeyWithAlias(accountPublicKey) // EVM alias from the public key — fully EVM-compatible
    .setInitialBalance(new Hbar(initBalanceHbar))
    .setMaxAutomaticTokenAssociations(10);

  // Submit to the network
  const txCreateAccountResponse = await txCreateAccount.execute(client);

  // Request the receipt
  const receiptCreateAccountTx = await txCreateAccountResponse.getReceipt(client);

  const statusCreateAccountTx = receiptCreateAccountTx.status;
  const accountId = receiptCreateAccountTx.accountId!;
  const txIdAccountCreated = txCreateAccountResponse.transactionId.toString();

  // The EVM alias only appears on the mirror node after consensus
  let accountEvmAddress: string | undefined;
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const mirrorResponse = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId.toString()}`);
  if (mirrorResponse.ok) {
    accountEvmAddress = (await mirrorResponse.json()).evm_address;
  }

  console.log(`------------------------------ Create ${name} ------------------------------`);
  console.log("Receipt status       :", statusCreateAccountTx.toString());
  console.log("Transaction ID       :", txIdAccountCreated);
  console.log("Hashscan URL         :", `https://hashscan.io/testnet/transaction/${txIdAccountCreated}`);
  console.log("Account ID           :", accountId.toString());
  console.log("EVM Address          :", accountEvmAddress);
  console.log("Private key          :", `0x${accountPrivateKey.toStringRaw()}`);
  console.log("Public key           :", `0x${accountPublicKey.toStringRaw()}`);

  return { key: accountPrivateKey, accountId, evmAddress: accountEvmAddress };
}

async function main() {
  const { client } = operatorClient();
  try {
    const alice = await createAccount("Alice", 20, client);
    const bob = await createAccount("Bob", 20, client);

    console.log(`\nAdd these to ./.env:`);
    console.log(`ALICE_ACCOUNT_ID=${alice.accountId}`);
    console.log(`ALICE_PRIVATE_KEY_HEX=0x${alice.key.toStringRaw()}`);
    console.log(`ALICE_EVM_ADDRESS=${alice.evmAddress}`);
    console.log(`BOB_ACCOUNT_ID=${bob.accountId}`);
    console.log(`BOB_PRIVATE_KEY_HEX=0x${bob.key.toStringRaw()}`);
    console.log(`BOB_EVM_ADDRESS=${bob.evmAddress}`);
  } catch (error) {
    console.error(error);
  } finally {
    client.close();
  }
}

main();
