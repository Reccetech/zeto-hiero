# Release Notes

All notable changes to **zeto-hiero** relative to upstream Zeto are documented here. This project
is a Hedera deployment of [Hyperledger Labs **Zeto**](https://github.com/hyperledger-labs/zeto) —
it does **not** fork or modify upstream; it vendors upstream unchanged and builds Hedera-specific
contracts, tooling, and docs *on top* of it.

---

## v0.5.0 — Multi-asset support (2026-06-30)

Covers all four asset classes — **HTS FT, ERC-20 FT, HTS NFT, ERC-721 NFT** — proven on Hedera testnet with real ZK proofs.

### Fungible: ERC-20 custody
- `ZetoHTSBridge` gains an **ERC-20 custody mode** (no HTS association). `HederaZetoToken.setupERC20(token)` shields a plain ERC-20 (a vanilla OpenZeppelin token on HSCS) with the **full v0.4 compliance stack unchanged** (KYC + sanctions + non-repudiation). The same pool still does HTS FT via `setupHTS`.
- The custody gate (`_requireHTSAssociated`) now passes for HTS-associated **or** ERC-custody tokens.

### Non-fungible: shielded NFT pool
- **`HederaZetoNFT`** = upstream `Zeto_NfAnonNullifier` + new `ZetoNFTBridge`. Custodies a real NFT via the **ERC-721 interface** — which both a plain ERC-721 *and* an HTS NFT expose at their EVM address; the only HTS difference is association. `setupERC721` / `setupHTSNFT`; `depositNFT` (custody + mint shielded note) / `transfer` (private, nullifier) / `withdrawNFT` (spend note + release real NFT). Pause switch included. 12.2 KB.
- **Circuit:** compiled upstream `nf_anon_nullifier_transfer` (2¹⁸ ptau) → `NfAnonNullifierTransferVerifierMVP` (uint[3]). NFT note = `Poseidon5(tokenId, uriHash, salt, ownerPubKey)`; nullifier = `Poseidon4(...)`.
- **Compliance scope:** basic shielding (anonymity + double-spend) — upstream has no NFT KYC/sanctions/non-repudiation circuits. Honest limit: the private transfer is fully ZK-trustless; the tokenId↔note custody binding at withdraw is operator/caller-asserted in this basic tier.

### Tooling + tests
- `test/lib/zeto-witness-nf.ts` (NFT witness), `MockERC721`, demo scripts `demo-erc20-ft-testnet.ts` + `demo-nft-testnet.ts`, and `docs/tutorials-multi-asset.md` (one section per asset class).
- **+8 tests (136 total):** ERC-20 FT pool (no `0x167` precompile) + NFT pool incl. a real-proof deposit → private transfer → withdraw of an ERC-721.

### Verified on Hedera testnet
- **ERC-20 FT:** pool `0x7edd8DcD…3eF7`; deposit 668,948 / confidential transfer 2,136,560 gas; authority audit reconstructed input=100, outputs=[40,60].
- **ERC-721 NFT:** pool `0x440b01eA…42D0`; deposit 459,210 / private transfer 914,432 / withdraw 789,593 gas; the real NFT moved Alice → (shielded) → Bob.
- See `run-results-v0.5-multi-asset.md`.

---

## v0.4.0 — Non-repudiation + selective disclosure + audit trail (2026-06-30)

Feature-complete confidential pool. Adds an authority-decryptable layer (non-repudiation), the
viewing-key SDK + scanners, DeRec-style authority-key custody, and an HCS audit trail on top of v0.3.
Proven end-to-end on Hedera testnet with real proofs, including the SDK scanners against real on-chain data.

### Circuits + pool
- **Authored** `circuits/sources/anon_enc_nullifier_kyc_sanctions_non_repudiation.circom` — the v0.3
  sanctions circuit + an authority ECDH `SymmetricEncrypt` of all secrets (`cipherTextAuthority[16]`).
  ~198k constraints → **2¹⁹ ptau**. `authorityPublicKey` is a circuit **public input** (per upstream NR),
  not baked into the verifying key — so the key can rotate without re-ceremony (deviates from PRD F-1).
  Verifier `AnonEncNullifierKycSanctionsNRVerifierMVP` (uint[38]).
- **`HederaZetoToken`** (18.9 KB) — production pool: KYC + sanctions + non-repudiation, stored
  `authorityPublicKey`, pause + reentrancy mutex. `transferConfidential` builds the 38 public signals,
  binds the authority key + sanctions root from state, emits `AuthorityCiphertext`.

### SDK (`sdk/`)
- `OutputScanner` (recipient note discovery via ECDH trial-decrypt), `AuthorityAuditScanner` (regulator
  full-ledger reconstruction from the authority ciphertext), `SanctionsPathBuilder`, `ViewingKey`.
  Note: in Zeto's anon_enc crypto the recipient's BJJ key *is* the viewing key; pool-level audit is the
  authority key.

### Authority-key custody + HCS audit
- `AuthorityKeyManager` — DeRec was unavailable, so custody uses **field-Shamir** over the BN254 scalar
  field (`sdk/src/authority/shamir.ts`): generate → split T-of-N → distribute (pluggable Helper
  encryption) → reconstruct; `sk_auth` is never returned whole.
- HCS audit taxonomy (10 F-7 event types) + codec + poster/listener; `scripts/create-hcs-topic.ts`
  creates a topic with a 3-of-5 Helper threshold submit key.

### Tests + testnet
- **128 tests** (+11): NR pool unit, NR real-proof e2e (authority reconstructs the plaintext), SDK
  scanners against a real proof, Shamir custody, HCS taxonomy, and shielded-supply invariants. Mock
  verifier gained a `[38]` overload.
- Testnet: pool `0x865e9306DEb38b9Ea1E79b4c08e806D0C4DA3E1d`, HCS topic `0.0.9377751`. Confidential
  transfer ~1.89M gas (+~19% over v0.3 for the 16-element authority ciphertext). See
  `run-results-v0.4-confidential.md`.

### v1.0 scaffolding (staged, not executed)
- `test/invariants.test.ts` (Hardhat property tests — Foundry unavailable), `scripts/ceremony-contribute.ts`
  + `docs/ceremony.md`, gated `scripts/mainnet-launch.ts`, `docs/operator-runbook.md`.
- **Still required for mainnet (human/external):** multi-party trusted setup ceremony, third-party
  security audit, Besu ≥ 25.3.0 on mainnet. The pool still uses single-party (toy) verifiers.

### Value-range note
This Zeto version's `check-positive` uses `GreaterEqThan(100)`, already past the 64-bit institutional
need — the PRD's `Num2Bits(40)→64` task is a no-op here.

---

## v0.3.0 — Sanctions screening (2026-06-30)

Adds ZK **sanctions screening** (PPOI equivalent) on top of v0.2: every screened transfer proves — in zero knowledge — that each spent nullifier is **not** on a sanctions list, without revealing which entries were checked. Proven end-to-end on Hedera testnet with real Groth16 proofs. v0.1/v0.2 contracts and flows remain available.

### What we added on top of v0.2
- **Authored circuit `anon_enc_nullifier_kyc_sanctions.circom`** (`circuits/sources/`) — there is no upstream Zeto circuit for this. Extends the upstream `anon_enc_nullifier_kyc` base with a per-input `SMTVerifier(fnc=1)` **non-inclusion** proof against a sanctions SMT, adding one public input `sanctionsRoot` (declared last → appends as public signal #20). ~191k constraints → **2¹⁹ ptau** (deposit/withdraw circuits unchanged).
- **`contracts/verifiers/AnonEncNullifierKycSanctionsVerifierMVP.sol`** — own-setup Groth16 verifier, `uint[20]` public signals.
- **`contracts/hedera/HederaZetoTokenKycSanctions.sol`** — pool = `Zeto_AnonEncNullifierKyc` + `ZetoHTSBridge` + `SanctionsModule` (17.5 KB). New `transferScreened(...)` mirrors upstream's transfer body, appends `uint256(sanctionsMerkleRoot)` as the 20th public input, and calls `_requireCurrentSanctionsRoot` up front for a clean fast revert. **`SanctionsModule` (built in v0.1) is now wired in** — `updateSanctionsMerkleRoot` (owner-or-oracle), `setSanctionsOracle`.
- **`test/lib/zeto-witness-sanctions.ts`** — off-chain sanctions SMT, `buildNonInclusionPath`, `prepareKycSanctionsTransferProof` (sanctions keyed by nullifier).
- **`scripts/demo-v03-sanctions-testnet.ts`** + `docs/run-results-v0.3-sanctions.md`.

### Correction to the PRD
The PRD §6.2 states `fnc=0` for non-membership. The actual iden3 circomlib (and the in-repo `check-smt-proof.circom`) uses **`fnc=1` for exclusion/non-membership**. Confirmed empirically before building; the circuit uses `fnc=1`.

### Tests
- +7 tests over v0.2 (**110 total**): sanctions pool integration (root management, `SanctionsRootMismatch` on stale root, double-spend regression, UUPS auth) and a **real-proof sanctions e2e** — a clean spend verifies on-chain; a sanctioned spend cannot produce a witness (negative test).
- `MockGroth16Verifier` extended with a `[20]` overload.

### Verified on Hedera testnet
KYC enrollment → set sanctions root → deposit → sanctions-screened transfer, real proofs. Pool `0xe47b3Bd5Ae7B71882E47104f66FdF5cE928E56Ce`. **Notable:** the screened transfer cost ~1.59M gas — **no material increase over v0.2's KYC transfer** (the non-inclusion check lives inside the proof; on-chain it's one extra public signal in the constant-cost pairing). Richer compliance, ~flat settlement cost. See `run-results-v0.3-sanctions.md`.

### Intentional deltas / notes
- Screens the **transfer** spend path (per PRD). Deposit/withdraw remain un-screened upstream.
- Sanctions tree is **off-chain rooted** — only the root lives on-chain (`SanctionsModule`); no new on-chain SMT.
- Inherited 19-signal `transfer` is unusable on this pool (the `_verifier` slot holds the 20-signal verifier) — use `transferScreened`.
- Still single-party (toy) trusted setup; multi-party ceremony remains a v1.0 gate.
- Deferred: non-repudiation / authority encryption / DeRec / HCS audit (v0.4).

### Next: v0.4 — non-repudiation + authority custody
Authority BJJ encryption of output values (audit decryptability) + DeRec key custody + HCS audit topic; upgrades to the full PRD circuit `anon_enc_nullifier_kyc_sanctions_non_repudiation`.

---

## v0.2.0 — KYC enforcement (2026-06-30)

Adds KYC identity enforcement and nullifier-based double-spend prevention on top of the v0.1 pool,
proven end-to-end on Hedera testnet with real Groth16 proofs. v0.1 contracts and flow are unchanged
and remain available.

### Baseline (upstream)
- Same submodule: Hyperledger Labs Zeto **v0.2.2** at `vendor/zeto`, consumed unchanged.
- v0.2 composes with a **different upstream variant**: `Zeto_AnonEncNullifierKyc` (anonymity + ECDH +
  nullifier SMT + an embedded on-chain KYC identity registry).
- Added dependency **`@iden3/contracts`** at the exact upstream-pinned git fork
  (`kaleido-io/contracts#keccak256`) — provides `SmtLib` + the `PoseidonUnit{2,3}L` libraries.

### What we added on top of upstream
- **`contracts/hedera/HederaZetoTokenKyc.sol`** — the v0.2 pool. Inherits `Zeto_AnonEncNullifierKyc` +
  `ZetoHTSBridge`; overrides the internal virtual `_deposit` and **`_withdrawWithNullifiers`** (the
  nullifier withdraw path) for HTS association + shielded-supply tracking. 16.2 KB (under the 24 KB
  EIP-170 limit). The KYC identity registry is the **inherited `Registry` base** — enrollment is the
  owner-only `register(pubKey, data)`; there is no separate registry contract.
- **`contracts/verifiers/AnonEncNullifierKycVerifierMVP.sol`** (KYC transfer, 19 public signals) and
  **`WithdrawNullifierVerifierMVP.sol`** (nullifier withdraw, 7 public signals) — generated from our own
  trusted setup, renamed + pragma-bumped, same convention as v0.1.
- **Circuits:** compiled `anon_enc_nullifier_kyc` and `withdraw_nullifier` — both required **2¹⁸ ptau**
  (the KYC transfer is ~118k constraints; the original plan's 2¹⁶ assumption was wrong). The deposit
  circuit is unchanged from v0.1.
- **`test/lib/poseidon-deploy.ts`** — deploys + links `PoseidonUnit2L`/`PoseidonUnit3L` (circomlibjs
  bytecode) and `SmtLib` for the KYC variant.
- **`test/lib/zeto-witness-kyc.ts`** — KYC witness helpers: `newNullifier`, off-chain UTXO + identity
  SMTs (`@iden3/js-merkletree`) kept in lock-step with the on-chain trees, `prepareKycTransferProof`,
  `prepareKycWithdrawProof`, and `decryptNote`.
- **`scripts/demo-v02-kyc-testnet.ts`** — the consolidated testnet demo (deploy → register → deposit →
  transfer → withdraw).

### Tests
- +18 tests over v0.1 (**103 total**): KYC variant smoke, Poseidon/SmtLib linking (on-chain Poseidon
  matches off-chain zeto-js), KYC verifier deploy, KYC pool integration (registry, deposit, **nullifier
  double-spend revert**, UUPS auth), and a **real-proof KYC end-to-end** (deposit → transfer → withdraw
  → double-spend) asserting off-chain SMT roots equal on-chain roots.
- `MockGroth16Verifier` extended with `[7]` and `[19]` overloads for the KYC path.

### Verified on Hedera testnet
Full **KYC enrollment → deposit → private transfer → withdraw** with real proofs. Pool
`0xed8661D592A88A81382996ea17e4323bA64Df8df`. Representative gas (higher than v0.1 — each op now does
on-chain SMT insertions + a larger proof):

| Operation | v0.2 gas | v0.1 gas |
|---|---|---|
| register (Alice / Bob) | 341,515 / 705,538 | — |
| deposit | 652,175 | 325,347 |
| transfer | 1,751,073 | 415,930 |
| withdraw | 1,009,179 | 330,404 |

See `run-results-v0.2-kyc.md` for the full run with HashScan links.

### Intentional deltas / notes
- **No separate `HederaKycRegistry`** (built in v0.1) is wired in — the KYC variant embeds its own
  `Registry`. The standalone registry remains for a future design that delegates to an external registry.
- Upstream's `_register` duplicate-check is ineffective (checks a different SMT key than `isRegistered`);
  re-registering a key doesn't revert. Not a v0.2 blocker; flagged for upstream contribute-back.
- Batch verifiers are passed as a mock placeholder (the 2-in/2-out demo never invokes them).
- Still **single-party (toy) trusted setup**; the multi-party ceremony remains a v1.0 gate.
- Deferred to later versions: sanctions screening (v0.3), viewing-key scanner (v0.3), non-repudiation /
  DeRec (v0.4), pause, batch flows.

### Next: v0.3 — Sanctions screening
ZK non-inclusion proof against an OFAC SDN commitment, using the `SanctionsModule` already built in v0.1.

---

## v0.1.0 — MVP (2026-06-18)

First tagged version. A working privacy-preserving shielded token pool on Hedera, proven end-to-end
on testnet with real Groth16 proofs.

### Baseline (upstream)

- **Upstream:** Hyperledger Labs Zeto, vendored as a git submodule at `vendor/zeto`.
- **Pinned version:** **v0.2.2** (commit `5539a36487b004219a47642c2b32110df1b807db`).
- **Modifications to upstream:** none. Upstream is consumed as-is; our pool composes with it by
  inheriting `Zeto_AnonEnc` (the anonymity + ECDH-encryption variant — no nullifiers, no KYC).

### What we added on top of upstream

#### Hedera integration contracts (`contracts/hedera/`) — wired into v0.1
- **`HederaZetoTokenLite.sol`** — the pool. Combines upstream `Zeto_AnonEnc` with our `ZetoHTSBridge`.
  Overrides the internal (virtual) `_deposit` / `_withdraw` to enforce HTS association and maintain a
  shielded-supply invariant; adds `setupHTS(token)` to associate the HTS token and wire it as the
  pool's ERC-20 in one owner-only call.
- **`ZetoHTSBridge.sol`** — abstract mixin that associates the pool with a native HTS token (via the
  `0x167` precompile) and tracks `shieldedSupply` per token. Custom errors + storage gap.
- **`IHederaTokenService.sol`**, **`HederaResponseCodes.sol`** — minimal interface + response codes
  for the HTS precompile.

#### Foundation contracts (`contracts/hedera/`) — built & tested, NOT yet wired into v0.1
These are forward-looking pieces for later versions; they are not part of the v0.1 pool path:
- **`HederaKycRegistry.sol`** — UUPS-upgradeable KYC registry (for v0.2).
- **`SanctionsModule.sol`** — sanctions screening module (for v0.3).
- **`ZetoVkeySetter.sol`** — verifying-key setter utility.

#### Our verifiers (`contracts/verifiers/`)
- **`DepositVerifierMVP.sol`**, **`AnonEncVerifierMVP.sol`**, **`WithdrawVerifierMVP.sol`** —
  Groth16 verifiers generated from **our own trusted setup**, renamed off the default
  `Groth16Verifier` (name-collision) and bumped to pragma `^0.8.27`. We deliberately do **not** use
  upstream's committed verifiers, which embed upstream's verifying keys.

#### Circuits (`circuits/`)
- Our trusted setup and build pipeline for the three invoked circuits — `deposit`, `anon_enc`,
  `withdraw` — with Powers of Tau (2¹⁴ and 2¹⁶) and snarkjs-generated proving/verifying keys.
  Build outputs are gitignored and regenerated locally.

#### Tooling & configuration
- **`hardhat.config.ts`** — Solidity **0.8.27**, **`evmVersion: "cancun"`** (required: OZ `Arrays.sol`
  uses `mcopy`), **`viaIR: true`**, and Hedera testnet/mainnet networks with an explicit
  `gasPrice` of 1500 gwei.
- **`test/lib/zeto-witness.ts`** — real-proof witness/proof helpers (`newUser`, `newUTXO`,
  `prepareDepositProof`, `prepareTransferProof`, `prepareWithdrawProof`, `decryptNote`) built on
  `maci-crypto` (BabyJubJub + ECDH) and `zeto-js` (Poseidon, encoding, decryption), proving against
  our compiled artifacts with `snarkjs`.
- **Deploy scripts** (`deploy/`) and **operational scripts** (`scripts/`): `phase6-create-token.ts`
  (HTS token + associate + fund), `demo-mvp-testnet.ts` (full shielded flow), `testnet-deposit-proof.ts`
  (gas/latency probe), `check-connection.ts`, `check-test-accounts.ts`.
- Added dependency **`@hiero-ledger/sdk`** (the current Hiero-branded JS SDK) alongside the existing
  `@hashgraph/sdk`.

#### Tests
- Full Hardhat suite (~85 tests) covering the HTS bridge, lite pool, KYC registry, sanctions module,
  vkey setter, an upstream-Zeto smoke test, real-proof deposit, and the full end-to-end MVP flow.
  Abstract mixins are tested via `TestXxx` subclasses; the HTS precompile is mocked at `0x167`.

#### Tutorial (`examples/walkthrough/`) — added this release
- Per-transaction runnable scripts (`01`–`09`) plus a shared `_zeto.ts` state/user helper.
- **`tutorial.md`** — runnable JS-SDK + ethers walkthrough.
- **`run-results.md`** — captured testnet run with entities, HashScan URLs, gas, and USD fees.

The conceptual privacy model (notes, commitments, the ZK proof, ECDH note discovery) is documented in `overview.md` §2.

### Intentional deltas from the production design (PRD)
v0.1 deliberately diverges from the full production design in `../PRD-Zeto-Hiero.md` to ship quickly:
- Uses upstream's inherited `initialize(...)` directly (no custom initializer chain).
- Overrides the internal virtual `_deposit` / `_withdraw` rather than mirroring upstream's init chain
  (upstream's public functions are non-virtual).
- **No nullifiers** (this is the `AnonEnc` variant): spent input commitments are revealed, so the
  spend graph of anonymous commitments is visible. Amounts, owners, and the sender→recipient link are
  hidden. Nullifier-based unlinkability arrives in later variants.
- **Deliberately excluded from v0.1:** KYC enforcement, sanctions screening, non-repudiation, DeRec
  custody, HCS audit, ReentrancyGuard, and pause. (See the build plans for the version roadmap.)

### Verified on Hedera testnet
Full **deposit → private transfer → withdraw** lifecycle with a real HTS token and real Groth16
proofs; balances reconcile (Alice 900 + Bob 40 + pool 60 = 1000). Representative gas:

| Operation | Gas |
|---|---|
| `setupHTS` | 783,314 |
| deposit | 325,347 |
| transfer | ~415,930 |
| withdraw | ~330,404 |

See `run-results.md` for a captured run with HashScan links and USD fees.

### Compatibility
- Solidity **0.8.27**, EVM **Cancun**, Node **20+**.
- Upstream Zeto **v0.2.2** (submodule).
- Hedera testnet (chain 296) / mainnet (chain 295).

### Next: v0.2 — KYC
Swap `Zeto_AnonEnc` → `Zeto_AnonEncNullifierKyc` (adds a nullifier SMT + identity membership, pulling
in `@iden3/contracts`), wire in the existing `HederaKycRegistry`, and extend the witness tooling for
the KYC circuit. See `AGENTS.md` and the build plans.
