import { expect } from "chai";
import { ethers } from "hardhat";
import * as path from "path";
import * as snarkjs from "snarkjs";
import { buildPoseidon, buildBabyjub } from "circomlibjs";

// MVP Phase 5 — REAL Groth16 proof, end to end.
// Builds a valid deposit witness (commitment = Poseidon4(value, salt, pubX, pubY)),
// generates a genuine proof against our freshly-compiled circuit + proving key,
// verifies it off-chain (snarkjs) AND on-chain (the generated DepositVerifierMVP).
// This is the "the cryptography is real" checkpoint — no mock verifier.

const BUILD = path.join(__dirname, "..", "circuits", "build");
const WASM = path.join(BUILD, "deposit_js", "deposit.wasm");
const ZKEY = path.join(BUILD, "deposit_final.zkey");
const VKEY = path.join(BUILD, "deposit_vkey.json");

describe("MVP Phase 5 — real deposit proof (off-chain + on-chain)", function () {
  this.timeout(120_000); // proof generation is multi-second

  let poseidon: any;
  let F: any;
  let depositAmount: bigint;
  let publicSignals: string[];
  let proof: any;

  before(async function () {
    poseidon = await buildPoseidon();
    const babyjub = await buildBabyjub();
    F = poseidon.F;

    // Derive a BabyJubJub keypair (Alice).
    const privKey = 2934109283n; // deterministic test scalar
    const pub = babyjub.mulPointEscalar(babyjub.Base8, privKey);
    const pubX = F.toObject(pub[0]);
    const pubY = F.toObject(pub[1]);

    // Deposit 100 → outputs [100, 0]. The zero output is the ZERO_UTXO (commitment 0).
    depositAmount = 100n;
    const value0 = 100n;
    const salt0 = 1234567890123456789n;

    // commitment0 = Poseidon4(value, salt, pubX, pubY)
    const c0 = F.toObject(poseidon([value0, salt0, pubX, pubY]));

    const input = {
      outputCommitments: [c0.toString(), "0"],
      outputValues: [value0.toString(), "0"],
      outputSalts: [salt0.toString(), "0"],
      outputOwnerPublicKeys: [
        [pubX.toString(), pubY.toString()],
        ["0", "0"],
      ],
    };

    const result = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    proof = result.proof;
    publicSignals = result.publicSignals;
  });

  it("public signals are [sum, commitment0, commitment1] with sum == deposit amount", function () {
    // snarkjs orders public signals as [outputs..., publicInputs...]:
    // the circuit's `out` (sum) first, then the two public outputCommitments.
    expect(publicSignals.length).to.equal(3);
    expect(BigInt(publicSignals[0])).to.equal(depositAmount);
    expect(BigInt(publicSignals[2])).to.equal(0n); // zero UTXO commitment
  });

  it("proof verifies OFF-chain via snarkjs against our vkey", async function () {
    const vkey = require(VKEY);
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(ok).to.equal(true);
  });

  it("proof verifies ON-chain via the generated DepositVerifierMVP", async function () {
    const Verifier = await ethers.getContractFactory("DepositVerifierMVP");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    // snarkjs Solidity calldata format
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const args = JSON.parse("[" + calldata + "]");
    const [pA, pB, pC, pubSignals] = args;

    const ok = await verifier.verifyProof(pA, pB, pC, pubSignals);
    expect(ok).to.equal(true);
  });

  it("on-chain verification REJECTS a tampered public signal", async function () {
    const Verifier = await ethers.getContractFactory("DepositVerifierMVP");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const args = JSON.parse("[" + calldata + "]");
    const [pA, pB, pC, pubSignals] = args;

    // Tamper: claim the deposit was 999 instead of 100
    const tampered = [...pubSignals];
    tampered[0] = "999";

    const ok = await verifier.verifyProof(pA, pB, pC, tampered);
    expect(ok).to.equal(false);
  });
});
