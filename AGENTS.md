# AGENTS.md — Zeto-Hiero handoff for AI coding agents

You are continuing work on **zeto-hiero**, a privacy-preserving token pool for Hedera (a Hedera deployment of Hyperledger Labs **Zeto**, the ZK UTXO token toolkit). Read this first, then the docs below.

## Read these, in order

All live in the parent folder `../` (i.e. `C:/repos/Privacy Proposal/`):

1. **`../MVP-Zeto-Hiero.md`** — architecture, how it works, performance, roadmap. Start here for the big picture.
2. **`../TUTORIAL-Zeto-Hiero-Shielded-Pool.md`** — standalone Hedera-tutorial-style walkthrough (9 numbered sections, code + console output for each step, layer table, Code Check). Created 2026-06-10.
3. **`../BUILD-PLAN-MVP-Zeto-Hiero.md`** — the active work checklist (v0.1). The **Status:** line at the top says exactly where we are. Phases are checkbox-tracked.
4. **`../PRD-Zeto-Hiero.md`** — full production design spec (≈6,000 lines). Reference it via `§` section numbers cited in the build plan; don't read end-to-end.
5. **`../BUILD-PLAN-Zeto-Hiero.md`** — the full production roadmap (v0.2 → v1.0), for context beyond the MVP.

## Where we are (2026-06-10)

✅ **MVP v0.1 COMPLETE.** All phases done. ~14 commits on local `main`, **85 tests passing**.

- Built & tested: `HederaZetoTokenLite` (the pool = upstream `Zeto_AnonEnc` + our `ZetoHTSBridge`), plus foundation contracts (`SanctionsModule`, `HederaKycRegistry`, `ZetoVkeySetter`) that aren't wired into v0.1 yet.
- **Full shielded flow proven on Hedera testnet** with a real HTS token: deposit → private transfer → withdraw, balances reconcile (Alice 900 + Bob 40 + pool 60 == 1000). Gas: deposit 325,347 · transfer 415,954 · withdraw 330,392 · setupHTS 783,314. See `scripts/demo-mvp-testnet.ts` + `scripts/phase6-create-token.ts`; HashScan links in `../BUILD-PLAN-MVP-Zeto-Hiero.md` (Phase 6) and `../MVP-Zeto-Hiero.md` §6.1.
- Transfer-witness tooling lives in `test/lib/zeto-witness.ts` (uses `maci-crypto` + `zeto-js`; proofs via `snarkjs.groth16.fullProve` against `circuits/build/`). `maci-crypto` 1.1.1 builds + loads fine on Windows — the native-dep worry didn't materialize.

## Your next task (v0.2 — KYC)

v0.1 is shipped. The next increment is **v0.2 — KYC enforcement** (see `../BUILD-PLAN-Zeto-Hiero.md`):

- Swap `Zeto_AnonEnc` → `Zeto_AnonEncNullifierKyc` (the KYC variant adds a nullifier SMT + identity-membership signals — this pulls in `@iden3/contracts` for `SmtLib`/Poseidon, which v0.1 deliberately skipped).
- Wire in the existing `HederaKycRegistry` (UUPS, already built + tested).
- Extend `test/lib/zeto-witness.ts` for the KYC circuit's witness (nullifiers, merkle proofs, KYC membership). Compile the `anon_enc_nullifier_kyc` circuit (needs 2¹⁶ ptau — already on disk) and stage its verifier the same way we did the v0.1 ones.
- Enroll Alice & Bob, then re-run a demo with KYC active.

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
