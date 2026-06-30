import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof } from "../test/lib/zeto-witness";
import {
  newUtxoSmt, newIdentitiesSmt, addIdentity, addCommitment, decryptNote,
} from "../test/lib/zeto-witness-kyc";
import {
  prepareKycSanctionsTransferProof, newSanctionsSmt, addSanctioned,
} from "../test/lib/zeto-witness-sanctions";
import { deployPoseidonAndSmt, librariesMap } from "../test/lib/poseidon-deploy";

dotenv.config();

// v0.3 Phase 6 — full KYC + sanctions-screened deposit -> transfer on Hedera testnet against a
// real HTS token, with real Groth16 proofs. Captures gas + HashScan links per step.
//
// vs v0.2: pool is HederaZetoTokenKycSanctions; we set a sanctions root and the transfer carries
// a per-input non-inclusion proof bound to that root via transferScreened.
//
// Prereq: scripts/phase6-create-token.ts has created the HTS token, associated Alice & Bob,
// funded Alice, and written UNDERLYING_TOKEN_ADDRESS to .env.
//
// Run: npx hardhat run scripts/demo-v03-sanctions-testnet.ts --network hedera_testnet

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 4_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");

const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

let HASHSCAN = "https://hashscan.io/testnet";
const txLink = (h: string) => `${HASHSCAN}/transaction/${h}`;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function deploy(name: string, args: any[] = []): Promise<string> {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy(...args, { gasLimit: DEPLOY_GAS });
  await c.waitForDeployment();
  return await c.getAddress();
}

