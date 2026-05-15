import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { ZetoVkeySetter, MockVerifierRegistry } from "../typechain-types";

const CIRCUITS = [
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_1_1",
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_2_2",
  "withdraw_kyc_sanctions_non_repudiation_2_1",
];
const CIRCUIT_IDS = CIRCUITS.map((n) => ethers.keccak256(ethers.toUtf8Bytes(n)));

// A minimal-but-valid VerifyingKey struct for the test
function sampleVkey() {
  return {
    alpha1: { x: 1n, y: 2n },
    beta2:  { x: [3n, 4n], y: [5n, 6n] },
    gamma2: { x: [7n, 8n], y: [9n, 10n] },
    delta2: { x: [11n, 12n], y: [13n, 14n] },
    ic: [
      { x: 15n, y: 16n },
      { x: 17n, y: 18n },
    ],
  };
}

async function deploySetter(owner: string, registryAddress: string, expected: string[]): Promise<ZetoVkeySetter> {
  const Factory = await ethers.getContractFactory("ZetoVkeySetter");
  const setter = (await upgrades.deployProxy(Factory, [owner, registryAddress, expected], {
    kind: "uups",
    initializer: "initialize",
  })) as unknown as ZetoVkeySetter;
  await setter.waitForDeployment();
  return setter;
}

async function deployMockRegistry(): Promise<MockVerifierRegistry> {
  const Factory = await ethers.getContractFactory("MockVerifierRegistry");
  const reg = (await Factory.deploy()) as unknown as MockVerifierRegistry;
  await reg.waitForDeployment();
  return reg;
}

