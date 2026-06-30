# zeto-hiero

Zeto privacy pool for Hedera Smart Contract Service. Hyperledger Labs Zeto + Hedera-specific contracts, circuits, and tooling.

## Documents

All prose lives in [`docs/`](docs/):

- **Overview:** [docs/overview.md](docs/overview.md) — architecture, how it works (incl. the privacy model in §2), performance, roadmap
- **Tutorial:** [docs/tutorial.md](docs/tutorial.md) — transaction-by-transaction HTS-FT walkthrough (runnable scripts in [`examples/walkthrough/`](examples/walkthrough/))
- **Multi-asset tutorials:** [docs/tutorials-multi-asset.md](docs/tutorials-multi-asset.md) — shielding each asset type: HTS FT, ERC-20 FT, HTS NFT, ERC-721 NFT
- **Run results:** [v0.1](docs/run-results.md) · [v0.2 KYC](docs/run-results-v0.2-kyc.md) · [v0.3 sanctions](docs/run-results-v0.3-sanctions.md) · [v0.4 confidential](docs/run-results-v0.4-confidential.md) · [v0.5 multi-asset](docs/run-results-v0.5-multi-asset.md) — captured testnet runs (entities, HashScan links, gas, fees)
- **Operator runbook:** [docs/operator-runbook.md](docs/operator-runbook.md) — deploy, enroll, rotate sanctions/authority keys, pause, upgrade, mainnet gates
- **Ceremony:** [docs/ceremony.md](docs/ceremony.md) — the v1.0 multi-party trusted-setup process (not yet run)
- **Rebuild circuits:** [docs/rebuild-circuits.md](docs/rebuild-circuits.md) — regenerate the (gitignored) proving keys + verifiers from a fresh clone
- **Release notes:** [docs/release-notes.md](docs/release-notes.md)
- **Privacy strategy:** [docs/privacy-strategy.md](docs/privacy-strategy.md) — proposed Hedera privacy approach and how this project fits

## Status

**v0.5 (multi-asset) complete** — all four asset classes shielded on Hedera testnet with real ZK
proofs: **HTS FT, ERC-20 FT, HTS NFT, ERC-721 NFT**. Fungible pools (`HederaZetoToken`) carry the full
v0.4 compliance stack (KYC + sanctions + authority-decryptable audit + HCS); NFT pools
(`HederaZetoNFT`) provide basic shielding (anonymity + nullifier double-spend). **v1.0 (ceremony +
audit + mainnet) is staged but not executed** — it requires a multi-party trusted setup, a third-party
audit, and Besu ≥ 25.3.0 on mainnet. See [docs/release-notes.md](docs/release-notes.md).

## Quick start

```bash
# Install dependencies
npm install

# Verify Hedera testnet RPC connectivity
npm run check:connection

# Run the test suite
npm test
```

## Repo layout

| Path | Purpose |
|---|---|
| `docs/` | All prose: overview, tutorial, run-results, rebuild-circuits, release-notes, privacy-strategy |
| `contracts/hedera/` | Hedera Solidity: pools `HederaZetoTokenLite` (v0.1) → `HederaZetoTokenKyc` (v0.2) → `HederaZetoTokenKycSanctions` (v0.3) → `HederaZetoToken` (v0.4, production), + HTS bridge, KYC registry, sanctions module, vkey-setter |
| `contracts/verifiers/` | Generated Groth16 verifiers (deposit, anon_enc, withdraw, KYC, sanctions, and the v0.4 non-repudiation transfer) |
| `circuits/sources/` | Authored circuits (v0.3 sanctions, v0.4 `anon_enc_nullifier_kyc_sanctions_non_repudiation`) |
| `sdk/` | `@hiero-privacy/zeto-sdk` — scanners (recipient + authority audit), sanctions path builder, authority-key custody (Shamir), HCS audit codec |
| `contracts/test/` | Test-only mocks + harness contracts |
| `circuits/` | Circuit build artifacts (`build/`, `ptau/`) — gitignored; regenerate via `docs/rebuild-circuits.md` |
| `deploy/` | hardhat-deploy scripts (verifiers, vkey-setter, lite-pool) |
| `scripts/` | Operational + testnet scripts (token setup, demo, connectivity checks) |
| `examples/walkthrough/` | Runnable per-transaction tutorial scripts (01–09 + `_zeto.ts`) |
| `test/` | Test suite (unit + integration + real-proof) + `lib/zeto-witness.ts` |
| `vendor/zeto/` | Upstream Zeto submodule (pinned v0.2.2) |

## License

Apache 2.0 — same as upstream Zeto.
