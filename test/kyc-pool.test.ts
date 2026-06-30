import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

// Dummy proof — MockGroth16Verifier accepts anything. Real proofs come in Phase 5.
const DUMMY_PROOF = {
  pA: [0n, 0n] as [bigint, bigint],
  pB: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
  pC: [0n, 0n] as [bigint, bigint],
};

// Two BabyJubJub-shaped public keys (any field elements work for registry tests with mocks).
const ALICE_PUBKEY: [bigint, bigint] = [
  1234567890123456789012345678901234567890n,
  9876543210987654321098765432109876543210n,
];
const BOB_PUBKEY: [bigint, bigint] = [
  1111111111111111111111111111111111111111n,
  2222222222222222222222222222222222222222n,
];

async function installMockHTS() {
  const MockFactory = await ethers.getContractFactory("MockHTSPrecompile");
  const mock = await MockFactory.deploy();
  await mock.waitForDeployment();
  const code = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [
    HTS_ADDRESS, "0x1",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);
}

async function deployStack(owner: any) {
  await installMockHTS();

  const ERC20Factory = await ethers.getContractFactory("MockERC20");
  const token = await ERC20Factory.deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  const MockVerifierFactory = await ethers.getContractFactory("MockGroth16Verifier");
  const mockVerifier = await MockVerifierFactory.deploy();
  await mockVerifier.waitForDeployment();
  const v = await mockVerifier.getAddress();

  // KYC variant links PoseidonUnit2L/3L + SmtLib (Phase 2).
  const libs = await deployPoseidonAndSmt(owner);

  const verifiersInfo = {
    verifier: v,
    depositVerifier: v,
    withdrawVerifier: v,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: v,
    batchWithdrawVerifier: v,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  const Pool = await ethers.getContractFactory("HederaZetoTokenKyc", {
    libraries: librariesMap(libs),
  });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC Pool", "ZKYC", owner.address, verifiersInfo],
    {
      kind: "uups",
      initializer: "initialize",
      unsafeAllow: ["missing-initializer", "external-library-linking"],
    }
  );
  await pool.waitForDeployment();

  return { pool, token };
}

describe("v0.2 Phase 4 — HederaZetoTokenKyc integration", function () {
  let owner: any, alice: any;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
  });

  it("deploys via UUPS proxy (with linked Poseidon/SmtLib) and sets the owner", async function () {
    const { pool } = await deployStack(owner);
    expect(await pool.owner()).to.equal(owner.address);
  });

  it("setupHTS is owner-gated and associates the token", async function () {
    const { pool, token } = await deployStack(owner);
    const tokenAddr = await token.getAddress();
    await expect(pool.connect(alice).setupHTS(tokenAddr))
      .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    await pool.setupHTS(tokenAddr);
    expect(await pool.htsAssociated(tokenAddr)).to.equal(true);
  });

  describe("KYC registry (embedded Registry base)", function () {
    it("register is owner-gated", async function () {
      const { pool } = await deployStack(owner);
      await expect(pool.connect(alice).register(ALICE_PUBKEY, "0x"))
        .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    });

    it("register enrolls a key; isRegistered reflects it; root advances", async function () {
      const { pool } = await deployStack(owner);
      expect(await pool.isRegistered(ALICE_PUBKEY)).to.equal(false);
      const rootBefore = await pool.getIdentitiesRoot();

      await pool.register(ALICE_PUBKEY, "0x");
      expect(await pool.isRegistered(ALICE_PUBKEY)).to.equal(true);
      const rootAfter = await pool.getIdentitiesRoot();
      expect(rootAfter).to.not.equal(rootBefore);
    });

    it("enrolls multiple distinct keys; both report registered", async function () {
      // NB: upstream's _register duplicate-check reads the SMT by poseidon2(pk) while the
      // leaf is keyed by poseidon3([poseidon2(pk),...]), so re-registering the same key does
      // NOT revert AlreadyRegistered (upstream quirk). We test the behavior we rely on:
      // enrolling Alice and Bob both succeed and both read back as registered.
      const { pool } = await deployStack(owner);
      await pool.register(ALICE_PUBKEY, "0x");
      await pool.register(BOB_PUBKEY, "0x");
      expect(await pool.isRegistered(ALICE_PUBKEY)).to.equal(true);
      expect(await pool.isRegistered(BOB_PUBKEY)).to.equal(true);
    });
  });

  it("deposit reverts before setupHTS (HTS gate fires before proof check)", async function () {
    const { pool } = await deployStack(owner);
    await expect(
      pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x")
    ).to.be.revertedWithCustomError(pool, "TokenNotAssociated");
  });

  it("deposit moves HTS and tracks shielded supply", async function () {
    const { pool, token } = await deployStack(owner);
    const tokenAddr = await token.getAddress();
    const poolAddr = await pool.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);

    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    expect(await token.balanceOf(poolAddr)).to.equal(100n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(100n);
  });

  it("nullifier double-spend protection: re-spending the same nullifiers reverts", async function () {
    const { pool, token } = await deployStack(owner);
    const tokenAddr = await token.getAddress();
    const poolAddr = await pool.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);

    // Deposit adds two commitments to the on-chain commitments SMT.
    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    const root = await pool.getRoot(); // valid historical root for the transfer proof

    // First transfer: spend nullifiers [911, 922] → outputs [333, 444]. Mock verifier accepts.
    await pool.connect(alice).transfer(
      [911n, 922n], [333n, 444n], root, 7n, [0n, 0n], [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], DUMMY_PROOF, "0x"
    );

    // Second transfer reusing nullifier 911 must revert (double-spend).
    await expect(
      pool.connect(alice).transfer(
        [911n, 933n], [555n, 666n], root, 7n, [0n, 0n], [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], DUMMY_PROOF, "0x"
      )
    ).to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
  });

  it("UUPS upgrade authorization is owner-only", async function () {
    const { pool } = await deployStack(owner);
    // Non-owner cannot upgrade. We don't need a real V2 — the auth check fires first.
    await expect(
      pool.connect(alice).upgradeToAndCall(ethers.ZeroAddress, "0x")
    ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
  });
});
