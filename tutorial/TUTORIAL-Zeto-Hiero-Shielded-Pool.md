# Zeto-Hiero — Build a Shielded Token Pool on Hedera (JS SDK Walkthrough)

The **Hedera Token Service (HTS)** lets you create and move fungible tokens natively, fast and cheap. But every HTS transfer is *public* — amounts and counterparties are visible on the mirror node. **Zeto-Hiero** adds a privacy layer on top: a **shielded pool** that custodies a real HTS token and lets users move value *inside* the pool with **zero-knowledge proofs**, so amounts and the sender→recipient link are hidden, while the on/off-ramps (deposit and withdraw) stay public and auditable.

In this tutorial you will run the full lifecycle on **Hedera testnet** with the **Hiero JS SDK** (`@hiero-ledger/sdk`) for the native token operations and `ethers` (via Hardhat) for the pool's smart-contract calls. You will learn how to:

- Create Hedera accounts for the operator, Alice, and Bob
- Create a fungible HTS token (`ZUSD-TEST`) and associate the accounts
- Deploy the shielded-pool service (ZK verifiers + the `HederaZetoTokenLite` pool)
- **Move tokens into the pool** (a public *deposit*)
- **Move tokens within the pool** (a private *transfer* — amounts hidden)
- **Move tokens out of the pool** (a public *withdraw*)
- Reconcile balances and read each transaction on HashScan

Every native step follows the same shape: **build → (freeze + sign) → execute → get receipt → log status + Transaction ID + HashScan URL.** Every contract step submits via `ethers`, waits for the receipt, and logs the tx hash + gas.

> **Want the "why" instead of the "how"?** This tutorial is the runnable walkthrough. For a plain-language explanation of what Alice and Bob are doing in Zeto terms — notes, commitments, the zero-knowledge proof, and how the transfer stays private — read the companion doc [`HOW-ZETO-WORKS.md`](HOW-ZETO-WORKS.md).

> **A note on names.** The Hiero JS SDK is published as **`@hiero-ledger/sdk`** (the package formerly distributed as `@hashgraph/sdk`), now stewarded as the Linux Foundation **Hiero** project. The API is identical; only the package name changed.
>
> **Two layers, two tools.** Native HTS actions (create accounts, create token, associate, fund) go through the **Hiero JS SDK** straight to consensus nodes — Sections 1–4. The pool actions (deploy, deposit, transfer, withdraw) are **EVM smart-contract calls** that carry ZK proofs and deploy a **UUPS proxy**, so they go through **`ethers` + Hardhat** via the Hashio JSON-RPC relay — Sections 5–9. Each section states which layer it uses.
>
> **Runnable scripts.** Every section maps to a real file under `tutorial/` and runs against testnet. Sections 1–4 run with `ts-node`; Sections 5–9 run with `npx hardhat run` (they need the Hardhat project: compiled artifacts, the OpenZeppelin upgrades plugin, the witness helpers, and the network config). The same logic also ships as two combined scripts, `scripts/phase6-create-token.ts` (1–4) and `scripts/demo-mvp-testnet.ts` (5–9).

---

## Prerequisites

