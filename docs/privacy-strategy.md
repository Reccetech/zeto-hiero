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

### 4.2 Proof of Concept: zeto-hiero (v0.1)

To validate feasibility, a proof-of-concept repository — **`zeto-hiero`** — was built as a Hedera-specific fork of Zeto. This work is intended to form the basis of an official Hiero project under the Linux Foundation Decentralized Trust (LFDT) umbrella, managing and extending the Zeto fork for Hedera — much as Hiero manages the Hedera SDK fork. This project status has not yet been formally proposed or accepted.

**v0.1 (MVP) — proof of concept as of 2026-06-05:**

| What was built | Detail |
|---|---|
| `HederaZetoTokenLite` | Shielded pool contract = upstream `Zeto_AnonEnc` + `ZetoHTSBridge` |
| ZK circuits | Deposit, anon_enc transfer, withdraw — custom Groth16 verifiers with Hedera-compatible verifier contracts |
| HTS bridge | Custodies Hedera-native HTS tokens inside the pool (not ERC-20 wrappers) |
| UUPS upgradeable proxy | OpenZeppelin UUPS; upgradeable without redeployment |
| Foundation contracts | `SanctionsModule`, `HederaKycRegistry`, `ZetoVkeySetter` — built but not wired into v0.1 |
| Test suite | 85 tests passing |
| Testnet proof | Full deposit → private transfer → withdraw on Hedera testnet with real HTS token and real ZK proofs |

**Testnet gas benchmarks (Hedera testnet, 2026-05):**

| Operation | Gas used | USD (@ $0.0804/HBAR) |
|---|---|---|
| HTS setup (one-time) | 783,314 | — |
| Deposit | 325,347 | ~$0.049 |
| Transfer (private) | 415,930 | ~$0.063 |
| Withdraw | 330,404 | ~$0.050 |

The proof-of-concept demonstrates that Zeto's cryptographic stack runs correctly on Hedera. These gas figures are illustrative benchmarks from a testnet run — production costs would depend on final circuit design, token volume, and network conditions.

**Repo:** `github.com/Reccetech/zeto-hiero` (private; would be transferred to a Hiero organization if the project is accepted)

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

## 6. Proposed Roadmap

The v0.1 proof of concept established feasibility. The following increments are proposed to close the gap between the current state and a production-grade offering. This roadmap is illustrative — scope, sequencing, and timelines would be determined through the formal project planning process.

| Version | Feature | What it adds |
|---|---|---|
| **v0.2** | KYC enforcement | Wire in `HederaKycRegistry`; use `Zeto_AnonEncNullifierKyc` variant; add SMT nullifiers to prevent double-spend |
| **v0.3** | Viewing keys / wallet scan | ECDH-based viewing key SDK so recipients can scan their notes without running a full node |
| **v0.4** | Sanctions screening circuit | ZK proof of non-inclusion against OFAC SDN list commitment — proves compliance without revealing identity |
| **v0.5** | Value range extension | Multi-UTXO inputs/outputs; larger denomination support |
| **v1.0** | Multi-party trusted setup ceremony | Replace the v0.1 single-party (toy) trusted setup with a proper Groth16 ceremony (3–6 months; required before any mainnet deployment) |

The longest-lead-time item is the **trusted setup ceremony**. If this proposal moves forward, the ceremony would need to be initiated well in advance of any mainnet target.

---

## 7. Proposed Compliance Posture

The proposed design is intended to satisfy enterprise compliance requirements without compromising the privacy model. These compliance features are subject to legal and regulatory review:

- **KYC gate** — only enrolled identities could participate in the pool (proposed for v0.2)
- **Viewing keys** — per-account keys would enable selective disclosure to auditors and regulators without revealing data to other parties (proposed for v0.3)
- **Sanctions screening** — a ZK proof of non-inclusion could prove an address is not on a sanctions list without revealing which addresses were checked (proposed for v0.4)
- **HCS anchoring** — Hedera Consensus Service could be used to timestamp compliance attestations, creating an immutable audit trail

The proposed design deliberately does not support full anonymity (unlinkable sender/receiver with no audit trail). Authorized parties with a valid legal order and the appropriate viewing key would be able to reconstruct complete transaction history. The adequacy of this posture for specific regulatory frameworks (GENIUS Act, MiCA/TFR, FATF R16) has not yet been formally reviewed by legal counsel.

---