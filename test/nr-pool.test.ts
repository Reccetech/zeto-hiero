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
const AUTH: [bigint, bigint] = [12345n, 67890n];
const CT16 = Array(16).fill(0n);
const CT8 = Array(8).fill(0n);

async function installMockHTS() {
  const m = await (await ethers.getContractFactory("MockHTSPrecompile")).deploy();
  await m.waitForDeployment();
  const code = await ethers.provider.getCode(await m.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [HTS_ADDRESS, "0x1", "0x" + "00".repeat(32)]);
}

async function deployStack(owner: any) {
  await installMockHTS();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();
  const v = await (await (await ethers.getContractFactory("MockGroth16Verifier")).deploy()).getAddress();
  const libs = await deployPoseidonAndSmt(owner);
  const verifiersInfo = {
    verifier: v, depositVerifier: v, withdrawVerifier: v,
    lockVerifier: ZERO, burnVerifier: ZERO, batchVerifier: v, batchWithdrawVerifier: v,
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };
  const Pool = await ethers.getContractFactory("HederaZetoToken", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool, ["Hedera Zeto Production Pool", "ZNR", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, token };
}

function nrArgs(sanctionsRoot: string, root: bigint) {
  return [
    [911n, 922n], [333n, 444n], root, 7n, [0n, 0n], CT8, CT16, sanctionsRoot, DUMMY_PROOF, "0x",
  ] as const;
}

describe("v0.4 Phase 3 — HederaZetoToken (non-repudiation) integration", function () {
  let owner: any, alice: any;
  beforeEach(async function () { [owner, alice] = await ethers.getSigners(); });

  it("deploys via UUPS proxy; owner set", async function () {
    const { pool } = await deployStack(owner);
    expect(await pool.owner()).to.equal(owner.address);
  });

  it("setAuthorityKey is owner-only and stored", async function () {
    const { pool } = await deployStack(owner);
    await expect(pool.connect(alice).setAuthorityKey(AUTH)).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    await expect(pool.setAuthorityKey(AUTH)).to.emit(pool, "AuthorityKeySet").withArgs(AUTH[0], AUTH[1]);
    expect(await pool.authorityPublicKey(0)).to.equal(AUTH[0]);
    expect(await pool.authorityPublicKey(1)).to.equal(AUTH[1]);
  });

  it("transferConfidential reverts AuthorityKeyUnset before the key is set", async function () {
    const { pool, token } = await deployStack(owner);
    await pool.setupHTS(await token.getAddress());
    await pool.updateSanctionsMerkleRoot(ROOT_A);
    await expect((pool as any).connect(alice).transferConfidential(...nrArgs(ROOT_A, 0n)))
      .to.be.revertedWithCustomError(pool, "AuthorityKeyUnset");
  });

  it("reverts SanctionsRootMismatch on a stale sanctions root", async function () {
    const { pool, token } = await deployStack(owner);
    await pool.setupHTS(await token.getAddress());
    await pool.setAuthorityKey(AUTH);
    await pool.updateSanctionsMerkleRoot(ROOT_A);
    await expect((pool as any).connect(alice).transferConfidential(...nrArgs("0x" + "22".repeat(32), 0n)))
      .to.be.revertedWithCustomError(pool, "SanctionsRootMismatch");
  });

  it("pause blocks deposit and transfer", async function () {
    const { pool, token } = await deployStack(owner);
    await pool.setupHTS(await token.getAddress());
    await pool.setAuthorityKey(AUTH);
    await pool.updateSanctionsMerkleRoot(ROOT_A);
    await pool.setPaused(true);
    await expect(pool.connect(alice).deposit(100n, [1n, 2n], DUMMY_PROOF, "0x"))
      .to.be.revertedWithCustomError(pool, "PoolPaused");
    await expect((pool as any).connect(alice).transferConfidential(...nrArgs(ROOT_A, 0n)))
      .to.be.revertedWithCustomError(pool, "PoolPaused");
  });

  it("full mock flow: deposit, then a confidential transfer passes checks + double-spend protection", async function () {
    const { pool, token } = await deployStack(owner);
    const poolAddr = await pool.getAddress();
    await pool.setupHTS(await token.getAddress());
    await pool.setAuthorityKey(AUTH);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);
    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    const root = await pool.getRoot();
    await pool.updateSanctionsMerkleRoot(ROOT_A);

    await (pool as any).connect(alice).transferConfidential(...nrArgs(ROOT_A, root));

    // reuse nullifier 911 -> double-spend revert
    const a2 = [...nrArgs(ROOT_A, root)] as any[];
    a2[0] = [911n, 933n]; a2[1] = [555n, 666n];
    await expect((pool as any).connect(alice).transferConfidential(...a2))
      .to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
  });
});