- A funded Hedera **testnet** operator account (account ID + ECDSA private key) from the [Hedera Portal](https://portal.hedera.com/).
- Node.js 20+, and from the repo root: `npm install` then `npx hardhat compile` (compiles the pool + vendored Zeto contracts and produces the artifacts the deploy step reads; requires the `cancun` EVM target already set in `hardhat.config.ts`).
- Compiled circuits in `circuits/build/` (the proving keys + WASM the proofs are generated against). These are gitignored; on a fresh clone, regenerate them via [`../circuits/REBUILD.md`](../circuits/REBUILD.md).
- Dependencies used here: `@hiero-ledger/sdk`, `hardhat` + `ethers`, `@openzeppelin/hardhat-upgrades`, and the witness helpers (`maci-crypto`, `zeto-js`) wired up in `test/lib/zeto-witness.ts`.

✅ If you just want the complete code, skip to the [Code Check](#code-check) section.

This tutorial maps to the per-transaction files in `tutorial/` (see `tutorial/README.md`), and to two combined scripts:

- `scripts/phase6-create-token.ts` — the native HTS setup (Sections 1–4)
- `scripts/demo-mvp-testnet.ts` — the pool deploy + shielded flow (Sections 5–9)

---

## Configure the Client

Load your credentials from `.env` and build a Hiero `Client` for testnet. The operator pays for and signs the native transactions.

01-create-accounts.ts

```javascript
import { Client, PrivateKey, AccountId, Hbar } from "@hiero-ledger/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ACCOUNT_ID);
const operatorKey = PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX);

const client = Client.forTestnet().setOperator(operatorId, operatorKey);
client.setDefaultMaxTransactionFee(new Hbar(20));
```

---

## 1. Create New Hedera Accounts (Alice and Bob)

**Layer: Hiero JS SDK.** Our actors are the **operator** (treasury + deployer), **Alice** (deposits and sends privately), and **Bob** (receives privately and withdraws). The operator already exists; create Alice and Bob with `AccountCreateTransaction`, generating an ECDSA key for each and setting an **EVM alias** with `setECDSAKeyWithAlias` so the pool steps can address them by their EVM address. After consensus, the on-chain EVM address is read back from the mirror node.

> In the repo's `demo` scripts, Alice and Bob are **pre-funded accounts read from `.env`** (`ALICE_ACCOUNT_ID` / `ALICE_PRIVATE_KEY_HEX`, and the same for Bob), so the scripts skip this step. Use the code below when you want to mint fresh actors programmatically — then drop the printed IDs/keys into `.env`.

01-create-accounts.ts

```javascript
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";

// Create an ECDSA account with an EVM alias, then resolve its on-chain EVM address.
async function createAccount(name, initBalanceHbar, client) {
  // Generate a new key for the account
  const accountPrivateKey = PrivateKey.generateECDSA();
  const accountPublicKey = accountPrivateKey.publicKey;

  const txCreateAccount = new AccountCreateTransaction()
    .setECDSAKeyWithAlias(accountPublicKey) // EVM alias from the public key — fully EVM-compatible
    .setInitialBalance(new Hbar(initBalanceHbar))
    .setMaxAutomaticTokenAssociations(10);

  // Submit, then request the receipt
  const txCreateAccountResponse = await txCreateAccount.execute(client);
  const receiptCreateAccountTx = await txCreateAccountResponse.getReceipt(client);

  const statusCreateAccountTx = receiptCreateAccountTx.status;
  const accountId = receiptCreateAccountTx.accountId;
  const txIdAccountCreated = txCreateAccountResponse.transactionId.toString();

  // The EVM alias only appears on the mirror node after consensus
  let accountEvmAddress;
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const mirrorResponse = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId.toString()}`);
  if (mirrorResponse.ok) accountEvmAddress = (await mirrorResponse.json()).evm_address;

  console.log(`------------------------------ Create ${name} ------------------------------`);
  console.log("Receipt status       :", statusCreateAccountTx.toString());
  console.log("Transaction ID       :", txIdAccountCreated);
  console.log("Hashscan URL         :", `https://hashscan.io/testnet/transaction/${txIdAccountCreated}`);
  console.log("Account ID           :", accountId.toString());
  console.log("EVM Address          :", accountEvmAddress);
  console.log("Private key          :", `0x${accountPrivateKey.toStringRaw()}`);
  console.log("Public key           :", `0x${accountPublicKey.toStringRaw()}`);

  return { key: accountPrivateKey, accountId, evmAddress: accountEvmAddress };
}

const alice = await createAccount("Alice", 20, client);
const bob = await createAccount("Bob", 20, client);

console.log(`\nAdd these to ./.env:`);
console.log(`ALICE_ACCOUNT_ID=${alice.accountId}`);
console.log(`ALICE_PRIVATE_KEY_HEX=0x${alice.key.toStringRaw()}`);
console.log(`BOB_ACCOUNT_ID=${bob.accountId}`);
console.log(`BOB_PRIVATE_KEY_HEX=0x${bob.key.toStringRaw()}`);
```

Run with:

```bash
npx ts-node tutorial/01-create-accounts.ts
```

#### Example output:

```
------------------------------ Create Alice ------------------------------
Receipt status       : SUCCESS
Transaction ID       : 0.0.7628788@1718654400.123456789
Hashscan URL         : https://hashscan.io/testnet/transaction/0.0.7628788@1718654400.123456789
Account ID           : 0.0.9134002
EVM Address          : 0x62ff851da9e57747a719d9b905031f137ea64a71
Private key          : 0x15d4...7242
Public key           : 0x03a1...
------------------------------ Create Bob ------------------------------
Receipt status       : SUCCESS
Transaction ID       : 0.0.7628788@1718654406.234567890
...
Account ID           : 0.0.9134005
EVM Address          : 0xc42e3f637ec406b0e0644d44506908ee5e9078e7
```

> Fund each with ~20 HBAR so they can pay relay gas for their own deposit/transfer/withdraw transactions. Transaction IDs above are representative — every run produces fresh ones.

---

## 2. Create the Underlying HTS Token

**Layer: Hiero JS SDK.** Create the fungible token the pool will custody. The operator is the treasury and holds the initial supply. We use 8 decimals and an infinite supply type. The token's **EVM address** (derived from its token ID) is what the pool contract talks to as an ERC-20.

02-create-token.ts

```javascript
const DECIMALS = 8;
const INITIAL_SUPPLY = 1_000_000; // base units, held by the operator (treasury)

