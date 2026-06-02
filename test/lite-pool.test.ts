import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

// Dummy Groth16 proof — accepted by MockGroth16Verifier (always true). Real proofs come in MVP Phase 5.
const DUMMY_PROOF = {
  pA: [0n, 0n] as [bigint, bigint],
  pB: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
  pC: [0n, 0n] as [bigint, bigint],
};

async function installMockHTS() {
  const MockFactory = await ethers.getContractFactory("MockHTSPrecompile");
  const mock = await MockFactory.deploy();
  await mock.waitForDeployment();
  const code = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  // Clear the force-response slot (setCode preserves storage across tests)
  await network.provider.send("hardhat_setStorageAt", [
    HTS_ADDRESS, "0x1",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);
  return MockFactory.attach(HTS_ADDRESS);
}

async function deployStack(owner: any, useMockVerifier: boolean) {
  await installMockHTS();

  // Mock ERC-20 standing in for an HTS-token-as-ERC20 (8 decimals)
  const ERC20Factory = await ethers.getContractFactory("MockERC20");
  const token = await ERC20Factory.deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  // Verifier addresses: mock (always-true) for Phase 4 integration.
  const MockVerifierFactory = await ethers.getContractFactory("MockGroth16Verifier");
  const mockVerifier = await MockVerifierFactory.deploy();
  await mockVerifier.waitForDeployment();
  const v = await mockVerifier.getAddress();

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

  const Pool = await ethers.getContractFactory("HederaZetoTokenLite");
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto MVP Pool", "ZTEST", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer"] }
  );
  await pool.waitForDeployment();

  return { pool, token };
}

describe("MVP Phase 4 — HederaZetoTokenLite integration", function () {
  let owner: any, alice: any;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
  });

  it("deploys via UUPS proxy and sets the owner", async function () {
    const { pool } = await deployStack(owner, true);
    expect(await pool.owner()).to.equal(owner.address);
  });

  it("setupHTS is owner-gated", async function () {
    const { pool, token } = await deployStack(owner, true);
    await expect(pool.connect(alice).setupHTS(await token.getAddress()))
      .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
  });

  it("setupHTS associates the token and wires the ERC-20", async function () {
    const { pool, token } = await deployStack(owner, true);
    const tokenAddr = await token.getAddress();
    await pool.setupHTS(tokenAddr);
    expect(await pool.htsAssociated(tokenAddr)).to.equal(true);
  });

  it("deposit reverts before setupHTS (HTS association gate fires before proof check)", async function () {
    const { pool } = await deployStack(owner, true);
    // _erc20 is unset (zero); _requireHTSAssociated(address(0)) reverts before any proof work.
    await expect(
      pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x")
    ).to.be.revertedWithCustomError(pool, "TokenNotAssociated");
  });

  it("full deposit → withdraw with supply tracking (mock verifier + mock HTS)", async function () {
    const { pool, token } = await deployStack(owner, true);
    const tokenAddr = await token.getAddress();
    const poolAddr = await pool.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);

    // Deposit 100 → two fresh output commitments
    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");
    expect(await token.balanceOf(poolAddr)).to.equal(100n);
    expect(await token.balanceOf(alice.address)).to.equal(900n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(100n);

    // Withdraw 100 → spends the two commitments, mints change commitment 333
    await pool.connect(alice).withdraw(100n, [111n, 222n], 333n, DUMMY_PROOF, "0x");
    expect(await token.balanceOf(poolAddr)).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(1000n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(0n);
  });

  it("dissociation blocked while shielded supply is outstanding (E-9)", async function () {
    const { pool, token } = await deployStack(owner, true);
    const tokenAddr = await token.getAddress();
    const poolAddr = await pool.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(alice.address, 1000n);
    await token.connect(alice).approve(poolAddr, 100n);
    await pool.connect(alice).deposit(100n, [111n, 222n], DUMMY_PROOF, "0x");

    await expect(pool.dissociateHTSToken(tokenAddr))
      .to.be.revertedWithCustomError(pool, "OutstandingShieldedSupply")
      .withArgs(tokenAddr, 100n);
  });
});
