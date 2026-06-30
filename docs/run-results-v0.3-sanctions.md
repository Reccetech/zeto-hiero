# Run Results — v0.3 KYC + Sanctions Shielded Pool (Hedera testnet)

**Date:** 2026-06-30 · **Network:** Hedera testnet (chain 296) · **Outcome:** ✅ KYC enrollment → set sanctions root → deposit → sanctions-screened transfer succeeded

The v0.3 counterpart to [run-results-v0.2-kyc.md](run-results-v0.2-kyc.md). Exercises `HederaZetoTokenKycSanctions`
(upstream `Zeto_AnonEncNullifierKyc` + `ZetoHTSBridge` + `SanctionsModule`): every screened transfer carries a
ZK **non-inclusion** proof that each spent nullifier is absent from an on-chain sanctions Sparse Merkle Tree
root — the PPOI (Proof of Proof of Innocence) equivalent — on top of v0.2's KYC membership + nullifier
double-spend prevention.

Operator/treasury = `0.0.7628788` (`0x17C137c42789D758Cb8c777DF29b656ff90a43C2`). Alice & Bob reuse the v0.1/v0.2
HTS accounts and ZUSD-TEST token; BabyJubJub keys are generated per run. Private keys live in `.env` (gitignored).

Run with: `npx hardhat run scripts/demo-v03-sanctions-testnet.ts --network hedera_testnet`

---

## Deployed contracts

