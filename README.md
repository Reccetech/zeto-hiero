# zeto-hiero

Zeto privacy pool for Hedera Smart Contract Service. Hyperledger Labs Zeto + Hedera-specific contracts, circuits, and tooling.

## Documents

All prose lives in [`docs/`](docs/):

- **Overview:** [docs/overview.md](docs/overview.md) — architecture, how it works (incl. the privacy model in §2), performance, roadmap
- **Tutorial:** [docs/tutorial.md](docs/tutorial.md) — transaction-by-transaction walkthrough (runnable scripts in [`examples/walkthrough/`](examples/walkthrough/))
- **Run results:** [docs/run-results.md](docs/run-results.md) (v0.1) · [docs/run-results-v0.2-kyc.md](docs/run-results-v0.2-kyc.md) (v0.2 KYC) — captured testnet runs (entities, HashScan links, gas, fees)
- **Rebuild circuits:** [docs/rebuild-circuits.md](docs/rebuild-circuits.md) — regenerate the (gitignored) proving keys + verifiers from a fresh clone
- **Release notes:** [docs/release-notes.md](docs/release-notes.md)
- **Privacy strategy:** [docs/privacy-strategy.md](docs/privacy-strategy.md) — proposed Hedera privacy approach and how this project fits

## Status

**v0.2 (KYC) complete** — KYC-gated shielded deposit/transfer/withdraw with nullifier double-spend
prevention, proven on Hedera testnet with real ZK proofs. v0.1 (MVP, `Zeto_AnonEnc`) remains available.
See [docs/release-notes.md](docs/release-notes.md).

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
| `contracts/hedera/` | Hedera-specific Solidity (v0.1 `HederaZetoTokenLite` + v0.2 `HederaZetoTokenKyc`, HTS bridge, KYC registry, sanctions, vkey-setter) |
| `contracts/verifiers/` | Generated Groth16 verifiers (v0.1: Deposit/AnonEnc/Withdraw; v0.2: AnonEncNullifierKyc/WithdrawNullifier) |
| `contracts/test/` | Test-only mocks + harness contracts |
| `circuits/` | Circuit build artifacts (`build/`, `ptau/`) — gitignored; regenerate via `docs/rebuild-circuits.md` |
| `deploy/` | hardhat-deploy scripts (verifiers, vkey-setter, lite-pool) |
| `scripts/` | Operational + testnet scripts (token setup, demo, connectivity checks) |
| `examples/walkthrough/` | Runnable per-transaction tutorial scripts (01–09 + `_zeto.ts`) |
| `test/` | Test suite (unit + integration + real-proof) + `lib/zeto-witness.ts` |
| `vendor/zeto/` | Upstream Zeto submodule (pinned v0.2.2) |

## License

Apache 2.0 — same as upstream Zeto.