async function main() {
  const [operator] = await ethers.getSigners();
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  if (net.chainId === 295n) HASHSCAN = "https://hashscan.io/mainnet";

  const token = env("UNDERLYING_TOKEN_ADDRESS");
  console.log(`\n=== v0.3 Phase 6 — KYC+sanctions testnet flow (chain ${net.chainId}) ===`);
  console.log(`Operator: ${operator.address}\nToken: ${token}\n`);

  const deployOv = { gasLimit: DEPLOY_GAS, gasPrice: GAS_PRICE };

  console.log("Deploying Poseidon + SmtLib...");
  const libs = await deployPoseidonAndSmt(operator, deployOv);
  console.log(`  P2=${libs.poseidon2} P3=${libs.poseidon3} SmtLib=${libs.smtLib}`);

  console.log("Deploying verifiers...");
  const sanctionsTransfer = await deploy("AnonEncNullifierKycSanctionsVerifierMVP");
  const deposit = await deploy("DepositVerifierMVP");
  const withdrawN = await deploy("WithdrawNullifierVerifierMVP");
  const batch = await deploy("MockGroth16Verifier");
  console.log(`  transfer(sanctions)=${sanctionsTransfer}\n  deposit=${deposit}\n  withdraw=${withdrawN}`);

  const verifiersInfo = {
    verifier: sanctionsTransfer,
    depositVerifier: deposit,
    withdrawVerifier: withdrawN,
    lockVerifier: ZERO, burnVerifier: ZERO,
    batchVerifier: batch, batchWithdrawVerifier: batch,
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };

  console.log("Deploying HederaZetoTokenKycSanctions proxy...");
  const Pool = await ethers.getContractFactory("HederaZetoTokenKycSanctions", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC+Sanctions Pool", "ZKYCS", operator.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"], txOverrides: { gasLimit: DEPLOY_GAS } },
  );
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`  pool=${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}\n`);

  console.log("setupHTS...");
  const setupTx = await pool.setupHTS(token, { gasLimit: TX_GAS });
  const setupRcpt = await setupTx.wait();
  console.log(`  gas=${setupRcpt!.gasUsed}  ${txLink(setupTx.hash)}\n`);

  const aliceWallet = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobWallet = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceWallet);
  const Bob = await newUser(bobWallet);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };
  const erc20Alice = new ethers.Contract(token, ERC20_ABI, aliceWallet);
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);

  // KYC enrollment
  console.log("0. KYC enrollment");
  const regA = await pool.register(Alice.babyJubPublicKey, "0x", { gasLimit: TX_GAS });
  const regARcpt = await regA.wait();
  const regB = await pool.register(Bob.babyJubPublicKey, "0x", { gasLimit: TX_GAS });
  const regBRcpt = await regB.wait();
  const idSmt = newIdentitiesSmt("kyc");
  await addIdentity(idSmt, Alice.babyJubPublicKey);
  await addIdentity(idSmt, Bob.babyJubPublicKey);
  console.log(`   Alice reg gas ${regARcpt!.gasUsed} | ${txLink(regA.hash)}`);
  console.log(`   Bob   reg gas ${regBRcpt!.gasUsed} | ${txLink(regB.hash)}`);
  console.log(`   identities root match: ${(await idSmt.root()).bigInt() === await pool.getIdentitiesRoot()}`);

  // Sanctions list (OFAC-style dummy entries; none are Alice/Bob)
  console.log("\n0b. Set sanctions root");
  const sanc = newSanctionsSmt("ofac");
  await addSanctioned(sanc, 111111n);
  await addSanctioned(sanc, 222222n);
  const sanctionsRoot = (await sanc.root()).bigInt();
  const srTx = await pool.updateSanctionsMerkleRoot(ethers.toBeHex(sanctionsRoot, 32), { gasLimit: TX_GAS });
  const srRcpt = await srTx.wait();
  console.log(`   sanctions root set gas ${srRcpt!.gasUsed} | ${txLink(srTx.hash)}`);

  // Deposit 100
  console.log("\n1. Deposit 100 (public -> shielded)");
  await (await erc20Alice.approve(poolAddr, 100n, ov)).wait();
  const utxo100 = newUTXO(100, Alice);
  const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
  const depTx = await pool.connect(aliceWallet).deposit(
    100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov);
  const depRcpt = await depTx.wait();
  const utxoSmt = newUtxoSmt("utxos");
  await addCommitment(utxoSmt, utxo100.hash);
  console.log(`   proof ${dep.ms}ms | gas ${depRcpt!.gasUsed} | ${txLink(depTx.hash)}`);
  console.log(`   shieldedSupply: ${await pool.shieldedSupply(token)} | utxo root match: ${(await utxoSmt.root()).bigInt() === await pool.getRoot()}`);

  // Screened transfer 40 -> Bob, 60 -> Alice
  console.log("\n2. Sanctions-screened transfer 100 -> 40 Bob + 60 Alice");
  const utxoBob40 = newUTXO(40, Bob);
  const utxoAlice60 = newUTXO(60, Alice);
  const xfer = await prepareKycSanctionsTransferProof(
    Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt, sanc);
  const xferTx = await pool.connect(aliceWallet).transferScreened(
    [xfer.nullifiers[0]],
    [xfer.outputCommitments[0], xfer.outputCommitments[1]],
    xfer.root, xfer.encryptionNonce, xfer.ecdhPublicKey, xfer.encryptedValues,
    xfer.sanctionsRoot, xfer.encodedProof, "0x", ov);
  const xferRcpt = await xferTx.wait();
  console.log(`   proof ${xfer.ms}ms | gas ${xferRcpt!.gasUsed} | ${txLink(xferTx.hash)}`);

  const evt = xferRcpt!.logs
    .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
  const recovered = decryptNote(
    Bob,
    evt!.args.encryptedValues.map((x: any) => BigInt(x)),
    BigInt(evt!.args.encryptionNonce),
    evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
    0);
  console.log(`   Bob decrypted his note: value=${recovered.value}`);

  console.log(`\n=== Gas summary ===`);
  console.log(`   register(Alice): ${regARcpt!.gasUsed}`);
  console.log(`   register(Bob):   ${regBRcpt!.gasUsed}`);
  console.log(`   updateSanctionsRoot: ${srRcpt!.gasUsed}`);
  console.log(`   setupHTS:        ${setupRcpt!.gasUsed}`);
  console.log(`   deposit:         ${depRcpt!.gasUsed}`);
  console.log(`   transferScreened: ${xferRcpt!.gasUsed}`);
  console.log(`\n=== Addresses ===`);
  console.log(`   pool=${poolAddr}`);
  console.log(`   sanctionsVerifier=${sanctionsTransfer} deposit=${deposit} withdraw=${withdrawN}`);
  console.log(`   P2=${libs.poseidon2} P3=${libs.poseidon3} SmtLib=${libs.smtLib}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
