import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import { newUser } from "../test/lib/zeto-witness";
import { newUtxoSmt, addCommitment } from "../test/lib/zeto-witness-kyc";
import { newAssetUTXO, prepareNfTransferProof } from "../test/lib/zeto-witness-nf";
import { deployPoseidonAndSmt, librariesMap } from "../test/lib/poseidon-deploy";

dotenv.config();

// v0.5 — shielded NFT flow on Hedera testnet: deposit a real ERC-721 into the pool, transfer it
// privately (real ZK proof), then withdraw the real NFT. The same HederaZetoNFT pool handles an
// HTS NFT via setupHTSNFT (HTS NFTs expose ERC-721 at their EVM address); this demo uses a plain
// ERC-721 via setupERC721 so it is fully self-contained.
// Run: npx hardhat run scripts/demo-nft-testnet.ts --network hedera_testnet

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
  console.log(`\n=== v0.5 shielded NFT flow (testnet) ===\nOperator: ${operator.address}\n`);
  const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

  const nft = await deploy("MockERC721", ["ArtCollection", "ART"]);
  const tokenAddr = await nft.getAddress();
  const TOKEN_ID = 1001;
  console.log(`Deployed ERC-721: ${tokenAddr} (tokenId ${TOKEN_ID})`);

  const libs = await deployPoseidonAndSmt(operator, { gasLimit: DEPLOY_GAS, gasPrice: GAS_PRICE });
  const nfVerifier = await (await deploy("NfAnonNullifierTransferVerifierMVP")).getAddress();
  const mock = await (await deploy("MockGroth16Verifier")).getAddress();
  const vinfo = { verifier: nfVerifier, depositVerifier: mock, withdrawVerifier: mock, lockVerifier: mock, burnVerifier: ZERO, batchVerifier: mock, batchWithdrawVerifier: mock, batchLockVerifier: ZERO, batchBurnVerifier: ZERO };

  const Pool = await ethers.getContractFactory("HederaZetoNFT", { libraries: librariesMap(libs) });
  const pool = await upgrades.deployProxy(Pool, ["Zeto NFT Pool", "ZNFT", operator.address, vinfo],
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer", "external-library-linking"], txOverrides: { gasLimit: DEPLOY_GAS } });
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`Pool: ${poolAddr}\n  ${HASHSCAN}/contract/${poolAddr}`);

  await (await pool.setupERC721(tokenAddr, ov)).wait();

  // Alice & Bob from .env (Zeto owner keys). Operator holds + deposits the NFT, minting Alice's note.
  const aliceW = new ethers.Wallet(env("ALICE_PRIVATE_KEY_HEX"), provider);
  const bobW = new ethers.Wallet(env("BOB_PRIVATE_KEY_HEX"), provider);
  const Alice = await newUser(aliceW); const Bob = await newUser(bobW);

  await (await (nft as any).mint(operator.address, TOKEN_ID, ov)).wait();
  await (await (nft as any).approve(poolAddr, TOKEN_ID, ov)).wait();

  console.log("\n1. Deposit NFT (custody real ERC-721 -> mint Alice's shielded note)");
  const aliceNote = newAssetUTXO(TOKEN_ID, "ipfs://art/1001", Alice);
  const dr = await (await pool.depositNFT(tokenAddr, TOKEN_ID, aliceNote.hash, "0x", ov)).wait();
  const utxoSmt = newUtxoSmt("nft"); await addCommitment(utxoSmt, aliceNote.hash);
  const owner1 = await (nft as any).ownerOf(TOKEN_ID);
  console.log(`   gas ${dr!.gasUsed} | ${link(dr!.hash)} | NFT now held by pool: ${owner1 === poolAddr}`);

  console.log("\n2. Private NFT transfer Alice -> Bob (real ZK proof; tokenId hidden on-chain)");
  const bobNote = newAssetUTXO(TOKEN_ID, "ipfs://art/1001", Bob);
  const x = await prepareNfTransferProof(Alice, aliceNote, bobNote, Bob, utxoSmt);
  const xr = await (await pool.connect(aliceW).transfer(x.nullifier, x.outputCommitment, x.root, x.encodedProof, "0x", ov)).wait();
  await addCommitment(utxoSmt, bobNote.hash);
  console.log(`   proof ${x.ms}ms | gas ${xr!.gasUsed} | ${link(xr!.hash)}`);

  console.log("\n3. Bob withdraws the real NFT (spend note -> release ERC-721)");
  const burn = newAssetUTXO(TOKEN_ID, "ipfs://art/1001", Bob);
  const wd = await prepareNfTransferProof(Bob, bobNote, burn, Bob, utxoSmt);
  const wr = await (await pool.connect(bobW).withdrawNFT(tokenAddr, TOKEN_ID, wd.nullifier, wd.outputCommitment, wd.root, wd.encodedProof, bobW.address, "0x", ov)).wait();
  const owner2 = await (nft as any).ownerOf(TOKEN_ID);
  console.log(`   proof ${wd.ms}ms | gas ${wr!.gasUsed} | ${link(wr!.hash)} | NFT now held by Bob: ${owner2 === bobW.address}`);

  console.log(`\nPool=${poolAddr}  ERC721=${tokenAddr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
