# Zeto-Hiero — Architecture, Tutorial, Performance, Roadmap

**Status:** ✅ **Feature set complete (v0.1 → v0.5).** Shielded deposit/transfer/withdraw with KYC enforcement, ZK sanctions screening, and authority-decryptable (non-repudiation) transfers, across **all four asset classes — HTS FT, ERC-20 FT, HTS NFT, ERC-721 NFT** — proven on Hedera testnet with real ZK proofs. **136 tests passing.** Production launch (v1.0) is gated on a multi-party trusted-setup ceremony, a third-party audit, and a Besu mainnet upgrade.
**Repo:** github.com/Reccetech/zeto-hiero (public)
**In this repo:** [release-notes.md](release-notes.md) · [tutorial.md](tutorial.md) · [../examples/walkthrough/](../examples/walkthrough/) (runnable v0.1 walkthrough) · run results for [v0.1](run-results.md) / [v0.2](run-results-v0.2-kyc.md) / [v0.3](run-results-v0.3-sanctions.md) / [v0.4](run-results-v0.4-confidential.md) · [operator-runbook.md](operator-runbook.md) · [ceremony.md](ceremony.md) · the privacy model is §2, the version roadmap is §7
**Internal design docs (not in this repo):** PRD-Zeto-Hiero.md (full product spec) · BUILD-PLAN-Zeto-Hiero.md + the per-version build plans (v0.2 KYC, v0.3 sanctions, v0.4→v1.0)
**Last updated:** 2026-06-30

> **Reading note.** This document was written around the v0.1 MVP and still uses it as the teaching baseline (the privacy model in §2 and the tutorial in §5 are the simplest `Zeto_AnonEnc` flow). Sections §3.2, §6, and §7 are updated for the full v0.1→v0.4 feature set. For the compliance-complete picture, read §2's limitation notes alongside §7.

---

## 1. What this is

Zeto-Hiero is a **privacy-preserving token pool** for Hedera. It lets institutions move a fungible token (an HTS token) between accounts so that **amounts and the sender/recipient relationship are hidden on-chain**, while still being backed 1:1 by the real token held in the pool.

