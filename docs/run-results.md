# Tutorial Run Results — Zeto-Hiero Shielded Pool (Hedera testnet)

**Date:** 2026-06-18 · **Network:** Hedera testnet (chain 296) · **Outcome:** ✅ all 9 steps succeeded

Run as written, end to end (fresh Alice & Bob accounts created in Step 1). Operator/treasury =
`0.0.7628788` (`0x17C137c42789D758Cb8c777DF29b656ff90a43C2`). Private keys are intentionally
omitted from this record; they live in `.env` (gitignored).

> **Re-validation (2026-06-30).** The shielded-pool flow (Sections 5–9) was re-run on testnet against
> the established ZUSD-TEST token via `scripts/demo-mvp-testnet.ts` to confirm the tutorial still works
> after the v0.2–v0.4 work. Fresh result — pool `0xA47d62c0Dd3d9Ae837Ae90e0a500387Bc43E3997`:
> [setupHTS](https://hashscan.io/testnet/transaction/0xf4182bc6a843730a99248c8dcb14e2927e9b15f3dfecc8ebc070d88acea3a622) 783,314 gas ·
> [deposit](https://hashscan.io/testnet/transaction/0xe103339a30a80f57218be1e759611929b916739121ed70e8fcb6250f5f85f618) 325,335 gas (proof 11.5 s) ·
> [transfer](https://hashscan.io/testnet/transaction/0x51dfea3feccfe438785b0f0873ecbe7dc64a0b18691c7c1f5cc8d03b1e584c9e) 415,870 gas (Bob decrypted value=40) ·
> [withdraw](https://hashscan.io/testnet/transaction/0x749370d1d7d4c0a58e1b0cd39b19b6d55dbfcbeafdf9f5c6ddc509ce774a5bd2) 330,404 gas.
> Invariant held: `shieldedSupply == pool balance == 60`; gas matches the original capture below within
> normal variation. (The naive Alice+Bob+pool sum differs from 1000 only because Alice/Bob carry
> balances from earlier runs — see the [v0.2](run-results-v0.2-kyc.md)/[v0.3](run-results-v0.3-sanctions.md)/[v0.4](run-results-v0.4-confidential.md) results for the compliance-enabled flows.)

---

## Step 1 — Create Accounts (`AccountCreateTransaction`)

| Entity | Account ID | EVM address | HashScan |
|---|---|---|---|
| **Alice** | `0.0.9277590` | `0xcc5d5b9cacd2c5f67f397f170489e614ceb3a194` | [account](https://hashscan.io/testnet/account/0.0.9277590) |
| **Bob** | `0.0.9277592` | `0x87c674b93a708cbe9d5d371d5434b79576ee34a1` | [account](https://hashscan.io/testnet/account/0.0.9277592) |

Each funded with 20 HBAR.

- Create Alice — tx `0.0.7628788@1781820713.917306143` · fee 0.6223 HBAR (**~$0.0500**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820713.917306143)
- Create Bob — tx `0.0.7628788@1781820721.942963137` · fee 0.6223 HBAR (**~$0.0500**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820721.942963137)

---

## Step 2 — Create HTS Token (`TokenCreateTransaction`)

| Entity | Token ID | EVM address | HashScan |
|---|---|---|---|
| **ZUSD-TEST** (8 dp, supply 1,000,000) | `0.0.9277599` | `0x00000000000000000000000000000000008d909f` | [token](https://hashscan.io/testnet/token/0.0.9277599) |

- Token create — tx `0.0.7628788@1781820771.769143823` · fee 12.5701 HBAR (**~$1.0100**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820771.769143823)

---

## Step 3 — Associate Alice & Bob (`TokenAssociateTransaction`)

- Associate Alice — tx `0.0.7628788@1781820785.760884170` · fee 0.6235 HBAR (**~$0.0501**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820785.760884170)
- Associate Bob — tx `0.0.7628788@1781820789.098959427` · fee 0.6235 HBAR (**~$0.0501**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820789.098959427)

---

## Step 4 — Fund Alice (`TransferTransaction`)

Transferred **1,000 base units** of ZUSD-TEST from treasury → Alice.

- Fund Alice — tx `0.0.7628788@1781820804.295288184` · fee 0.0124 HBAR (**~$0.0010**) · [HashScan](https://hashscan.io/testnet/transaction/0.0.7628788@1781820804.295288184)

Public ledger after Step 4: **Alice = 1000**, **Bob = 0**, **treasury = 999,000**.

---

## Step 5 — Deploy Shielded-Pool Service (`ethers` + UUPS proxy)

| Entity | Address | HashScan |
|---|---|---|
| anon_enc verifier | `0x370B80069d8784E2F100968CDdCbe306b15ccFE9` | [contract](https://hashscan.io/testnet/contract/0x370B80069d8784E2F100968CDdCbe306b15ccFE9) |
| deposit verifier | `0x42A6507dEc69c96D354d73e714B26563F9a339B8` | [contract](https://hashscan.io/testnet/contract/0x42A6507dEc69c96D354d73e714B26563F9a339B8) |
| withdraw verifier | `0xF5768CfaC6742a51E39BbE2596ed1322F94d7ED6` | [contract](https://hashscan.io/testnet/contract/0xF5768CfaC6742a51E39BbE2596ed1322F94d7ED6) |
| **pool** (`HederaZetoTokenLite`, UUPS proxy) | `0xa24A9aAEC0495c50194572CCF2bfDc00cf3D229D` | [contract](https://hashscan.io/testnet/contract/0xa24A9aAEC0495c50194572CCF2bfDc00cf3D229D) |

A `MockGroth16Verifier` (batch placeholder) was also deployed. `poolAddr` saved to `examples/walkthrough/.tutorial-state.json`.

- `setupHTS(token)` — tx `0xe58bc767b78fec4d0f3fbdbc20edef5bd98e41cfaa8a396f1130c549911312f8` · gas **783,314** · fee 0.8303 HBAR (**~$0.0667**) · [HashScan](https://hashscan.io/testnet/transaction/0xe58bc767b78fec4d0f3fbdbc20edef5bd98e41cfaa8a396f1130c549911312f8)

---

## Step 6 — Deposit (public → shielded)

Alice deposits 100; pool mints a shielded commitment.

- Deposit — tx `0xf7f7cca1432fddddfb369506f0013c31a3d6f41c8bae0eb378e67d72d6401781` · gas **325,347** · proof **18,585 ms** · fee 0.3449 HBAR (**~$0.0277**) · [HashScan](https://hashscan.io/testnet/transaction/0xf7f7cca1432fddddfb369506f0013c31a3d6f41c8bae0eb378e67d72d6401781)
- Post-state: pool token balance = **100**, `shieldedSupply` = **100**.

---

## Step 7 — Private Transfer (shielded → shielded)

Alice spends her 100-note → **40 to Bob + 60 change**. Amounts and the Alice→Bob link are hidden on-chain; Bob recovered his note by decrypting the event (`value=40`).

- Transfer — tx `0xef181d75443878593d0871654b45456daee4ee6b731b60a5e906db1968d4da7e` · gas **415,930** · proof **41,987 ms** · fee 0.4409 HBAR (**~$0.0354**) · [HashScan](https://hashscan.io/testnet/transaction/0xef181d75443878593d0871654b45456daee4ee6b731b60a5e906db1968d4da7e)

---

## Step 8 — Withdraw (shielded → public)

Bob spends his 40-note; pool burns the commitment and sends 40 real HTS units to Bob.

- Withdraw — tx `0x691fb09f52fa5959c7e5e4a92b50e2f9fcc4ea240b13b0a6bbacf8b1995d8c55` · gas **330,404** · proof **19,877 ms** · fee 0.3502 HBAR (**~$0.0281**) · [HashScan](https://hashscan.io/testnet/transaction/0x691fb09f52fa5959c7e5e4a92b50e2f9fcc4ea240b13b0a6bbacf8b1995d8c55)

---

## Step 9 — Reconcile (EVM reads)

```
Alice=900  Bob=40  pool=60  shieldedSupply=60
reconcile (Alice+Bob+pool) = 1000 (expected 1000)
```

✅ Invariant holds: **`shieldedSupply == pool token balance == 60`**, and total value is conserved (**900 + 40 + 60 = 1000**).

---

## Gas & latency summary

| Operation | Gas used | Proof gen |
|---|---|---|
| `setupHTS` | 783,314 | — |
| deposit | 325,347 | 18,585 ms |
| transfer | 415,930 | 41,987 ms |
| withdraw | 330,404 | 19,877 ms |

Each step ran as a separate process, so every proof was a cold start (proving key loaded fresh).

---

## Charged fees (USD)

Actual `charged_tx_fee` from the mirror node, converted at the network exchange rate in effect
during the run: **cent_equivalent 241049 / hbar_equivalent 30000 ⇒ $0.080350 / HBAR**. The native
operations match Hedera's USD-denominated fee schedule almost exactly (account create $0.05, token
create $1.00, associate $0.05, transfer $0.001); the contract calls vary with gas.

| Step | Transaction | Fee (HBAR) | Fee (USD) |
|---|---|---:|---:|
| 1 | Create Alice | 0.62228010 | $0.0500 |
| 1 | Create Bob | 0.62228010 | $0.0500 |
| 2 | Token create | 12.57005835 | $1.0100 |
| 3 | Associate Alice | 0.62352466 | $0.0501 |
| 3 | Associate Bob | 0.62352466 | $0.0501 |
| 4 | Fund Alice | 0.01244559 | $0.0010 |
| 5 | setupHTS | 0.83031284 | $0.0667 |
| 6 | deposit | 0.34486782 | $0.0277 |
| 7 | transfer | 0.44088580 | $0.0354 |
| 8 | withdraw | 0.35022824 | $0.0281 |
| | **Total** | **17.04040816** | **$1.3692** |

> Excludes the four verifier/pool **contract-deploy** transactions in Step 5 (deployed via `ethers`;
> their tx hashes weren't captured in this run). The token-create fee ($1.01) dominates the total;
> the recurring shielded operations (deposit/transfer/withdraw) are ~$0.03 each. The shielded
> transfer costs about the same as a deposit/withdraw despite hiding amounts — the ZK proof is
> verified on-chain but proof *generation* happens client-side (off-chain), so it doesn't inflate gas.

---

## Entity quick-reference

| Entity | ID / address |
|---|---|
| Operator / treasury | `0.0.7628788` |
| Alice | `0.0.9277590` / `0xcc5d5b9cacd2c5f67f397f170489e614ceb3a194` |
| Bob | `0.0.9277592` / `0x87c674b93a708cbe9d5d371d5434b79576ee34a1` |
| Token (ZUSD-TEST) | `0.0.9277599` / `0x00000000000000000000000000000000008d909f` |
| Pool (UUPS proxy) | `0xa24A9aAEC0495c50194572CCF2bfDc00cf3D229D` |
| anon_enc verifier | `0x370B80069d8784E2F100968CDdCbe306b15ccFE9` |
| deposit verifier | `0x42A6507dEc69c96D354d73e714B26563F9a339B8` |
| withdraw verifier | `0xF5768CfaC6742a51E39BbE2596ed1322F94d7ED6` |
