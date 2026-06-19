# Zeto-Hiero Shielded Pool — Tutorial Scripts

Per-transaction TypeScript files for the walkthrough in
[`TUTORIAL-Zeto-Hiero-Shielded-Pool.md`](TUTORIAL-Zeto-Hiero-Shielded-Pool.md). They live **inside
the `zeto-hiero` repo** (`zeto-hiero/tutorial/`) so every import — Hardhat, the compiled
artifacts, the witness helpers in `../test/lib/zeto-witness.ts`, and the SDK — resolves and the
scripts actually run.

Each file is **self-contained** for its config: it loads `../.env`, builds its own client/signer,
runs one transaction, and prints status + Transaction ID/hash + a HashScan URL.

## Files

| File | Transaction | How to run |
|---|---|---|
| `01-create-accounts.ts` | `AccountCreateTransaction` (Alice, Bob) | `npx ts-node tutorial/01-create-accounts.ts` |
| `02-create-token.ts` | `TokenCreateTransaction` (writes `TOKEN_ID`/`UNDERLYING_TOKEN_ADDRESS` to `.env`) | `npx ts-node tutorial/02-create-token.ts` |
| `03-associate-token.ts` | `TokenAssociateTransaction` | `npx ts-node tutorial/03-associate-token.ts` |
| `04-fund-alice.ts` | `TransferTransaction` | `npx ts-node tutorial/04-fund-alice.ts` |
| `05-deploy-pool.ts` | deploy verifiers + UUPS pool + `setupHTS` | `npx hardhat run tutorial/05-deploy-pool.ts --network hedera_testnet` |
| `06-deposit.ts` | `approve` + `deposit` (+ proof) | `npx hardhat run tutorial/06-deposit.ts --network hedera_testnet` |
| `07-transfer.ts` | private `transfer` (+ proof, event decrypt) | `npx hardhat run tutorial/07-transfer.ts --network hedera_testnet` |
| `08-withdraw.ts` | `withdraw` (+ proof) | `npx hardhat run tutorial/08-withdraw.ts --network hedera_testnet` |
| `09-reconcile.ts` | `balanceOf` + `shieldedSupply` | `npx hardhat run tutorial/09-reconcile.ts --network hedera_testnet` |

`_zeto.ts` is a shared helper (not a step): it persists each user's BabyJubJub keypair and the
spendable notes to `.tutorial-state.json`, so notes reconstruct identically across the separate
step processes. `.tutorial-state.json` is gitignored throwaway state.

## Two layers, two tools

- **Steps 1–4** are native HTS actions via the **Hiero JS SDK** (`@hiero-ledger/sdk`). They talk
  straight to consensus nodes and need only the SDK + `dotenv` — run them with `ts-node`.
- **Steps 5–9** are EVM smart-contract actions that carry ZK proofs and deploy a **UUPS proxy**,
  so they run through **`ethers` + Hardhat** (same code path as `scripts/demo-mvp-testnet.ts`) and
  must be launched with `npx hardhat run ... --network hedera_testnet`.

## Prerequisites

From the repo root (`zeto-hiero/`):

```bash
npm install                 # installs @hiero-ledger/sdk, hardhat, ethers, witness deps, ...
npx hardhat compile         # produces the artifacts the deploy step reads (cancun EVM target)
# circuits/build/ must contain the compiled .wasm/.zkey (proving keys) — gitignored;
# regenerate from a fresh clone via ../circuits/REBUILD.md
```

`.env` (at `zeto-hiero/.env`) must have: `HEDERA_OPERATOR_ACCOUNT_ID`,
`HEDERA_OPERATOR_PRIVATE_KEY_HEX`, `ALICE_*`, `BOB_*`. Steps 02–09 also use `TOKEN_ID` /
`UNDERLYING_TOKEN_ADDRESS` (written by step 02).

## Run the whole flow

```bash
# Native HTS setup (Hiero JS SDK)
npx ts-node tutorial/01-create-accounts.ts   # paste the printed ALICE_/BOB_ lines into ./.env
npx ts-node tutorial/02-create-token.ts      # writes TOKEN_ID + UNDERLYING_TOKEN_ADDRESS
npx ts-node tutorial/03-associate-token.ts
npx ts-node tutorial/04-fund-alice.ts

# Shielded flow (ethers + Hardhat)
npx hardhat run tutorial/05-deploy-pool.ts --network hedera_testnet
npx hardhat run tutorial/06-deposit.ts     --network hedera_testnet
npx hardhat run tutorial/07-transfer.ts    --network hedera_testnet
npx hardhat run tutorial/08-withdraw.ts    --network hedera_testnet
npx hardhat run tutorial/09-reconcile.ts   --network hedera_testnet
```

> Prefer one shot? The repo's combined scripts do steps 1–4 (`scripts/phase6-create-token.ts`)
> and 5–9 (`scripts/demo-mvp-testnet.ts`) in a single process each. These per-step files split the
> same logic so you can run and inspect one transaction at a time.
