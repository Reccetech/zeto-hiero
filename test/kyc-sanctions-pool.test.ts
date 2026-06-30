import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

const DUMMY_PROOF = {
  pA: [0n, 0n] as [bigint, bigint],
  pB: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
  pC: [0n, 0n] as [bigint, bigint],
};

const ROOT_A = "0x" + "11".repeat(32);
const ROOT_B = "0x" + "22".repeat(32);

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
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  const mockVerifier = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
  await mockVerifier.waitForDeployment();
  const v = await mockVerifier.getAddress();

  const libs = await deployPoseidonAndSmt(owner);

  const verifiersInfo = {
    verifier: v, // the 20-signal sanctions verifier slot (mock here)
    depositVerifier: v,
    withdrawVerifier: v,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: v,
    batchWithdrawVerifier: v,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  const Pool = await ethers.getContractFactory("HederaZetoTokenKycSanctions", {
    libraries: librariesMap(libs),
  });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC+Sanctions Pool", "ZKYCS", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, token };
}

// transferScreened arg helper (mock verifier accepts any proof; SMT root args are arbitrary here)
function screenedArgs(sanctionsRoot: string) {
  return [
    [911n, 922n],                       // nullifiers
    [333n, 444n],                       // outputs
    0n,                                 // utxo root (set per-test)
    7n,                                 // encryptionNonce
    [0n, 0n],                           // ecdhPublicKey
    [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],   // encryptedValues
    sanctionsRoot,                      // sanctionsRoot
    DUMMY_PROOF,
    "0x",
  ] as const;
}

describe("v0.3 Phase 4 — HederaZetoTokenKycSanctions integration", function () {
  let owner: any, alice: any, oracle: any;

  beforeEach(async function () {
    [owner, alice, oracle] = await ethers.getSigners();
  });

  it("deploys via UUPS proxy with linked libraries; owner set", async function () {
    const { pool } = await deployStack(owner);
    expect(await pool.owner()).to.equal(owner.address);
  });

  describe("sanctions root management (SanctionsModule)", function () {
    it("updateSanctionsMerkleRoot is owner-or-oracle gated and records block", async function () {
      const { pool } = await deployStack(owner);
      await expect(pool.connect(alice).updateSanctionsMerkleRoot(ROOT_A))
        .to.be.revertedWithCustomError(pool, "NotOwnerOrOracle");

      await expect(pool.updateSanctionsMerkleRoot(ROOT_A))
        .to.emit(pool, "SanctionsMerkleRootUpdated");
      expect(await pool.sanctionsMerkleRoot()).to.equal(ROOT_A);
      expect(await pool.sanctionsMerkleRootBlock()).to.be.greaterThan(0n);
    });

    it("setSanctionsOracle is owner-only; oracle can then update", async function () {
      const { pool } = await deployStack(owner);
      await expect(pool.connect(alice).setSanctionsOracle(oracle.address))
        .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
      await pool.setSanctionsOracle(oracle.address);
      await expect(pool.connect(oracle).updateSanctionsMerkleRoot(ROOT_B))
        .to.emit(pool, "SanctionsMerkleRootUpdated");
      expect(await pool.sanctionsMerkleRoot()).to.equal(ROOT_B);
    });
  });

  describe("transferScreened sanctions-root binding", function () {
    it("reverts SanctionsRootMismatch when the proof's root != current on-chain root", async function () {
      const { pool, token } = await deployStack(owner);
      await pool.setupHTS(await token.getAddress());
      await pool.updateSanctionsMerkleRoot(ROOT_A);

      const args = screenedArgs(ROOT_B); // stale/wrong root
      await expect((pool as any).connect(alice).transferScreened(...args))
        .to.be.revertedWithCustomError(pool, "SanctionsRootMismatch");
    });

    it("passes the root check and double-spend protection holds (mock verifier)", async function () {
      const { pool, token } = await deployStack(owner);
      const poolAddr = await pool.getAddress();
      await pool.setupHTS(await token.getAddress());
      await token.mint(alice.address, 1000n);
      await token.connect(alice).approve(poolAddr, 100n);
      await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
      const root = await pool.getRoot();
      await pool.updateSanctionsMerkleRoot(ROOT_A);

      // first screened transfer with the matching root succeeds (mock verifier returns true)
      const a1 = [...screenedArgs(ROOT_A)] as any[];
      a1[2] = root;
      await (pool as any).connect(alice).transferScreened(...a1);

      // reusing nullifier 911 reverts (double-spend) — sanctions wiring doesn't break it
      const a2 = [...screenedArgs(ROOT_A)] as any[];
      a2[0] = [911n, 933n];
      a2[1] = [555n, 666n];
      a2[2] = root;
      await expect((pool as any).connect(alice).transferScreened(...a2))
        .to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
    });
  });

  it("UUPS upgrade authorization is owner-only", async function () {
    const { pool } = await deployStack(owner);
    await expect(pool.connect(alice).upgradeToAndCall(ethers.ZeroAddress, "0x"))
      .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
  });
});
