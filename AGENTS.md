# AGENTS.md — Zeto-Hiero handoff for AI coding agents

You are continuing work on **zeto-hiero**, a privacy-preserving token pool for Hedera (a Hedera deployment of Hyperledger Labs **Zeto**, the ZK UTXO token toolkit). Read this first, then the docs below.

## Read these, in order

In this repo (under `docs/`):

1. **`docs/overview.md`** — architecture, how it works (privacy model in §2), performance, roadmap. Start here for the big picture.
2. **`docs/tutorial.md`** — transaction-by-transaction walkthrough; the runnable scripts are in `examples/walkthrough/`.

Internal design docs (kept in the working folder `../`, not committed to this repo):

3. **`BUILD-PLAN-MVP-Zeto-Hiero.md`** — the active work checklist (v0.1); phases are checkbox-tracked.
4. **`PRD-Zeto-Hiero.md`** — full production design spec (≈6,000 lines). Reference by `§` section numbers; don't read end-to-end.
5. **`BUILD-PLAN-Zeto-Hiero.md`** — the full production roadmap (v0.2 → v1.0).

## Where we are (2026-06-30)

✅ **v0.4 (CONFIDENTIAL / NON-REPUDIATION) COMPLETE — feature set done.** **128 tests passing.** Production pool with KYC + sanctions + authority-decryptable transfers, viewing-key SDK + scanners, DeRec-style key custody, HCS audit trail. Proven on testnet with real proofs incl. SDK scanners on real on-chain data. Full detail: `../BUILD-PLAN-v0.4-to-v1.0-Zeto-Hiero.md` + `docs/run-results-v0.4-confidential.md`.
- Pool `HederaZetoToken` = KYC+sanctions+NR. `transferConfidential` (38 public signals); authority key stored on-chain + bound into the proof, `AuthorityCiphertext` event. Pause + reentrancy mutex. Testnet pool `0x865e9306DEb38b9Ea1E79b4c08e806D0C4DA3E1d`, HCS topic `0.0.9377751`.
- Authored circuit `anon_enc_nullifier_kyc_sanctions_non_repudiation` (2¹⁹ ptau, verifier uint[38]). `authorityPublicKey` is a PUBLIC INPUT (not baked in) → rotatable without re-ceremony (deviates from PRD F-1). Value-range is a no-op (check-positive already GreaterEqThan(100)).
- `sdk/`: OutputScanner, AuthorityAuditScanner, SanctionsPathBuilder, ViewingKey, AuthorityKeyManager (field-Shamir — DeRec lib unavailable), HCS taxonomy/poster. Witness `test/lib/zeto-witness-nr.ts`; real-proof e2e `test/nr-real-proof.test.ts`; demo `scripts/demo-v04-confidential-testnet.ts`.

**🔴 v1.0 — NOT done; requires humans/authorization (do NOT attempt to fake):**
- **Multi-party trusted setup ceremony** (`docs/ceremony.md`, `scripts/ceremony-contribute.ts`) — needs ≥10 independent contributors over months. All current verifiers are single-party TOY setups (testnet-only).
- **Third-party security audit** — `test/invariants.test.ts` feeds it; it does not replace it.
- **Mainnet launch** — gated by `scripts/mainnet-launch.ts` (refuses unless ceremony+audit+Besu≥25.3.0+explicit confirm). See `docs/operator-runbook.md` §Mainnet.
The codeable v1.0 scaffolding (invariant tests, ceremony tooling+docs, gated mainnet script, runbook) is built and committed.

---

### Prior milestone — v0.3 (SANCTIONS) (2026-06-30)

