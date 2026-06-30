import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof, type User } from "./lib/zeto-witness";
import { newUtxoSmt, newIdentitiesSmt, addIdentity, addCommitment, decryptNote } from "./lib/zeto-witness-kyc";
import { newSanctionsSmt, addSanctioned } from "./lib/zeto-witness-sanctions";
import { prepareNRTransferProof, decryptAuthority } from "./lib/zeto-witness-nr";
import { deployPoseidonAndSmt, librariesMap } from "./lib/poseidon-deploy";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair, formatPrivKeyForBabyJub } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */

// v0.4 Phase 5 — production confidential transfer (KYC + sanctions + non-repudiation) with REAL
// Groth16 proofs against HederaZetoToken. Proves the authority can decrypt the full transaction.

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

async function installMockHTS() {
  const m = await (await ethers.getContractFactory("MockHTSPrecompile")).deploy();
  await m.waitForDeployment();
  const code = await ethers.provider.getCode(await m.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [HTS_ADDRESS, "0x1", "0x" + "00".repeat(32)]);
}

async function deployRealStack(owner: any) {
  await installMockHTS();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();
  const nr = await (await ethers.getContractFactory("AnonEncNullifierKycSanctionsNRVerifierMVP")).deploy();
  const deposit = await (await ethers.getContractFactory("DepositVerifierMVP")).deploy();
  const withdrawN = await (await ethers.getContractFactory("WithdrawNullifierVerifierMVP")).deploy();
  const batch = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
  await Promise.all([nr.waitForDeployment(), deposit.waitForDeployment(), withdrawN.waitForDeployment(), batch.waitForDeployment()]);
  const verifiersInfo = {
    verifier: await nr.getAddress(), depositVerifier: await deposit.getAddress(), withdrawVerifier: await withdrawN.getAddress(),
    lockVerifier: ZERO, burnVerifier: ZERO, batchVerifier: await batch.getAddress(), batchWithdrawVerifier: await batch.getAddress(),
    batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
  };
  const libs = await deployPoseidonAndSmt(owner);
  const Pool = await ethers.getContractFactory("HederaZetoToken", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(
    Pool, ["Hedera Zeto Production Pool", "ZNR", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"] },
  );
  await pool.waitForDeployment();
  return { pool, token };
}

describe("v0.4 Phase 5 — confidential transfer with authority decrypt (real proofs)", function () {
  this.timeout(900_000);

  it("runs a confidential transfer and the authority reconstructs the plaintext", async function () {
    const [owner, aliceSigner, bobSigner] = await ethers.getSigners();
    const Alice: User = await newUser(aliceSigner);
    const Bob: User = await newUser(bobSigner);

    // pool authority keypair
    const authority = genKeypair();

    const { pool, token } = await deployRealStack(owner);
    const poolAddr = await pool.getAddress();
    const tokenAddr = await token.getAddress();

    await pool.setupHTS(tokenAddr);
    await pool.setAuthorityKey([authority.pubKey[0], authority.pubKey[1]]);
    await token.mint(Alice.ethAddress, 1000n);
    await token.connect(aliceSigner).approve(poolAddr, 100n);

    await (await pool.register(Alice.babyJubPublicKey, "0x")).wait();
    await (await pool.register(Bob.babyJubPublicKey, "0x")).wait();
    const idSmt = newIdentitiesSmt("kyc");
    await addIdentity(idSmt, Alice.babyJubPublicKey);
    await addIdentity(idSmt, Bob.babyJubPublicKey);
    expect((await idSmt.root()).bigInt()).to.equal(await pool.getIdentitiesRoot());

    const utxo100 = newUTXO(100, Alice);
    const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
    await (await pool.connect(aliceSigner).deposit(100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x")).wait();
    const utxoSmt = newUtxoSmt("utxos");
    await addCommitment(utxoSmt, utxo100.hash);

    const sanc = newSanctionsSmt("ofac");
    await addSanctioned(sanc, 111n);
    await addSanctioned(sanc, 222n);
    await (await pool.updateSanctionsMerkleRoot(ethers.toBeHex((await sanc.root()).bigInt(), 32))).wait();

    const utxoBob40 = newUTXO(40, Bob);
    const utxoAlice60 = newUTXO(60, Alice);
    const xfer = await prepareNRTransferProof(
      Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice],
      utxoSmt, idSmt, sanc, authority.pubKey,
    );
    console.log(`    NR transfer proof gen: ${xfer.ms} ms`);

    const tx = await pool.connect(aliceSigner).transferConfidential(
      [xfer.nullifiers[0]],
      [xfer.outputCommitments[0], xfer.outputCommitments[1]],
      xfer.root, xfer.encryptionNonce, xfer.ecdhPublicKey, xfer.encryptedValues,
      xfer.cipherTextAuthority, xfer.sanctionsRoot, xfer.encodedProof, "0x",
    );
    const rcpt = await tx.wait();
    console.log(`    transferConfidential() gas: ${rcpt!.gasUsed}`);

    // Bob recovers his note via the recipient ciphertext
    const evt = rcpt!.logs
      .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
    const recovered = decryptNote(
      Bob, evt!.args.encryptedValues.map((x: any) => BigInt(x)), BigInt(evt!.args.encryptionNonce),
      evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)), 0,
    );
    expect(recovered.value).to.equal(40n);

    // The AUTHORITY recovers the full plaintext from the authority ciphertext.
    // plaintext = [ownerPub(2), in0 value+salt, in1 value+salt, out0 ownerPub(2), out1 ownerPub(2),
    //              out0 value+salt, out1 value+salt] = 14 elements.
    const authEvt = rcpt!.logs
      .map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e && e.name === "AuthorityCiphertext");
    expect(authEvt, "authority ciphertext event present").to.not.equal(undefined);
    const plain = decryptAuthority(
      authority.privKey, // raw key — genEcdhSharedKey formats internally (same as decryptNote)
      authEvt!.args.cipherTextAuthority.map((x: any) => BigInt(x)),
      BigInt(authEvt!.args.encryptionNonce),
      xfer.ecdhPublicKey,
      14,
    );
    // plain[0..2] = sender owner pubkey; plain[2..4] = input0 (value=100, salt); etc.
    expect(plain[2]).to.equal(100n, "authority sees input value 100");
    // output values are at indices 2 + 2*nInputs + 2*nOutputs ... : owner keys then values
    // layout: [2] ownerPub, [2*2]=in v/s, [2*2]=out ownerPub, then out values+salts
    const outValBase = 2 + 2 * 2 + 2 * 2; // = 10
    expect(plain[outValBase]).to.equal(40n, "authority sees output 0 value 40 (Bob)");
    expect(plain[outValBase + 2]).to.equal(60n, "authority sees output 1 value 60 (Alice)");
  });
});
