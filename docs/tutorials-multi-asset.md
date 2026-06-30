# Tutorials — Shielding Each Asset Type (HTS / ERC × FT / NFT)

Zeto-Hiero shields four asset classes. This guide has one section per class. The deep, step-by-step
**HTS fungible** walkthrough lives in [`tutorial.md`](tutorial.md); the sections here show how each
other class differs and how to run it.

| Asset | Pool contract | Custody setup | Compliance | Runnable demo |
|---|---|---|---|---|
| **HTS FT** | `HederaZetoToken` | `setupHTS(token)` | full (KYC + sanctions + non-repudiation) | `scripts/demo-v04-confidential-testnet.ts` |
| **ERC-20 FT** | `HederaZetoToken` | `setupERC20(token)` | full (same stack) | `scripts/demo-erc20-ft-testnet.ts` |
| **HTS NFT** | `HederaZetoNFT` | `setupHTSNFT(token)` | basic (anonymity + double-spend) | `scripts/demo-nft-testnet.ts` (setupHTSNFT) |
| **ERC-721 NFT** | `HederaZetoNFT` | `setupERC721(token)` | basic | `scripts/demo-nft-testnet.ts` |

**The one idea that unifies all four:** on Hedera, a native **HTS fungible** token exposes an
**ERC-20** interface at its EVM address, and an **HTS NFT** exposes an **ERC-721** interface. So the
pool always custodies value through the standard `transferFrom`/`transfer` calls — the *only*
difference between an HTS token and a plain ERC token is that an HTS token must first be
**associated** with the pool via the `0x167` system contract. That association is the single line of
HTS-specific code; everything else (the ZK proofs, the shielded transfers) is identical.

---

## 1. HTS Fungible Token (the canonical flow)

This is the full walkthrough in [`tutorial.md`](tutorial.md): create an HTS token, deploy the pool,
`setupHTS(token)` (associate + wire as ERC-20), then deposit → private transfer → withdraw. With the
**production pool** (`HederaZetoToken`) you also get KYC enrollment, sanctions screening, and an
authority-decryptable audit trail — see [`run-results-v0.4-confidential.md`](run-results-v0.4-confidential.md).

```bash
npx hardhat run scripts/demo-v04-confidential-testnet.ts --network hedera_testnet
```

---

## 2. ERC-20 Fungible Token

A **plain ERC-20** (a vanilla OpenZeppelin token deployed on HSCS — *not* an HTS token) is shielded by
the **same production pool** with the **same full compliance stack**. The only change is the custody
setup call:

```solidity
// HTS fungible token:   associate (0x167) + wire as ERC-20
pool.setupHTS(htsToken);
// Plain ERC-20:         no association — just wire it
pool.setupERC20(erc20Token);
```

Everything downstream — `deposit`, `transferConfidential` (KYC + sanctions + non-repudiation),
`withdraw`, the viewing-key scanners, the authority audit — is byte-for-byte identical. Under the
hood the pool moves the token with `transferFrom`/`transfer`, which works for any ERC-20.

```bash
npx hardhat run scripts/demo-erc20-ft-testnet.ts --network hedera_testnet
```

The demo deploys a plain ERC-20, deploys the pool, calls `setupERC20`, enrolls KYC, sets a sanctions
root, then runs deposit → confidential transfer → authority audit. Locally this path is covered by
`test/erc20-ft-pool.test.ts` (note: that test installs **no** `0x167` precompile, proving the ERC-20
path never touches HTS).

---

## 3. ERC-721 NFT

Non-fungible tokens are shielded by a different pool, **`HederaZetoNFT`** (upstream
`Zeto_NfAnonNullifier`). An NFT note binds a `tokenId` + URI; the pool takes custody of the real NFT
and mints a shielded note, the note transfers privately (the spend is hidden by a nullifier, the
tokenId stays hidden in-circuit), and a withdraw releases the real NFT.

```solidity
pool.setupERC721(erc721);                              // enable custody (no association)
pool.depositNFT(erc721, tokenId, noteCommitment, "0x"); // custody NFT + mint shielded note
pool.transfer(nullifier, outputCommitment, root, proof, "0x"); // private NFT transfer
pool.withdrawNFT(erc721, tokenId, nullifier, output, root, proof, to, "0x"); // release real NFT
```

```bash
npx hardhat run scripts/demo-nft-testnet.ts --network hedera_testnet
```

The demo deploys an ERC-721, mints `tokenId 1001`, deposits it (custody + mint Alice's note),
transfers Alice→Bob privately with a real ZK proof, then Bob withdraws the real NFT. Locally covered
by `test/nft-pool.test.ts` (a full real-proof deposit → transfer → withdraw).

**Compliance scope:** NFT pools are **basic shielding** — anonymity + nullifier double-spend
prevention. Upstream Zeto has no KYC/sanctions/non-repudiation NFT circuits, so those aren't applied
here. The private transfer is fully ZK-trustless; the tokenId↔note custody binding at withdraw is
operator/caller-asserted in this basic tier (full trustless binding needs a custom NFT
deposit/withdraw circuit).

---

## 4. HTS NFT

An **HTS NFT** is shielded by the **same `HederaZetoNFT` pool** as ERC-721 — because an HTS NFT
exposes the ERC-721 interface at its EVM address. The only difference is the custody setup:

```solidity
// ERC-721:  pool.setupERC721(token);    // no association
// HTS NFT:  pool.setupHTSNFT(token);     // associate the collection via 0x167, then identical
```

After `setupHTSNFT`, `depositNFT` / `transfer` / `withdrawNFT` are exactly as in §3. To run on
testnet you first create an HTS NFT collection and mint a serial (via `@hiero-ledger/sdk`
`TokenCreateTransaction` with `TokenType.NonFungibleUnique` + `TokenMintTransaction`), then pass its
EVM address to `setupHTSNFT` and its serial number as the `tokenId`. The shielded flow is identical
to the ERC-721 demo (`scripts/demo-nft-testnet.ts`), swapping `setupERC721` → `setupHTSNFT`.

> The HTS-NFT custody path (associate + ERC-721 transfer) is unit-tested against the `0x167`
> precompile mock in `test/nft-pool.test.ts` ("setupERC721 / setupHTSNFT gate custody").

---

## Captured runs

See [`run-results-v0.5-multi-asset.md`](run-results-v0.5-multi-asset.md) for captured testnet runs of
the ERC-20 FT and ERC-721 NFT flows (entities, HashScan links, gas), alongside the HTS FT runs in the
[v0.1–v0.4 results](run-results.md).
