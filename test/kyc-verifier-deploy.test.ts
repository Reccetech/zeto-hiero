import { expect } from "chai";
import { ethers } from "hardhat";

// v0.2 Phase 3 — the KYC transfer verifier (generated from anon_enc_nullifier_kyc, 2^18 ptau)
// deploys and exposes the verifyProof shape the pool's INPUT_SIZE=19 transfer path expects.
describe("v0.2 Phase 3 — AnonEncNullifierKyc verifier", function () {
  it("deploys to a non-zero address with non-trivial bytecode", async function () {
    const Verifier = await ethers.getContractFactory("AnonEncNullifierKycVerifierMVP");
    const v = await Verifier.deploy();
    await v.waitForDeployment();
    const addr = await v.getAddress();
    expect(addr).to.not.equal(ethers.ZeroAddress);
    expect(await ethers.provider.getCode(addr)).to.not.equal("0x");
  });

  it("exposes verifyProof(uint[2],uint[2][2],uint[2],uint[19])", async function () {
    const Verifier = await ethers.getContractFactory("AnonEncNullifierKycVerifierMVP");
    const names = Verifier.interface.fragments
      .filter((f): f is import("ethers").FunctionFragment => f.type === "function")
      .map((f) => f.format("full"));
    expect(
      names.some((s) => s.includes("verifyProof") && s.includes("uint256[19]")),
      "verifyProof should take 19 public signals",
    ).to.equal(true);
  });
});
