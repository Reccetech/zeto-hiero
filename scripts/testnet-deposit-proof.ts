import { ethers, network } from "hardhat";
import * as path from "path";
import * as snarkjs from "snarkjs";
import { buildPoseidon, buildBabyjub } from "circomlibjs";

// MVP Phase 5 (Option 3): prove a real Groth16 deposit proof verifies on ACTUAL Hedera
// testnet, and measure proof-gen time, verification latency, and on-chain gas.
//
// Run: npx hardhat run scripts/testnet-deposit-proof.ts --network hedera_testnet

const BUILD = path.join(__dirname, "..", "circuits", "build");
const WASM = path.join(BUILD, "deposit_js", "deposit.wasm");
const ZKEY = path.join(BUILD, "deposit_final.zkey");
const VKEY = path.join(BUILD, "deposit_vkey.json");

function ms(start: number) {
  return `${(Date.now() - start).toFixed(0)} ms`;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const hashscanBase =
    net.chainId === 296n ? "https://hashscan.io/testnet" : net.chainId === 295n ? "https://hashscan.io/mainnet" : null;

  console.log(`\n=== MVP Phase 5 / Option 3 — real deposit proof on chain ${net.chainId} ===`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} HBAR\n`);

  // ── 1. Build a real deposit proof locally (timed) ──────────────────────────
  const poseidon = await buildPoseidon();
  const babyjub = await buildBabyjub();
  const F = poseidon.F;

  const privKey = 2934109283n;
  const pub = babyjub.mulPointEscalar(babyjub.Base8, privKey);
  const pubX = F.toObject(pub[0]);
  const pubY = F.toObject(pub[1]);

  const value0 = 100n;
  const salt0 = 1234567890123456789n;
  const c0 = F.toObject(poseidon([value0, salt0, pubX, pubY]));

  const input = {
    outputCommitments: [c0.toString(), "0"],
    outputValues: [value0.toString(), "0"],
    outputSalts: [salt0.toString(), "0"],
    outputOwnerPublicKeys: [[pubX.toString(), pubY.toString()], ["0", "0"]],
  };

  let t = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const proofGenTime = ms(t);

  // sanity: off-chain verify
  const vkey = require(VKEY);
  const offchainOk = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log(`1. Proof generation:        ${proofGenTime}`);
  console.log(`   Off-chain verify:        ${offchainOk ? "OK" : "FAILED"}\n`);

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse("[" + calldata + "]");

  // ── 2. Deploy the verifier to testnet (timed, gas) ─────────────────────────
  // Hedera: pass explicit gasLimit so hardhat-ethers skips eth_estimateGas
  // (the relay rejects the auto-estimation with INSUFFICIENT_TX_FEE).
  const DEPLOY_GAS = 6_000_000n;
  const TX_GAS = 2_000_000n;

  const Verifier = await ethers.getContractFactory("DepositVerifierMVP");
  t = Date.now();
  const verifier = await Verifier.deploy({ gasLimit: DEPLOY_GAS });
  await verifier.waitForDeployment();
  const vDeployTime = ms(t);
  const vAddr = await verifier.getAddress();
  const vDeployRcpt = await ethers.provider.getTransactionReceipt(verifier.deploymentTransaction()!.hash);
  console.log(`2. Verifier deployed:       ${vAddr}`);
  console.log(`   Deploy time:             ${vDeployTime}`);
  console.log(`   Deploy gas:              ${vDeployRcpt!.gasUsed.toString()}`);
  if (hashscanBase) console.log(`   ${hashscanBase}/contract/${vAddr}\n`);

  // ── 3. eth_call verification (correctness + latency) ───────────────────────
  t = Date.now();
  const callOk = await verifier.verifyProof(pA, pB, pC, pubSignals);
  const callLatency = ms(t);
  console.log(`3. On-chain verify (eth_call): ${callOk ? "OK" : "FAILED"}   latency ${callLatency}\n`);

  // ── 4. State-changing verification via probe (real gas receipt) ────────────
  const Probe = await ethers.getContractFactory("VerifierGasProbe");
  const probe = await Probe.deploy(vAddr, { gasLimit: DEPLOY_GAS });
  await probe.waitForDeployment();
  const probeAddr = await probe.getAddress();

  t = Date.now();
  const tx = await probe.probe(pA, pB, pC, pubSignals, { gasLimit: TX_GAS });
  const rcpt = await tx.wait();
  const verifyTxTime = ms(t);
  console.log(`4. Verify as transaction (probe):`);
  console.log(`   tx hash:                 ${tx.hash}`);
  console.log(`   submit→confirm:          ${verifyTxTime}`);
  console.log(`   gasUsed (full tx):       ${rcpt!.gasUsed.toString()}`);
  console.log(`   on-chain result:         ${(await probe.lastResult()) ? "TRUE (proof valid)" : "FALSE"}`);
  if (hashscanBase) console.log(`   ${hashscanBase}/transaction/${tx.hash}\n`);

  // ── 5. Tamper check on chain ───────────────────────────────────────────────
  const tampered = [...pubSignals];
  tampered[0] = "999";
  const tamperOk = await verifier.verifyProof(pA, pB, pC, tampered);
  console.log(`5. Tampered signal (amount 100→999): on-chain verify = ${tamperOk} (expected false)\n`);

  console.log(`=== Summary ===`);
  console.log(`Proof gen (local):     ${proofGenTime}`);
  console.log(`Verifier deploy gas:   ${vDeployRcpt!.gasUsed.toString()}`);
  console.log(`Verify tx gas:         ${rcpt!.gasUsed.toString()}`);
  console.log(`Verify tx wall-clock:  ${verifyTxTime}`);
  console.log(`Correctness:           valid=${callOk}, tampered-rejected=${!tamperOk}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
