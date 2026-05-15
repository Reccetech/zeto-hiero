import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TestSanctionsModule } from "../typechain-types";

async function deployModule(owner: string): Promise<TestSanctionsModule> {
  const Factory = await ethers.getContractFactory("TestSanctionsModule");
  const mod = (await upgrades.deployProxy(Factory, [owner], {
    kind: "uups",
    initializer: "initialize",
    unsafeAllow: ["missing-public-upgradeto"],
  })) as unknown as TestSanctionsModule;
  await mod.waitForDeployment();
  return mod;
}

describe("SanctionsModule", function () {
  let mod: TestSanctionsModule;
  let owner: any;
  let oracle: any;
  let alice: any;

  const ZERO = ethers.ZeroHash;
  const ROOT_A = "0x" + "11".repeat(32);
  const ROOT_B = "0x" + "22".repeat(32);

  beforeEach(async function () {
    [owner, oracle, alice] = await ethers.getSigners();
    mod = await deployModule(owner.address);
  });

  describe("initial state", function () {
    it("default sanctionsMerkleRoot is bytes32(0) (empty SMT — E-6 testnet convention)", async function () {
      expect(await mod.sanctionsMerkleRoot()).to.equal(ZERO);
    });

    it("default sanctionsOracle is address(0) (oracle disabled)", async function () {
      expect(await mod.sanctionsOracle()).to.equal(ethers.ZeroAddress);
    });

    it("default sanctionsMerkleRootBlock is 0", async function () {
      expect(await mod.sanctionsMerkleRootBlock()).to.equal(0n);
    });
  });

  describe("updateSanctionsMerkleRoot", function () {
    it("owner can update root; emits event with old/new and block number", async function () {
      const tx = await mod.updateSanctionsMerkleRoot(ROOT_A);
      const receipt = await tx.wait();
      await expect(tx)
        .to.emit(mod, "SanctionsMerkleRootUpdated")
        .withArgs(ZERO, ROOT_A, receipt!.blockNumber);
      expect(await mod.sanctionsMerkleRoot()).to.equal(ROOT_A);
      expect(await mod.sanctionsMerkleRootBlock()).to.equal(BigInt(receipt!.blockNumber));
    });

    it("subsequent update emits with the previous root as oldRoot", async function () {
      await mod.updateSanctionsMerkleRoot(ROOT_A);
      await expect(mod.updateSanctionsMerkleRoot(ROOT_B))
        .to.emit(mod, "SanctionsMerkleRootUpdated")
        .withArgs(ROOT_A, ROOT_B, await ethers.provider.getBlockNumber() + 1);
      expect(await mod.sanctionsMerkleRoot()).to.equal(ROOT_B);
    });

    it("oracle (when set) can update root", async function () {
      await mod.setSanctionsOracle(oracle.address);
      await expect(mod.connect(oracle).updateSanctionsMerkleRoot(ROOT_A))
        .to.emit(mod, "SanctionsMerkleRootUpdated");
      expect(await mod.sanctionsMerkleRoot()).to.equal(ROOT_A);
    });

    it("non-owner non-oracle reverts with NotOwnerOrOracle", async function () {
      await expect(mod.connect(alice).updateSanctionsMerkleRoot(ROOT_A))
        .to.be.revertedWithCustomError(mod, "NotOwnerOrOracle");
    });

    it("with oracle set, a different non-owner non-oracle still reverts", async function () {
      await mod.setSanctionsOracle(oracle.address);
      await expect(mod.connect(alice).updateSanctionsMerkleRoot(ROOT_A))
        .to.be.revertedWithCustomError(mod, "NotOwnerOrOracle");
    });
  });

  describe("setSanctionsOracle", function () {
    it("owner can set oracle and emits event", async function () {
      await expect(mod.setSanctionsOracle(oracle.address))
        .to.emit(mod, "SanctionsOracleSet")
        .withArgs(oracle.address);
      expect(await mod.sanctionsOracle()).to.equal(oracle.address);
    });

    it("owner can disable oracle by setting to address(0)", async function () {
      await mod.setSanctionsOracle(oracle.address);
      await mod.setSanctionsOracle(ethers.ZeroAddress);
      expect(await mod.sanctionsOracle()).to.equal(ethers.ZeroAddress);
      // oracle should no longer be able to update
      await expect(mod.connect(oracle).updateSanctionsMerkleRoot(ROOT_A))
        .to.be.revertedWithCustomError(mod, "NotOwnerOrOracle");
    });

    it("non-owner cannot set oracle", async function () {
      await expect(mod.connect(alice).setSanctionsOracle(oracle.address))
        .to.be.revertedWithCustomError(mod, "OwnableUnauthorizedAccount");
    });
  });

  describe("_requireCurrentSanctionsRoot — E-6 always-on enforcement", function () {
    it("passes when proof's root matches current root (non-zero)", async function () {
      await mod.updateSanctionsMerkleRoot(ROOT_A);
      // No revert
      await mod.requireCurrentSanctionsRoot(ROOT_A);
    });

    it("passes when both are bytes32(0) — empty SMT testnet default", async function () {
      // Pool deploys with sanctionsMerkleRoot == bytes32(0); clients prove against bytes32(0)
      // This is the legitimate testnet path; not a bypass.
      await mod.requireCurrentSanctionsRoot(ZERO);
    });

    it("reverts with SanctionsRootMismatch on stale root after rotation", async function () {
      await mod.updateSanctionsMerkleRoot(ROOT_A);
      // Operator rotates root mid-flight
      await mod.updateSanctionsMerkleRoot(ROOT_B);
      // Client's proof was generated against ROOT_A; now stale
      await expect(mod.requireCurrentSanctionsRoot(ROOT_A))
        .to.be.revertedWithCustomError(mod, "SanctionsRootMismatch");
    });

    it("reverts when a non-zero proof root is presented against bytes32(0)", async function () {
      // Attacker attempts to bypass by claiming an unset root
      await expect(mod.requireCurrentSanctionsRoot(ROOT_A))
        .to.be.revertedWithCustomError(mod, "SanctionsRootMismatch");
    });
  });
});
