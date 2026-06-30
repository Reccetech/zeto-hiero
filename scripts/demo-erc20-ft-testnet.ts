import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import { newUser, newUTXO, ZERO_UTXO, prepareDepositProof } from "../test/lib/zeto-witness";
import { newUtxoSmt, newIdentitiesSmt, addIdentity, addCommitment, decryptNote } from "../test/lib/zeto-witness-kyc";
import { newSanctionsSmt, addSanctioned } from "../test/lib/zeto-witness-sanctions";
import { prepareNRTransferProof } from "../test/lib/zeto-witness-nr";
import { auditTransfer } from "../sdk/src/scan/AuthorityAuditScanner";
import { deployPoseidonAndSmt, librariesMap } from "../test/lib/poseidon-deploy";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */
dotenv.config();

// v0.5 — ERC-20 FT confidential flow on Hedera testnet: a PLAIN ERC-20 (deployed here, no HTS
// association) shielded by the full v0.4 compliance pool (KYC + sanctions + non-repudiation).
// Run: npx hardhat run scripts/demo-erc20-ft-testnet.ts --network hedera_testnet

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n, TX_GAS = 4_500_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");
let HASHSCAN = "https://hashscan.io/testnet";
const link = (h: string) => `${HASHSCAN}/transaction/${h}`;
function env(n: string) { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; }
async function deploy(name: string, args: any[] = []) {
  const c = await (await ethers.getContractFactory(name)).deploy(...args, { gasLimit: DEPLOY_GAS });
  await c.waitForDeployment(); return c;
}

async function main() {
  const [operator] = await ethers.getSigners();
  const provider = ethers.provider;
  console.log(`\n=== v0.5 ERC-20 FT confidential flow (testnet) ===\nOperator: ${operator.address}\n`);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

  // A plain ERC-20 (not an HTS token) deployed on HSCS
  const erc20 = await deploy("MockERC20", ["Plain USD", "pUSD", 6]);
  const tokenAddr = await erc20.getAddress();
  console.log(`Deployed plain ERC-20: ${tokenAddr}`);

  const libs = await deployPoseidonAndSmt(operator, { gasLimit: DEPLOY_GAS, gasPrice: GAS_PRICE });
  const nr = await (await deploy("AnonEncNullifierKycSanctionsNRVerifierMVP")).getAddress();
  const dep = await (await deploy("DepositVerifierMVP")).getAddress();
  const wd = await (await deploy("WithdrawNullifierVerifierMVP")).getAddress();
  const batch = await (await deploy("MockGroth16Verifier")).getAddress();
  const vinfo = { verifier: nr, depositVerifier: dep, withdrawVerifier: wd, lockVerifier: ZERO, burnVerifier: ZERO, batchVerifier: batch, batchWithdrawVerifier: batch, batchLockVerifier: ZERO, batchBurnVerifier: ZERO };

  const Pool = await ethers.getContractFactory("HederaZetoToken", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(Pool, ["Zeto ERC20 Pool", "ZERC", operator.address, vinfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"], txOverrides: { gasLimit: DEPLOY_GAS } });
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`Pool: ${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}`);

  // ERC-20 custody — NOTE: setupERC20, NOT setupHTS (no association)
  const su = await (await pool.setupERC20(tokenAddr, ov)).wait();
  console.log(`setupERC20 gas=${su!.gasUsed}`);

  const authority = genKeypair();
  await (await pool.setAuthorityKey([authority.pubKey[0], authority.pubKey[1]], ov)).wait();

  // Alice & Bob from .env
  const aliceW = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobW = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceW); const Bob = await newUser(bobW);

  await (await pool.register(Alice.babyJubPublicKey, "0x", ov)).wait();
  await (await pool.register(Bob.babyJubPublicKey, "0x", ov)).wait();
  const idSmt = newIdentitiesSmt("kyc"); await addIdentity(idSmt, Alice.babyJubPublicKey); await addIdentity(idSmt, Bob.babyJubPublicKey);
  console.log(`KYC enrolled. identities root match: ${(await idSmt.root()).bigInt() === await pool.getIdentitiesRoot()}`);

  const sanc = newSanctionsSmt("ofac"); await addSanctioned(sanc, 111n); await addSanctioned(sanc, 222n);
  await (await pool.updateSanctionsMerkleRoot(ethers.toBeHex((await sanc.root()).bigInt(), 32), ov)).wait();

  // Mint the plain ERC-20 to Alice + approve the pool
  await (await (erc20 as any).mint(Alice.ethAddress, 1000n, ov)).wait();
  const erc20Alice = new ethers.Contract(tokenAddr, ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], aliceW);
  await (await erc20Alice.approve(poolAddr, 100n, ov)).wait();

  console.log("\n1. Deposit 100 (plain ERC-20 -> shielded)");
  const utxo100 = newUTXO(100, Alice);
  const d = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);
  const dr = await (await pool.connect(aliceW).deposit(100n, [d.outputCommitments[0], d.outputCommitments[1]], d.encodedProof, "0x", ov)).wait();
  const utxoSmt = newUtxoSmt("utxos"); await addCommitment(utxoSmt, utxo100.hash);
  console.log(`   gas ${dr!.gasUsed} | ${link(dr!.hash)} | shieldedSupply=${await pool.shieldedSupply(tokenAddr)}`);

  console.log("\n2. Confidential transfer 100 -> 40 Bob + 60 Alice");
  const b40 = newUTXO(40, Bob); const a60 = newUTXO(60, Alice);
  const x = await prepareNRTransferProof(Alice, [utxo100, ZERO_UTXO], [b40, a60], [Bob, Alice], utxoSmt, idSmt, sanc, authority.pubKey);
  const xr = await (await pool.connect(aliceW).transferConfidential([x.nullifiers[0]], [x.outputCommitments[0], x.outputCommitments[1]], x.root, x.encryptionNonce, x.ecdhPublicKey, x.encryptedValues, x.cipherTextAuthority, x.sanctionsRoot, x.encodedProof, "0x", ov)).wait();
  console.log(`   gas ${xr!.gasUsed} | ${link(xr!.hash)}`);

  const aEvt = xr!.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "AuthorityCiphertext");
  const tEvt = xr!.logs.map((l: any) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "UTXOTransferWithEncryptedValues");
  const audited = auditTransfer(authority.privKey, { nullifiers: [x.nullifiers[0]], outputs: [b40.hash, a60.hash], encryptionNonce: BigInt(aEvt!.args.encryptionNonce), ecdhPublicKey: tEvt!.args.ecdhPublicKey.map((v: any) => BigInt(v)) as [bigint, bigint], cipherTextAuthority: aEvt!.args.cipherTextAuthority.map((v: any) => BigInt(v)) }, 2, 2);
  console.log(`   [SDK] authority audit: input=${audited.inputs[0].value}, outputs=[${audited.outputs[0].value}, ${audited.outputs[1].value}]`);
  console.log(`\nPool=${poolAddr}  ERC20=${tokenAddr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
