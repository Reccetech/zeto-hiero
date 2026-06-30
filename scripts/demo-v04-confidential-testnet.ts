import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import { Client, TopicCreateTransaction, AccountId, PrivateKey } from "@hiero-ledger/sdk";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof } from "../test/lib/zeto-witness";
import { newUtxoSmt, newIdentitiesSmt, addIdentity, addCommitment } from "../test/lib/zeto-witness-kyc";
import { newSanctionsSmt, addSanctioned } from "../test/lib/zeto-witness-sanctions";
import { prepareNRTransferProof } from "../test/lib/zeto-witness-nr";
import { scanForRecipient } from "../sdk/src/scan/OutputScanner";
import { auditTransfer } from "../sdk/src/scan/AuthorityAuditScanner";
import { postAuditEvent } from "../sdk/src/hcs/eventPoster";
import { deployPoseidonAndSmt, librariesMap } from "../test/lib/poseidon-deploy";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */

dotenv.config();

// v0.4 Phase 7 — full production confidential flow on Hedera testnet with real proofs:
// deploy -> register KYC -> set authority key + sanctions root -> create HCS audit topic + anchor
// events -> deposit -> confidential transfer -> recipient scans note (SDK) -> authority decrypts
// the full transaction (SDK). Captures gas + HashScan.
//
// Run: npx hardhat run scripts/demo-v04-confidential-testnet.ts --network hedera_testnet

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 4_500_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");
const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];
let HASHSCAN = "https://hashscan.io/testnet";
const txLink = (h: string) => `${HASHSCAN}/transaction/${h}`;
function env(name: string): string { const v = process.env[name]; if (!v) throw new Error(`Missing ${name}`); return v; }
async function deploy(name: string): Promise<string> {
  const c = await (await ethers.getContractFactory(name)).deploy({ gasLimit: DEPLOY_GAS });
  await c.waitForDeployment(); return await c.getAddress();
}

