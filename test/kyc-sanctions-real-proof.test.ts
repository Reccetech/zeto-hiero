import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof, type User } from "./lib/zeto-witness";
import {
  newUtxoSmt,
  newIdentitiesSmt,
  addIdentity,
  addCommitment,
  newNullifier,
  decryptNote,
} from "./lib/zeto-witness-kyc";
import {
  prepareKycSanctionsTransferProof,
  newSanctionsSmt,
  addSanctioned,
} from "./lib/zeto-witness-sanctions";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

// v0.3 Phase 5 — full KYC + sanctions shielded flow with REAL Groth16 proofs against
// HederaZetoTokenKycSanctions. Proves: (a) a transfer whose spent nullifier is ABSENT from the
// sanctions tree verifies on-chain; (b) a transfer whose nullifier is PRESENT cannot even
// produce a witness (circuit rejects the false non-inclusion claim).

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

async function installMockHTS() {
  const m = await (await ethers.getContractFactory("MockHTSPrecompile")).deploy();
  await m.waitForDeployment();
  const code = await ethers.provider.getCode(await m.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [
    HTS_ADDRESS, "0x1", "0x" + "00".repeat(32),
  ]);
}

async function deployRealStack(owner: any) {
  await installMockHTS();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  const sanctionsTransfer = await (await ethers.getContractFactory("AnonEncNullifierKycSanctionsVerifierMVP")).deploy();
  const deposit = await (await ethers.getContractFactory("DepositVerifierMVP")).deploy();
  const withdrawN = await (await ethers.getContractFactory("WithdrawNullifierVerifierMVP")).deploy();
  const batch = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
  await Promise.all([
    sanctionsTransfer.waitForDeployment(), deposit.waitForDeployment(),
    withdrawN.waitForDeployment(), batch.waitForDeployment(),
  ]);

  const verifiersInfo = {
    verifier: await sanctionsTransfer.getAddress(), // 20-signal sanctions transfer verifier
    depositVerifier: await deposit.getAddress(),
    withdrawVerifier: await withdrawN.getAddress(),
    lockVerifier: ZERO, burnVerifier: ZERO,
    batchVerifier: await batch.getAddress(),
    batchWithdrawVerifier: await batch.getAddress(),
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };

  const libs = await deployPoseidonAndSmt(owner);
  const Pool = await ethers.getContractFactory("HederaZetoTokenKycSanctions", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto KYC+Sanctions Pool", "ZKYCS", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, token };
}

describe("v0.3 Phase 5 — KYC+sanctions transfer (real proofs)", function () {
  this.timeout(900_000); // sanctions circuit (2^19) proof gen is heavy

  it("blocks a sanctioned spend and allows a clean one, end to end", async function () {
    const [owner, aliceSigner, bobSigner] = await ethers.getSigners();
    const Alice: User = await newUser(aliceSigner);
    const Bob: User = await newUser(bobSigner);

    const { pool, token } = await deployRealStack(owner);
    const poolAddr = await pool.getAddress();
    const tokenAddr = await token.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(Alice.ethAddress, 1000n);
    await token.connect(aliceSigner).approve(poolAddr, 100n);

    // KYC enrollment (on-chain + off-chain mirror)
    await (await pool.register(Alice.babyJubPublicKey, "0x")).wait();
    await (await pool.register(Bob.babyJubPublicKey, "0x")).wait();
    const idSmt = newIdentitiesSmt("kyc");
    await addIdentity(idSmt, Alice.babyJubPublicKey);
    await addIdentity(idSmt, Bob.babyJubPublicKey);
    expect((await idSmt.root()).bigInt()).to.equal(await pool.getIdentitiesRoot());

    // Deposit 100; mirror into off-chain UTXO SMT
    const utxo100 = newUTXO(100, Alice);
    const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
    await (await pool.connect(aliceSigner).deposit(
      100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x",
    )).wait();
    const utxoSmt = newUtxoSmt("utxos");
    await addCommitment(utxoSmt, utxo100.hash);
    expect((await utxoSmt.root()).bigInt()).to.equal(await pool.getRoot());

    const utxoBob40 = newUTXO(40, Bob);
    const utxoAlice60 = newUTXO(60, Alice);
    const aliceNullifier = newNullifier(utxo100, Alice);

    // ---- NEGATIVE: Alice's spend nullifier IS on the sanctions list → no valid witness ----
    const sancBad = newSanctionsSmt("bad");
    await addSanctioned(sancBad, aliceNullifier);
    await addSanctioned(sancBad, 4242n);
    let threw = false;
    try {
      await prepareKycSanctionsTransferProof(
        Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt, sancBad,
      );
    } catch {
      threw = true;
    }
    expect(threw, "sanctioned spend must fail proof generation").to.equal(true);

    // ---- POSITIVE: clean sanctions list (Alice's nullifier absent) → verifies on-chain ----
    const sanc = newSanctionsSmt("clean");
    await addSanctioned(sanc, 111n);
    await addSanctioned(sanc, 222n);
    const sanctionsRoot = (await sanc.root()).bigInt();
    await (await pool.updateSanctionsMerkleRoot(ethers.toBeHex(sanctionsRoot, 32))).wait();

    const xfer = await prepareKycSanctionsTransferProof(
      Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice], utxoSmt, idSmt, sanc,
    );
    console.log(`    sanctions transfer proof gen: ${xfer.ms} ms`);

    const tx = await pool.connect(aliceSigner).transferScreened(
      [xfer.nullifiers[0]],
      [xfer.outputCommitments[0], xfer.outputCommitments[1]],
      xfer.root,
      xfer.encryptionNonce,
      xfer.ecdhPublicKey,
      xfer.encryptedValues,
      xfer.sanctionsRoot,
      xfer.encodedProof,
      "0x",
    );
    const rcpt = await tx.wait();
    console.log(`    transferScreened() gas: ${rcpt!.gasUsed}`);

    // Bob recovers his note
    const evt = rcpt!.logs
      .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
    const recovered = decryptNote(
      Bob,
      evt!.args.encryptedValues.map((x: any) => BigInt(x)),
      BigInt(evt!.args.encryptionNonce),
      evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
      0,
    );
    expect(recovered.value).to.equal(40n);
    expect(newUTXO(Number(recovered.value), Bob, recovered.salt).hash).to.equal(utxoBob40.hash);

    // Double-spend of the same nullifier reverts
    await expect(
      pool.connect(aliceSigner).transferScreened(
        [xfer.nullifiers[0]],
        [xfer.outputCommitments[0], xfer.outputCommitments[1]],
        xfer.root,
        xfer.encryptionNonce,
        xfer.ecdhPublicKey,
        xfer.encryptedValues,
        xfer.sanctionsRoot,
        xfer.encodedProof,
        "0x",
      ),
    ).to.be.revertedWithCustomError(pool, "UTXOAlreadySpent");
  });
});
