import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import {
  newUser,
  newUTXO,
  ZERO_UTXO,
  prepareDepositProof,
  prepareTransferProof,
  prepareWithdrawProof,
  decryptNote,
} from "../test/lib/zeto-witness";

dotenv.config();

// MVP Phase 6 — full deposit -> private transfer -> withdraw on Hedera testnet against a
// REAL HTS token, with real Groth16 proofs. Captures gas + HashScan links for each step.
//
// Prereq: run scripts/phase6-create-token.ts first (creates the token, associates Alice &
// Bob, funds Alice, writes UNDERLYING_TOKEN_ADDRESS to .env).
//
// Run: npx hardhat run scripts/demo-mvp-testnet.ts --network hedera_testnet
//
// We deploy directly with ethers (sequential, explicit gasLimit) rather than hardhat-deploy,
// which batches transactions and trips the Hashio relay's nonce tracking. Alice and Bob are
// raw wallets built from their .env keys (only the operator is in hardhat's accounts list).

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 3_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");

const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

let HASHSCAN = "https://hashscan.io/testnet";
function txLink(h: string) {
  return `${HASHSCAN}/transaction/${h}`;
}

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
  console.log(`\n=== MVP Phase 6 — testnet shielded flow (chain ${net.chainId}) ===`);
  console.log(`Operator: ${operator.address}`);
  console.log(`Token:    ${token}\n`);

  // ── Deploy verifiers (ours for invoked circuits; mock placeholder for unused batch) ──
  console.log("Deploying verifiers...");
  const anonEnc = await deploy("AnonEncVerifierMVP");
  const deposit = await deploy("DepositVerifierMVP");
  const withdraw = await deploy("WithdrawVerifierMVP");
  const batch = await deploy("MockGroth16Verifier");
  console.log(`  anon_enc=${anonEnc}\n  deposit=${deposit}\n  withdraw=${withdraw}`);

  const verifiersInfo = {
    verifier: anonEnc,
    depositVerifier: deposit,
    withdrawVerifier: withdraw,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: batch,
    batchWithdrawVerifier: batch,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  // ── Deploy the pool (UUPS proxy) ──
  console.log("Deploying HederaZetoTokenLite proxy...");
  const Pool = await ethers.getContractFactory("HederaZetoTokenLite");
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto MVP Pool", "ZTEST", operator.address, verifiersInfo],
    {
      kind: "uups",
      initializer: "initialize",
      unsafeAllow: ["missing-initializer"],
      txOverrides: { gasLimit: DEPLOY_GAS },
    },
  );
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`  pool=${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}\n`);

  // ── Associate the HTS token with the pool + wire it as the ERC-20 ──
  console.log("setupHTS (pool associates the HTS token)...");
  const setupTx = await pool.setupHTS(token, { gasLimit: TX_GAS });
  const setupRcpt = await setupTx.wait();
  console.log(`  gas=${setupRcpt!.gasUsed}  ${txLink(setupTx.hash)}\n`);

  // ── Build Alice & Bob wallets + Zeto users ──
  const aliceWallet = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobWallet = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceWallet);
  const Bob = await newUser(bobWallet);

  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };
  const erc20Alice = new ethers.Contract(token, ERC20_ABI, aliceWallet);
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);

  const aliceStart = await erc20.balanceOf(Alice.ethAddress);
  console.log(`Alice token balance (base units): ${aliceStart}`);

  // ── 1. Deposit 100 ──
  console.log("\n1. Deposit 100 (public -> shielded)");
  await (await erc20Alice.approve(poolAddr, 100n, ov)).wait();
  const utxo100 = newUTXO(100, Alice);
  const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
  const depTx = await pool
    .connect(aliceWallet)
    .deposit(100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov);
  const depRcpt = await depTx.wait();
  console.log(`   proof ${dep.ms}ms | gas ${depRcpt!.gasUsed} | ${txLink(depTx.hash)}`);
  console.log(`   pool token bal: ${await erc20.balanceOf(poolAddr)} | shieldedSupply: ${await pool.shieldedSupply(token)}`);

  // ── 2. Private transfer: 40 to Bob, 60 change to Alice ──
  console.log("\n2. Private transfer 100 -> 40 Bob + 60 Alice (shielded)");
  const utxoBob40 = newUTXO(40, Bob);
  const utxoAlice60 = newUTXO(60, Alice);
  const xfer = await prepareTransferProof(Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice]);
  const xferTx = await pool
    .connect(aliceWallet)
    .transfer(
      [xfer.inputCommitments[0]],
      [xfer.outputCommitments[0], xfer.outputCommitments[1]],
      xfer.encryptionNonce,
      xfer.ecdhPublicKey,
      xfer.encryptedValues,
      xfer.encodedProof,
      "0x",
      ov,
    );
  const xferRcpt = await xferTx.wait();
  console.log(`   proof ${xfer.ms}ms | gas ${xferRcpt!.gasUsed} | ${txLink(xferTx.hash)}`);

  // ── 3. Bob recovers his note from the event ──
  const evt = xferRcpt!.logs
    .map((l: any) => {
      try {
        return pool.interface.parseLog(l);
      } catch {
        return null;
      }
    })
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

  // ── 4. Bob withdraws 40 ──
  console.log("\n3. Bob withdraws 40 (shielded -> public)");
  const change = newUTXO(0, Bob);
  const wd = await prepareWithdrawProof(Bob, [utxoBob40Recovered, ZERO_UTXO], change);
  const wdTx = await pool
    .connect(bobWallet)
    .withdraw(40n, [wd.inputCommitments[0]], wd.output, wd.encodedProof, "0x", ov);
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
  console.log(`   setupHTS:  ${setupRcpt!.gasUsed}`);
  console.log(`   deposit:   ${depRcpt!.gasUsed}`);
  console.log(`   transfer:  ${xferRcpt!.gasUsed}`);
  console.log(`   withdraw:  ${wdRcpt!.gasUsed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
