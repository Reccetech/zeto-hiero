// MVP Phase 6 — create the underlying HTS fungible token on Hedera testnet, associate
// Alice & Bob, fund Alice, and persist the token's EVM address to .env.
//
// One-time setup, run with: npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet
// (network flag is irrelevant here — this uses @hashgraph/sdk directly, not the JSON-RPC relay.)

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  Client,
  PrivateKey,
  AccountId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenAssociateTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";

dotenv.config();

const DECIMALS = 8;
const INITIAL_SUPPLY = 1_000_000; // base units, held by treasury (operator)
const ALICE_FUNDING = 1_000; // base units transferred to Alice for the demo

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function main() {
  const operatorId = AccountId.fromString(env("HEDERA_OPERATOR_ACCOUNT_ID"));
  const operatorKey = PrivateKey.fromStringECDSA(env("HEDERA_OPERATOR_PRIVATE_KEY_HEX"));
  const aliceId = AccountId.fromString(env("ALICE_ACCOUNT_ID"));
  const aliceKey = PrivateKey.fromStringECDSA(env("ALICE_PRIVATE_KEY_HEX"));
  const bobId = AccountId.fromString(env("BOB_ACCOUNT_ID"));
  const bobKey = PrivateKey.fromStringECDSA(env("BOB_PRIVATE_KEY_HEX"));

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  // 1. Create the fungible token (treasury = operator)
  console.log("Creating ZUSD-TEST fungible token...");
  const createRcpt = await (
    await (
      await new TokenCreateTransaction()
        .setTokenName("Zeto USD Test")
        .setTokenSymbol("ZUSD-TEST")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(DECIMALS)
        .setInitialSupply(INITIAL_SUPPLY)
        .setTreasuryAccountId(operatorId)
        .setSupplyType(TokenSupplyType.Infinite)
        .setAdminKey(operatorKey.publicKey)
        .setSupplyKey(operatorKey.publicKey)
        .freezeWith(client)
        .sign(operatorKey)
    ).execute(client)
  ).getReceipt(client);

  const tokenId = createRcpt.tokenId!;
  const tokenEvm = "0x" + tokenId.toSolidityAddress();
  console.log(`  tokenId: ${tokenId.toString()}  (EVM ${tokenEvm})`);

  // 2. Associate Alice & Bob (each must sign; operator pays)
  for (const [name, id, key] of [
    ["Alice", aliceId, aliceKey],
    ["Bob", bobId, bobKey],
  ] as const) {
    console.log(`Associating ${name} (${id.toString()})...`);
    await (
      await (
        await new TokenAssociateTransaction()
          .setAccountId(id)
          .setTokenIds([tokenId])
          .freezeWith(client)
          .sign(key)
      ).execute(client)
    ).getReceipt(client);
  }

  // 3. Fund Alice from treasury
  console.log(`Transferring ${ALICE_FUNDING} base units to Alice...`);
  await (
    await (
      await new TransferTransaction()
        .addTokenTransfer(tokenId, operatorId, -ALICE_FUNDING)
        .addTokenTransfer(tokenId, aliceId, ALICE_FUNDING)
        .freezeWith(client)
        .sign(operatorKey)
    ).execute(client)
  ).getReceipt(client);

  // 4. Persist token EVM address to .env (replace or append UNDERLYING_TOKEN_ADDRESS)
  const envPath = path.join(__dirname, "..", ".env");
  let body = fs.readFileSync(envPath, "utf8");
  if (/^UNDERLYING_TOKEN_ADDRESS=.*$/m.test(body)) {
    body = body.replace(/^UNDERLYING_TOKEN_ADDRESS=.*$/m, `UNDERLYING_TOKEN_ADDRESS=${tokenEvm}`);
  } else {
    body += `\nUNDERLYING_TOKEN_ADDRESS=${tokenEvm}\n`;
  }
  fs.writeFileSync(envPath, body);

  console.log("\n=== Phase 6 token setup complete ===");
  console.log(`  Token:   ${tokenId.toString()}  ${tokenEvm}`);
  console.log(`  HashScan: https://hashscan.io/testnet/token/${tokenId.toString()}`);
  console.log(`  Alice funded with ${ALICE_FUNDING} base units; Bob associated.`);
  console.log(`  Wrote UNDERLYING_TOKEN_ADDRESS to .env`);

  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
