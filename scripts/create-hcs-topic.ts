import { Client, TopicCreateTransaction, KeyList, PublicKey } from "@hiero-ledger/sdk";
import * as dotenv from "dotenv";

dotenv.config();

// v0.4 Phase 6 — create a pool's HCS audit topic with a threshold submit key (PRD §16.7).
// The submit key is a 3-of-5 KeyList of the Helper public keys, so no single Helper (and not the
// pool operator alone) can forge the audit log. The topic memo binds it to the pool address.
//
// Usage: HELPER_PUBKEYS="hex1,hex2,hex3,hex4,hex5" POOL_ADDRESS=0x... \
//        npx ts-node scripts/create-hcs-topic.ts

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function main() {
  const operatorId = env("HEDERA_OPERATOR_ACCOUNT_ID");
  const operatorKey = env("HEDERA_OPERATOR_PRIVATE_KEY_HEX");
  const pool = env("POOL_ADDRESS");
  const helperHex = env("HELPER_PUBKEYS").split(",").map((s) => s.trim());
  if (helperHex.length < 3) throw new Error("need >= 3 helper public keys for a 3-of-N threshold");

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  // 3-of-N threshold submit key from the Helper public keys.
  const submitKey = new KeyList(
    helperHex.map((h) => PublicKey.fromString(h)),
    3,
  );

  const tx = await new TopicCreateTransaction()
    .setTopicMemo(`authority-key-registry:${pool}`)
    .setSubmitKey(submitKey)
    .execute(client);
  const receipt = await tx.getReceipt(client);

  console.log(`HCS audit topic created: ${receipt.topicId?.toString()}`);
  console.log(`  memo: authority-key-registry:${pool}`);
  console.log(`  submit key: 3-of-${helperHex.length} Helper threshold`);
  client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
