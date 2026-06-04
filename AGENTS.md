# AGENTS.md — Zeto-Hiero handoff for AI coding agents

You are continuing work on **zeto-hiero**, a privacy-preserving token pool for Hedera (a Hedera deployment of Hyperledger Labs **Zeto**, the ZK UTXO token toolkit). Read this first, then the docs below.

## Read these, in order

All live in the parent folder `../` (i.e. `C:/repos/Privacy Proposal/`):

1. **`../MVP-Zeto-Hiero.md`** — architecture, how it works, performance, roadmap. Start here for the big picture.
2. **`../BUILD-PLAN-MVP-Zeto-Hiero.md`** — the active work checklist (v0.1). The **Status:** line at the top says exactly where we are. Phases are checkbox-tracked.
3. **`../PRD-Zeto-Hiero.md`** — full production design spec (≈6,000 lines). Reference it via `§` section numbers cited in the build plan; don't read end-to-end.
4. **`../BUILD-PLAN-Zeto-Hiero.md`** — the full production roadmap (v0.2 → v1.0), for context beyond the MVP.

## Where we are (2026-06-01)

MVP v0.1, Phases 0–4 complete; **Phase 5 partial**. 12 commits on local `main`, **84 tests passing**.

- Built & tested: `HederaZetoTokenLite` (the pool = upstream `Zeto_AnonEnc` + our `ZetoHTSBridge`), plus foundation contracts (`SanctionsModule`, `HederaKycRegistry`, `ZetoVkeySetter`) that aren't wired into v0.1 yet.
- **Proven on real Hedera testnet:** a real Groth16 **deposit** proof verified on-chain (~276K gas, ~0.27 HBAR). See `scripts/testnet-deposit-proof.ts`.

## Your next task (completes v0.1)

**Phase 5 finish → Phase 6.** Run the full pool-level `deposit → transfer → withdraw` with real proofs, locally first, then on testnet.

The blocking piece is the **transfer (`anon_enc`) witness**: each output note must be ECDH-encrypted to the recipient's BabyJubJub public key (with an encryption nonce + Poseidon-derived shared secret). Two paths:

- **Recommended first attempt:** hand-roll the ECDH encryption with `circomlibjs` (already a dependency, no native build). Mirror what upstream's `zeto-js` does in `vendor/zeto/zkp/js/lib/util.js` (`newEncryptionNonce`, `poseidonDecrypt`, etc.).
- **Fallback:** install upstream `zeto-js` (`file:vendor/zeto/zkp/js`) + `maci-crypto`. ⚠️ `maci-crypto` has native dependencies that are painful on Windows — only go here if the hand-rolled path stalls.

Then drive `pool.deposit() → pool.transfer() → pool.withdraw()` and assert balances reconcile (Alice + Bob + pool = constant). The deposit half is already proven; transfer + withdraw complete it. The `anon_enc` transfer circuit is ~20× the deposit circuit, so capture its on-chain verification gas — that number is still unknown.

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
npm test                                                    # 84 tests
npx hardhat run scripts/testnet-deposit-proof.ts --network hedera_testnet   # the proven deposit demo
npx hardhat deploy --tags lite-pool --network hardhat       # local pool deploy
```