It is a Hedera deployment of **[Zeto](https://github.com/hyperledger-labs/zeto)** — the Hyperledger Labs zero-knowledge UTXO token toolkit (Apache 2.0, by Kaleido) — combined with Hedera-specific contracts that bridge to the Hedera Token Service (HTS).

> **Supported assets — all four classes (as of v0.5).** Both **fungible** and **non-fungible** tokens are shielded, in both their **HTS** and plain **ERC** forms:
> - **HTS FT** and **ERC-20 FT** → `HederaZetoToken` (the full v0.4 compliance pool). `setupHTS(token)` associates a native HTS token; `setupERC20(token)` wires a plain ERC-20 with no association. Same KYC + sanctions + non-repudiation stack either way.
> - **HTS NFT** and **ERC-721 NFT** → `HederaZetoNFT` (upstream `Zeto_NfAnonNullifier` + custody bridge). `setupHTSNFT(token)` / `setupERC721(token)`. Basic shielding (anonymity + nullifier double-spend) — upstream has no NFT compliance circuits.
>
> The unifying insight: on Hedera an HTS FT exposes an **ERC-20** interface and an HTS NFT exposes an **ERC-721** interface at their EVM address, so custody is always `transferFrom`/`transfer` — the *only* HTS-specific step is token association. See [tutorials-multi-asset.md](tutorials-multi-asset.md) and [run-results-v0.5-multi-asset.md](run-results-v0.5-multi-asset.md).

**The MVP (v0.1)** is the smallest version that proves the concept end-to-end on Hedera:

- A working privacy pool contract (`HederaZetoTokenLite`) that wraps Zeto's anonymity-and-encryption token with HTS support.
- Real zero-knowledge (Groth16/BN254) proofs **verified on actual Hedera testnet**.
- Deposit / private transfer / withdraw of an HTS token.

It deliberately **excludes** the compliance and custody machinery (KYC, sanctions screening, regulator auditability, threshold key custody) that the production design specifies. Those land in later versions — see the [Roadmap](#7-roadmap).

### What v0.1 proves

The hardest unknown for this entire project was: *does Zeto's ZK cryptography actually work on Hedera's EVM, and what does it cost?* The MVP answers that with live testnet evidence — a real Groth16 proof verifies on-chain on Hedera, an invalid proof is rejected, and the gas/latency are measured (see [Performance](#6-performance-metrics)).

---

## 2. The privacy model — what's hidden and what isn't

Zeto is a **UTXO (unspent-transaction-output) commitment** system, conceptually like shielded notes:

- When you **deposit** tokens, the pool takes your real HTS tokens and creates one or more **commitments** — cryptographic hashes of the form `Poseidon(value, salt, ownerPublicKey)`. The commitment reveals nothing about the value or owner to an observer; it's just a hash on-chain.
- A **private transfer** spends input commitments and creates output commitments. A zero-knowledge proof guarantees the transfer is valid (inputs equal outputs, the sender owns the inputs) **without revealing the amounts or who the parties are**. The recipient learns their new note via an encrypted payload only they can decrypt (ECDH to their key).
- A **withdraw** converts a commitment back to real HTS tokens, sent to the withdrawer's account.

| | Visible on-chain | Hidden |
|---|---|---|
| A deposit happened, and its amount | ✅ (deposit is the public on-ramp) | — |
| Transfer sender | — | ✅ hidden |
| Transfer recipient | — | ✅ hidden |
| Transfer amount | — | ✅ hidden |
| A withdrawal happened, its amount + recipient | ✅ (withdraw is the public off-ramp) | — |

The information boundaries are the deposit and withdraw endpoints; everything in between is private. This is the `Zeto_AnonEnc` variant — **anonymity + encryption**, the simplest variant that supports recipient discovery.

> **v0.1 limitation:** there is no KYC gate, no sanctions screening, and no regulator viewing-key in the MVP. Anyone can transact, and only the transacting parties can see amounts. Compliance features are added in v0.2–v0.4.

### 2.1 Two identities: the account that pays vs. the Zeto owner key

The Hedera account a user signs transactions with is **not** how Zeto identifies them inside the pool. Each participant has a separate **owner key** — a BabyJubJub keypair (a curve chosen because it is cheap to use inside ZK circuits) — and a note "belongs to" whoever holds the matching owner key. Owner keys never appear on-chain in the clear, so knowing someone's *account* tells an observer nothing about which *notes* they own.

### 2.2 Notes, commitments, and why the salt matters

Inside the pool there are no balances, only **notes** — records of the form `{ value, salt, owner }`. What is stored on-chain is never the note, only its **commitment**: `Poseidon(value, salt, ownerPubKeyX, ownerPubKeyY)`. The commitment is a one-way fingerprint that pins the note down exactly while revealing nothing. The **salt** (a fresh random number per note) is what makes this safe: without it, an observer could guess a small set of likely values and hash them to recognise a note, and two equal-value notes would look identical. To *spend* a note you must know all three secrets (`value`, `salt`, and the owner private key) — so the chain holds only fingerprints, and only the owner holds the preimage.

### 2.3 What the transfer proof guarantees

A private transfer hides the amounts, so how does the contract know the sender isn't cheating (e.g. spending a 100-note and minting two 1,000-notes)? The Groth16 proof. Without revealing any secret value, it guarantees:

- **Value is conserved** — input total exactly equals output total (e.g. 100 = 40 + 60).
- **Ownership** — the spender holds the owner private key for each input note.
- **Well-formed outputs** — each output commitment is a correct hash of its hidden `(value, salt, owner)`.
- **Honest encryption** — the encrypted payload (below) really contains the output notes, not junk.

The contract accepts the transfer only if the proof holds, so the system stays sound while every number stays secret. The proof is generated on the sender's machine; only the small proof goes on-chain, which is why the amounts never leave the device.

### 2.4 How the recipient discovers their note (ECDH)

The chain holds the recipient's commitment, but they can't spend it until they learn its secret `value` and `salt` — which the sender chose. Rather than send a side message, Zeto **encrypts the note into the transfer itself**, so the recipient needs only their own private key. When the sender builds the transfer, the circuit also:

1. generates a throwaway **ephemeral keypair** `(ephPriv, ephPub)`, new for that one transfer;
2. derives a shared secret with the recipient, `shared = ephPriv · recipientPubKey` (a curve point-multiplication — this is **ECDH**); and
3. encrypts the recipient's `(value, salt)` under `shared` (a ZK-friendly Poseidon cipher), publishing the ciphertext and the ephemeral **public** key in the transfer event. `ephPriv` is never published.

The recipient reverses it using the ECDH symmetry `ephPriv · recipientPubKey == recipientPrivKey · ephPub`: both sides equal the same shared secret, but the recipient's route needs their private key, which only they hold. They recompute the secret, decrypt, recover `(value, salt)`, and reconstruct the spendable note (the `value=40` line in the walkthrough). Consequences: **only the recipient can read it**; discovery is **trustless** (the proof guaranteed the ciphertext matches the committed note); and in practice a wallet **scans** transfer events and tries to decrypt each, treating a note as theirs when the decrypted `(value, salt)` hashes to an on-chain commitment under their key. The fresh ephemeral key per transfer also keeps repeated payments between the same parties from being clustered.

### 2.5 The proving and verifying keys (trusted setup)

Groth16 has two matched halves: the sender proves with a **proving key**, and the on-chain verifier checks with the matching **verifying key** baked into the verifier contract at deploy time. Both come, once per circuit, from a **trusted setup** (a Powers-of-Tau phase plus a circuit-specific phase) — fixed public parameters, not anyone's secret. Two consequences: (1) they are a *matched set* — a verifier from one setup rejects proofs from a different setup, so the deployed verifier and the client proving key must share a setup; and (2) they are regenerable, but a re-run yields a fresh set that won't match an already-deployed verifier, so you'd redeploy (see [`rebuild-circuits.md`](rebuild-circuits.md)). **Security note (v0.1):** this MVP's setup is a single-party, throwaway one — convenient but *not secure*, because whoever ran it could in principle use the leftover secret ("toxic waste") to forge proofs the verifier would accept. Production requires a **multi-party ceremony** in which no single participant ever holds the full secret (one honest participant suffices for soundness); that is a v1.0 item (see [Roadmap](#7-roadmap)).

### 2.6 Honest limits of v0.1 privacy

Privacy is real but not absolute:

- **The public boundaries leak at the edges.** Deposits and withdrawals show real amounts and accounts; a deposit of 100 followed soon after by a withdrawal of 40 can be correlated by amount/timing. Privacy strengthens with the size of the **anonymity set** (many users, varied amounts and timing).
- **This variant reveals which note was spent.** `Zeto_AnonEnc` marks the *input commitment* as spent, so the graph of "this note produced those notes" is visible — as a web of anonymous, valueless fingerprints. It hides amounts, owners, and the sender→recipient identity link, but not the existence of the spend. The **nullifier**-based variants on the roadmap (v0.2+) hide even *which* note was spent.
- **No compliance layer yet.** v0.1 omits KYC, sanctions screening, and auditor viewing keys by design (v0.2–v0.4).
- **The trusted setup is a toy** (see §2.5) — soundness against a malicious setup operator needs the v1.0 ceremony.

---

## 3. Architecture

### 3.1 Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Client / SDK (off-chain)                                     │
│  • BabyJubJub keypair, commitment construction (Poseidon)     │
│  • Groth16 proof generation (snarkjs + compiled circuit)      │
└───────────────────────────┬───────────────────────────────────┘
                            │ deposit / transfer / withdraw tx
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  HederaZetoTokenLite  (UUPS proxy, ~12.2 KB)                  │
│  ┌─────────────────────────┐  ┌──────────────────────────┐   │
│  │ Zeto_AnonEnc (upstream) │  │ ZetoHTSBridge (ours)     │   │
│  │ • UTXO commitment state │  │ • HTS token association  │   │
│  │ • deposit/transfer/     │  │ • shielded-supply track  │   │
│  │   withdraw logic        │  │ • safe dissociation (E-9)│   │
│  │ • proof verification    │  └──────────────────────────┘   │
│  └───────────┬─────────────┘                                  │
└──────────────┼────────────────────────────────────────────────┘
              │ verifyProof (BN254 pairing)        │ HTS transferFrom/transfer
              ▼                                     ▼
┌──────────────────────────┐         ┌────────────────────────────┐
│ Groth16 Verifier(s)      │         │ HTS Token (precompile 0x167│
│ (generated from circuits)│         │ / ERC-20 facade)            │
└──────────────────────────┘         └────────────────────────────┘
```

### 3.2 Contracts (all Solidity `^0.8.27`, Cancun EVM)

| Contract | Origin | Role in MVP |
|---|---|---|
| **`HederaZetoTokenLite`** | ours | The pool. Inherits `Zeto_AnonEnc` + `ZetoHTSBridge`. UUPS-upgradeable. ~12.2 KB. |
| `Zeto_AnonEnc` | upstream (vendored v0.2.2) | UTXO state machine, deposit/transfer/withdraw, proof verification dispatch. |
| **`ZetoHTSBridge`** | ours | HTS token association (so the pool can hold the token), shielded-supply tracking, safe-dissociation guard. |
| `IHederaTokenService` / `HederaResponseCodes` | ours | Interface + constants for the Hedera Token Service system contract at `0x167`. |
| Groth16 verifiers (`DepositVerifierMVP`, …) | generated | On-chain BN254 pairing check for each circuit. Generated from our compiled circuits. |

**Later pools build on this** (the §7 roadmap, all complete + testnet-proven): **`HederaZetoTokenKyc`** (v0.2, `Zeto_AnonEncNullifierKyc` — KYC identities + nullifier SMT), **`HederaZetoTokenKycSanctions`** (v0.3, adds the authored sanctions non-inclusion circuit + wires `SanctionsModule`), and **`HederaZetoToken`** (v0.4, the production pool — adds authority-decryptable transfers, pause, and a reentrancy mutex). The v0.2+ pools link external `PoseidonUnit2L/3L` + `SmtLib` libraries (for the on-chain SMTs) and use larger circuits (2¹⁸–2¹⁹ ptau). The KYC registry is the **embedded `Registry`** of the upstream KYC variant (enroll via `pool.register(...)`), not the standalone `HederaKycRegistry`. `ZetoVkeySetter` (UUPS, "all expected circuits committed before lock") remains a deployment-workflow helper for the v1.0 ceremony.

### 3.3 The zero-knowledge layer

Three circuits (circom 2.2.2), compiled locally, each with its own Groth16 proving + verifying key from a single-party **test** setup (production needs a multi-party ceremony — see roadmap):

| Circuit | Constraints | Powers of Tau | Purpose |
|---|---|---|---|
| `deposit` | 810 | 2¹⁴ | Prove output commitments match the deposited amount |
| `withdraw` | 5,053 | 2¹⁴ | Prove the withdrawn amount matches spent commitments |
| `anon_enc` | 16,111 | 2¹⁶ | Prove a valid private transfer (ownership, value conservation, ECDH encryption) |

> **Note:** upstream's Makefile lists stale Powers-of-Tau sizes. Empirically `anon_enc` needs 2¹⁶ (snarkjs requires the ceremony domain ≥ 2× constraints), not the documented 2¹³.

The commitment scheme is `Poseidon(4)([value, salt, ownerPubKeyX, ownerPubKeyY])`. Owner keys are BabyJubJub. Proofs are Groth16 over BN254, verified on-chain via Hedera's `ecAdd`/`ecMul`/`ecPairing` precompiles (`0x06`/`0x07`/`0x08`).

### 3.4 Why a custom pool contract instead of using Zeto directly

Two Hedera-specific realities:

1. **HTS association.** A Hedera contract must explicitly *associate* with an HTS token before it can hold a balance of it. `ZetoHTSBridge.setupHTS()` does this. Plain Zeto has no concept of it.
2. **Shielded-supply safety (issue E-9).** If an operator dissociates the token while shielded UTXOs are still outstanding, those UTXOs become permanently un-withdrawable. `ZetoHTSBridge` tracks `shieldedSupply` (incremented on deposit, decremented on withdraw) and blocks dissociation while it's non-zero.

The pool overrides Zeto's internal `_deposit` / `_withdraw` (which are `virtual`) to enforce association and maintain the supply invariant, then delegates to upstream for the actual UTXO + proof logic.

---

## 4. How it works — transaction flows

### Deposit (public → shielded)
1. Off-chain, the depositor picks output commitment values (e.g. 100 → a single 100-value note) and computes commitments with Poseidon.
2. They generate a `deposit` proof: "these commitments sum to the amount I'm depositing."
3. `pool.deposit(amount, outputCommitments, proof)`:
   - `ZetoHTSBridge` confirms the token is associated.
   - Upstream verifies the proof, then pulls `amount` HTS tokens via `transferFrom`.
   - Shielded supply increases by `amount`.

### Private transfer (shielded → shielded)
1. The sender selects input notes they own and defines outputs (e.g. 40 to Bob, 60 change to self).
2. They generate an `anon_enc` proof: inputs = outputs, sender owns inputs, and outputs are ECDH-encrypted to recipients' BabyJubJub keys.
3. `pool.transfer(inputs, outputs, encryptionNonce, ecdhPublicKey, encryptedValues, proof)`:
   - Upstream verifies the proof, marks inputs spent, records new output commitments.
   - On-chain observers see only opaque commitments + an encrypted blob. Bob scans events and decrypts his note.

### Withdraw (shielded → public)
1. The withdrawer proves spent commitments cover the withdrawn amount.
2. `pool.withdraw(amount, inputs, output, proof)`:
   - Upstream verifies, marks inputs spent, transfers `amount` HTS tokens to `msg.sender`.
   - Shielded supply decreases by `amount`.

> In `Zeto_AnonEnc`, withdraw always pays `msg.sender` — there's no separate recipient parameter, so the "recipient-binding" concern (issue E-1) doesn't apply in v0.1.

---

## 5. Tutorial

### 5.1 Prerequisites

- Node.js 20+ and npm
- The repo at `C:/repos/Privacy Proposal/zeto-hiero/`
- For circuit work: the circom v2.2.2 binary (already at `tools/bin/circom.exe`) and Powers of Tau files in `circuits/ptau/` (gitignored; re-download if missing — see 5.7)
- For testnet: a funded Hedera testnet account (operator) — credentials live in `.env`

### 5.2 Install and build

```bash
cd "C:/repos/Privacy Proposal/zeto-hiero"
npm install
npx hardhat compile          # compiles our contracts + vendored upstream Zeto
```

### 5.3 Run the test suite

```bash
npm test                     # 85 tests
```

Covers: HTS bridge (association, supply tracking, safe dissociation), sanctions module, KYC registry (incl. UUPS upgrade), vkey-setter completeness invariant, the lite pool integration (deposit→withdraw with a mock verifier), **real Groth16 proof** verification (off-chain + on-chain), and the **full end-to-end shielded flow** (deposit→transfer→withdraw with real proofs, balances reconciled).

### 5.4 Local deployment

```bash
npx hardhat deploy --tags lite-pool --network hardhat
```

This deploys the verifiers, then the `HederaZetoTokenLite` UUPS proxy, wiring the verifiers into Zeto's `VerifiersInfo` struct. After deploy, the owner calls `setupHTS(<token>)` once to associate the token and wire it as the pool's ERC-20.

### 5.5 The headline demo — full shielded flow on Hedera testnet

This is the v0.1 deliverable: deposit → private transfer → withdraw against a **real HTS token** with real proofs. Two steps:

```bash
# One-time: create the ZUSD-TEST HTS token, associate Alice & Bob, fund Alice,
# and write UNDERLYING_TOKEN_ADDRESS into .env.
npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet

# Deploy verifiers + pool, then run deposit -> transfer -> withdraw.
npx hardhat run scripts/demo-mvp-testnet.ts --network hedera_testnet
```

The demo deploys the verifiers and the `HederaZetoTokenLite` proxy, calls `setupHTS`, then (with Alice and Bob as distinct funded accounts) deposits 100, privately transfers 40 to Bob + 60 change to Alice, has Bob decrypt his note from the on-chain event, and withdraws 40 — printing per-step gas and HashScan links and asserting the balances reconcile. See [§6.1](#61-full-shielded-flow-on-hedera-testnet-v01-complete) for the captured results.

> For a phase-by-phase narration of this flow (what each step does, what to verify on HashScan, and the privacy guarantee in action), see [§5.6 Real-life walkthrough](#56-real-life-walkthrough--token-lifecycle-on-hedera-testnet).

> **Lighter checkpoint:** to validate just the deposit verifier on testnet (no HTS token needed), run `npx hardhat run scripts/testnet-deposit-proof.ts --network hedera_testnet`. It deploys a verifier, verifies a real proof on-chain (`eth_call` + a state-changing tx for a gas receipt), and confirms a tampered proof is rejected.

> **Hedera gas gotcha (already handled in config + scripts):** Hedera rejects auto-estimated fees with `INSUFFICIENT_TX_FEE`. The fix: an explicit `gasPrice` (1500 gwei) in `hardhat.config.ts` and an explicit `gasLimit` on each transaction (bypasses the relay's `eth_estimateGas`). Also, `hardhat deploy` batches transactions and trips the Hashio relay's nonce tracking — testnet deploys use a self-contained ethers script (`scripts/demo-mvp-testnet.ts`) instead.

### 5.6 Real-life walkthrough — token lifecycle on Hedera testnet

This is the full operator story end to end: **deploy the service → create an HTS token → move tokens into the shielded pool → operate privately → move tokens back out**, all on live Hedera testnet with real ZK proofs. It uses the two scripts from §5.5; this section explains exactly what each phase does, what you should see, and what to check on HashScan.

> **Step-by-step SDK tutorial:** for a Hedera-tutorial-style, transaction-by-transaction walkthrough (Hiero JS SDK for the native HTS steps + `ethers` for the pool calls, with copy-paste code and console output for each step), see the standalone [`tutorial.md`](tutorial.md).

> **Scope note (v0.1 today):** the flow is driven by two scripts with **fixed demo amounts** (deposit 100, transfer 40 + 60 change, withdraw 40) and the three `.env` accounts (operator, Alice, Bob). `demo-mvp-testnet.ts` deploys a **fresh** pool on each run and does not persist the pool address for later reuse. Parameterized, separately-runnable per-operation commands against a persistent deployment are a future tooling step — not part of v0.1.

#### Pre-flight

- `.env` has the funded **operator** key (`HEDERA_OPERATOR_PRIVATE_KEY_HEX`) plus **Alice** and **Bob** keys/account IDs. All three need a little HBAR for gas (the test accounts have ~770–940 HBAR each).
- Circuits are built (`circuits/build/` present) and contracts compile (`npx hardhat compile`).

#### Step 1 — Create the HTS token, associate accounts, fund Alice

```bash
npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet
```

What it does (via `@hashgraph/sdk`, not the JSON-RPC relay):
1. Creates a fungible token **`ZUSD-TEST`** (8 decimals, treasury = operator).
2. **Associates** Alice and Bob with the token (each must sign; required before an account can hold or receive it).
3. Transfers **1000 base units** from the treasury to Alice (her spendable balance for the demo).
4. Writes the token's EVM address into `.env` as `UNDERLYING_TOKEN_ADDRESS` (consumed by the next script).

Verify on HashScan: open the printed token link (e.g. `https://hashscan.io/testnet/token/0.0.9134010`) and confirm the token exists, 8 decimals, and Alice's 1000-unit balance.

#### Step 2 — Deploy the service and run the full lifecycle

```bash
npx hardhat run scripts/demo-mvp-testnet.ts --network hedera_testnet
```

This single run performs the whole lifecycle. Read it as five phases:

**(a) Deploy the service.** Deploys the three Groth16 verifiers (deposit/anon_enc/withdraw — ours, from our trusted setup) and the `HederaZetoTokenLite` UUPS proxy, owned by the operator.

**(b) Wire the token (`setupHTS`).** The operator calls `pool.setupHTS(<token>)` once. The pool **associates itself** with the HTS token (so it can custody it) and wires it as the pool's ERC-20. *(captured: ~783,314 gas.)*

**(c) Move tokens IN — deposit (public → shielded).** Alice `approve`s the pool for 100 units, then a real `deposit` proof is generated locally and `pool.deposit(100, …)` pulls 100 units via `transferFrom`, minting a shielded commitment. After this: pool token balance = 100, Alice = 900, `shieldedSupply` = 100. *(captured: ~325,347 gas.)*

**(d) Operate privately — transfer (shielded → shielded).** Alice generates an `anon_enc` transfer proof spending her 100-unit note into **40 to Bob** and **60 change to herself**, ECDH-encrypting each output to its owner. On-chain, observers see only opaque commitments + an encrypted blob — **amounts and the sender/recipient link are hidden**. Bob then reconstructs his note by decrypting the event with his BabyJubJub key. The underlying token balances do **not** move (it's purely shielded). *(captured: ~415,954 gas.)*

**(e) Move tokens OUT — withdraw (shielded → public).** Bob generates a `withdraw` proof for his 40-unit note and calls `pool.withdraw(40, …)`; the pool transfers 40 real units to Bob (`msg.sender`). After this: Bob = 40, pool = 60, `shieldedSupply` = 60. *(captured: ~330,392 gas.)*

**Reconciliation.** The script asserts conservation: **Alice 900 + Bob 40 + pool 60 == 1000**, with `shieldedSupply == pool balance == 60`. It prints per-step gas and a HashScan link for every transaction.

#### What a captured run looks like

```text
1. Deposit 100 (public -> shielded)
   proof 42284ms | gas 325347 | https://hashscan.io/testnet/transaction/0x10ab31…8bee9
   pool token bal: 100 | shieldedSupply: 100
2. Private transfer 100 -> 40 Bob + 60 Alice (shielded)
   proof 4358ms | gas 415954 | https://hashscan.io/testnet/transaction/0x6ab062…a3321
   Bob decrypted his note: value=40
3. Bob withdraws 40 (shielded -> public)
   proof 1203ms | gas 330392 | https://hashscan.io/testnet/transaction/0x1cb220…1f5b8
=== Final balances (base units) ===
   Alice=900  Bob=40  pool=60  shieldedSupply=60
   reconcile (Alice+Bob+pool) = 1000 (expected 1000)
```

#### What to confirm on HashScan

- **Deposit tx** — a public token transfer of 100 from Alice into the pool (the public on-ramp; amount visible).
- **Transfer tx** — only opaque commitments + an encrypted-values blob; **no amounts, no Alice→Bob link** is visible. This is the privacy guarantee in action.
- **Withdraw tx** — a public token transfer of 40 from the pool to Bob (the public off-ramp; amount visible).
- **Token page** — final balances match the reconciliation above.

> **First-proof cold start:** the first proof of a run can take ~25–45 s (loading the proving key + WASM); subsequent proofs are ~1–4 s. This is client-side and consumes no gas. See §6.1 for the full gas table and live links.

### 5.7 Rebuild the circuits (only if `circuits/build/` is missing)

```bash
# Compile (circom binary is at tools/bin/circom.exe)
# circuitlib must be at vendor/zeto/zkp/circuits/node_modules/circomlib (circomlib@2.0.5)
# Download Powers of Tau 2^14 and 2^16 into circuits/ptau/ from
#   https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_{14,16}.ptau
# Then: compile each circuit, run `snarkjs groth16 setup`, contribute, export vkey + solidity verifier
```
(The exact commands are recorded in the internal `BUILD-PLAN-MVP-Zeto-Hiero.md` Phase 5.)

---

## 6. Performance metrics

Measured on **Hedera testnet (chain 296)** via the Hashio JSON-RPC relay, deposit circuit, two independent runs (consistent results):

| Metric | Value | Notes |
|---|---|---|
| **Proof generation (client-side)** | **6–9 s** warm, 22–27 s cold | Off-chain, in the user's wallet/SDK. Cold includes loading the 10 MB proving key. Pre-transaction — consumes no gas. |
| **On-chain verification** | **~276,500 gas** | The BN254 pairing check for a deposit. |
| **Verification cost** | **~0.27 HBAR** (~$0.01) | At testnet gas price ~970 gwei. |
| **Verifier deployment** | 363,103 gas | One-time per pool. |
| **`eth_call` verify latency** | 119–146 ms | Read-only verification. |
| **Write tx submit→confirm** | ~9 s | Normal Hedera finality via Hashio. |
| **Correctness** | valid → accepted; tampered → rejected | Amount tampered 100→999 correctly fails on-chain. |
| **Pool contract size** | 12.2 KB | Well under the 24,576-byte EIP-170 limit. |

**Reference points:**
- A plain HTS token transfer is ~30–40K gas, so a ZK deposit verification (~276K) is roughly 7–9× a normal transfer — still well under one US cent on Hedera's flat-fee model.
- Proof generation dominates user-perceived latency, but it's client-side and parallelizable; a production SDK caching keys in memory lands at the low end (~6 s) and could be optimized further.

### 6.1 Full shielded flow on Hedera testnet (v0.1 complete)

The complete `deposit → private transfer → withdraw` was run end-to-end against a real HTS token (`ZUSD-TEST`, 8 decimals) on Hedera testnet (chain 296), with Alice and Bob as distinct funded accounts. Final balances reconcile exactly: **Alice 900 + Bob 40 + pool 60 == 1000**, and `shieldedSupply == pool balance == 60`.

| Operation | On-chain gas | Proof gen (client) | Notes |
|---|---|---|---|
| `setupHTS` (one-time) | 783,314 | — | Pool associates the HTS token via the `0x167` precompile |
| **Deposit** (100) | **325,347** | 42 s cold / ~1 s warm | Pulls HTS via `transferFrom`; mints output commitment |
| **Private transfer** (40→Bob, 60→Alice) | **415,954** | ~4 s | `anon_enc` proof; matches local 415,879 and the PRD §18.9 ~445K baseline |
| **Withdraw** (40) | **330,392** | ~1 s | Pays `msg.sender` (Bob) in HTS |

**Live testnet evidence:**
- Token: [`0.0.9134010`](https://hashscan.io/testnet/token/0.0.9134010) · Pool: [`0xc8FdE6…07cF7`](https://hashscan.io/testnet/contract/0xc8FdE6d63D1c0b8a9e4dB0ee3Bc5D0f508F07cF7)
- Deposit: [`0x10ab31…8bee9`](https://hashscan.io/testnet/transaction/0x10ab31c64a294c4bd4069327950260f4a571267477efb6719a099bb6a0a8bee9) · Transfer: [`0x6ab062…a3321`](https://hashscan.io/testnet/transaction/0x6ab0621e78c129a6c3fa80927054781d364b74d967473535fd470cbe791a3321) · Withdraw: [`0x1cb220…1f5b8`](https://hashscan.io/testnet/transaction/0x1cb220b2eae1138312fe4a5e880513073e22f301944267e4cadb8cc638b1f5b8)
- Earlier standalone deposit-verifier checkpoint: [`0x489fcb…474c`](https://hashscan.io/testnet/transaction/0x489fcb161d0dbbaec7c4a5615a95c4b92c70665cb34fe61bc2b8e972dbec474c)

Reproduce with: `npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet` then `npx hardhat run scripts/demo-mvp-testnet.ts --network hedera_testnet`.

---

## 7. Roadmap

Each version added **one** capability, so complexity grew incrementally and every step shipped something testable on Hedera testnet. **v0.1 → v0.4 are complete and testnet-proven; v1.0 (production launch) remains.**

| Version | Adds | Status |
|---|---|---|
| **v0.1 (MVP)** | Shielded HTS deposit/transfer/withdraw; real ZK proofs on testnet (`HederaZetoTokenLite`, `Zeto_AnonEnc`) | ✅ **Complete** — full deposit→transfer→withdraw on testnet; balances reconcile |
| **v0.2** | KYC enforcement — `Zeto_AnonEncNullifierKyc` + nullifier SMT; only registered BabyJubJub identities can transact | ✅ **Complete** — `HederaZetoTokenKyc`; KYC + double-spend prevention proven on testnet ([run](run-results-v0.2-kyc.md)) |
| **v0.3** | Sanctions screening — authored `anon_enc_nullifier_kyc_sanctions` circuit + `SanctionsModule`; per-spend ZK non-inclusion (PPOI) | ✅ **Complete** — `HederaZetoTokenKycSanctions`; sanctioned spend can't produce a proof ([run](run-results-v0.3-sanctions.md)) |
| **v0.4** | Non-repudiation (authority-decryptable transfers) + viewing-key SDK & scanners + DeRec-style authority-key custody + HCS audit trail | ✅ **Complete** — `HederaZetoToken` (production pool); regulator reconstructs the full ledger from the authority ciphertext ([run](run-results-v0.4-confidential.md)) |
| **v0.5** | Multi-asset — ERC-20 FT custody + shielded NFT pool (HTS NFT + ERC-721); all four asset classes | ✅ **Complete** — `HederaZetoToken.setupERC20` (full compliance on a plain ERC-20) + `HederaZetoNFT` (basic shielding); both proven on testnet ([run](run-results-v0.5-multi-asset.md)) |
| **v1.0** | Production hardening — multi-party trusted-setup ceremony (replaces single-party test keys), third-party security audit, mainnet launch | ⏳ **Staged, not executed** — codeable parts done (invariant tests, ceremony tooling, gated launch script, runbook); gated on the items below |

### Compliance posture (delivered across v0.2–v0.4)

- **KYC gate (v0.2)** — only enrolled identities can be a sender or recipient inside the pool.
- **Sanctions screening (v0.3)** — every transfer proves, in ZK, that the spend is *not* on a sanctions list — without revealing which entries were checked.
- **Selective disclosure (v0.4)** — recipients decrypt their own notes; a regulator holding the pool's **authority key** decrypts the **authority ciphertext** on every transfer to reconstruct the full ledger; neither capability grants spend access.
- **Authority-key custody (v0.4)** — `AuthorityKeyManager` splits the authority key T-of-N (DeRec-style; field-Shamir fallback) so no single party holds it whole.
- **HCS audit trail (v0.4)** — a per-pool Hedera Consensus Service topic (threshold submit key) anchors every admin action (key/sanctions/identity-root updates, pause, upgrade).

### Remaining for mainnet (v1.0 — gated on humans / external dependencies)

- **Trusted setup ceremony** — all circuits currently use insecure **single-party** test keys. Mainnet requires a multi-party Groth16 Phase-2 ceremony (≥10 contributors, 3–6 months). Process + tooling: [ceremony.md](ceremony.md), `scripts/ceremony-contribute.ts`. **Critical-path item.**
- **Third-party security audit** — the invariant/property suite (`test/invariants.test.ts`) feeds it; it does not replace it.
- **Besu ≥ 25.3.0** — Hedera consensus nodes must ship the fix for CVE-2025-30147 (a BN254 point-on-curve check) before any mainnet deployment. As of last check the network was on 25.2.2.
- The mainnet launch itself is gated in code (`scripts/mainnet-launch.ts` refuses to deploy until ceremony + audit + Besu + explicit confirmation), and run from [operator-runbook.md](operator-runbook.md) §Mainnet.

> **Production hardening already in the v0.4 pool:** `HederaZetoToken` adds a pause switch and a reentrancy mutex (the E-3/E-8 items); the nullifier variants (v0.2+) also retired the v0.1 "spent note is visible" limitation.

---

## 8. Repository map

```
zeto-hiero/
├── README.md            Entry point + quick start
├── AGENTS.md            Contributor / AI handoff
├── docs/                All prose docs: overview.md (this file), tutorial.md,
│                        run-results*.md (v0.1–v0.4), rebuild-circuits.md,
│                        release-notes.md, privacy-strategy.md, operator-runbook.md, ceremony.md
├── contracts/
│   ├── hedera/          Pools: HederaZetoTokenLite (v0.1), HederaZetoTokenKyc (v0.2),
│   │                    HederaZetoTokenKycSanctions (v0.3), HederaZetoToken (v0.4, production);
│   │                    + ZetoHTSBridge, SanctionsModule, HederaKycRegistry, ZetoVkeySetter,
│   │                    IHederaTokenService, HederaResponseCodes
│   ├── verifiers/       Our Groth16 verifiers (deposit, anon_enc, withdraw, withdraw_nullifier,
│   │                    KYC, sanctions, and the v0.4 non-repudiation transfer)
│   └── test/            Mocks (HTS precompile, ERC-20, Groth16 verifier) + test harness contracts
├── circuits/
│   ├── sources/         Authored circuits (v0.3 sanctions, v0.4 non-repudiation)
│   └── build/ + ptau/   gitignored; regenerable — see docs/rebuild-circuits.md
├── sdk/                 @hiero-privacy/zeto-sdk: scanners (recipient + authority audit),
│                        sanctions path builder, authority-key custody (Shamir), HCS audit codec
├── deploy/              hardhat-deploy scripts — local
├── scripts/             per-version testnet demos (demo-mvp / v02 / v03 / v04), token setup,
│                        create-hcs-topic, ceremony-contribute, mainnet-launch (gated)
├── examples/walkthrough/  Runnable per-transaction v0.1 tutorial scripts (01–09 + _zeto.ts)
├── test/                128 tests (unit + integration + real-proof + invariants) + lib/ witness helpers
└── vendor/zeto/         Upstream Zeto v0.2.2 (git submodule)
```

**Test coverage:** 128 passing across v0.1–v0.4 — HTS bridge, sanctions, KYC registry, vkey-setter, the four pools' integration tests, verifier deploys, Poseidon/SmtLib linking, real-proof end-to-end flows (anon, KYC, sanctions, non-repudiation with authority decrypt), SDK scanners, Shamir custody, HCS taxonomy, and shielded-supply invariants.

---

## 9. Summary

Zeto-Hiero demonstrates that a compliance-complete Zeto privacy pool runs on Hedera. Starting from the v0.1 MVP — which retired the biggest technical risk (does the ZK cryptography work on Hedera's EVM?) — the project added, one increment at a time and each proven on live testnet with real Groth16 proofs: **KYC enforcement + nullifier double-spend prevention (v0.2)**, **ZK sanctions screening (v0.3)**, and **authority-decryptable transfers for regulator audit, viewing-key scanners, threshold key custody, and an HCS audit trail (v0.4)**. The full suite is green (**128 passing**), and the complete confidential flow (deposit → private transfer → withdraw, with KYC + sanctions + authority decrypt) runs end-to-end on Hedera testnet with balances reconciling and the regulator reconstructing the ledger from on-chain ciphertext. What remains is **not additive engineering** but production hardening that needs people and time: a multi-party trusted-setup ceremony, a third-party security audit, and the Besu mainnet upgrade (v1.0).
