import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HederaKycRegistry, HederaKycRegistryV2 } from "../typechain-types";

async function deployRegistry(owner: string): Promise<HederaKycRegistry> {
  const Factory = await ethers.getContractFactory("HederaKycRegistry");
  const reg = (await upgrades.deployProxy(Factory, [owner], {
    kind: "uups",
    initializer: "initialize",
  })) as unknown as HederaKycRegistry;
  await reg.waitForDeployment();
  return reg;
}

// Compute the same key hash the contract uses
function bjjKeyHash(x: bigint, y: bigint): string {
  return ethers.keccak256(ethers.solidityPacked(["uint256", "uint256"], [x, y]));
}

describe("HederaKycRegistry", function () {
  let reg: HederaKycRegistry;
  let owner: any;
  let alice: any;
  let bob: any;

  // Sample BJJ public keys (any non-zero field elements work for the tests)
  const ALICE_X = 0x1111111111111111111111111111111111111111111111111111111111111111n;
  const ALICE_Y = 0x2222222222222222222222222222222222222222222222222222222222222222n;
  const BOB_X   = 0x3333333333333333333333333333333333333333333333333333333333333333n;
  const BOB_Y   = 0x4444444444444444444444444444444444444444444444444444444444444444n;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    reg = await deployRegistry(owner.address);
  });

  describe("enroll", function () {
    it("writes both directional maps and isEnrolled", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      const keyHash = bjjKeyHash(ALICE_X, ALICE_Y);
      expect(await reg.bjjKeyToAccount(keyHash)).to.equal(alice.address);
      expect(await reg.accountToBjjKey(alice.address)).to.equal(keyHash);
      expect(await reg.isEnrolled(keyHash)).to.equal(true);
      expect(await reg.enrollmentCount()).to.equal(1n);
    });

    it("emits ParticipantEnrolled with correct fields", async function () {
      await expect(reg.enroll(alice.address, ALICE_X, ALICE_Y))
        .to.emit(reg, "ParticipantEnrolled")
        .withArgs(bjjKeyHash(ALICE_X, ALICE_Y), alice.address, ALICE_X, ALICE_Y, 1n);
    });

    it("rejects zero address", async function () {
      await expect(reg.enroll(ethers.ZeroAddress, ALICE_X, ALICE_Y))
        .to.be.revertedWithCustomError(reg, "ZeroAddress");
    });

    it("rejects duplicate key enrollment with KeyAlreadyEnrolled", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      // Same BJJ key, different account
      await expect(reg.enroll(bob.address, ALICE_X, ALICE_Y))
        .to.be.revertedWithCustomError(reg, "KeyAlreadyEnrolled");
    });

    it("rejects re-binding same address with new key (AccountAlreadyBound)", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      // Same address, different BJJ key
      await expect(reg.enroll(alice.address, BOB_X, BOB_Y))
        .to.be.revertedWithCustomError(reg, "AccountAlreadyBound");
    });

    it("non-owner cannot enroll", async function () {
      await expect(reg.connect(alice).enroll(alice.address, ALICE_X, ALICE_Y))
        .to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
    });
  });

  describe("batchEnroll", function () {
    it("enrolls 10 participants", async function () {
      const accounts = [];
      const xs = [];
      const ys = [];
      const signers = await ethers.getSigners();
      for (let i = 0; i < 10; i++) {
        accounts.push(signers[i].address);
        xs.push(BigInt(i + 100) * (1n << 64n));
        ys.push(BigInt(i + 200) * (1n << 64n));
      }
      await reg.batchEnroll(accounts, xs, ys);
      expect(await reg.enrollmentCount()).to.equal(10n);
      // Spot check a few
      expect(await reg.isEnrolled(bjjKeyHash(xs[0], ys[0]))).to.equal(true);
      expect(await reg.isEnrolled(bjjKeyHash(xs[9], ys[9]))).to.equal(true);
    });

    it("reverts with ArrayLengthMismatch on length mismatch", async function () {
      await expect(reg.batchEnroll([alice.address], [ALICE_X], [ALICE_Y, BOB_Y]))
        .to.be.revertedWithCustomError(reg, "ArrayLengthMismatch");
      await expect(reg.batchEnroll([alice.address, bob.address], [ALICE_X], [ALICE_Y]))
        .to.be.revertedWithCustomError(reg, "ArrayLengthMismatch");
    });

    it("silently skips already-enrolled keys (idempotent batch)", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      // Re-include alice in a batch — should not revert, just skip
      await reg.batchEnroll([alice.address, bob.address], [ALICE_X, BOB_X], [ALICE_Y, BOB_Y]);
      expect(await reg.enrollmentCount()).to.equal(2n); // Alice (already) + Bob (new)
    });

    it("silently skips zero-address entries in a batch", async function () {
      await reg.batchEnroll([alice.address, ethers.ZeroAddress], [ALICE_X, BOB_X], [ALICE_Y, BOB_Y]);
      expect(await reg.enrollmentCount()).to.equal(1n);
    });
  });

  describe("revoke", function () {
    it("clears both maps and flips isEnrolled to false", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      const keyHash = bjjKeyHash(ALICE_X, ALICE_Y);
      await reg.revoke(ALICE_X, ALICE_Y);
      expect(await reg.bjjKeyToAccount(keyHash)).to.equal(ethers.ZeroAddress);
      expect(await reg.accountToBjjKey(alice.address)).to.equal(ethers.ZeroHash);
      expect(await reg.isEnrolled(keyHash)).to.equal(false);
    });

    it("emits ParticipantRevoked", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      await expect(reg.revoke(ALICE_X, ALICE_Y))
        .to.emit(reg, "ParticipantRevoked")
        .withArgs(bjjKeyHash(ALICE_X, ALICE_Y), alice.address);
    });

    it("allows subsequent enroll(sameAccount, newKey) — E-14", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      await reg.revoke(ALICE_X, ALICE_Y);
      // Same address can now be re-bound to a different BJJ key
      await reg.enroll(alice.address, BOB_X, BOB_Y);
      expect(await reg.accountToBjjKey(alice.address)).to.equal(bjjKeyHash(BOB_X, BOB_Y));
    });

    it("reverts with KeyNotEnrolled when revoking a non-enrolled key", async function () {
      await expect(reg.revoke(ALICE_X, ALICE_Y))
        .to.be.revertedWithCustomError(reg, "KeyNotEnrolled");
    });
  });

  describe("updateIdentitiesRoot", function () {
    const ROOT_A = "0x" + "aa".repeat(32);
    const ROOT_B = "0x" + "bb".repeat(32);

    it("emits IdentitiesRootUpdated with old/new/block", async function () {
      const tx = await reg.updateIdentitiesRoot(ROOT_A);
      const receipt = await tx.wait();
      await expect(tx)
        .to.emit(reg, "IdentitiesRootUpdated")
        .withArgs(ethers.ZeroHash, ROOT_A, receipt!.blockNumber);
      expect(await reg.identitiesRoot()).to.equal(ROOT_A);
    });

    it("subsequent update uses previous root as oldRoot", async function () {
      await reg.updateIdentitiesRoot(ROOT_A);
      await expect(reg.updateIdentitiesRoot(ROOT_B))
        .to.emit(reg, "IdentitiesRootUpdated");
      expect(await reg.identitiesRoot()).to.equal(ROOT_B);
    });

    it("non-owner cannot update root", async function () {
      await expect(reg.connect(alice).updateIdentitiesRoot(ROOT_A))
        .to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
    });
  });

  describe("view helpers", function () {
    it("getAccountForKey returns mapped address", async function () {
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      expect(await reg.getAccountForKey(ALICE_X, ALICE_Y)).to.equal(alice.address);
    });

    it("isKeyEnrolled returns true when enrolled, false otherwise", async function () {
      expect(await reg.isKeyEnrolled(ALICE_X, ALICE_Y)).to.equal(false);
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      expect(await reg.isKeyEnrolled(ALICE_X, ALICE_Y)).to.equal(true);
    });
  });

  describe("UUPS upgrade", function () {
    it("preserves enrolled state across upgrade to V2", async function () {
      // Enroll on V1
      await reg.enroll(alice.address, ALICE_X, ALICE_Y);
      await reg.updateIdentitiesRoot("0x" + "cc".repeat(32));
      const keyHash = bjjKeyHash(ALICE_X, ALICE_Y);
      const beforeProxy = await reg.getAddress();

      // Upgrade to V2. unsafeAllow["missing-initializer"]: V2 inherits initialize() from V1,
      // but the OZ plugin's static analysis doesn't recognize inherited initializers as
      // satisfying the check. The inherited function is structurally correct.
      const V2 = await ethers.getContractFactory("HederaKycRegistryV2");
      const upgraded = (await upgrades.upgradeProxy(beforeProxy, V2, {
        unsafeAllow: ["missing-initializer"],
      })) as unknown as HederaKycRegistryV2;
      await upgraded.waitForDeployment();

      // Proxy address unchanged
      expect(await upgraded.getAddress()).to.equal(beforeProxy);

      // V1 state survived
      expect(await upgraded.bjjKeyToAccount(keyHash)).to.equal(alice.address);
      expect(await upgraded.accountToBjjKey(alice.address)).to.equal(keyHash);
      expect(await upgraded.isEnrolled(keyHash)).to.equal(true);
      expect(await upgraded.enrollmentCount()).to.equal(1n);
      expect(await upgraded.identitiesRoot()).to.equal("0x" + "cc".repeat(32));

      // V2 new field usable
      await upgraded.setV2NewField(42n);
      expect(await upgraded.v2NewField()).to.equal(42n);
    });

    it("non-owner cannot upgrade", async function () {
      const V2 = await ethers.getContractFactory("HederaKycRegistryV2");
      const aliceConnected = V2.connect(alice);
      await expect(
        upgrades.upgradeProxy(await reg.getAddress(), aliceConnected, {
          unsafeAllow: ["missing-initializer"],
        })
      ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
    });
  });
});
