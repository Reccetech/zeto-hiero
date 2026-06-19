# Release Notes

All notable changes to **zeto-hiero** relative to upstream Zeto are documented here. This project
is a Hedera deployment of [Hyperledger Labs **Zeto**](https://github.com/hyperledger-labs/zeto) —
it does **not** fork or modify upstream; it vendors upstream unchanged and builds Hedera-specific
contracts, tooling, and docs *on top* of it.

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