| Entity | Address | HashScan |
|---|---|---|
| `PoseidonUnit2L` | `0x15d66308178b715376f2F9c6434363BD3Bac8F3d` | [contract](https://hashscan.io/testnet/contract/0x15d66308178b715376f2F9c6434363BD3Bac8F3d) |
| `PoseidonUnit3L` | `0xEfeFf7Fc2532c13174db2C3E5Bfe6D0e6a27fd59` | [contract](https://hashscan.io/testnet/contract/0xEfeFf7Fc2532c13174db2C3E5Bfe6D0e6a27fd59) |
| `SmtLib` | `0x8539347f9F872064A79bb2C5E2D62F94909A4660` | [contract](https://hashscan.io/testnet/contract/0x8539347f9F872064A79bb2C5E2D62F94909A4660) |
| sanctions transfer verifier (`uint[20]`) | `0xC9F24879df4DEDa444b4A54996243785a5506277` | [contract](https://hashscan.io/testnet/contract/0xC9F24879df4DEDa444b4A54996243785a5506277) |
| deposit verifier | `0x4150F99716a07c2B92b45eA7Cb170ea89eF6Fbdb` | [contract](https://hashscan.io/testnet/contract/0x4150F99716a07c2B92b45eA7Cb170ea89eF6Fbdb) |
| nullifier-withdraw verifier | `0xC79e49f882032eeD432B7c5d73025dcCCc890c52` | [contract](https://hashscan.io/testnet/contract/0xC79e49f882032eeD432B7c5d73025dcCCc890c52) |
| **pool** (`HederaZetoTokenKycSanctions`, UUPS proxy) | `0xe47b3Bd5Ae7B71882E47104f66FdF5cE928E56Ce` | [contract](https://hashscan.io/testnet/contract/0xe47b3Bd5Ae7B71882E47104f66FdF5cE928E56Ce) |

- `setupHTS(token)` — tx `0x17f4a1e0f9fe3e53d265e6e59b732d2a578edad835fc854925458ed5454b118a` · gas **783,446** · [HashScan](https://hashscan.io/testnet/transaction/0x17f4a1e0f9fe3e53d265e6e59b732d2a578edad835fc854925458ed5454b118a)

---

## Step 0 — KYC enrollment + sanctions root

Register Alice & Bob (embedded KYC registry); off-chain identities root **matched on-chain `getIdentitiesRoot()`**. Then publish the sanctions root: an OFAC-style SMT of sanctioned keys (dummy entries for the demo — none are Alice or Bob), stored on-chain via `updateSanctionsMerkleRoot`.

- Register Alice — tx `0x6fef5529f642c5116c78f3efca2db0305e0474b6b6a3a43677ac851629009989` · gas **341,647** · [HashScan](https://hashscan.io/testnet/transaction/0x6fef5529f642c5116c78f3efca2db0305e0474b6b6a3a43677ac851629009989)
- Register Bob — tx `0xdaecf443db39de0f963705ce8cd91b03121be6833b258f95b561a63c1157b217` · gas **622,580** · [HashScan](https://hashscan.io/testnet/transaction/0xdaecf443db39de0f963705ce8cd91b03121be6833b258f95b561a63c1157b217)
- Set sanctions root — tx `0x6ee5e054da3231d03919ba430e1d7a4983dd90fc8bdca1351471279d8d511b2f` · gas **75,230** · [HashScan](https://hashscan.io/testnet/transaction/0x6ee5e054da3231d03919ba430e1d7a4983dd90fc8bdca1351471279d8d511b2f)

---

## Step 1 — Deposit (public → shielded)

Alice deposits 100; off-chain UTXO root **matched `getRoot()`** after the deposit.

- Deposit — tx `0xb7b732ce1bdd8117dd2dfed2171a53ce2eb9f00223fc90e57bcc18ada5a5e323` · gas **652,282** · proof **16,228 ms** · [HashScan](https://hashscan.io/testnet/transaction/0xb7b732ce1bdd8117dd2dfed2171a53ce2eb9f00223fc90e57bcc18ada5a5e323)
- Post-state: `shieldedSupply` = **100**.

---

## Step 2 — Sanctions-screened transfer (shielded → shielded)

Alice spends her 100-note → **40 to Bob + 60 change**, carrying a per-input non-inclusion proof bound to the on-chain sanctions root (`transferScreened`). The proof attests, in zero knowledge, that the spent nullifier is **not** on the sanctions list — without revealing which entries were checked. Bob recovered his note by decrypting the event (`value=40`).

- Screened transfer — tx `0x944946b5fd99d642afd58540dd45c6090f1f0b41c4d9cc76d8746852b10eb8a7` · gas **1,587,534** · proof **16,364 ms** · [HashScan](https://hashscan.io/testnet/transaction/0x944946b5fd99d642afd58540dd45c6090f1f0b41c4d9cc76d8746852b10eb8a7)

---

## Gas & latency summary

| Operation | v0.3 gas | v0.2 gas | Note |
|---|---:|---:|---|
| register (Alice / Bob) | 341,647 / 622,580 | 341,515 / 705,538 | ≈ (KYC unchanged) |
| `updateSanctionsMerkleRoot` | 75,230 | — (new) | cheap — just stores a root |
| `setupHTS` | 783,446 | 783,380 | ≈ |
| deposit | 652,282 | 652,175 | ≈ (deposit circuit unchanged) |
| transfer (screened) | **1,587,534** | 1,751,073 | **≈, even slightly lower** |

**Key result:** adding sanctions screening did **not** materially increase transfer gas (it's actually a touch lower than v0.2's KYC transfer, within normal variation). The non-inclusion proof is verified *inside* the Groth16 proof — on-chain it's just one additional public signal (20 vs 19) in the constant-cost pairing check. The cost moves to **proof generation** (client-side, off-chain) and to a larger circuit (~191k constraints, 2¹⁹ trusted setup), not to on-chain gas. This is the core economic argument for ZK compliance: richer policy, ~flat settlement cost.

---

## Approximate fees (USD)

Derived from gas using the v0.1-observed effective gas price (≈ 1.060 ×10⁻⁶ HBAR/gas) at **$0.080350 / HBAR**.
Estimates; excludes contract-deploy txs.

| Step | Gas | Fee (HBAR, approx) | Fee (USD, approx) |
|---|---:|---:|---:|
| Register Alice | 341,647 | 0.3622 | $0.0291 |
| Register Bob | 622,580 | 0.6600 | $0.0530 |
| Set sanctions root | 75,230 | 0.0798 | $0.0064 |
| setupHTS | 783,446 | 0.8305 | $0.0667 |
| Deposit | 652,282 | 0.6914 | $0.0556 |
| Screened transfer | 1,587,534 | 1.6828 | $0.1352 |
| **Total (operations)** | | **4.3067** | **$0.3461** |

---

## What this run proves

- The **authored** KYC + sanctions circuit (`anon_enc_nullifier_kyc_sanctions`, 2¹⁹ ptau) works on Hedera testnet with **real Groth16 proofs** — there was no upstream circuit for this; it was written for v0.3.
- **Sanctions non-inclusion is enforced cryptographically:** a clean spend verifies; a sanctioned spend cannot even produce a witness (proven in `test/kyc-sanctions-real-proof.test.ts`).
- The **sanctions root is bound** to the proof and managed on-chain by `SanctionsModule` (owner/oracle-updatable); a transfer against a stale root reverts `SanctionsRootMismatch` before the costly verify.
- KYC membership, nullifier double-spend prevention, ECDH note discovery, and the HTS custody/shielded-supply invariant all carry over unchanged from v0.2.

---

## Entity quick-reference

| Entity | ID / address |
|---|---|
| Operator / treasury | `0.0.7628788` / `0x17C137c42789D758Cb8c777DF29b656ff90a43C2` |
| Token (ZUSD-TEST) | `0.0.9277599` / `0x00000000000000000000000000000000008d909f` |
| Pool (`HederaZetoTokenKycSanctions`, UUPS proxy) | `0xe47b3Bd5Ae7B71882E47104f66FdF5cE928E56Ce` |
| sanctions transfer verifier | `0xC9F24879df4DEDa444b4A54996243785a5506277` |
| deposit / withdraw verifiers | `0x4150F9…6Fbdb` / `0xC79e49…0c52` |
| Poseidon2 / Poseidon3 / SmtLib | `0x15d663…8F3d` / `0xEfeFf7…7fd59` / `0x853934…4660` |
