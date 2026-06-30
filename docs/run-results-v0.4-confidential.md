# Run Results — v0.4 Confidential Pool / Non-Repudiation (Hedera testnet)

**Date:** 2026-06-30 · **Network:** Hedera testnet (chain 296) · **Outcome:** ✅ deploy → KYC → sanctions root → HCS audit topic → deposit → confidential transfer → SDK recipient scan → SDK authority audit, all with real proofs

The v0.4 counterpart to the v0.2/v0.3 run-results. Exercises `HederaZetoToken` — the production pool:
KYC + sanctions + **non-repudiation** (authority-decryptable transfers) — plus the HCS audit trail and
the SDK scanners against real on-chain data.

Operator `0.0.7628788` (`0x17C137c42789D758Cb8c777DF29b656ff90a43C2`). Run with
`scripts/demo-v04-confidential-testnet.ts`.

## Deployed contracts

| Entity | Address |
|---|---|
| **pool** (`HederaZetoToken`, UUPS proxy) | [`0x865e9306DEb38b9Ea1E79b4c08e806D0C4DA3E1d`](https://hashscan.io/testnet/contract/0x865e9306DEb38b9Ea1E79b4c08e806D0C4DA3E1d) |
| NR transfer verifier (uint[38]) | `0xbb521eDeE6154e5D2dA416F9d6265751A5bC2F97` |
| deposit / nullifier-withdraw verifiers | `0x677C53853B548560fCD934AAe3c53653e759B6Bd` / `0x3c8095Df6393398203e329B6a6eA0aF882264287` |
| Poseidon2 / Poseidon3 / SmtLib | `0xA6B14A…6D15` / `0xCf7278…60CD` / `0x494FF2…4CD3` |
| HCS audit topic | [`0.0.9377751`](https://hashscan.io/testnet/topic/0.0.9377751) |

## Steps

- **setupHTS** gas 783,512 · **setAuthorityKey** gas 75,077
- **KYC enrollment** — Alice 341,735 / Bob 622,669; off-chain identities root matched on-chain ✓
- **Sanctions root** — gas 75,296 · [tx](https://hashscan.io/testnet/transaction/0x4554f80a30ffa2796bf19f5e482280fb1be14d38ce2205aa427932cabaee9db9)
- **HCS audit topic** created (`0.0.9377751`); anchored `authority_key_registered` + `sanctions_root_updated`
- **Deposit 100** — gas 654,522 · proof 15,664 ms · [tx](https://hashscan.io/testnet/transaction/0xd0090a146e07a8282583396ded455ff4d057e7043099448709a0fdae3d8fa532)
- **Confidential transfer** 100 → 40 Bob + 60 Alice — gas **1,886,076** · proof 14,204 ms · [tx](https://hashscan.io/testnet/transaction/0xedd13e51cbbf21c4e6c0053f74c520c03c9aa769d64eda5ed7c3e45306fe2635)
- **[SDK] OutputScanner** — Bob discovered his note (value 40) from the transfer event
- **[SDK] AuthorityAuditScanner** — the authority reconstructed the full transfer: **input=100, outputs=[40, 60]**

## Gas summary

| Operation | v0.4 gas | v0.3 gas | Note |
|---|---:|---:|---|
| register (Alice / Bob) | 341,735 / 622,669 | 341,647 / 705,538 | ≈ |
| `setAuthorityKey` | 75,077 | — (new) | one-time / on rotation |
| `updateSanctionsMerkleRoot` | 75,296 | 75,230 | ≈ |
| `setupHTS` | 783,512 | 783,446 | ≈ |
| deposit | 654,522 | 652,282 | ≈ |
| confidential transfer | **1,886,076** | 1,587,534 (sanctions) | +~19% |

The confidential transfer adds ~300k gas over the v0.3 sanctions transfer. That increment is the
on-chain cost of the **authority ciphertext**: 16 extra public signals (38 vs 20) in the pairing
check, plus emitting the `AuthorityCiphertext` event. The authority *encryption* itself is done
inside the proof (client-side) — the on-chain delta is just the larger public-input vector + event.

## What this run proves

- The **authored production circuit** (`anon_enc_nullifier_kyc_sanctions_non_repudiation`, 2¹⁹ ptau,
  38 public signals) works on Hedera testnet with real Groth16 proofs.
- **Non-repudiation works end-to-end:** a regulator holding the authority key reconstructed the full
  transaction (sender, input value, both output owners + values) from on-chain data, while Bob — using
  only his own key — saw just his own 40 note, and on-chain observers see neither.
- The **HCS audit trail** is live: a per-pool topic with anchored key/sanctions events.
- The **SDK scanners** (`OutputScanner`, `AuthorityAuditScanner`) work against real Mirror Node /
  event data, not just unit fixtures.
- KYC membership, sanctions non-inclusion, nullifier double-spend prevention, and the HTS custody
  invariant all carry over from v0.1–v0.3.

> The authority key here is a single-party testnet key. Production uses the DeRec 5-Helper / T=3
> custody model (`AuthorityKeyManager`) and a multi-party trusted setup ceremony (`docs/ceremony.md`).