✅ **v0.3 (SANCTIONS) COMPLETE.** **110 tests passing.** Adds ZK sanctions non-inclusion (PPOI) on top of v0.2, proven on Hedera testnet with real proofs. Key facts (full detail in `../BUILD-PLAN-v0.3-Sanctions-Zeto-Hiero.md` + `docs/run-results-v0.3-sanctions.md`):
- Pool `HederaZetoTokenKycSanctions` = `Zeto_AnonEncNullifierKyc` + `ZetoHTSBridge` + `SanctionsModule`. New `transferScreened(...)` (the inherited 19-signal `transfer` is unusable — the `_verifier` slot holds the 20-signal sanctions verifier). Appends `uint256(sanctionsMerkleRoot)` as public input #20; `_requireCurrentSanctionsRoot` gives a fast revert on stale root.
- **Authored circuit** `circuits/sources/anon_enc_nullifier_kyc_sanctions.circom` (no upstream equivalent): KYC base + per-input `SMTVerifier(fnc=1)` non-inclusion. **`fnc=1` = non-membership** (the PRD says fnc=0 — it's wrong; confirmed empirically). `sanctionsRoot` declared **last** so it appends as public signal #20 (snarkjs orders public signals as [outputs, then inputs by declaration order]). ~191k constraints → **2¹⁹ ptau**. Verifier `AnonEncNullifierKycSanctionsVerifierMVP` (`uint[20]`).
- `SanctionsModule` (built in v0.1) now wired: `updateSanctionsMerkleRoot` (owner-or-oracle), `setSanctionsOracle`. Sanctions tree is **off-chain rooted** — only the root is on-chain (no new on-chain SMT). Sanctions keyed by **nullifier** (PRD default).
- Witness: `test/lib/zeto-witness-sanctions.ts` — `newSanctionsSmt`/`addSanctioned`/`buildNonInclusionPath` (just `generateCircomVerifierProof` on an absent key) / `prepareKycSanctionsTransferProof`. Real-proof e2e `test/kyc-sanctions-real-proof.test.ts` (clean spend verifies; sanctioned spend can't produce a witness). Demo `scripts/demo-v03-sanctions-testnet.ts`. Testnet pool `0xe47b3Bd5Ae7B71882E47104f66FdF5cE928E56Ce`.
- **Gas insight:** screened transfer ~1.59M gas — no material increase over v0.2's KYC transfer. Non-inclusion is verified inside the proof; on-chain it's just one more public signal. Richer compliance, ~flat settlement cost.

**Next increment: v0.4 — non-repudiation + authority custody + HCS audit** (authority BJJ encryption of output values, DeRec key custody, HCS audit topic; upgrades to the full PRD circuit `anon_enc_nullifier_kyc_sanctions_non_repudiation`; see Phases 3+7 of `../BUILD-PLAN-Zeto-Hiero.md`).

---

### Prior milestone — v0.2 (KYC) (2026-06-30)

✅ **v0.2 (KYC) COMPLETE.** **103 tests passing.** KYC-gated shielded flow with nullifier double-spend prevention, proven on Hedera testnet with real Groth16 proofs. Key facts (full detail in `../BUILD-PLAN-v0.2-KYC-Zeto-Hiero.md` + `docs/run-results-v0.2-kyc.md`):
- Pool `HederaZetoTokenKyc` = upstream `Zeto_AnonEncNullifierKyc` + `ZetoHTSBridge`. Overrides internal virtual `_deposit` **and `_withdrawWithNullifiers`** (the nullifier withdraw path).
- **KYC registry is the *embedded* `Registry` base**, not the standalone `HederaKycRegistry`. Enroll via owner-only `pool.register(pubKey, data)`; current root = `getIdentitiesRoot()`. `initialize` is the unchanged 4-arg form.
- Variant links `PoseidonUnit2L`/`PoseidonUnit3L` (circomlibjs bytecode) + `SmtLib` — deploy via `test/lib/poseidon-deploy.ts`. `@iden3/contracts` installed from the git fork `kaleido-io/contracts#keccak256`.
- Circuits `anon_enc_nullifier_kyc` (transfer, 19 signals) + `withdraw_nullifier` (7 signals) needed **2¹⁸ ptau** (not 2¹⁶ — ~118k constraints). Own-setup verifiers `AnonEncNullifierKycVerifierMVP` / `WithdrawNullifierVerifierMVP`. Deposit circuit unchanged from v0.1.
- KYC witness tooling in `test/lib/zeto-witness-kyc.ts` (off-chain SMTs via `@iden3/js-merkletree`, kept in lock-step with on-chain trees). Real-proof e2e in `test/kyc-real-proof.test.ts`. Demo: `scripts/demo-v02-kyc-testnet.ts`. Testnet pool `0xed8661D592A88A81382996ea17e4323bA64Df8df`.

**Next increment: v0.3 — sanctions screening** (ZK non-inclusion vs an OFAC SDN commitment, using the v0.1 `SanctionsModule`; needs a custom circuit — see Phase 3 of `../BUILD-PLAN-Zeto-Hiero.md`).

---

### Prior milestone — MVP v0.1 (2026-06-10)

✅ **MVP v0.1 COMPLETE.** All phases done. ~14 commits on local `main`, **85 tests passing**.

- Built & tested: `HederaZetoTokenLite` (the pool = upstream `Zeto_AnonEnc` + our `ZetoHTSBridge`), plus foundation contracts (`SanctionsModule`, `HederaKycRegistry`, `ZetoVkeySetter`) that aren't wired into v0.1 yet.
- **Full shielded flow proven on Hedera testnet** with a real HTS token: deposit → private transfer → withdraw, balances reconcile (Alice 900 + Bob 40 + pool 60 == 1000). Gas: deposit 325,347 · transfer 415,954 · withdraw 330,392 · setupHTS 783,314. See `scripts/demo-mvp-testnet.ts` + `scripts/phase6-create-token.ts`; HashScan links in `docs/overview.md` §6.1 (and the internal `BUILD-PLAN-MVP-Zeto-Hiero.md` Phase 6).
- Transfer-witness tooling lives in `test/lib/zeto-witness.ts` (uses `maci-crypto` + `zeto-js`; proofs via `snarkjs.groth16.fullProve` against `circuits/build/`). `maci-crypto` 1.1.1 builds + loads fine on Windows — the native-dep worry didn't materialize.

## Your next task — v1.0 (external gates; do NOT fake)

The feature set (v0.1–v0.4) is complete. What remains is **v1.0 production hardening**, which is mostly NOT coding — it needs humans, external parties, and explicit authorization:

1. **Third-party security audit** — engage an external ZK/Solidity auditor. Feed them `test/invariants.test.ts` + the contracts. Resolve findings. (Do this BEFORE the ceremony freeze.)
2. **Multi-party trusted setup ceremony** — recruit ≥10 independent contributors; run the Phase-2 MPC per `docs/ceremony.md` using `scripts/ceremony-contribute.ts`; deploy the ceremony-produced verifiers. All current verifiers are single-party TOY setups.
3. **Packaged SDK (Phase 8)** — finish `HieroZetoClient` (deposit/transfer/withdraw end-to-end), `HederaProvider`, key manager; publish `@hiero-privacy/zeto-sdk`. (The scanners + custody + HCS modules already exist under `sdk/`.)
4. **Mainnet launch** — only when ceremony + audit are done AND Besu ≥ 25.3.0 is live on mainnet. Gated by `scripts/mainnet-launch.ts`; follow `docs/operator-runbook.md` §Mainnet. This is irreversible + outward-facing — get explicit human go-ahead.

References (read their "Build progress" sections): `../BUILD-PLAN-v0.4-to-v1.0-Zeto-Hiero.md` (the remaining-work master plan), plus the v0.2/v0.3 plans.

## Environment (same machine, already set up)

- `tools/bin/circom.exe` — circom v2.2.2 (gitignored, present on disk)
- `circuits/build/` — compiled `.wasm`/`.zkey`/`vkey`/Solidity verifiers (gitignored, present)
- `circuits/ptau/` — Powers of Tau 2¹⁴ and 2¹⁶ (gitignored, present)
- `.env` — 3 funded Hedera testnet accounts (operator/Account1, Alice, Bob). Gitignored. No HTS test token yet — create one programmatically via `@hashgraph/sdk` `TokenCreateTransaction` for the Phase 6 testnet flow.
- `vendor/zeto/` — upstream Zeto submodule, pinned v0.2.2.

## Conventions & gotchas (learned the hard way)

- **Solidity `^0.8.27`, `evmVersion: "cancun"`** (required — OZ `Arrays.sol` uses `mcopy`; Hedera supports Cancun). Already set in `hardhat.config.ts`.
- **Hedera `INSUFFICIENT_TX_FEE`:** set explicit `gasPrice` (1500 gwei, in config) **and** pass explicit `gasLimit` on every tx — this bypasses the relay's `eth_estimateGas`, which is the actual failure point. See `scripts/testnet-deposit-proof.ts` for the pattern.
- **`anon_enc` needs 2¹⁶ ptau**, not the 2¹³ upstream's Makefile claims (snarkjs needs domain ≥ 2× constraints; it has ~20k wires).
- **Our own verifiers:** generate with `snarkjs zkey export solidityverifier`, rename from the default `Groth16Verifier` (name collision), bump pragma to `^0.8.27`. Don't use upstream's committed verifiers (they embed upstream's vkey).
- **`Zeto_AnonEnc` specifics:** `VerifiersInfo` has 9 fields (lock/burn = zero address); public `deposit`/`transfer`/`withdraw` are NOT virtual — override the internal `_deposit`/`_withdraw` (which are); withdraw pays `msg.sender` (no recipient param). It uses NO on-chain Poseidon.
- **UUPS deploy:** `HederaZetoTokenLite` inherits `initialize` from `Zeto_AnonEnc`; pass `unsafeAllow: ["missing-initializer"]` to `upgrades.deployProxy` (OZ plugin static-analysis quirk). See `deploy/02_deploy_lite_pool.ts`.
- **Custom errors only** (no `require("string")`). OZ `contracts-upgradeable` 5.x; abstract mixins reserve `uint256[50] private __gap;`.
- **Tests:** abstract mixins are tested via `TestXxx` concrete subclasses. HTS precompile mocked at `0x167` via `hardhat_setCode` + `hardhat_setStorageAt` (clear storage in `beforeEach`).
- **Git:** local-only (no remote). GPG signing disabled per-repo. `npm test` must stay green before committing a phase.

## Commands

```bash
npm install
npx hardhat compile
npm test                                                       # 85 tests
npx hardhat deploy --tags lite-pool --network hardhat          # local pool deploy
# Testnet v0.1 demo (real HTS token + full shielded flow):
npx hardhat run scripts/phase6-create-token.ts --network hedera_testnet   # one-time: create token, associate, fund
npx hardhat run scripts/demo-mvp-testnet.ts --network hedera_testnet      # deposit -> transfer -> withdraw
```

**Testnet gotcha:** `hardhat deploy` batches txs and trips the Hashio relay's nonce tracking (`NONCE_EXPIRED`). For testnet, deploy with a self-contained ethers script (sequential `await waitForDeployment()` per contract) — see `scripts/demo-mvp-testnet.ts`. Always pass an explicit `gasLimit` (skips `eth_estimateGas`, which the relay rejects with `INSUFFICIENT_TX_FEE`); raw `ethers.Wallet`s also need an explicit `gasPrice` (1500 gwei).
