# Run Results — v0.5 Multi-Asset (Hedera testnet)

**Date:** 2026-06-30 · **Network:** Hedera testnet (chain 296) · **Outcome:** ✅ ERC-20 FT and ERC-721 NFT shielded flows ran end-to-end with real ZK proofs

Captured runs for the two new asset classes added in v0.5. HTS FT is in
[run-results-v0.4-confidential.md](run-results-v0.4-confidential.md); HTS NFT uses the same
`HederaZetoNFT` pool as ERC-721 (HTS NFTs expose ERC-721 at their EVM address) and is unit-tested
against the `0x167` precompile mock.

Operator `0.0.7628788` (`0x17C137c42789D758Cb8c777DF29b656ff90a43C2`).

---

## ERC-20 FT — plain ERC-20, full v0.4 compliance pool

A vanilla ERC-20 (deployed on HSCS, **no HTS association**) shielded by `HederaZetoToken` with the
full KYC + sanctions + non-repudiation stack. `setupERC20` (not `setupHTS`) wires custody.

| Entity | Address |
|---|---|
| Pool (`HederaZetoToken`) | [`0x7edd8DcD385B58Da06A26fe126DF4c7b580e3eF7`](https://hashscan.io/testnet/contract/0x7edd8DcD385B58Da06A26fe126DF4c7b580e3eF7) |
| Plain ERC-20 (`pUSD`) | `0xFEa2deb0468DdE55544A48473c7780AE77890DE5` |

- `setupERC20` — gas **74,747** (no `0x167` association)
- KYC enrollment — off-chain identities root matched on-chain ✓
- Deposit 100 — gas **668,948** · [tx](https://hashscan.io/testnet/transaction/0xee678b67bfc528c97c417c1a43952ca2d80227a9f26e918c98a63943391681b1) · `shieldedSupply=100`
- Confidential transfer 100 → 40 Bob + 60 Alice — gas **2,136,560** · [tx](https://hashscan.io/testnet/transaction/0x20d80b03319dce8d1f70d9db4fde7d726bc8cbfd549c8f4148fddb85d8d91929)
- **[SDK] authority audit reconstructed: input=100, outputs=[40, 60]** — the regulator path works identically to HTS FT.

Confirms the full v0.4 compliance flow runs on a **plain ERC-20** with zero HTS involvement (the
local `test/erc20-ft-pool.test.ts` installs no precompile at all).

---

## ERC-721 NFT — shielded NFT pool

A real ERC-721 deposited into `HederaZetoNFT`, transferred privately, then withdrawn. Basic shielding
(anonymity + nullifier double-spend).

| Entity | Address |
|---|---|
| Pool (`HederaZetoNFT`) | [`0x440b01eA26a9560c628D43A78eB512B15ADC42D0`](https://hashscan.io/testnet/contract/0x440b01eA26a9560c628D43A78eB512B15ADC42D0) |
| ERC-721 (`ART`, tokenId 1001) | `0x0C6FFC19EbC200f94BBcf3Ce4c52C6638e77019A` |

- Deposit NFT (custody real ERC-721 → mint Alice's shielded note) — gas **459,210** · [tx](https://hashscan.io/testnet/transaction/0xb276acaebd654b152f415538476501b6e99cbd7cb74e4c832ca36f40620f31b5) · NFT now held by pool ✓
- Private NFT transfer Alice → Bob (real ZK proof; tokenId hidden) — gas **914,432** · proof 21.3 s · [tx](https://hashscan.io/testnet/transaction/0xbb2081f308d81bc5605655c1b2a83df6b72b0c0f4242aaace86775d94f75c91a)
- Bob withdraws the real NFT (spend note → release ERC-721) — gas **789,593** · [tx](https://hashscan.io/testnet/transaction/0xfaa0f2d8a8b3542e69d6c5da3babb1af3690043f4e57cc786333d007ed8ad239) · **NFT now held by Bob ✓**

The real NFT moved Alice → (shielded) → Bob without the transfer being linkable on-chain, and the
double-spend guard reverts a replayed nullifier (verified in `test/nft-pool.test.ts`).

---

## Coverage matrix (all four classes)

| Asset | Custody setup | Compliance | Proven |
|---|---|---|---|
| HTS FT | `setupHTS` | full (KYC+sanctions+NR) | testnet (v0.4) + tests |
| ERC-20 FT | `setupERC20` | full | **testnet (above)** + `erc20-ft-pool.test.ts` |
| ERC-721 NFT | `setupERC721` | basic | **testnet (above)** + `nft-pool.test.ts` real-proof |
| HTS NFT | `setupHTSNFT` | basic | unit-tested (precompile mock); identical to ERC-721 + association |