// Build and freeze for signing
const txTokenCreate = await new TokenCreateTransaction()
  .setTokenName("Zeto USD Test")
  .setTokenSymbol("ZUSD-TEST")
  .setTokenType(TokenType.FungibleCommon)
  .setDecimals(DECIMALS)
  .setInitialSupply(INITIAL_SUPPLY)
  .setTreasuryAccountId(operatorId)
  .setSupplyType(TokenSupplyType.Infinite)
  .setAdminKey(operatorKey.publicKey)
  .setSupplyKey(operatorKey.publicKey)
  .freezeWith(client);

// Sign with the treasury (operator) key, then submit
const signTxTokenCreate = await txTokenCreate.sign(operatorKey);
const txTokenCreateResponse = await signTxTokenCreate.execute(client);
const receiptTokenCreateTx = await txTokenCreateResponse.getReceipt(client);

const tokenId = receiptTokenCreateTx.tokenId;
const tokenEvm = "0x" + tokenId.toSolidityAddress();
const txTokenCreateId = txTokenCreateResponse.transactionId.toString();

console.log("--------------------------------- Token Creation ---------------------------------");
console.log("Receipt status           :", receiptTokenCreateTx.status.toString());
console.log("Transaction ID           :", txTokenCreateId);
console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txTokenCreateId}`);
console.log("Token ID                 :", tokenId.toString());
console.log("Token EVM address        :", tokenEvm);
// The script also writes TOKEN_ID + UNDERLYING_TOKEN_ADDRESS back to ./.env for the later steps.
```

Run with:

```bash
npx ts-node tutorial/02-create-token.ts
```

#### Example output:

```
--------------------------------- Token Creation ---------------------------------
Receipt status           : SUCCESS
Transaction ID           : 0.0.7628788@1718654412.345678901
Hashscan URL             : https://hashscan.io/testnet/transaction/0.0.7628788@1718654412.345678901
Token ID                 : 0.0.9134010
Token EVM address        : 0x00000000000000000000000000000000008b5fba

Wrote TOKEN_ID and UNDERLYING_TOKEN_ADDRESS to .../zeto-hiero/.env
```

---

## 3. Associate Alice and Bob with the Token

**Layer: Hiero JS SDK.** Before an account that isn't the treasury can hold a token, it must be **associated** with it. Each account signs its own association.

03-associate-token.ts

```javascript
for (const actor of [
  { name: "Alice", id: aliceId, key: aliceKey },
  { name: "Bob", id: bobId, key: bobKey },
]) {
  // Build and freeze for signing
  const txTokenAssociate = await new TokenAssociateTransaction()
    .setAccountId(actor.id)
    .setTokenIds([tokenId])
    .freezeWith(client);

  // The account being associated must sign
  const signTxTokenAssociate = await txTokenAssociate.sign(actor.key);
  const txTokenAssociateResponse = await signTxTokenAssociate.execute(client);
  const receiptTokenAssociateTx = await txTokenAssociateResponse.getReceipt(client);

  const txTokenAssociateId = txTokenAssociateResponse.transactionId.toString();
  console.log(`--------------------------------- Associate ${actor.name} ---------------------------------`);
  console.log("Receipt status           :", receiptTokenAssociateTx.status.toString());
  console.log("Transaction ID           :", txTokenAssociateId);
  console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txTokenAssociateId}`);
}
```

Run with:

```bash
npx ts-node tutorial/03-associate-token.ts
```

#### Example output:

```
--------------------------------- Associate Alice ---------------------------------
Receipt status           : SUCCESS
Transaction ID           : 0.0.7628788@1718654418.456789012
Hashscan URL             : https://hashscan.io/testnet/transaction/0.0.7628788@1718654418.456789012
--------------------------------- Associate Bob ---------------------------------
Receipt status           : SUCCESS
Transaction ID           : 0.0.7628788@1718654424.567890123
Hashscan URL             : https://hashscan.io/testnet/transaction/0.0.7628788@1718654424.567890123
```

---

## 4. Fund Alice and Persist the Token Address

**Layer: Hiero JS SDK.** Move some starting balance from the treasury to Alice with a `TransferTransaction`. (Step 2 already persisted the token's EVM address to `.env` as `UNDERLYING_TOKEN_ADDRESS`, which the pool steps read.)

04-fund-alice.ts

```javascript
const ALICE_FUNDING = 1_000; // base units

