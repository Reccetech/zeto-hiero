# Rebuilding the Circuit Artifacts

The compiled circuit artifacts (`circuits/build/`) and the Powers-of-Tau files (`circuits/ptau/`) are **gitignored** — they're large and regenerable. A fresh clone can compile contracts and run the mock-based tests, but the **real-proof tests and the tutorial's proof steps (deposit / transfer / withdraw) need these artifacts**. This doc shows how to regenerate them.

> ⚠️ **Read this first — regenerated keys will NOT match the committed verifiers.**
> The trusted setup below uses a fresh, single-party (toy) contribution, so each rebuild produces a **different** proving/verifying key — and therefore a different verifier contract — than the ones committed in `contracts/verifiers/*VerifierMVP.sol` and deployed on testnet. That's expected and fine: a rebuilt set is **internally consistent** (proofs verify against the matching verifier). To use a rebuilt set on-chain you must **redeploy** the regenerated verifiers (the tutorial's deploy step does this). You cannot reproduce the exact committed/deployed verifiers — and you don't need to: v1.0 replaces this whole toy setup with a real multi-party ceremony (see `../ROADMAP.md`).

---

## What gets produced

For each circuit (`deposit`, `withdraw`, `anon_enc`), into `circuits/build/`:

| Artifact | Used by |
|---|---|
| `<name>.r1cs`, `<name>.sym` | the setup step |
| `<name>_js/<name>.wasm` | **witness generation** (`test/lib/zeto-witness.ts`) |
| `<name>_final.zkey` | **proof generation** (`snarkjs.groth16.fullProve`) |
| `<name>_vkey.json` | verification key (reference) |
| `<name>_verifier.sol` | source for the on-chain verifier (renamed → `contracts/verifiers/`) |

The three circuits and the Powers-of-Tau size each needs:

| Circuit | Constraints | Powers of Tau |
|---|---|---|
| `deposit` | 810 | 2¹⁴ |
| `withdraw` | 5,053 | 2¹⁴ |
| `anon_enc` | 16,111 | 2¹⁶ |

