# Hedera Privacy Strategy — Proposal
---

## 1. The Two Paths to Blockchain Privacy

Every public blockchain faces the same fundamental tension: the transparency that enables trust and auditability is also the property that exposes sensitive business data to competitors, market observers, and uninvolved parties. There are two structurally distinct approaches to resolving this tension.

### Path 1 — Privacy at the Protocol / Native Layer

Privacy is built into the consensus layer itself. All transactions are private by default; selective disclosure is an explicit opt-in. Examples: Aleo (zk-native L1), Midnight (Kachina ZK), Zcash.

**Characteristics:**
- Privacy is universal — every user benefits automatically
- Protocol changes require network-wide governance and validator upgrades
- Not compatible with an existing, running public ledger without a hard fork
- Longest path to adoption; cannot be retrofitted onto Hedera without consensus-layer changes

### Path 2 — Privacy via Smart Contracts (Application Layer)

Privacy is provided by smart contracts deployed on an EVM-compatible chain. The base layer stays transparent; the privacy pool is an opt-in application. Users deposit assets into a shielded contract, transact privately inside it, and withdraw back to the transparent layer. Examples: RAILGUN, Zeto, Tornado Cash, Nightfall.

**Characteristics:**
- No changes to consensus, node software, or Hedera's hashgraph
- Deployable on Hedera Smart Contract Service (HSCS) without network upgrades
- Multiple privacy offerings can coexist — different contracts targeting different use cases (fungible tokens, RWA, settlement)
- Anonymity set grows with adoption; stronger privacy as usage increases
- Enterprise compliance (KYC, sanctions, viewing keys) can be baked into contract logic
- Third parties can build and deploy their own privacy contracts on the same infrastructure

**This proposal recommends Path 2** as the primary privacy approach for Hedera. Path 2 is consistent with Hedera's existing network architecture, avoids consensus-layer changes, and supports a portfolio of complementary solutions across use cases. This recommendation is subject to review and approval.

---

## 2. Proposed Ecosystem Approach

This proposal suggests that Hedera adopt an ecosystem model rather than mandating a single privacy solution — similar to Solana's approach, where the foundation officially recognizes a portfolio of independently developed privacy projects. Under this model, Hiero networks would support any conforming privacy solution, with a flagship offering providing the reference implementation for the highest-priority enterprise segments.

The proposed flagship is a **ZK UTXO shielded pool** targeting stablecoin ecosystems and real-world asset (RWA) tokenization. Complementary offerings would address adjacent use cases:

| Use case | Proposed solution |
|---|---|
| Institutional stablecoin settlement | Flagship ZK shielded pool (Zeto-based) |
| RWA tokenization | Flagship ZK shielded pool |
| Corporate treasury & private payments | Flagship ZK shielded pool |
| Atomic DvP / PvP settlement (consortium) | HashSphere in-network privacy |
| Confidential amounts only (no identity privacy needed) | Third-party lightweight offering |
| Private smart contract state / order books | Third-party TEE-based (future roadmap) |

This use-case mapping is a starting point for discussion — the final segmentation would be determined through stakeholder review.

---

## 3. Why a Smart Contract Approach May Be Right for Hedera

Hedera's existing architecture presents a strong fit for Path 2:

- **HSCS is EVM-compatible** — ZK verifier contracts (`ecAdd`, `ecMul`, `ecPairing` precompiles for BN254) can run natively without protocol changes
- **HTS native tokens** — a shielded pool could bridge HTS tokens (not just ERC-20 wrappers), making it a first-class citizen for Hedera's token ecosystem
- **No new node hardware** — TEE-based approaches (Oasis, Secret Network) require Intel SGX on validators; the ZK approach does not
- **Public L1 deployment** — Hedera remains a public, permissionless ledger; privacy is additive, not substitutive
- **Fee predictability preserved** — HBAR-denominated gas with explicit limits; Hedera's deterministic fee model is unchanged

These characteristics suggest Path 2 could be implemented with minimal disruption to the existing network and operator community.

---

## 4. Proposed Flagship Implementation: Zeto for Hiero

### 4.1 Why Zeto Is Proposed

After evaluating 15+ privacy solutions (full scorecard in `PRD-Hedera-Privacy-Architecture.md §2`), this proposal recommends building the flagship implementation on **Zeto** (Hyperledger Labs, Apache 2.0). The original first-choice protocol (RAILGUN) was ruled out due to licensing: all three RAILGUN repositories are UNLICENSED and require a bilateral license or RAIL DAO governance vote before deployment. Zeto shares RAILGUN's full cryptographic stack (BabyJubJub + Poseidon + Groth16 + BN254) and is deployable under an open license without negotiation.