// Build and freeze for signing
const txTransfer = await new TransferTransaction()
  .addTokenTransfer(tokenId, operatorId, -ALICE_FUNDING)
  .addTokenTransfer(tokenId, aliceId, ALICE_FUNDING)
  .freezeWith(client);

// Sign with the treasury (operator) key, then submit
const signTxTransfer = await txTransfer.sign(operatorKey);
const txTransferResponse = await signTxTransfer.execute(client);
const receiptTransferTx = await txTransferResponse.getReceipt(client);

const txIdTransfer = txTransferResponse.transactionId.toString();
console.log("-------------------------------- Fund Alice (token transfer) ------------------------------");
console.log("Receipt status           :", receiptTransferTx.status.toString());
console.log("Transaction ID           :", txIdTransfer);
console.log("Hashscan URL             :", `https://hashscan.io/testnet/transaction/${txIdTransfer}`);
```

Run with:

```bash
npx ts-node tutorial/04-fund-alice.ts
```

At this point the public ledger shows: **Alice = 1000**, **Bob = 0**, **operator/treasury = 999,000**.

---

## 5. Deploy the Shielded-Pool Service

**Layer: EVM via `ethers` + Hardhat.** The service is three Groth16 **verifier** contracts (deposit / transfer-`anon_enc` / withdraw — generated from our trusted setup) plus the **`HederaZetoTokenLite`** pool deployed behind a UUPS proxy. We deploy with `ethers` sequentially (awaiting each deployment) rather than batching, because the Hashio relay's nonce tracking can't keep up with batched sends. The proxy is deployed with OpenZeppelin's `upgrades.deployProxy` (implementation + `ERC1967Proxy` + storage-layout safety checks).

> **Why ethers here, not the Hiero SDK?** The pool is a **UUPS proxy** and the deposit/transfer/withdraw calls carry an ABI-encoded Groth16 proof **struct** — both are far simpler through `ethers`/Hardhat than the native SDK. The token underneath is still pure HTS.
>
> **Hedera gas gotcha.** Hedera rejects auto-estimated fees with `INSUFFICIENT_TX_FEE`. Set an explicit `gasPrice` (1500 gwei) and an explicit `gasLimit` on every transaction to bypass the relay's `eth_estimateGas`.

05-deploy-pool.ts

```javascript
import { ethers, upgrades } from "hardhat";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEPLOY_GAS = 6_000_000n;
const TX_GAS = 3_000_000n;

async function deploy(name) {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy({ gasLimit: DEPLOY_GAS });
  await c.waitForDeployment();          // sequential — let the relay settle the nonce
  return await c.getAddress();
}

const [operator] = await ethers.getSigners();
const token = process.env.UNDERLYING_TOKEN_ADDRESS;

// Deploy the verifiers (ours match our trusted setup; batch is an unused placeholder)
const anonEnc  = await deploy("AnonEncVerifierMVP");
const deposit  = await deploy("DepositVerifierMVP");
const withdraw = await deploy("WithdrawVerifierMVP");
const batch    = await deploy("MockGroth16Verifier");

const verifiersInfo = {
  verifier: anonEnc, depositVerifier: deposit, withdrawVerifier: withdraw,
  lockVerifier: ZERO, burnVerifier: ZERO,
  batchVerifier: batch, batchWithdrawVerifier: batch,
  batchLockVerifier: ZERO, batchBurnVerifier: ZERO,
};

// Deploy the pool (UUPS proxy)
const Pool = await ethers.getContractFactory("HederaZetoTokenLite");
const pool = await upgrades.deployProxy(
  Pool,
  ["Hedera Zeto MVP Pool", "ZTEST", operator.address, verifiersInfo],
  { kind: "uups", initializer: "initialize",
    unsafeAllow: ["missing-initializer"], txOverrides: { gasLimit: DEPLOY_GAS } },
);
await pool.waitForDeployment();
const poolAddr = await pool.getAddress();
console.log(`- pool: https://hashscan.io/testnet/contract/${poolAddr}`);

