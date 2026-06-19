/**
 * Tutorial §2 — Create the Underlying HTS Token
 * Transaction: TokenCreateTransaction (FungibleCommon, operator = treasury).
 *
 * Independently runnable from the repo root (zeto-hiero/):
 *   npx ts-node tutorial/02-create-token.ts
 * Requires in .env: HEDERA_OPERATOR_ACCOUNT_ID, HEDERA_OPERATOR_PRIVATE_KEY_HEX
 *
 * Writes TOKEN_ID and UNDERLYING_TOKEN_ADDRESS back to ./.env so the later steps
 * (associate, fund, deploy, reconcile) pick them up automatically.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  Client, AccountId, PrivateKey, Hbar,
  TokenCreateTransaction, TokenType, TokenSupplyType,
} from "@hiero-ledger/sdk";

// ── Config (self-contained) ────────────────────────────────────────────────
const ENV_PATH = path.resolve(__dirname, "../.env");
dotenv.config({ path: ENV_PATH });

function operatorClient() {
  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ACCOUNT_ID!);
  const operatorKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX!);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return { client, operatorId, operatorKey };
}

// Replace KEY=... in .env if present, else append it.
function upsertEnv(key: string, value: string) {
  let body = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  body = re.test(body) ? body.replace(re, line) : body.replace(/\s*$/, `\n${line}\n`);
  fs.writeFileSync(ENV_PATH, body);
}

const DECIMALS = 8;
const INITIAL_SUPPLY = 1_000_000; // base units, held by the operator (treasury)

async function main() {
  const { client, operatorId, operatorKey } = operatorClient();
  try {
    // Build and freeze for signing
    const txTokenCreate = await new TokenCreateTransaction()
      .setTokenName("Zeto USD Test")
      .setTokenSymbol("ZUSD-TEST")
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(DECIMALS)
      .setInitialSupply(INITIAL_SUPPLY)
      .setTreasuryAccountId(operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .setAdminKey(operatorKey.publicKey)
      .setSupplyKey(operatorKey.publicKey)
      .freezeWith(client);

    // Sign with the treasury (operator) key, then submit
    const signTxTokenCreate = await txTokenCreate.sign(operatorKey);
    const txTokenCreateResponse = await signTxTokenCreate.execute(client);

    // Receipt
    const receiptTokenCreateTx = await txTokenCreateResponse.getReceipt(client);

    const statusTokenCreateTx = receiptTokenCreateTx.status;
    const tokenId = receiptTokenCreateTx.tokenId!;
    const tokenEvm = "0x" + tokenId.toSolidityAddress();
    const txTokenCreateId = txTokenCreateResponse.transactionId.toString();

    console.log("--------------------------------- Token Creation ---------------------------------");
    console.log("Receipt status           :", statusTokenCreateTx.toString());
    console.log("Transaction ID           :", txTokenCreateId);
    console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txTokenCreateId}`);
    console.log("Token ID                 :", tokenId.toString());
    console.log("Token EVM address        :", tokenEvm);

    // Persist for the later steps
    upsertEnv("TOKEN_ID", tokenId.toString());
    upsertEnv("UNDERLYING_TOKEN_ADDRESS", tokenEvm);
    console.log(`\nWrote TOKEN_ID and UNDERLYING_TOKEN_ADDRESS to ${ENV_PATH}`);
  } catch (error) {
    console.error(error);
  } finally {
    client.close();
  }
}

main();
