import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof, type User } from "./lib/zeto-witness";
import {
  prepareKycTransferProof,
  prepareKycWithdrawProof,
  decryptNote,
  newUtxoSmt,
  newIdentitiesSmt,
  addIdentity,
  addCommitment,
} from "./lib/zeto-witness-kyc";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

// v0.2 Phase 5 — full KYC shielded flow with REAL Groth16 proofs against HederaZetoTokenKyc
// (upstream Zeto_AnonEncNullifierKyc + our ZetoHTSBridge), using our own-setup verifiers.
// Exercises the two things v0.1 didn't: nullifier-backed transfers with a UTXO SMT inclusion
// proof, and KYC identity-membership proofs for the sender and both output owners.

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

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

async function deployRealStack(owner: any) {
  await installMockHTS();

  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  // Real own-setup verifiers: deposit (unchanged from v0.1), KYC transfer, nullifier withdraw.
  const kycTransfer = await (await ethers.getContractFactory("AnonEncNullifierKycVerifierMVP")).deploy();
  const deposit = await (await ethers.getContractFactory("DepositVerifierMVP")).deploy();
  const withdrawN = await (await ethers.getContractFactory("WithdrawNullifierVerifierMVP")).deploy();
  const batch = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
  await Promise.all([
    kycTransfer.waitForDeployment(), deposit.waitForDeployment(),
    withdrawN.waitForDeployment(), batch.waitForDeployment(),
  ]);

  const verifiersInfo = {
    verifier: await kycTransfer.getAddress(),
    depositVerifier: await deposit.getAddress(),
    withdrawVerifier: await withdrawN.getAddress(),
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: await batch.getAddress(),
    batchWithdrawVerifier: await batch.getAddress(),
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  const libs = await deployPoseidonAndSmt(owner);
  const Pool = await ethers.getContractFactory("HederaZetoTokenKyc", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC Pool", "ZKYC", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();

  return { pool, token };
}

describe("v0.2 Phase 5 — KYC deposit -> transfer -> double-spend (real proofs)", function () {
  this.timeout(600_000); // KYC transfer proof gen is heavier than v0.1 anon_enc

  it("enrolls KYC identities, runs a private transfer, and blocks a double-spend", async function () {
    const [owner, aliceSigner, bobSigner] = await ethers.getSigners();
    const Alice: User = await newUser(aliceSigner);
    const Bob: User = await newUser(bobSigner);

    const { pool, token } = await deployRealStack(owner);
    const poolAddr = await pool.getAddress();
    const tokenAddr = await token.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(Alice.ethAddress, 1000n);
    await token.connect(aliceSigner).approve(poolAddr, 100n);

    // ---- KYC enrollment: register Alice & Bob on-chain and mirror into the off-chain id SMT ----
    await (await pool.register(Alice.babyJubPublicKey, "0x")).wait();
    await (await pool.register(Bob.babyJubPublicKey, "0x")).wait();
    const idSmt = newIdentitiesSmt("kyc");
    await addIdentity(idSmt, Alice.babyJubPublicKey);
    await addIdentity(idSmt, Bob.babyJubPublicKey);
    // off-chain identities root must equal the on-chain registry root
    expect((await idSmt.root()).bigInt()).to.equal(await pool.getIdentitiesRoot());

    expect(await pool.isRegistered(Alice.babyJubPublicKey)).to.equal(true);
    expect(await pool.isRegistered(Bob.babyJubPublicKey)).to.equal(true);

    // ---- 1. Deposit 100 (public -> shielded) ----
    const utxo100 = newUTXO(100, Alice);
    const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
    await (await pool.connect(aliceSigner).deposit(
      100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x",
    )).wait();
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(100n);

    // mirror the deposited commitment into the off-chain UTXO SMT; root must match on-chain
    const utxoSmt = newUtxoSmt("utxos");
    await addCommitment(utxoSmt, utxo100.hash);
    expect((await utxoSmt.root()).bigInt()).to.equal(await pool.getRoot());

    // ---- 2. Private KYC transfer: 100 -> 40 to Bob + 60 change to Alice ----
    const utxoBob40 = newUTXO(40, Bob);
    const utxoAlice60 = newUTXO(60, Alice);
    const xfer = await prepareKycTransferProof(
      Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt,
    );
    console.log(`    KYC transfer proof gen: ${xfer.ms} ms`);

    const tx = await pool.connect(aliceSigner).transfer(
      [xfer.nullifiers[0]],                                   // ZERO nullifier trimmed; contract re-pads
      [xfer.outputCommitments[0], xfer.outputCommitments[1]],
      xfer.root,
      xfer.encryptionNonce,
      xfer.ecdhPublicKey,
      xfer.encryptedValues,
      xfer.encodedProof,
      "0x",
    );
    const rcpt = await tx.wait();
    console.log(`    transfer() gas: ${rcpt!.gasUsed}`);

    // underlying token custody unchanged by a shielded transfer
    expect(await token.balanceOf(poolAddr)).to.equal(100n);

    // ---- 3. Bob recovers his note from the event (ECDH + Poseidon decrypt) ----
    const evt = rcpt!.logs
      .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
    expect(evt, "transfer event present").to.not.equal(undefined);

    const recovered = decryptNote(
      Bob,
      evt!.args.encryptedValues.map((x: any) => BigInt(x)),
      BigInt(evt!.args.encryptionNonce),
      evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
      0,
    );
    expect(recovered.value).to.equal(40n);
    const utxoBob40Recovered = newUTXO(Number(recovered.value), Bob, recovered.salt);
    expect(utxoBob40Recovered.hash).to.equal(utxoBob40.hash);

    // sync the new output commitments into the off-chain UTXO SMT (the pool added them on-chain)
    await addCommitment(utxoSmt, utxoBob40.hash);
    await addCommitment(utxoSmt, utxoAlice60.hash);
    expect((await utxoSmt.root()).bigInt()).to.equal(await pool.getRoot());

    // ---- 4. Bob withdraws his 40 (nullifier withdraw, real proof) ----
    const change = newUTXO(0, Bob);
    const wd = await prepareKycWithdrawProof(Bob, [utxoBob40Recovered, ZERO_UTXO], change, utxoSmt);
    await (await pool.connect(bobSigner).withdraw(
      40n, [wd.nullifiers[0]], wd.output, wd.root, wd.encodedProof, "0x",
    )).wait();
    expect(await token.balanceOf(Bob.ethAddress)).to.equal(40n);
    expect(await token.balanceOf(poolAddr)).to.equal(60n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(60n);

    // ---- 5. Double-spend: re-submitting the same transfer nullifier must revert ----
    await expect(
      pool.connect(aliceSigner).transfer(
        [xfer.nullifiers[0]],
        [xfer.outputCommitments[0], xfer.outputCommitments[1]],
        xfer.root,
        xfer.encryptionNonce,
        xfer.ecdhPublicKey,
        xfer.encryptedValues,
        xfer.encodedProof,
        "0x",
      ),
    ).to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
  });
});
