import { expect } from "chai";
import { ethers, artifacts } from "hardhat";

// MVP Phase 1 smoke: prove that the compiled Zeto_AnonEnc artifact is reachable
// and has the function shape we expect for downstream phases.
// No deployment — this just validates the ABI was produced correctly.
describe("MVP Phase 1 — upstream Zeto compile smoke", function () {
  it("Zeto_AnonEnc artifact is reachable via Hardhat artifacts", async function () {
    const artifact = await artifacts.readArtifact("Zeto_AnonEnc");
    expect(artifact.contractName).to.equal("Zeto_AnonEnc");
    expect(artifact.bytecode.length).to.be.greaterThan(2);
  });

  it("Zeto_AnonEnc exposes the entry-point functions used in MVP Phase 4+", async function () {
    const factory = await ethers.getContractFactory("Zeto_AnonEnc");
    const fragments = factory.interface.fragments
      .filter((f): f is import("ethers").FunctionFragment => f.type === "function")
      .map((f) => f.name);

    // Functions we'll call from HederaZetoTokenLite + the demo script
    for (const fn of ["deposit", "transfer", "withdraw", "initialize"]) {
      expect(fragments).to.include(fn, `Zeto_AnonEnc should expose ${fn}()`);
    }
  });

  it("UpstreamZetoSmoke compiles and is usable as a factory", async function () {
    const factory = await ethers.getContractFactory("UpstreamZetoSmoke");
    expect(factory).to.not.be.undefined;
  });
});
