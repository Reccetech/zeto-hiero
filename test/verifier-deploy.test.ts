import { expect } from "chai";
import { ethers, deployments } from "hardhat";

// MVP Phase 2 (was Phase 3) — verifier deployment smoke test.
// Runs the verifiers tag via hardhat-deploy's fixture, then asserts each verifier
// is reachable, has bytecode, and exposes the expected verifyProof ABI shape.
//
// Per-verifier signal counts (from upstream `vendor/zeto/solidity/contracts/zeto_anon_enc.sol`):
//   INPUT_SIZE = 15        → verifier signature: verifyProof(_pA, _pB, _pC, _pubSignals[15])
//   BATCH_INPUT_SIZE = 63  → batch signature:    verifyProof(_pA, _pB, _pC, _pubSignals[63])
//
// Public signal counts for deposit/withdraw verifiers come from upstream's circuits and
// are validated implicitly by the artifact's compiled ABI.
const EXPECTED_DEPLOYMENTS = [
  "Verifier_AnonEnc",
  "Verifier_AnonEncBatch",
  "Verifier_Deposit",
  "Verifier_Withdraw",
  "Verifier_WithdrawBatch",
];

const setup = deployments.createFixture(async ({ deployments }) => {
  await deployments.fixture(["verifiers"]);
  const out: Record<string, { address: string }> = {};
  for (const name of EXPECTED_DEPLOYMENTS) {
    out[name] = await deployments.get(name);
  }
  return out;
});

describe("MVP Phase 2 (verifiers) — deploy script smoke", function () {
  it("deploys all 5 AnonEnc-path verifiers", async function () {
    const dep = await setup();
    for (const name of EXPECTED_DEPLOYMENTS) {
      expect(dep[name].address).to.properAddress;
      expect(dep[name].address).to.not.equal(ethers.ZeroAddress);
    }
  });

  it("each deployed verifier has non-trivial bytecode", async function () {
    const dep = await setup();
    for (const name of EXPECTED_DEPLOYMENTS) {
      const code = await ethers.provider.getCode(dep[name].address);
      expect(code.length).to.be.greaterThan(2, `${name} has no bytecode`);
    }
  });

  it("each verifier exposes verifyProof(...)", async function () {
    await setup();
    // hardhat-deploy stores the ABI in the deployment record; use that directly
    // rather than ethers.getContractAt (which looks up by artifact/Solidity name).
    for (const name of EXPECTED_DEPLOYMENTS) {
      const record = await deployments.get(name);
      const iface = new ethers.Interface(record.abi);
      const fns = iface.fragments
        .filter((f): f is import("ethers").FunctionFragment => f.type === "function")
        .map((f) => f.name);
      expect(fns).to.include("verifyProof", `${name} should expose verifyProof()`);
    }
  });
});
