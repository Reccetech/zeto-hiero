import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

// v0.5 Phase 1 — the full v0.4 compliance pool (HederaZetoToken) custodying a PLAIN ERC-20
// (no HTS association). Confirms the ERC-20 custody path: deposit/withdraw move tokens with no
// HTS precompile involved, while KYC + sanctions + non-repudiation wiring is unchanged.

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

async function deployStack(owner: any) {
  // NOTE: no installMockHTS() — ERC-20 custody must work without the 0x167 precompile.
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Plain USD", "pUSD", 6);
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
    Pool, ["Hedera Zeto ERC-20 Pool", "ZERC", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, token };
}

describe("v0.5 Phase 1 — HederaZetoToken with plain ERC-20 custody (no HTS)", function () {
  let owner: any, alice: any;
  beforeEach(async function () { [owner, alice] = await ethers.getSigners(); });

  it("setupERC20 enables ERC custody without HTS association", async function () {
    const { pool, token } = await deployStack(owner);
    const t = await token.getAddress();
    await expect(pool.connect(alice).setupERC20(t)).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    await pool.setupERC20(t);
    expect(await pool.ercCustody(t)).to.equal(true);
    expect(await pool.htsAssociated(t)).to.equal(false); // never associated
  });

  it("deposit moves ERC-20 into the pool + tracks shielded supply (no 0x167)", async function () {
    const { pool, token } = await deployStack(owner);
    const poolAddr = await pool.getAddress();
    const t = await token.getAddress();
    await pool.setupERC20(t);
    await pool.setAuthorityKey(AUTH);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);

    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    expect(await token.balanceOf(poolAddr)).to.equal(100n);
    expect(await pool.shieldedSupply(t)).to.equal(100n);
  });

  it("confidential transfer works in ERC custody mode (mock verifier) + double-spend guard", async function () {
    const { pool, token } = await deployStack(owner);
    const poolAddr = await pool.getAddress();
    const t = await token.getAddress();
    await pool.setupERC20(t);
    await pool.setAuthorityKey(AUTH);
    await pool.updateSanctionsMerkleRoot(ROOT_A);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);
    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    const root = await pool.getRoot();

    const args = [[911n, 922n], [333n, 444n], root, 7n, [0n, 0n], CT8, CT16, ROOT_A, DUMMY_PROOF, "0x"] as any[];
    await (pool as any).connect(alice).transferConfidential(...args);

    const dbl = [...args]; dbl[0] = [911n, 933n]; dbl[1] = [555n, 666n];
    await expect((pool as any).connect(alice).transferConfidential(...dbl))
      .to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
  });

  it("deposit still reverts if no custody mode was set", async function () {
    const { pool } = await deployStack(owner);
    await pool.setAuthorityKey(AUTH);
    await expect(pool.connect(alice).deposit(100n, [1n, 2n], DUMMY_PROOF, "0x"))
      .to.be.revertedWithCustomError(pool, "TokenNotAssociated");
  });
});
