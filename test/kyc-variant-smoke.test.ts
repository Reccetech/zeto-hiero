import { expect } from "chai";
import { ethers, artifacts } from "hardhat";

// v0.2 Phase 1 smoke: prove the upstream Zeto_AnonEncNullifierKyc artifact is reachable
// and has the function shape v0.2 depends on. Confirms the @iden3/contracts fork
// (SmtLib + Poseidon units) and the KYC variant compiled cleanly under our cancun target.
describe("v0.2 Phase 1 — KYC variant compile smoke", function () {
  it("Zeto_AnonEncNullifierKyc artifact is reachable via Hardhat artifacts", async function () {
    const artifact = await artifacts.readArtifact("Zeto_AnonEncNullifierKyc");
    expect(artifact.contractName).to.equal("Zeto_AnonEncNullifierKyc");
    expect(artifact.bytecode.length).to.be.greaterThan(2);
  });

  it("exposes entry points used by HederaZetoTokenKyc + the KYC demo", async function () {
    // Read the ABI from the artifact rather than getContractFactory: the KYC variant
    // requires linking PoseidonUnit2L/3L + SmtLib (deployed in Phase 2), and a factory
    // can't be built without those links. The ABI alone is enough to validate the shape.
    const artifact = await artifacts.readArtifact("Zeto_AnonEncNullifierKyc");
    const iface = new ethers.Interface(artifact.abi);
    const fragments = iface.fragments
      .filter((f): f is import("ethers").FunctionFragment => f.type === "function")
      .map((f) => f.name);

    // transfer/deposit/withdraw/initialize are the token flow; register/getIdentitiesRoot
    // are the embedded KYC Registry that the transfer circuit verifies membership against.
    for (const fn of [
      "deposit",
      "transfer",
      "withdraw",
      "initialize",
      "register",
      "getIdentitiesRoot",
      "isRegistered",
    ]) {
      expect(fragments).to.include(fn, `Zeto_AnonEncNullifierKyc should expose ${fn}()`);
    }
  });

  it("requires linking the SMT + Poseidon libraries (Phase 2 dependency)", async function () {
    // Documents the linking requirement that drives Phase 2. The unlinked bytecode
    // contains the library placeholder references.
    const artifact = await artifacts.readArtifact("Zeto_AnonEncNullifierKyc");
    const linkRefs = JSON.stringify(artifact.linkReferences);
    expect(linkRefs).to.contain("SmtLib");
    expect(linkRefs).to.contain("Poseidon");
  });
});