// Wire the HTS token to the pool (associate + record as ERC-20)
const setupTx = await pool.setupHTS(token, { gasLimit: TX_GAS });
const setupRcpt = await setupTx.wait();
console.log(`- setupHTS gas ${setupRcpt.gasUsed} | tx ${setupTx.hash}`);
// The script saves poolAddr to tutorial/.tutorial-state.json for the next steps.
```

Run with:

```bash
npx hardhat run tutorial/05-deploy-pool.ts --network hedera_testnet
```

#### Example output:

```
Deploying verifiers...
  anon_enc=0xaaC2F0be9e81E2B38d74b92bbE5F64c0De6cE79c
  deposit=0xcab40ABc58F842F104873C9191cF4d14CCA3c3e4
  withdraw=0x3aCD4e8aBdD429481eF272Ac00297F07393FDFCf
--------------------------------- Deploy pool (UUPS proxy) ---------------------------------
Pool address               : 0xc8FdE6d63D1c0b8a9e4dB0ee3Bc5D0f508F07cF7
Hashscan URL               : https://hashscan.io/testnet/contract/0xc8FdE6d63D1c0b8a9e4dB0ee3Bc5D0f508F07cF7
--------------------------------- setupHTS ---------------------------------
Status                     : SUCCESS
Transaction hash           : 0x2debfc40d72a6929a97e8a3130e8ea9c4af6e1f036dec0d53a37f10492b1302d
Gas used                   : 783314
```

---

## 6. Move Tokens INTO the Pool — Deposit (public → shielded)

**Layer: EVM call + client-side proof.** A deposit is the public on-ramp. Alice approves the pool to pull 100 base units, generates a **deposit proof** locally (proving the new commitment encodes exactly 100), and calls `deposit`. The pool pulls the HTS tokens via `transferFrom` and mints a shielded **commitment** that only Alice can later spend.

The proof and the note (a `{value, salt, owner}` UTXO) are built by the witness helper using `snarkjs.groth16.fullProve` against our compiled circuit, with BabyJubJub keys from `maci-crypto` and Poseidon hashing from `zeto-js`.

06-deposit.ts

```javascript
import { ethers } from "hardhat";
import { newUTXO, ZERO_UTXO, prepareDepositProof } from "../test/lib/zeto-witness";
import { loadUser, requirePool, writeState } from "./_zeto";

const TX_GAS = 3_000_000n;
const GAS_PRICE = ethers.parseUnits("1500", "gwei");
const ov = { gasLimit: TX_GAS, gasPrice: GAS_PRICE };

const poolAddr = requirePool();                                    // from step 05's state
const aliceWallet = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX, ethers.provider);
const Alice = await loadUser("Alice", aliceWallet);                // stable BJJ keypair across steps
const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, aliceWallet);

const erc20 = new ethers.Contract(process.env.UNDERLYING_TOKEN_ADDRESS,
  ["function approve(address,uint256) returns (bool)",
   "function balanceOf(address) view returns (uint256)"], aliceWallet);

// 1) Approve, 2) build the note + proof, 3) deposit
await (await erc20.approve(poolAddr, 100n, ov)).wait();
const utxo100 = newUTXO(100, Alice);
const dep = await prepareDepositProof(Alice, [utxo100, ZERO_UTXO]);

const depTx = await pool.deposit(
  100n, [dep.outputCommitments[0], dep.outputCommitments[1]], dep.encodedProof, "0x", ov);
const rcpt = await depTx.wait();
console.log(`- deposit proof ${dep.ms}ms | gas ${rcpt.gasUsed} | tx ${depTx.hash}`);

