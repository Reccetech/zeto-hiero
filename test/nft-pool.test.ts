import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { newUser, type User } from "./lib/zeto-witness";
import { newUtxoSmt, addCommitment } from "./lib/zeto-witness-kyc";
import { newAssetUTXO, newAssetNullifier, prepareNfTransferProof } from "./lib/zeto-witness-nf";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

const ZERO = "0x0000000000000000000000000000000000000000";
const DUMMY_PROOF = {
  pA: [0n, 0n] as [bigint, bigint],
  pB: [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]],
  pC: [0n, 0n] as [bigint, bigint],
};
const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

async function installMockHTS() {
  const m = await (await ethers.getContractFactory("MockHTSPrecompile")).deploy();
  await m.waitForDeployment();
  const code = await ethers.provider.getCode(await m.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [HTS_ADDRESS, "0x1", "0x" + "00".repeat(32)]);
}

async function deployStack(owner: any, realVerifier: boolean) {
  const nft = await (await ethers.getContractFactory("MockERC721")).deploy("Art", "ART");
  await nft.waitForDeployment();

  const verifierAddr = realVerifier
    ? await (await (await ethers.getContractFactory("NfAnonNullifierTransferVerifierMVP")).deploy()).getAddress()
    : await (await (await ethers.getContractFactory("MockGroth16Verifier")).deploy()).getAddress();
  const mock = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();

  const libs = await deployPoseidonAndSmt(owner);
  const verifiersInfo = {
    verifier: verifierAddr, depositVerifier: await mock.getAddress(), withdrawVerifier: await mock.getAddress(),
    lockVerifier: await mock.getAddress(), burnVerifier: ZERO,
    batchVerifier: await mock.getAddress(), batchWithdrawVerifier: await mock.getAddress(),
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };
  const Pool = await ethers.getContractFactory("HederaZetoNFT", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool, ["Hedera Zeto NFT Pool", "ZNFT", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, nft };
}

describe("v0.5 — HederaZetoNFT (shielded NFT pool)", function () {
  let owner: any, alice: any, bob: any;
  beforeEach(async function () { [owner, alice, bob] = await ethers.getSigners(); });

  it("setupERC721 / setupHTSNFT gate custody, and are owner-only", async function () {
    const { pool, nft } = await deployStack(owner, false);
    const t = await nft.getAddress();
    await expect(pool.connect(alice).setupERC721(t)).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    await pool.setupERC721(t);
    expect(await pool.nftErcCustody(t)).to.equal(true);

    // HTS NFT path (needs the 0x167 precompile mock)
    await installMockHTS();
    const hnft = await (await ethers.getContractFactory("MockERC721")).deploy("HtsArt", "HART");
    await hnft.waitForDeployment();
    await pool.setupHTSNFT(await hnft.getAddress());
    expect(await pool.nftHtsAssociated(await hnft.getAddress())).to.equal(true);
  });

  it("depositNFT takes custody of a real ERC-721 and mints a shielded note", async function () {
    const { pool, nft } = await deployStack(owner, false);
    const poolAddr = await pool.getAddress();
    const t = await nft.getAddress();
    await pool.setupERC721(t);
    await nft.mint(owner.address, 1001);
    await nft.approve(poolAddr, 1001);

    const Alice: User = await newUser(alice);
    const note = newAssetUTXO(1001, "ipfs://art/1001", Alice);
    await pool.depositNFT(t, 1001, note.hash, "0x");

    expect(await nft.ownerOf(1001)).to.equal(poolAddr);       // pool now custodies the NFT
    expect(await pool.nftEscrowed(t, 1001)).to.equal(true);
  });

  it("full shielded NFT flow with REAL proofs: deposit -> private transfer -> withdraw", async function () {
    this.timeout(600_000);
    const { pool, nft } = await deployStack(owner, true);
    const poolAddr = await pool.getAddress();
    const t = await nft.getAddress();
    const Alice: User = await newUser(alice);
    const Bob: User = await newUser(bob);

    await pool.setupERC721(t);
    await nft.mint(owner.address, 1001);
    await nft.approve(poolAddr, 1001);

    // Deposit: custody the NFT, mint Alice's shielded note
    const aliceNote = newAssetUTXO(1001, "ipfs://art/1001", Alice);
    await (await pool.depositNFT(t, 1001, aliceNote.hash, "0x")).wait();
    expect(await nft.ownerOf(1001)).to.equal(poolAddr);

    // mirror the commitments tree off-chain; roots must match
    const utxoSmt = newUtxoSmt("nft");
    await addCommitment(utxoSmt, aliceNote.hash);
    expect((await utxoSmt.root()).bigInt()).to.equal(await pool.getRoot());

    // Private transfer Alice -> Bob (real NF proof; same tokenId/uri preserved in-circuit)
    const bobNote = newAssetUTXO(1001, "ipfs://art/1001", Bob);
    const xfer = await prepareNfTransferProof(Alice, aliceNote, bobNote, Bob, utxoSmt);
    await (await pool.connect(alice).transfer(xfer.nullifier, xfer.outputCommitment, xfer.root, xfer.encodedProof, "0x")).wait();
    await addCommitment(utxoSmt, bobNote.hash);

    // Bob withdraws: spend his note (real proof) -> pool releases the real NFT to Bob
    const burn = newAssetUTXO(1001, "ipfs://art/1001", Bob); // fresh-salt output consumed by the withdraw
    const wd = await prepareNfTransferProof(Bob, bobNote, burn, Bob, utxoSmt);
    await (await pool.connect(bob).withdrawNFT(t, 1001, wd.nullifier, wd.outputCommitment, wd.root, wd.encodedProof, bob.address, "0x")).wait();

    expect(await nft.ownerOf(1001)).to.equal(bob.address);   // Bob now holds the real NFT
    expect(await pool.nftEscrowed(t, 1001)).to.equal(false);

    // double-spend: re-submitting Bob's transfer nullifier reverts
    await expect(
      pool.connect(alice).transfer(xfer.nullifier, xfer.outputCommitment, xfer.root, xfer.encodedProof, "0x"),
    ).to.be.reverted;
  });

  it("pause blocks deposit/withdraw", async function () {
    const { pool, nft } = await deployStack(owner, false);
    await pool.setupERC721(await nft.getAddress());
    await pool.setPaused(true);
    await expect(pool.depositNFT(await nft.getAddress(), 1, 1n, "0x")).to.be.revertedWithCustomError(pool, "NFTPoolPaused");
  });
});
