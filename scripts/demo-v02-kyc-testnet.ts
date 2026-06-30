import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof } from "../test/lib/zeto-witness";
import {
  prepareKycTransferProof,
  prepareKycWithdrawProof,
  decryptNote,
  newUtxoSmt,
  newIdentitiesSmt,
  addIdentity,
  addCommitment,
} from "../test/lib/zeto-witness-kyc";
import { deployPoseidonAndSmt, librariesMap } from "../test/lib/poseidon-deploy";

dotenv.config();

// v0.2 Phase 6 — full KYC-gated deposit -> private transfer -> withdraw on Hedera testnet
// against a REAL HTS token, with real Groth16 proofs. Captures gas + HashScan links per step.
//
// vs v0.1 (demo-mvp-testnet.ts): pool is HederaZetoTokenKyc (Zeto_AnonEncNullifierKyc); we
// deploy + link Poseidon/SmtLib, register Alice & Bob in the embedded KYC registry, and keep
// off-chain SMTs in lock-step with the on-chain commitments + identities trees so the transfer
// and withdraw circuits can prove membership.
//
// Prereq: scripts/phase6-create-token.ts has created the HTS token, associated Alice & Bob,
// funded Alice, and written UNDERLYING_TOKEN_ADDRESS to .env.
//
// Run: npx hardhat run scripts/demo-v02-kyc-testnet.ts --network hedera_testnet

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 4_000_000n; // KYC transfer is ~1.6M+; give headroom
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
  console.log(`\n=== v0.2 Phase 6 — KYC testnet shielded flow (chain ${net.chainId}) ===`);
  console.log(`Operator: ${operator.address}`);
  console.log(`Token:    ${token}\n`);

  const deployOv = { gasLimit: DEPLOY_GAS, gasPrice: GAS_PRICE };

  // ── Poseidon + SmtLib (required by the KYC variant's on-chain SMTs) ──
  console.log("Deploying Poseidon + SmtLib...");
  const libs = await deployPoseidonAndSmt(operator, deployOv);
  console.log(`  PoseidonUnit2L=${libs.poseidon2}\n  PoseidonUnit3L=${libs.poseidon3}\n  SmtLib=${libs.smtLib}`);

  // ── Verifiers: ours for invoked circuits; mock placeholder for unused batch ──
  console.log("Deploying verifiers...");
  const kycTransfer = await deploy("AnonEncNullifierKycVerifierMVP");
  const deposit = await deploy("DepositVerifierMVP");
  const withdrawN = await deploy("WithdrawNullifierVerifierMVP");
  const batch = await deploy("MockGroth16Verifier");
  console.log(`  transfer=${kycTransfer}\n  deposit=${deposit}\n  withdraw=${withdrawN}`);

  const verifiersInfo = {
    verifier: kycTransfer,
    depositVerifier: deposit,
    withdrawVerifier: withdrawN,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: batch,
    batchWithdrawVerifier: batch,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  // ── Pool (UUPS proxy) with linked libraries ──
  console.log("Deploying HederaZetoTokenKyc proxy...");
  const Pool = await ethers.getContractFactory("HederaZetoTokenKyc", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC Pool", "ZKYC", operator.address, verifiersInfo],
    {
      kind: "uups",
      initializer: "initialize",
      unsafeAllow: ["missing-initializer", "external-library-linking"],
      txOverrides: { gasLimit: DEPLOY_GAS },
    },
  );
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`  pool=${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}\n`);

  // ── setupHTS ──
  console.log("setupHTS (pool associates the HTS token)...");
  const setupTx = await pool.setupHTS(token, { gasLimit: TX_GAS });
  const setupRcpt = await setupTx.wait();
  console.log(`  gas=${setupRcpt!.gasUsed}  ${txLink(setupTx.hash)}\n`);

  // ── Alice & Bob wallets + Zeto users ──
  const aliceWallet = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobWallet = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceWallet);
  const Bob = await newUser(bobWallet);

  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };
  const erc20Alice = new ethers.Contract(token, ERC20_ABI, aliceWallet);
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
  const aliceStart = await erc20.balanceOf(Alice.ethAddress);
  console.log(`Alice token balance (base units): ${aliceStart}`);

  // ── KYC enrollment: register on-chain, mirror off-chain ──
  console.log("\n0. KYC enrollment (register Alice & Bob in the pool registry)");
  const regA = await pool.register(Alice.babyJubPublicKey, "0x", { gasLimit: TX_GAS });
  const regARcpt = await regA.wait();
  const regB = await pool.register(Bob.babyJubPublicKey, "0x", { gasLimit: TX_GAS });
  const regBRcpt = await regB.wait();
  console.log(`   Alice reg gas ${regARcpt!.gasUsed} | ${txLink(regA.hash)}`);
  console.log(`   Bob   reg gas ${regBRcpt!.gasUsed} | ${txLink(regB.hash)}`);

  const idSmt = newIdentitiesSmt("kyc");
  await addIdentity(idSmt, Alice.babyJubPublicKey);
  await addIdentity(idSmt, Bob.babyJubPublicKey);
  const onchainIdRoot = await pool.getIdentitiesRoot();
  console.log(`   identities root match: ${(await idSmt.root()).bigInt() === onchainIdRoot}`);

  // ── 1. Deposit 100 ──
  console.log("\n1. Deposit 100 (public -> shielded)");
  await (await erc20Alice.approve(poolAddr, 100n, ov)).wait();
  const utxo100 = newUTXO(100, Alice);
  const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
  const depTx = await pool
    .connect(aliceWallet)
    .deposit(100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov);
  const depRcpt = await depTx.wait();
  const utxoSmt = newUtxoSmt("utxos");
  await addCommitment(utxoSmt, utxo100.hash);
  console.log(`   proof ${dep.ms}ms | gas ${depRcpt!.gasUsed} | ${txLink(depTx.hash)}`);
  console.log(`   utxo root match: ${(await utxoSmt.root()).bigInt() === (await pool.getRoot())}`);
  console.log(`   pool token bal: ${await erc20.balanceOf(poolAddr)} | shieldedSupply: ${await pool.shieldedSupply(token)}`);

  // ── 2. Private KYC transfer: 40 to Bob, 60 change to Alice ──
  console.log("\n2. Private transfer 100 -> 40 Bob + 60 Alice (shielded, KYC)");
  const utxoBob40 = newUTXO(40, Bob);
  const utxoAlice60 = newUTXO(60, Alice);
  const xfer = await prepareKycTransferProof(
    Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt,
  );
  const xferTx = await pool.connect(aliceWallet).transfer(
    [xfer.nullifiers[0]],
    [xfer.outputCommitments[0], xfer.outputCommitments[1]],
    xfer.root,
    xfer.encryptionNonce,
    xfer.ecdhPublicKey,
    xfer.encryptedValues,
    xfer.encodedProof,
    "0x",
    ov,
  );
  const xferRcpt = await xferTx.wait();
  console.log(`   proof ${xfer.ms}ms | gas ${xferRcpt!.gasUsed} | ${txLink(xferTx.hash)}`);

  // keep both SMTs in sync with the new outputs
  await addCommitment(utxoSmt, utxoBob40.hash);
  await addCommitment(utxoSmt, utxoAlice60.hash);

  // ── 3. Bob recovers his note ──
  const evt = xferRcpt!.logs
    .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
  const recovered = decryptNote(
    Bob,
    evt!.args.encryptedValues.map((x: any) => BigInt(x)),
    BigInt(evt!.args.encryptionNonce),
    evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
    0,
  );
  console.log(`   Bob decrypted his note: value=${recovered.value}`);
  const utxoBob40Recovered = newUTXO(Number(recovered.value), Bob, recovered.salt);

  // ── 4. Bob withdraws 40 (nullifier withdraw) ──
  console.log("\n3. Bob withdraws 40 (shielded -> public)");
  const change = newUTXO(0, Bob);
  const wd = await prepareKycWithdrawProof(Bob, [utxoBob40Recovered, ZERO_UTXO], change, utxoSmt);
  const wdTx = await pool
    .connect(bobWallet)
    .withdraw(40n, [wd.nullifiers[0]], wd.output, wd.root, wd.encodedProof, "0x", ov);
  const wdRcpt = await wdTx.wait();
  console.log(`   proof ${wd.ms}ms | gas ${wdRcpt!.gasUsed} | ${txLink(wdTx.hash)}`);

  // ── 5. Reconcile ──
  const aliceBal = await erc20.balanceOf(Alice.ethAddress);
  const bobBal = await erc20.balanceOf(Bob.ethAddress);
  const poolBal = await erc20.balanceOf(poolAddr);
  console.log(`\n=== Final balances (base units) ===`);
  console.log(`   Alice=${aliceBal}  Bob=${bobBal}  pool=${poolBal}  shieldedSupply=${await pool.shieldedSupply(token)}`);
  console.log(`   reconcile (Alice+Bob+pool) = ${aliceBal + bobBal + poolBal} (expected ${aliceStart})`);

  console.log(`\n=== Gas summary ===`);
  console.log(`   register(Alice): ${regARcpt!.gasUsed}`);
  console.log(`   register(Bob):   ${regBRcpt!.gasUsed}`);
  console.log(`   setupHTS:        ${setupRcpt!.gasUsed}`);
  console.log(`   deposit:         ${depRcpt!.gasUsed}`);
  console.log(`   transfer:        ${xferRcpt!.gasUsed}`);
  console.log(`   withdraw:        ${wdRcpt!.gasUsed}`);

  console.log(`\n=== Deployed addresses ===`);
  console.log(`   pool=${poolAddr}`);
  console.log(`   PoseidonUnit2L=${libs.poseidon2} PoseidonUnit3L=${libs.poseidon3} SmtLib=${libs.smtLib}`);
  console.log(`   verifiers: transfer=${kycTransfer} deposit=${deposit} withdraw=${withdrawN}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