// Persist Alice's note (value + salt) so step 07 can spend it
writeState({ aliceNote: { value: 100, salt: utxo100.salt.toString() } });
```

Run with:

```bash
npx hardhat run tutorial/06-deposit.ts --network hedera_testnet
```

#### Example output:

```
--------------------------------- Deposit (public -> shielded) ---------------------------------
Status               : SUCCESS
Transaction hash     : 0x10ab31c64a294c4bd4069327950260f4a571267477efb6719a099bb6a0a8bee9
Hashscan URL         : https://hashscan.io/testnet/transaction/0x10ab31c64a294c4bd4069327950260f4a571267477efb6719a099bb6a0a8bee9
Proof gen            : 42284ms
Gas used             : 325347
Pool token balance   : 100
shieldedSupply       : 100
```

The 100 units left Alice's public balance and now sit in the pool, represented by a commitment. The first proof of a run is a **cold start** (~25–45 s, loading the proving key); later proofs are ~1–4 s.

**On HashScan:** the deposit tx shows a normal HTS transfer of 100 from Alice into the pool — the on-ramp amount is public.

---

## 7. Move Tokens WITHIN the Pool — Private Transfer (shielded → shielded)

**Layer: EVM call + client-side proof.** This is the privacy step. Alice spends her 100-unit note and produces **two output notes**: **40 to Bob** and **60 change to herself**. The `anon_enc` proof proves value is conserved (40 + 60 = 100) and that each output's `(value, salt)` is **ECDH-encrypted** to its owner's BabyJubJub key — using a fresh ephemeral keypair. On-chain, observers see only opaque commitments plus an encrypted blob: **no amounts, and no Alice→Bob link.**

07-transfer.ts

```javascript
import { ethers } from "hardhat";
import { newUTXO, ZERO_UTXO, prepareTransferProof, decryptNote } from "../test/lib/zeto-witness";
import { loadUser, requirePool, readState, writeState } from "./_zeto";

const ov = { gasLimit: 3_000_000n, gasPrice: ethers.parseUnits("1500", "gwei") };
const poolAddr = requirePool();
const st = readState();

const aliceWallet = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX, ethers.provider);
const bobWallet   = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX, ethers.provider);
const Alice = await loadUser("Alice", aliceWallet);
const Bob   = await loadUser("Bob", bobWallet);
const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, aliceWallet);

// Reconstruct Alice's deposited note (same owner key + salt => same commitment hash)
const utxo100     = newUTXO(Number(st.aliceNote.value), Alice, BigInt(st.aliceNote.salt));
const utxoBob40   = newUTXO(40, Bob);
const utxoAlice60 = newUTXO(60, Alice);
const xfer = await prepareTransferProof(
  Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice]);

const xferTx = await pool.transfer(
  [xfer.inputCommitments[0]],
  [xfer.outputCommitments[0], xfer.outputCommitments[1]],
  xfer.encryptionNonce, xfer.ecdhPublicKey, xfer.encryptedValues,
  xfer.encodedProof, "0x", ov);
const rcpt = await xferTx.wait();
console.log(`- transfer proof ${xfer.ms}ms | gas ${rcpt.gasUsed} | tx ${xferTx.hash}`);
```

### Bob recovers his note from the event

Bob isn't told his note directly — he **decrypts** it from the on-chain event. Using his BJJ private key and the ephemeral public key in the event, he derives the ECDH shared key and Poseidon-decrypts his slice to recover `{value, salt}`, then reconstructs the spendable note (persisted for step 08).

07-transfer.ts (continued)

```javascript
const evt = rcpt.logs
  .map((l) => { try { return pool.interface.parseLog(l); } catch { return null; } })
  .find((e) => e && e.name === "UTXOTransferWithEncryptedValues");

const recovered = decryptNote(
  Bob,
  evt.args.encryptedValues.map((x) => BigInt(x)),
  BigInt(evt.args.encryptionNonce),
  evt.args.ecdhPublicKey.map((x) => BigInt(x)),
  0);                                            // Bob is output index 0
console.log(`- Bob decrypted his note: value=${recovered.value}`);
writeState({ bobNote: { value: Number(recovered.value), salt: recovered.salt.toString() } });
```

Run with:

```bash
npx hardhat run tutorial/07-transfer.ts --network hedera_testnet
```

#### Example output:

```
--------------------------------- Private Transfer (shielded) ---------------------------------
Status               : SUCCESS
Transaction hash     : 0x6ab0621e78c129a6c3fa80927054781d364b74d967473535fd470cbe791a3321
Hashscan URL         : https://hashscan.io/testnet/transaction/0x6ab0621e78c129a6c3fa80927054781d364b74d967473535fd470cbe791a3321
Proof gen            : 4358ms
Gas used             : 415954
Bob decrypted note   : value=40
```

**On HashScan:** the transfer tx shows only commitments and an encrypted-values blob — **the 40/60 split and the Alice→Bob relationship are hidden.** The underlying HTS balances do not move; value stays inside the pool. This is the privacy guarantee in action.

---

## 8. Move Tokens OUT of the Pool — Withdraw (shielded → public)

**Layer: EVM call + client-side proof.** Bob takes his shielded 40 back to the public ledger. He generates a **withdraw proof** for his 40-unit note (with a zero-value change note) and calls `withdraw`; the pool burns the commitment and transfers 40 real HTS units to `msg.sender` (Bob).

08-withdraw.ts

```javascript
import { ethers } from "hardhat";
import { newUTXO, ZERO_UTXO, prepareWithdrawProof } from "../test/lib/zeto-witness";
import { loadUser, requirePool, readState } from "./_zeto";