**What Zeto is:** A ZK UTXO token toolkit for EVM chains. Assets are held as Poseidon hash commitments on-chain — the owner, amount, and transfer details are never revealed. ZK proofs (Groth16 on BN254) prove the validity of each operation without exposing the underlying data.

**Cryptographic stack:**
- BabyJubJub keypairs (ZK-friendly curve) — distinct from Hedera account keys
- Poseidon hash for UTXO commitments
- ECDH for encrypted note delivery to recipients
- Groth16 Circom circuits — one circuit per operation (deposit, transfer, withdraw)
- Trusted setup (Powers of Tau + per-circuit Phase 2)

### 4.2 Proof of Concept: zeto-hiero (v0.1 → v0.4)

To validate feasibility, a proof-of-concept repository — **`zeto-hiero`** — was built as a Hedera-specific fork of Zeto. What began as a v0.1 MVP has been extended through four increments into a **feature-complete** privacy pool — KYC, sanctions screening, and regulator-auditable confidentiality — each proven on Hedera testnet with real ZK proofs. This work is intended to form the basis of an official Hiero project under the Linux Foundation Decentralized Trust (LFDT) umbrella. The Hiero project status, and the production-launch decision, have not yet been formally accepted.

**Built and testnet-proven (as of 2026-06-30, 128 tests passing):**

| Increment | Pool contract | What was built |
|---|---|---|
| v0.1 | `HederaZetoTokenLite` | Shielded pool = upstream `Zeto_AnonEnc` + `ZetoHTSBridge`; deposit/transfer/withdraw with custom Groth16 verifiers; UUPS proxy; custodies native HTS (not ERC-20 wrappers) |
| v0.2 | `HederaZetoTokenKyc` | KYC enforcement (`Zeto_AnonEncNullifierKyc`) — enrolled identities only; nullifier SMT prevents double-spend |
| v0.3 | `HederaZetoTokenKycSanctions` | Authored sanctions circuit — per-spend ZK non-inclusion proof against an OFAC commitment |
| v0.4 | `HederaZetoToken` (production) | Authority-decryptable transfers (regulator audit); viewing-key SDK + scanners; DeRec-style threshold key custody; HCS audit trail; pause + reentrancy guard |
| v0.5 | `HederaZetoToken` + `HederaZetoNFT` | Multi-asset coverage: **HTS FT, ERC-20 FT, HTS NFT, ERC-721 NFT**. Fungible pools carry the full v0.4 compliance stack; NFT pools provide basic shielding (anonymity + double-spend) |

**Asset coverage (v0.5):** all four classes are shielded and testnet-proven. On Hedera an HTS fungible token exposes an ERC-20 interface and an HTS NFT exposes an ERC-721 interface at its EVM address, so the pools custody value through standard `transferFrom`/`transfer` — the only HTS-specific step is token association. Fungible tokens (HTS or ERC-20) get KYC + sanctions + non-repudiation; NFTs (HTS or ERC-721) get basic shielding, since upstream Zeto provides no NFT compliance circuits.

**Representative testnet gas (Hedera testnet; USD @ $0.0804/HBAR, ~1.06×10⁻⁶ HBAR/gas):**

| Operation | v0.1 (anon) | v0.4 (KYC+sanctions+authority) |
|---|---|---|
| Deposit | 325,335 gas (~$0.05) | 654,522 gas (~$0.06) |
| Private transfer | 415,870 gas (~$0.05) | 1,886,076 gas (~$0.16) |
| Withdraw | 330,404 gas (~$0.05) | — (unchanged from v0.1 path) |

The confidential transfer costs more because each one now carries on-chain SMT updates plus KYC, sanctions, and authority-ciphertext public signals — yet stays well within enterprise tolerances (~$0.16). Crucially, the heavy work (proof generation) happens **client-side, off-chain**: richer compliance, roughly flat settlement cost. Figures are illustrative testnet benchmarks; production costs depend on final circuit parameters and network conditions.

**Repo:** `github.com/Reccetech/zeto-hiero` (public; would be transferred to a Hiero organization if the project is accepted)

### 4.3 What a Private Transfer Would Look Like

1. **Alice deposits** 100 HTS tokens → pool takes custody; Alice receives a private UTXO commitment (hash of value, salt, BabyJubJub public key)
2. **Alice transfers** 40 tokens to Bob → generates a Groth16 proof proving: (a) she owns a valid UTXO, (b) the output commitments balance, (c) Bob's new commitment is correctly formed — without revealing any of the values
3. **Bob discovers his note** via ECDH: Alice encrypts the value and salt using a shared secret derived from an ephemeral keypair and Bob's public key; Bob scans transfer events and trial-decrypts each one
4. **Bob withdraws** 40 tokens → pool releases HTS custody; ZK proof confirms Bob owns the commitment

