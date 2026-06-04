import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import {
  newUser,
  newUTXO,
  ZERO_UTXO,
  prepareDepositProof,
  prepareTransferProof,
  prepareWithdrawProof,
  decryptNote,
  type User,
} from "./lib/zeto-witness";

// MVP Phase 5 — full pool-level deposit -> private transfer -> withdraw with REAL Groth16
// proofs against HederaZetoTokenLite (upstream Zeto_AnonEnc + our ZetoHTSBridge), using our
// own trusted-setup verifiers. Asserts the shielded-supply invariant and that the underlying
// token balances reconcile end to end (Alice + Bob + pool == initial total).

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const ZERO = "0x0000000000000000000000000000000000000000";

async function installMockHTS() {
  const MockFactory = await ethers.getContractFactory("MockHTSPrecompile");
  const mock = await MockFactory.deploy();
  await mock.waitForDeployment();
  const code = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, code]);
  await network.provider.send("hardhat_setStorageAt", [
    HTS_ADDRESS,
    "0x1",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);
}

async function deployRealStack(owner: any) {
  await installMockHTS();

  const ERC20Factory = await ethers.getContractFactory("MockERC20");
  const token = await ERC20Factory.deploy("Zeto USD Test", "ZUSD-TEST", 8);
  await token.waitForDeployment();

  // Our own-setup verifiers for every circuit we actually invoke.
  const anonEnc = await (await ethers.getContractFactory("AnonEncVerifierMVP")).deploy();
  const deposit = await (await ethers.getContractFactory("DepositVerifierMVP")).deploy();
  const withdraw = await (await ethers.getContractFactory("WithdrawVerifierMVP")).deploy();
  // Batch verifiers are never invoked in the 2-in/2-out flow; a mock placeholder suffices.
  const batch = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
  await Promise.all([
    anonEnc.waitForDeployment(),
    deposit.waitForDeployment(),
    withdraw.waitForDeployment(),
    batch.waitForDeployment(),
  ]);

  const verifiersInfo = {
    verifier: await anonEnc.getAddress(),
    depositVerifier: await deposit.getAddress(),
    withdrawVerifier: await withdraw.getAddress(),
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier: await batch.getAddress(),
    batchWithdrawVerifier: await batch.getAddress(),
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  const Pool = await ethers.getContractFactory("HederaZetoTokenLite");
  const pool = await upgrades.deployProxy(
    Pool,
    ["Hedera Zeto MVP Pool", "ZTEST", owner.address, verifiersInfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer"] },
  );
  await pool.waitForDeployment();

  return { pool, token };
}

describe("MVP Phase 5 — end-to-end deposit -> transfer -> withdraw (real proofs)", function () {
  this.timeout(180_000); // anon_enc proof generation can take several seconds

  it("runs the full shielded flow and reconciles balances", async function () {
    const [owner, aliceSigner, bobSigner] = await ethers.getSigners();
    const Alice: User = await newUser(aliceSigner);
    const Bob: User = await newUser(bobSigner);

    const { pool, token } = await deployRealStack(owner);
    const poolAddr = await pool.getAddress();
    const tokenAddr = await token.getAddress();

    await pool.setupHTS(tokenAddr);
    await token.mint(Alice.ethAddress, 1000n);
    await token.connect(aliceSigner).approve(poolAddr, 100n);

    // ---- 1. Deposit 100 (public -> shielded) ----
    const utxo100 = newUTXO(100, Alice);
    const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
    await (
      await pool
        .connect(aliceSigner)
        .deposit(100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x")
    ).wait();

    expect(await token.balanceOf(poolAddr)).to.equal(100n);
    expect(await token.balanceOf(Alice.ethAddress)).to.equal(900n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(100n);
    expect(await pool.spent(utxo100.hash)).to.equal(false);

    // ---- 2. Private transfer: 100 -> 40 to Bob + 60 change to Alice ----
    const utxoBob40 = newUTXO(40, Bob);
    const utxoAlice60 = newUTXO(60, Alice);
    const xfer = await prepareTransferProof(
      Alice,
      [utxo100, ZERO_UTXO],
      [utxoBob40, utxoAlice60],
      [Bob, Alice],
    );

    const transferTx = await pool.connect(aliceSigner).transfer(
      [xfer.inputCommitments[0]], // ZERO input trimmed; contract re-pads
      [xfer.outputCommitments[0], xfer.outputCommitments[1]],
      xfer.encryptionNonce,
      xfer.ecdhPublicKey,
      xfer.encryptedValues,
      xfer.encodedProof,
      "0x",
    );
    const transferRcpt = await transferTx.wait();
    console.log(`    anon_enc proof gen: ${xfer.ms} ms | transfer() gas: ${transferRcpt!.gasUsed}`);

    // input consumed, outputs recorded; underlying token balances unchanged by a shielded transfer
    expect(await pool.spent(utxo100.hash)).to.equal(true);
    expect(await pool.spent(utxoBob40.hash)).to.equal(false);
    expect(await pool.spent(utxoAlice60.hash)).to.equal(false);
    expect(await token.balanceOf(poolAddr)).to.equal(100n);

    // ---- 3. Bob recovers his note from the on-chain event (ECDH + Poseidon decrypt) ----
    const evt = transferRcpt!.logs
      .map((l: any) => {
        try {
          return pool.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
    expect(evt, "transfer event present").to.not.equal(undefined);

    const recovered = decryptNote(
      Bob,
      evt!.args.encryptedValues.map((x: any) => BigInt(x)),
      BigInt(evt!.args.encryptionNonce),
      evt!.args.ecdhPublicKey.map((x: any) => BigInt(x)),
      0, // Bob's note is output index 0
    );
    expect(recovered.value).to.equal(40n);
    const utxoBob40Recovered = newUTXO(Number(recovered.value), Bob, recovered.salt);
    expect(utxoBob40Recovered.hash).to.equal(utxoBob40.hash);

    // ---- 4. Bob withdraws 40 (shielded -> public), paid to msg.sender (Bob) ----
    const change = newUTXO(0, Bob);
    const wd = await prepareWithdrawProof(Bob, [utxoBob40Recovered, ZERO_UTXO], change);
    await (
      await pool
        .connect(bobSigner)
        .withdraw(40n, [wd.inputCommitments[0]], wd.output, wd.encodedProof, "0x")
    ).wait();

    expect(await token.balanceOf(Bob.ethAddress)).to.equal(40n);
    expect(await token.balanceOf(poolAddr)).to.equal(60n);
    expect(await pool.shieldedSupply(tokenAddr)).to.equal(60n);
    expect(await pool.spent(utxoBob40.hash)).to.equal(true);

    // ---- 5. Reconcile: Alice + Bob + pool == initial 1000 ----
    const aliceBal = await token.balanceOf(Alice.ethAddress);
    const bobBal = await token.balanceOf(Bob.ethAddress);
    const poolBal = await token.balanceOf(poolAddr);
    expect(aliceBal + bobBal + poolBal).to.equal(1000n);
  });
});