const ov = { gasLimit: 3_000_000n, gasPrice: ethers.parseUnits("1500", "gwei") };
const poolAddr = requirePool();
const st = readState();

const bobWallet = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX, ethers.provider);
const Bob = await loadUser("Bob", bobWallet);
const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr, bobWallet);

// Reconstruct Bob's note from step 07, then prove the withdraw
const bobNote = newUTXO(Number(st.bobNote.value), Bob, BigInt(st.bobNote.salt));
const change  = newUTXO(0, Bob);
const wd = await prepareWithdrawProof(Bob, [bobNote, ZERO_UTXO], change);

const wdTx = await pool.withdraw(
  40n, [wd.inputCommitments[0]], wd.output, wd.encodedProof, "0x", ov);
const rcpt = await wdTx.wait();
console.log(`- withdraw proof ${wd.ms}ms | gas ${rcpt.gasUsed} | tx ${wdTx.hash}`);
```

Run with:

```bash
npx hardhat run tutorial/08-withdraw.ts --network hedera_testnet
```

#### Example output:

```
--------------------------------- Withdraw (shielded -> public) ---------------------------------
Status               : SUCCESS
Transaction hash     : 0x1cb220b2eae1138312fe4a5e880513073e22f301944267e4cadb8cc638b1f5b8
Hashscan URL         : https://hashscan.io/testnet/transaction/0x1cb220b2eae1138312fe4a5e880513073e22f301944267e4cadb8cc638b1f5b8
Proof gen            : 1203ms
Gas used             : 330392
```

**On HashScan:** the withdraw tx shows a normal HTS transfer of 40 from the pool to Bob — the off-ramp amount is public again.

---

## 9. Reconcile Balances

**Layer: EVM reads.** Confirm value was conserved across the whole flow. Alice deposited 100 and kept 60 of it shielded (so her public balance is 900); Bob withdrew 40; the pool still custodies 60 for Alice's outstanding note, and `shieldedSupply` equals the pool's token balance.

09-reconcile.ts

```javascript
import { ethers } from "hardhat";
import { requirePool } from "./_zeto";

const token = process.env.UNDERLYING_TOKEN_ADDRESS;
const poolAddr = requirePool();
const aliceAddr = new ethers.Wallet(process.env.ALICE_PRIVATE_KEY_HEX).address;
const bobAddr   = new ethers.Wallet(process.env.BOB_PRIVATE_KEY_HEX).address;

const erc20 = new ethers.Contract(token,
  ["function balanceOf(address) view returns (uint256)"], ethers.provider);
const pool = await ethers.getContractAt("HederaZetoTokenLite", poolAddr);

const [aliceBal, bobBal, poolBal, shieldedSupply] = await Promise.all([
  erc20.balanceOf(aliceAddr), erc20.balanceOf(bobAddr),
  erc20.balanceOf(poolAddr), pool.shieldedSupply(token),
]);
console.log(`Alice=${aliceBal} Bob=${bobBal} pool=${poolBal} shieldedSupply=${shieldedSupply}`);
console.log(`reconcile (Alice+Bob+pool) = ${aliceBal + bobBal + poolBal} (expected 1000)`);
```

Run with:

```bash
npx hardhat run tutorial/09-reconcile.ts --network hedera_testnet
```

#### Example output:

```
=== Final balances (base units) ===
   Alice=900  Bob=40  pool=60  shieldedSupply=60
   reconcile (Alice+Bob+pool) = 1000 (expected 1000)