(`anon_enc` needs 2¹⁶ even though upstream's Makefile suggests 2¹³ — snarkjs requires the ptau domain to exceed ~2× the constraint count.)

---

## Prerequisites

- **Submodule present** — the circuit *sources* live in the upstream Zeto submodule:
  ```bash
  git submodule update --init --recursive
  ```
- **circom 2.2.2** — the binary at `tools/bin/` is gitignored. Install circom 2.2.2 (see https://docs.circom.io/getting-started/installation/) and make it available as `circom` on your PATH (or drop it at `tools/bin/circom.exe` on Windows). Verify: `circom --version` → `2.2.2`.
- **snarkjs** — already a dev dependency; run via `npx snarkjs` after `npm install`. (Pinned ~0.7.x.)
- **Node 20+**.
- **Powers-of-Tau files** — downloaded in step 1 below.

All commands below are run from the repo root unless noted, in a bash-compatible shell.

---

## Step 1 — Download the Powers-of-Tau files

```bash
mkdir -p circuits/ptau
for n in 14 16; do
  curl -L -o "circuits/ptau/powersOfTau28_hez_final_${n}.ptau" \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${n}.ptau"
done
```

(2¹⁴ is ~1 GB-class small; 2¹⁶ is larger. These are the standard Hermez community Powers-of-Tau.)

## Step 2 — Compile the circuits

Compile from inside the submodule's `circuits/` directory (so `circomlib` and the relative `lib/` includes resolve), writing outputs to the repo's `circuits/build/`:

```bash
REPO="$(pwd)"
mkdir -p "$REPO/circuits/build"
cd vendor/zeto/zkp/circuits
for name in deposit withdraw anon_enc; do
  circom "${name}.circom" --r1cs --wasm --sym -l node_modules -o "$REPO/circuits/build"
done
cd "$REPO"
```

This produces `circuits/build/<name>.r1cs`, `circuits/build/<name>_js/<name>.wasm`, and `circuits/build/<name>.sym` for each.

## Step 3 — Groth16 setup + contribution

```bash
# circuit → ptau size
declare -A PTAU=( [deposit]=14 [withdraw]=14 [anon_enc]=16 )

for name in deposit withdraw anon_enc; do
  ptau="circuits/ptau/powersOfTau28_hez_final_${PTAU[$name]}.ptau"
  npx snarkjs groth16 setup "circuits/build/${name}.r1cs" "$ptau" "circuits/build/${name}_0000.zkey"
  # Single-party toy contribution — fresh randomness each run (NOT a secure ceremony).
  npx snarkjs zkey contribute "circuits/build/${name}_0000.zkey" "circuits/build/${name}_final.zkey" \
    --name="local rebuild" -e="$(head -c 32 /dev/urandom | xxd -p)"
  npx snarkjs zkey export verificationkey "circuits/build/${name}_final.zkey" "circuits/build/${name}_vkey.json"
  npx snarkjs zkey export solidityverifier "circuits/build/${name}_final.zkey" "circuits/build/${name}_verifier.sol"
done
```

At this point witness + proof generation works (`npm test` real-proof paths, and the tutorial proof steps).

## Step 4 — Install the on-chain verifiers

The snarkjs output is a contract named `Groth16Verifier`. Rename each to its MVP name and bump the pragma to match the project (`^0.8.27`), then place it in `contracts/verifiers/`:

```bash
declare -A CONTRACT=( [deposit]=DepositVerifierMVP [withdraw]=WithdrawVerifierMVP [anon_enc]=AnonEncVerifierMVP )

for name in deposit withdraw anon_enc; do
  out="contracts/verifiers/${CONTRACT[$name]}.sol"
  sed -e "s/contract Groth16Verifier/contract ${CONTRACT[$name]}/" \
      -e "s/^pragma solidity .*/pragma solidity ^0.8.27;/" \
      "circuits/build/${name}_verifier.sol" > "$out"
  echo "wrote $out"
done
```

(On Windows/PowerShell, do the same two replacements with `-replace` or your editor. The only required edits are the contract name and the pragma line.)

## Step 5 — Recompile and (re)deploy

```bash
npx hardhat compile
npm test                  # mock + real-proof tests should pass against the rebuilt set
```

To use the rebuilt set on Hedera testnet, **deploy a fresh pool** so it points at your regenerated verifiers (the deploy step deploys the `*VerifierMVP` contracts you just wrote):

```bash
npx hardhat run tutorial/05-deploy-pool.ts --network hedera_testnet
# then steps 06–09 as in the tutorial
```

> A pool deployed by an earlier setup will reject proofs from a rebuilt set (different verifying key), and vice-versa. Always deploy + transact within a single, consistent build.

---

## One-shot convenience

The steps above as a single script (assumes circom 2.2.2 on PATH, submodule initialised, run from repo root):

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$(pwd)"
declare -A PTAU=( [deposit]=14 [withdraw]=14 [anon_enc]=16 )
declare -A CONTRACT=( [deposit]=DepositVerifierMVP [withdraw]=WithdrawVerifierMVP [anon_enc]=AnonEncVerifierMVP )

mkdir -p circuits/ptau circuits/build
for n in 14 16; do
  f="circuits/ptau/powersOfTau28_hez_final_${n}.ptau"
  [ -f "$f" ] || curl -L -o "$f" "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${n}.ptau"
done

( cd vendor/zeto/zkp/circuits && for name in deposit withdraw anon_enc; do
    circom "${name}.circom" --r1cs --wasm --sym -l node_modules -o "$REPO/circuits/build"
  done )

for name in deposit withdraw anon_enc; do
  ptau="circuits/ptau/powersOfTau28_hez_final_${PTAU[$name]}.ptau"
  npx snarkjs groth16 setup "circuits/build/${name}.r1cs" "$ptau" "circuits/build/${name}_0000.zkey"
  npx snarkjs zkey contribute "circuits/build/${name}_0000.zkey" "circuits/build/${name}_final.zkey" \
    --name="local rebuild" -e="$(head -c 32 /dev/urandom | xxd -p)"
  npx snarkjs zkey export verificationkey "circuits/build/${name}_final.zkey" "circuits/build/${name}_vkey.json"
  npx snarkjs zkey export solidityverifier "circuits/build/${name}_final.zkey" "circuits/build/${name}_verifier.sol"
  sed -e "s/contract Groth16Verifier/contract ${CONTRACT[$name]}/" \
      -e "s/^pragma solidity .*/pragma solidity ^0.8.27;/" \
      "circuits/build/${name}_verifier.sol" > "contracts/verifiers/${CONTRACT[$name]}.sol"
done

npx hardhat compile
echo "Rebuild complete. Redeploy the pool (tutorial/05) to use the regenerated verifiers."
```

---

## Why the committed verifiers can't be reproduced bit-for-bit

Groth16 proving/verifying keys depend on the random entropy contributed during `zkey contribute`. The original v0.1 setup's entropy was not preserved (deliberately — it's a throwaway toy setup), so a rebuild necessarily yields different keys. This is acceptable for the MVP: the committed verifiers exist only to demonstrate the flow on testnet. The production path (v1.0) discards all of this and runs a real, multi-party, auditable Powers-of-Tau + Phase-2 ceremony whose transcript *is* preserved and verifiable. See [`../ROADMAP.md`](../ROADMAP.md) and [`../RELEASE-NOTES.md`](../RELEASE-NOTES.md).