describe("ZetoVkeySetter", function () {
  let setter: ZetoVkeySetter;
  let registry: MockVerifierRegistry;
  let owner: any;
  let alice: any;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    registry = await deployMockRegistry();
    setter = await deploySetter(owner.address, await registry.getAddress(), CIRCUIT_IDS);
  });

  describe("initialize", function () {
    it("stores expectedCircuits at deploy time", async function () {
      expect(await setter.expectedCircuitsCount()).to.equal(BigInt(CIRCUITS.length));
      for (let i = 0; i < CIRCUITS.length; i++) {
        expect(await setter.expectedCircuits(i)).to.equal(CIRCUIT_IDS[i]);
      }
    });

    it("reverts with EmptyExpectedCircuits on empty array", async function () {
      const Factory = await ethers.getContractFactory("ZetoVkeySetter");
      await expect(
        upgrades.deployProxy(Factory, [owner.address, await registry.getAddress(), []], {
          kind: "uups",
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(Factory, "EmptyExpectedCircuits");
    });

    it("locked is false on fresh deploy", async function () {
      expect(await setter.locked()).to.equal(false);
    });
  });

  describe("stageVerifyingKey + commitVerifyingKey (happy path)", function () {
    it("stages then commits a single vkey; writes to registry", async function () {
      const vk = sampleVkey();
      await expect(setter.stageVerifyingKey(CIRCUITS[0], vk))
        .to.emit(setter, "VerifyingKeyStaged")
        .withArgs(CIRCUIT_IDS[0], CIRCUITS[0]);
      expect(await setter.hasStaged(CIRCUIT_IDS[0])).to.equal(true);

      await expect(setter.commitVerifyingKey(CIRCUITS[0]))
        .to.emit(setter, "VerifyingKeyCommitted")
        .withArgs(CIRCUIT_IDS[0], CIRCUITS[0]);
      expect(await setter.isCommitted(CIRCUIT_IDS[0])).to.equal(true);
      expect(await registry.hasVkey(CIRCUIT_IDS[0])).to.equal(true);
      expect(await registry.setCount()).to.equal(1n);
    });

    it("commit reverts with NoStagedKey if not staged", async function () {
      await expect(setter.commitVerifyingKey(CIRCUITS[0]))
        .to.be.revertedWithCustomError(setter, "NoStagedKey")
        .withArgs(CIRCUIT_IDS[0]);
    });

    it("non-owner cannot stage or commit", async function () {
      const vk = sampleVkey();
      await expect(setter.connect(alice).stageVerifyingKey(CIRCUITS[0], vk))
        .to.be.revertedWithCustomError(setter, "OwnableUnauthorizedAccount");
      await setter.stageVerifyingKey(CIRCUITS[0], vk);
      await expect(setter.connect(alice).commitVerifyingKey(CIRCUITS[0]))
        .to.be.revertedWithCustomError(setter, "OwnableUnauthorizedAccount");
    });
  });

  describe("batchStageVerifyingKeys + batchCommitVerifyingKeys", function () {
    it("batch stages and commits all circuits", async function () {
      const vks = CIRCUITS.map(() => sampleVkey());
      await setter.batchStageVerifyingKeys(CIRCUITS, vks);
      for (const id of CIRCUIT_IDS) expect(await setter.hasStaged(id)).to.equal(true);
      await setter.batchCommitVerifyingKeys(CIRCUITS);
      for (const id of CIRCUIT_IDS) expect(await setter.isCommitted(id)).to.equal(true);
      expect(await registry.setCount()).to.equal(BigInt(CIRCUITS.length));
    });

    it("batch stage with mismatched array lengths reverts with ArrayLengthMismatch", async function () {
      const vks = [sampleVkey(), sampleVkey()];
      await expect(setter.batchStageVerifyingKeys(CIRCUITS, vks))
        .to.be.revertedWithCustomError(setter, "ArrayLengthMismatch");
    });

    it("batch commit reverts on first not-staged circuit", async function () {
      // Only stage the first; commit will fail on the second
      await setter.stageVerifyingKey(CIRCUITS[0], sampleVkey());
      await expect(setter.batchCommitVerifyingKeys(CIRCUITS))
        .to.be.revertedWithCustomError(setter, "NoStagedKey");
    });
  });

  describe("readyToLock / uncommittedCircuits — E-7 completeness", function () {
    it("readyToLock is false on fresh deploy; uncommittedCircuits returns all expected", async function () {
      expect(await setter.readyToLock()).to.equal(false);
      const missing = await setter.uncommittedCircuits();
      expect(missing.length).to.equal(CIRCUITS.length);
      expect([...missing]).to.deep.equal(CIRCUIT_IDS);
    });

    it("readyToLock is false until ALL expected circuits are committed", async function () {
      const vks = CIRCUITS.map(() => sampleVkey());
      await setter.batchStageVerifyingKeys(CIRCUITS, vks);
      // Commit only the first two
      await setter.batchCommitVerifyingKeys(CIRCUITS.slice(0, 2));
      expect(await setter.readyToLock()).to.equal(false);
      const missing = await setter.uncommittedCircuits();
      expect(missing.length).to.equal(1);
      expect(missing[0]).to.equal(CIRCUIT_IDS[2]);
    });

    it("readyToLock is true after all committed", async function () {
      const vks = CIRCUITS.map(() => sampleVkey());
      await setter.batchStageVerifyingKeys(CIRCUITS, vks);
      await setter.batchCommitVerifyingKeys(CIRCUITS);
      expect(await setter.readyToLock()).to.equal(true);
      const missing = await setter.uncommittedCircuits();
      expect(missing.length).to.equal(0);
    });
  });

  describe("lock() — E-7 completeness invariant", function () {
    it("reverts with MissingCircuit if any expected circuit is not committed", async function () {
      const vks = [sampleVkey(), sampleVkey()];
      await setter.batchStageVerifyingKeys(CIRCUITS.slice(0, 2), vks);
      await setter.batchCommitVerifyingKeys(CIRCUITS.slice(0, 2));
      // CIRCUITS[2] is not committed
      await expect(setter.lock())
        .to.be.revertedWithCustomError(setter, "MissingCircuit")
        .withArgs(CIRCUIT_IDS[2]);
      expect(await setter.locked()).to.equal(false);
    });

    it("succeeds and emits VKeySetLocked after all expected circuits committed", async function () {
      const vks = CIRCUITS.map(() => sampleVkey());
      await setter.batchStageVerifyingKeys(CIRCUITS, vks);
      await setter.batchCommitVerifyingKeys(CIRCUITS);
      await expect(setter.lock()).to.emit(setter, "VKeySetLocked");
      expect(await setter.locked()).to.equal(true);
    });

    it("post-lock, stage and commit revert with VkeysLocked", async function () {
      const vks = CIRCUITS.map(() => sampleVkey());
      await setter.batchStageVerifyingKeys(CIRCUITS, vks);
      await setter.batchCommitVerifyingKeys(CIRCUITS);
      await setter.lock();

      await expect(setter.stageVerifyingKey(CIRCUITS[0], sampleVkey()))
        .to.be.revertedWithCustomError(setter, "VkeysLocked");
      await expect(setter.commitVerifyingKey(CIRCUITS[0]))
        .to.be.revertedWithCustomError(setter, "VkeysLocked");
      await expect(setter.batchStageVerifyingKeys([CIRCUITS[0]], [sampleVkey()]))
        .to.be.revertedWithCustomError(setter, "VkeysLocked");
      await expect(setter.batchCommitVerifyingKeys([CIRCUITS[0]]))
        .to.be.revertedWithCustomError(setter, "VkeysLocked");
    });

    it("non-owner cannot lock", async function () {
      await expect(setter.connect(alice).lock())
        .to.be.revertedWithCustomError(setter, "OwnableUnauthorizedAccount");
    });
  });
});
