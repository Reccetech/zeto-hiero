# zeto-hiero

Zeto privacy pool for Hedera Smart Contract Service. Hyperledger Labs Zeto + Hedera-specific contracts, SDK, and deployment tooling.

## Documents

- **MVP overview:** [MVP-Zeto-Hiero.md](MVP-Zeto-Hiero.md) — architecture, how it works, performance, roadmap
- **Release notes:** [RELEASE-NOTES.md](RELEASE-NOTES.md)
- **Tutorial:** [tutorial/TUTORIAL-Zeto-Hiero-Shielded-Pool.md](tutorial/TUTORIAL-Zeto-Hiero-Shielded-Pool.md) (runnable walkthrough); the privacy model is in [MVP-Zeto-Hiero.md §2](MVP-Zeto-Hiero.md#2-the-privacy-model--whats-hidden-and-what-isnt)
- **Rebuild circuits:** [circuits/REBUILD.md](circuits/REBUILD.md) — regenerate the (gitignored) proving keys + verifiers from a fresh clone

## Status

v0.1 (MVP) complete — full shielded deposit/transfer/withdraw on Hedera testnet with real ZK proofs. See [RELEASE-NOTES.md](RELEASE-NOTES.md).

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
| `contracts/hedera/` | Hedera-specific Solidity (HTS bridge, sanctions, KYC, pool) |
| `contracts/lib/` | Poseidon libraries (deployed once, linked) |
| `contracts/interfaces/` | Interface contracts (IGroth16Verifier, IHederaKycRegistry) |
| `contracts/verifiers/` | Generated Groth16 verifiers (snarkjs output, gitignored) |
| `contracts/generated/` | Generated public-signal layout constants (build-time) |
| `circuits/sources/` | Circom sources (Hedera-specific circuits) |
| `circuits/build/` | Compiled `.wasm`, `.r1cs`, `.zkey`, `.vkey.json` (gitignored) |
| `sdk/` | `@hiero-privacy/zeto-sdk` TypeScript package |
| `deploy/` | hardhat-deploy scripts (numbered 00–07) |
| `scripts/` | Operational scripts (enroll, update-sanctions-root, pause, etc.) |
| `test/` | Solidity + integration tests |
| `tools/` | Build tools (export-verifiers, gen-public-signal-layouts, gen-authority-constants) |
| `vendor/zeto/` | Upstream Zeto submodule (pinned) |
| `docs/` | Operator runbook, ceremony documentation, gas profile |

## License

Apache 2.0 — same as upstream Zeto.
