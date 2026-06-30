# Run Results — v0.2 KYC Shielded Pool (Hedera testnet)

**Date:** 2026-06-30 · **Network:** Hedera testnet (chain 296) · **Outcome:** ✅ full KYC deposit → transfer → withdraw succeeded

This is the v0.2 counterpart to [run-results.md](run-results.md) (v0.1). It exercises `HederaZetoTokenKyc`
(upstream `Zeto_AnonEncNullifierKyc` + our `ZetoHTSBridge`): the pool now enforces **KYC identity
membership** on every transfer and prevents double-spends with an on-chain **nullifier SMT**.

Operator/treasury = `0.0.7628788` (`0x17C137c42789D758Cb8c777DF29b656ff90a43C2`). Alice and Bob reuse the
HTS accounts and ZUSD-TEST token from the v0.1 run (Alice started this run with 900 ZUSD-TEST, Bob with 40
left over from v0.1). Their BabyJubJub KYC keypairs are freshly generated per run. Private keys live in
`.env` (gitignored).

Run with: `npx hardhat run scripts/demo-v02-kyc-testnet.ts --network hedera_testnet`

---

## Deployed contracts

| Entity | Address | HashScan |
|---|---|---|
| `PoseidonUnit2L` | `0xAAd471B9B28A811F04A402B3AB6AaE63A206C6eD` | [contract](https://hashscan.io/testnet/contract/0xAAd471B9B28A811F04A402B3AB6AaE63A206C6eD) |
| `PoseidonUnit3L` | `0x0e5855e48FD07f586364fD26Bf726672987cae75` | [contract](https://hashscan.io/testnet/contract/0x0e5855e48FD07f586364fD26Bf726672987cae75) |
| `SmtLib` | `0x9E7F80A366BdbdFDB56b71C4daB7714c4Ead61A6` | [contract](https://hashscan.io/testnet/contract/0x9E7F80A366BdbdFDB56b71C4daB7714c4Ead61A6) |
| KYC transfer verifier | `0xD5DFbDFc1bE2d54Dfc43E5bA5c0680502f0eca57` | [contract](https://hashscan.io/testnet/contract/0xD5DFbDFc1bE2d54Dfc43E5bA5c0680502f0eca57) |
| deposit verifier | `0xAA21132480ADFf3807B078D4D048397a849fB440` | [contract](https://hashscan.io/testnet/contract/0xAA21132480ADFf3807B078D4D048397a849fB440) |
| nullifier-withdraw verifier | `0xAe856245416Bb2882BAd2e76EFcB038063b6207e` | [contract](https://hashscan.io/testnet/contract/0xAe856245416Bb2882BAd2e76EFcB038063b6207e) |
| **pool** (`HederaZetoTokenKyc`, UUPS proxy) | `0xed8661D592A88A81382996ea17e4323bA64Df8df` | [contract](https://hashscan.io/testnet/contract/0xed8661D592A88A81382996ea17e4323bA64Df8df) |

The KYC variant links the three Poseidon/SmtLib libraries (it maintains on-chain Sparse Merkle Trees for
both UTXO commitments and KYC identities). v0.1 needed none of these.

- `setupHTS(token)` — tx `0x6a93b3a2ec8cc07b06c0dfa50fc0f8954e7202bb42364f4ab27fafb87180d473` · gas **783,380** · [HashScan](https://hashscan.io/testnet/transaction/0x6a93b3a2ec8cc07b06c0dfa50fc0f8954e7202bb42364f4ab27fafb87180d473)

---

## Step 0 — KYC enrollment (`register`)

The owner registers Alice's and Bob's BabyJubJub public keys in the pool's embedded identities SMT. The
off-chain identities root computed by the witness helper **matched the on-chain `getIdentitiesRoot()`** —
the prerequisite for any transfer proof to verify.

- Register Alice — tx `0xa5fb5c18a26cd1c468003b896436612211dc092f5045369577474da03dcb87fa` · gas **341,515** · [HashScan](https://hashscan.io/testnet/transaction/0xa5fb5c18a26cd1c468003b896436612211dc092f5045369577474da03dcb87fa)
- Register Bob — tx `0xe9a1df919de765d7c706fb590106eb24bdf869747dda06ab6f53f8e9c7effe6d` · gas **705,538** · [HashScan](https://hashscan.io/testnet/transaction/0xe9a1df919de765d7c706fb590106eb24bdf869747dda06ab6f53f8e9c7effe6d)

> Bob's registration costs ~2× Alice's: the first leaf goes into an empty SMT, while the second splits a
> node and adds a sibling, so it touches more storage.

---

## Step 1 — Deposit (public → shielded)

Alice deposits 100; the pool mints a shielded commitment into the on-chain UTXO SMT. The off-chain UTXO
root **matched `getRoot()`** after the deposit.

- Deposit — tx `0x5f4160d91cb515f88b4b1809154552ea9f1a8017ad0acf128a8876d2b631d85f` · gas **652,175** · proof **17,301 ms** · [HashScan](https://hashscan.io/testnet/transaction/0x5f4160d91cb515f88b4b1809154552ea9f1a8017ad0acf128a8876d2b631d85f)
- Post-state: pool token balance = **100**, `shieldedSupply` = **100**.

---

## Step 2 — Private KYC transfer (shielded → shielded)

Alice spends her 100-note → **40 to Bob + 60 change to Alice**. The transfer proof additionally proves
(a) the spent UTXO is in the commitments SMT (via a nullifier), and (b) the sender and **both** output
owners are registered in the identities SMT. Amounts and the Alice→Bob link stay hidden on-chain; Bob
recovered his note by decrypting the event (`value=40`).

- Transfer — tx `0x519732b5409dde971471a32b2336612183d3512e156d0e61a38d7106ebfb84b4` · gas **1,751,073** · proof **8,578 ms** · [HashScan](https://hashscan.io/testnet/transaction/0x519732b5409dde971471a32b2336612183d3512e156d0e61a38d7106ebfb84b4)

---

## Step 3 — Withdraw (shielded → public)

Bob spends his 40-note (a nullifier withdraw); the pool burns the commitment and sends 40 real HTS units
to Bob.

- Withdraw — tx `0xf65dbd7d38916eae433c34717a19a7857f7e2ebc4cb2f4e13183ee13f5f7dbd0` · gas **1,009,179** · proof **7,700 ms** · [HashScan](https://hashscan.io/testnet/transaction/0xf65dbd7d38916eae433c34717a19a7857f7e2ebc4cb2f4e13183ee13f5f7dbd0)

---

## Reconcile

```
Alice=800  Bob=80  pool=60  shieldedSupply=60
```

✅ Invariant holds: **`shieldedSupply == pool token balance == 60`**. Value is conserved per the protocol:
Alice spent 100 of her public balance (900 → 800); of that, 40 became Bob's note (which he withdrew →
his public balance 40 → 80) and 60 remains shielded as Alice's note (held by the pool). The script's naive
`Alice+Bob+pool` check reads 940 rather than 900 only because **Bob carried a 40-token balance from the
v0.1 run** — not a protocol discrepancy (deposit 100 = Bob's withdrawn 40 + pool's still-shielded 60).

---

## Gas & latency summary

| Operation | v0.2 gas | v0.1 gas | Δ | Proof gen |
|---|---:|---:|---|---:|
| `register` (Alice / Bob) | 341,515 / 705,538 | — (new) | new | — |
| `setupHTS` | 783,380 | 783,314 | ≈ | — |
| deposit | 652,175 | 325,347 | +2.0× | 17,301 ms |
| transfer | 1,751,073 | 415,930 | +4.2× | 8,578 ms |
| withdraw | 1,009,179 | 330,404 | +3.1× | 7,700 ms |

The gas increases over v0.1 are expected: every KYC deposit/transfer/withdraw now performs **on-chain
Sparse-Merkle-Tree insertions** (Poseidon hashing up a 64-level tree) and verifies a **larger Groth16
proof** (19 public signals for the transfer vs 15 in v0.1, plus nullifier checks). This is the
cost of double-spend prevention + KYC enforcement.

---

## Approximate fees (USD)

Unlike the v0.1 record (mirror-node actuals), these are **derived from gas** using the effective gas price
observed in the v0.1 run (`setupHTS` 783,314 gas cost 0.83031 HBAR ⇒ ≈ 1.060 ×10⁻⁶ HBAR/gas) at the same
exchange rate (**$0.080350 / HBAR**). Treat as estimates (±, exclude contract-deploy txs).

| Step | Transaction | Gas | Fee (HBAR, approx) | Fee (USD, approx) |
|---|---|---:|---:|---:|
| 0 | Register Alice | 341,515 | 0.3620 | $0.0291 |
| 0 | Register Bob | 705,538 | 0.7479 | $0.0601 |
| — | setupHTS | 783,380 | 0.8304 | $0.0667 |
| 1 | deposit | 652,175 | 0.6913 | $0.0555 |
| 2 | transfer | 1,751,073 | 1.8562 | $0.1491 |
| 3 | withdraw | 1,009,179 | 1.0697 | $0.0860 |
| | **Total (operations)** | | **5.5575** | **$0.4466** |

The shielded transfer is the most expensive operation at ~$0.15 — still well within enterprise tolerances,
and the proof *generation* (the heavy part) happens client-side, off-chain.

---

## What this run proves

- The full **KYC-gated** shielded flow works on Hedera testnet with **real Groth16 proofs** against the
  larger `anon_enc_nullifier_kyc` (2¹⁸ ptau) and `withdraw_nullifier` circuits.
- The **embedded on-chain KYC registry** works: off-chain and on-chain identity roots agree, and the
  transfer circuit's membership proof verifies on-chain.
- **Nullifiers** prevent double-spends (verified locally in `test/kyc-real-proof.test.ts`).
- The `ZetoHTSBridge` custody + shielded-supply invariant carry over unchanged from v0.1.

---

## Entity quick-reference

| Entity | ID / address |
|---|---|
| Operator / treasury | `0.0.7628788` / `0x17C137c42789D758Cb8c777DF29b656ff90a43C2` |
| Token (ZUSD-TEST) | `0.0.9277599` / `0x00000000000000000000000000000000008d909f` |
| Pool (`HederaZetoTokenKyc`, UUPS proxy) | `0xed8661D592A88A81382996ea17e4323bA64Df8df` |
| KYC transfer verifier | `0xD5DFbDFc1bE2d54Dfc43E5bA5c0680502f0eca57` |
| deposit verifier | `0xAA21132480ADFf3807B078D4D048397a849fB440` |
| nullifier-withdraw verifier | `0xAe856245416Bb2882BAd2e76EFcB038063b6207e` |
| Poseidon2 / Poseidon3 / SmtLib | `0xAAd4…C6eD` / `0x0e58…ae75` / `0x9E7F…61A6` |
