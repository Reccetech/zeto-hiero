# zeto-hiero

Zeto privacy pool for Hedera Smart Contract Service. Hyperledger Labs Zeto + Hedera-specific contracts, SDK, and deployment tooling.

## Documents

- **Product spec:** [PRD-Zeto-Hiero.md](../Privacy%20Proposal/PRD-Zeto-Hiero.md) — full design (contracts, circuits, SDK, ceremony, operations)
- **Build plan:** [BUILD-PLAN-Zeto-Hiero.md](../Privacy%20Proposal/BUILD-PLAN-Zeto-Hiero.md) — phase-by-phase implementation checklist

## Status

Phase 0 — bootstrap (in progress).

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