From the chain's perspective: only Poseidon hashes and encrypted ciphertext are ever visible. No amounts, no sender/receiver links.

---

## 5. Relationship to LFDT Paladin

The Zeto module is one component of a broader LFDT project called **Paladin** — a privacy-preserving transaction manager for EVM chains. Paladin's architecture is modular: Zeto (ZK UTXO pools) is one of several privacy domains; others include Pente (private EVM state) and Noto (confidential tokens).

This proposal does not suggest forking Paladin wholesale. The intent is to contribute a Hedera-specific Zeto extension back to LFDT as a first-class Hiero project, with upstream compatibility tracked via submodule pinning. Formal engagement with the LFDT / Hyperledger Labs community would be a required step if this proposal is approved.

---

## 6. Roadmap — status as built

The v0.1 proof of concept established feasibility; the compliance and selective-disclosure layers below have since been **built and proven on Hedera testnet with real ZK proofs**. (The proof-of-concept remains a feasibility demonstrator, not an approved production deployment — the production-launch decision and the items in v1.0 are still subject to review.)

| Version | Feature | What it adds | Status |
|---|---|---|---|
| **v0.1** | Shielded pool | Deposit / private transfer / withdraw of an HTS token with real Groth16 proofs | ✅ Complete (testnet) |
| **v0.2** | KYC enforcement | `Zeto_AnonEncNullifierKyc` variant: only enrolled BabyJubJub identities can transact; nullifier SMT prevents double-spend | ✅ Complete (testnet) |
| **v0.3** | Sanctions screening | Authored circuit adding a per-spend ZK **non-inclusion** proof against an OFAC SDN commitment — proves compliance without revealing which entries were checked | ✅ Complete (testnet) |
| **v0.4** | Non-repudiation + selective disclosure | Authority-decryptable transfers (regulator reconstructs the full ledger), a viewing-key SDK + scanners, DeRec-style threshold custody of the authority key, and an HCS audit trail | ✅ Complete (testnet) |
| **v0.5** | Multi-asset | ERC-20 FT custody (full compliance) + a shielded NFT pool (HTS NFT + ERC-721, basic shielding) — all four asset classes | ✅ Complete (testnet) |
| **v1.0** | Production hardening | Multi-party trusted-setup ceremony (replaces the single-party toy keys), third-party security audit, mainnet launch | ⏳ Staged — gated on ceremony + audit + a Besu mainnet upgrade |

The longest-lead-time item is the **trusted setup ceremony** (estimated 3–6 months of multi-party coordination). It, the security audit, and the mainnet launch are the remaining gates before any production deployment. *Note: the value-range extension contemplated earlier proved unnecessary — the vendored Zeto circuits already support a value range well beyond institutional needs.*

---

## 7. Compliance Posture (delivered)

The implemented design satisfies enterprise compliance requirements without compromising the privacy model. These features are built and testnet-proven; their adequacy for specific regulatory frameworks (GENIUS Act, MiCA/TFR, FATF R16) remains subject to legal review:

- **KYC gate (v0.2)** — only enrolled identities can be a sender or recipient inside the pool; enrollment is an owner-controlled, on-chain registration.
- **Sanctions screening (v0.3)** — every transfer carries a ZK proof that the spend is not on a sanctions list; a sanctioned spend cannot produce a valid proof. The sanctions list is maintained off-chain by a compliance oracle, with only its root committed on-chain.
- **Selective disclosure (v0.4)** — recipients decrypt their own incoming notes; a regulator holding the pool's **authority key** decrypts an authority ciphertext attached to every transfer and reconstructs the complete ledger (who sent what to whom). Neither capability grants the ability to spend.
- **Threshold key custody (v0.4)** — the authority key is split T-of-N across named Helpers (DeRec-style), so no single party — including the operator — can unilaterally decrypt.
- **HCS audit trail (v0.4)** — a per-pool Hedera Consensus Service topic with a threshold submit key anchors every administrative action (sanctions/identity root updates, key registration, pause, upgrade), creating an immutable, independently-verifiable log.

The design deliberately does not support full anonymity (unlinkable sender/receiver with no audit trail). Authorized parties with the appropriate key can reconstruct complete transaction history — which is the point: privacy from competitors and the public, transparency to regulators.

---