```

The pool invariant holds: **`shieldedSupply == pool token balance == 60`**, and total value is conserved: **Alice 900 + Bob 40 + pool 60 = 1000**.

---

## Conclusion

You created HTS accounts and a fungible token with the Hiero JS SDK, deployed a zero-knowledge **shielded pool** on Hedera testnet, and ran a full **deposit → private transfer → withdraw** lifecycle with **real Groth16 proofs**. The deposit and withdraw amounts are public (the auditable on/off-ramps), while the in-pool transfer hides amounts and the sender→recipient link. The whole flow cost roughly 0.3–0.8 HBAR per step in gas, with client-side proof generation dominating latency.

This is **v0.1** — it deliberately excludes KYC, sanctions screening, and regulator auditability. Those land in later versions ([roadmap](../MVP-Zeto-Hiero.md#7-roadmap)). v0.2 adds KYC enforcement by swapping the pool's transfer circuit for `Zeto_AnonEncNullifierKyc` and wiring the `HederaKycRegistry`.

> **Scope note (v0.1):** the per-step files use **fixed demo amounts** (deposit 100, transfer 40 + 60 change, withdraw 40) and the three `.env` accounts, and deploy a **fresh** pool on each run of step 05 (the pool address is saved to `.tutorial-state.json`, not `.env`). Parameterized per-operation commands against a persistent deployment are a future tooling step.
>
> **State across steps:** because each step is its own process, the per-step files persist each user's BabyJubJub keypair and the spendable notes to `tutorial/.tutorial-state.json` (the combined `demo-mvp-testnet.ts` threads these in memory instead). Delete that file to start a clean run.

---

## Which transaction does each step use?

| Step | Layer | Tool | Transaction / call |
|---|---|---|---|
| 1. Create accounts | Native HTS | Hiero JS SDK | `AccountCreateTransaction` |
| 2. Create token | Native HTS | Hiero JS SDK | `TokenCreateTransaction` |
| 3. Associate | Native HTS | Hiero JS SDK | `TokenAssociateTransaction` |
| 4. Fund Alice | Native HTS | Hiero JS SDK | `TransferTransaction` |
| 5. Deploy pool + `setupHTS` | EVM | `ethers` + upgrades | contract deploy + `setupHTS()` |
| 6. Deposit (in) | EVM + proof | `ethers` + snarkjs | `approve()` + `deposit()` |
| 7. Private transfer | EVM + proof | `ethers` + snarkjs | `transfer()` |
| 8. Withdraw (out) | EVM + proof | `ethers` + snarkjs | `withdraw()` |
| 9. Reconcile | EVM reads | `ethers` | `balanceOf()`, `shieldedSupply()` |

---

## Code Check

Per-transaction files live in `tutorial/` (see `tutorial/README.md` for the full run list). The same logic also ships as two combined scripts:

- **`scripts/phase6-create-token.ts`** — Sections 1–4: create the HTS token, associate Alice & Bob, fund Alice, and write `UNDERLYING_TOKEN_ADDRESS` to `.env`.
- **`scripts/demo-mvp-testnet.ts`** — Sections 5–9: deploy the verifiers + pool, `setupHTS`, then deposit → private transfer (with Bob decrypting his note) → withdraw, printing per-step gas, HashScan links, and the final reconciliation.

Run the combined scripts in order:

```bash
npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet   # Sections 1–4
npx hardhat run scripts/demo-mvp-testnet.ts    --network hedera_testnet   # Sections 5–9
```

The witness/proof helpers (`newUser`, `newUTXO`, `prepareDepositProof`, `prepareTransferProof`, `prepareWithdrawProof`, `decryptNote`) live in `test/lib/zeto-witness.ts` and are shared by the test suite, the demo, and these tutorial steps.

### Live testnet evidence (captured run)

- Token: [`0.0.9134010`](https://hashscan.io/testnet/token/0.0.9134010) · Pool: [`0xc8FdE6…07cF7`](https://hashscan.io/testnet/contract/0xc8FdE6d63D1c0b8a9e4dB0ee3Bc5D0f508F07cF7)
- Deposit: [`0x10ab31…8bee9`](https://hashscan.io/testnet/transaction/0x10ab31c64a294c4bd4069327950260f4a571267477efb6719a099bb6a0a8bee9)
- Transfer: [`0x6ab062…a3321`](https://hashscan.io/testnet/transaction/0x6ab0621e78c129a6c3fa80927054781d364b74d967473535fd470cbe791a3321)
- Withdraw: [`0x1cb220…1f5b8`](https://hashscan.io/testnet/transaction/0x1cb220b2eae1138312fe4a5e880513073e22f301944267e4cadb8cc638b1f5b8)

See [`MVP-Zeto-Hiero.md`](../MVP-Zeto-Hiero.md) for the architecture, privacy model, performance metrics, and roadmap.