async function main() {
  const [operator] = await ethers.getSigners();
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  if (net.chainId === 295n) HASHSCAN = "https://hashscan.io/mainnet";
  const token = env("UNDERLYING_TOKEN_ADDRESS");
  console.log(`\n=== v0.4 Phase 7 — confidential (non-repudiation) testnet flow (chain ${net.chainId}) ===`);
  console.log(`Operator: ${operator.address}\nToken: ${token}\n`);

  const deployOv = { gasLimit: DEPLOY_GAS, gasPrice: GAS_PRICE };
  console.log("Deploying Poseidon + SmtLib...");
  const libs = await deployPoseidonAndSmt(operator, deployOv);
  console.log(`  P2=${libs.poseidon2} P3=${libs.poseidon3} SmtLib=${libs.smtLib}`);

  console.log("Deploying verifiers...");
  const nr = await deploy("AnonEncNullifierKycSanctionsNRVerifierMVP");
  const deposit = await deploy("DepositVerifierMVP");
  const withdrawN = await deploy("WithdrawNullifierVerifierMVP");
  const batch = await deploy("MockGroth16Verifier");
  console.log(`  transfer(NR)=${nr}\n  deposit=${deposit}\n  withdraw=${withdrawN}`);

  const verifiersInfo = {
    verifier: nr, depositVerifier: deposit, withdrawVerifier: withdrawN,
    lockVerifier: ZERO, burnVerifier: ZERO, batchVerifier: batch, batchWithdrawVerifier: batch,
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };
  console.log("Deploying HederaZetoToken proxy...");
  const Pool = await ethers.getContractFactory("HederaZetoToken", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool, ["Hedera Zeto Production Pool", "ZNR", operator.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"], txOverrides: { gasLimit: DEPLOY_GAS } },
  );
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`  pool=${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}\n`);

  const setupRcpt = await (await pool.setupHTS(token, { gasLimit: TX_GAS })).wait();
  console.log(`setupHTS gas=${setupRcpt!.gasUsed}\n`);

  // Authority key for the pool (in production this comes from the DeRec ceremony; here single-party)
  const authority = genKeypair();
  const akRcpt = await (await pool.setAuthorityKey([authority.pubKey[0], authority.pubKey[1]], { gasLimit: TX_GAS })).wait();
  console.log(`setAuthorityKey gas=${akRcpt!.gasUsed}`);

  const aliceWallet = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobWallet = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceWallet);
  const Bob = await newUser(bobWallet);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };
  const erc20Alice = new ethers.Contract(token, ERC20_ABI, aliceWallet);

  console.log("\n0. KYC enrollment");
  const regA = await (await pool.register(Alice.babyJubPublicKey, "0x", { gasLimit: TX_GAS })).wait();
  const regB = await (await pool.register(Bob.babyJubPublicKey, "0x", { gasLimit: TX_GAS })).wait();
  const idSmt = newIdentitiesSmt("kyc");
  await addIdentity(idSmt, Alice.babyJubPublicKey);
  await addIdentity(idSmt, Bob.babyJubPublicKey);
  console.log(`   Alice ${regA!.gasUsed} | Bob ${regB!.gasUsed} | root match: ${(await idSmt.root()).bigInt() === await pool.getIdentitiesRoot()}`);

  console.log("\n0b. Sanctions root");
  const sanc = newSanctionsSmt("ofac");
  await addSanctioned(sanc, 111111n); await addSanctioned(sanc, 222222n);
  const srRcpt = await (await pool.updateSanctionsMerkleRoot(ethers.toBeHex((await sanc.root()).bigInt(), 32), { gasLimit: TX_GAS })).wait();
  console.log(`   set gas=${srRcpt!.gasUsed} | ${txLink(srRcpt!.hash)}`);

  // HCS audit topic (operator submit key for the demo; production uses a 3-of-5 Helper threshold)
  console.log("\n0c. HCS audit topic");
  const hcs = Client.forTestnet().setOperator(
    AccountId.fromString(env("HEDERA_OPERATOR_ACCOUNT_ID")),
    PrivateKey.fromStringECDSA(env("HEDERA_OPERATOR_PRIVATE_KEY_HEX")),
  );
  const topicId = (await (await new TopicCreateTransaction().setTopicMemo(`authority-key-registry:${poolAddr}`).execute(hcs)).getReceipt(hcs)).topicId!.toString();
  console.log(`   topic=${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
  await postAuditEvent(hcs, topicId, { type: "authority_key_registered", pool: poolAddr, timestamp: Math.floor(Date.now() / 1000), data: { x: authority.pubKey[0].toString(), y: authority.pubKey[1].toString() } });
  await postAuditEvent(hcs, topicId, { type: "sanctions_root_updated", pool: poolAddr, timestamp: Math.floor(Date.now() / 1000), data: { root: (await sanc.root()).bigInt().toString() } });
  console.log(`   anchored: authority_key_registered, sanctions_root_updated`);

  console.log("\n1. Deposit 100");
  await (await erc20Alice.approve(poolAddr, 100n, ov)).wait();
  const utxo100 = newUTXO(100, Alice);
  const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
  const depRcpt = await (await pool.connect(aliceWallet).deposit(100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov)).wait();
  const utxoSmt = newUtxoSmt("utxos");
  await addCommitment(utxoSmt, utxo100.hash);
  console.log(`   proof ${dep.ms}ms | gas ${depRcpt!.gasUsed} | ${txLink(depRcpt!.hash)}`);

  console.log("\n2. Confidential transfer 100 -> 40 Bob + 60 Alice (KYC + sanctions + authority)");
  const utxoBob40 = newUTXO(40, Bob);
  const utxoAlice60 = newUTXO(60, Alice);
  const xfer = await prepareNRTransferProof(Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt, sanc, authority.pubKey);
  const xferTx = await pool.connect(aliceWallet).transferConfidential(
    [xfer.nullifiers[0]], [xfer.outputCommitments[0], xfer.outputCommitments[1]],
    xfer.root, xfer.encryptionNonce, xfer.ecdhPublicKey, xfer.encryptedValues, xfer.cipherTextAuthority, xfer.sanctionsRoot, xfer.encodedProof, "0x", ov);
  const xferRcpt = await xferTx.wait();
  console.log(`   proof ${xfer.ms}ms | gas ${xferRcpt!.gasUsed} | ${txLink(xferTx.hash)}`);

  // Recipient scan (SDK): Bob discovers his note from the transfer event
  const tEvt = xferRcpt!.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
  const bobNotes = scanForRecipient(
    [{ outputs: [utxoBob40.hash, utxoAlice60.hash], encryptionNonce: BigInt(tEvt!.args.encryptionNonce), ecdhPublicKey: tEvt!.args.ecdhPublicKey.map((x: any) => BigInt(x)) as [bigint, bigint], encryptedValues: tEvt!.args.encryptedValues.map((x: any) => BigInt(x)) }],
    Bob.babyJubPrivateKey, Bob.babyJubPublicKey as [bigint, bigint]);
  console.log(`   [SDK] Bob's OutputScanner found ${bobNotes.length} note(s): value=${bobNotes[0]?.value}`);

  // Authority audit (SDK): regulator reconstructs the full transfer
  const aEvt = xferRcpt!.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "AuthorityCiphertext");
  const audited = auditTransfer(authority.privKey, { nullifiers: [xfer.nullifiers[0]], outputs: [utxoBob40.hash, utxoAlice60.hash], encryptionNonce: BigInt(aEvt!.args.encryptionNonce), ecdhPublicKey: tEvt!.args.ecdhPublicKey.map((x: any) => BigInt(x)) as [bigint, bigint], cipherTextAuthority: aEvt!.args.cipherTextAuthority.map((x: any) => BigInt(x)) }, 2, 2);
  console.log(`   [SDK] Authority audit: input=${audited.inputs[0].value}, outputs=[${audited.outputs[0].value}, ${audited.outputs[1].value}]`);

  console.log(`\n=== Gas summary ===`);
  console.log(`   register A/B: ${regA!.gasUsed}/${regB!.gasUsed} | setupHTS ${setupRcpt!.gasUsed} | setAuthKey ${akRcpt!.gasUsed} | sanctionsRoot ${srRcpt!.gasUsed} | deposit ${depRcpt!.gasUsed} | transferConfidential ${xferRcpt!.gasUsed}`);
  console.log(`\n=== Addresses ===\n   pool=${poolAddr}\n   NRverifier=${nr} deposit=${deposit} withdraw=${withdrawN}\n   P2=${libs.poseidon2} P3=${libs.poseidon3} SmtLib=${libs.smtLib}\n   HCS topic=${topicId}`);
  hcs.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
