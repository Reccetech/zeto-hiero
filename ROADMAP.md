# zeto-hiero Roadmap

This roadmap lays out how zeto-hiero — a privacy-preserving shielded token pool for Hedera, built on [Hyperledger Labs Zeto](https://github.com/hyperledger-labs/zeto) — grows from the current MVP to a production, mainnet-ready system.

The guiding principle is **incremental capability**: each version adds **one** major capability on top of the last, so complexity grows in controlled steps and every version ships something testable end-to-end. The MVP (v0.1) is the first rung; each subsequent version layers compliance, auditability, and hardening.

> Companion documents: [`RELEASE-NOTES.md`](RELEASE-NOTES.md) (what shipped) and [`MVP-Zeto-Hiero.md`](MVP-Zeto-Hiero.md) (architecture + roadmap summary), both in this repo. The full design spec `PRD-Zeto-Hiero.md` and the version-by-version build plan `BUILD-PLAN-Zeto-Hiero.md` are internal design docs (not included in this repo).

---

## Current status

**v0.1 (MVP) is complete** — the full deposit → private transfer → withdraw lifecycle runs on Hedera testnet with a real HTS token and real Groth16 proofs, balances reconcile, and gas/fees are measured (see [`tutorial/RUN-RESULTS.md`](tutorial/RUN-RESULTS.md)). The next active increment is **v0.2 — KYC enforcement**.

---

## Version overview

| Version | Adds | Upstream Zeto variant | Status |
|---|---|---|---|
| **v0.1 (MVP)** | Shielded HTS deposit/transfer/withdraw; real ZK proofs on testnet | `Zeto_AnonEnc` | ✅ **Complete** |
| **v0.2** | KYC enforcement — only enrolled participants can transact | `Zeto_AnonEncNullifierKyc` | 🔜 **Next** (foundation built, not wired) |
| **v0.3** | Sanctions screening — on-chain non-inclusion proofs | + sanctions circuit / `SanctionsModule` | 🟡 Module built & tested |
| **v0.4** | Non-repudiation + DeRec key custody + HCS audit trail | `Zeto_AnonEncNullifierKyc` + non-repudiation layer | 📐 Designed in PRD |
| **v1.0** | Production hardening — trusted-setup ceremony, security audit, mainnet | — | 📐 Gated on ceremony + audit |

Legend: ✅ done · 🔜 next · 🟡 partially built · 📐 designed only.

---

## v0.2 — KYC enforcement (next)

**Goal:** restrict pool participation to identity-verified parties without de-anonymizing transactions to the public. Alice and Bob must be enrolled in a KYC registry before they can transact; observers still cannot see amounts or the sender→recipient link.

**Key work:**
- Swap the pool's base from `Zeto_AnonEnc` to **`Zeto_AnonEncNullifierKyc`**. This introduces a **nullifier** sparse-Merkle tree (SMT) and identity-membership signals — which also pulls in `@iden3/contracts` for `SmtLib`/Poseidon (deliberately skipped in v0.1).
- Wire in the existing **`HederaKycRegistry`** (UUPS, already built and tested in v0.1).
- Extend the witness tooling (`test/lib/zeto-witness.ts`) for the KYC circuit: nullifiers, Merkle proofs, and KYC membership signals.
- Compile the `anon_enc_nullifier_kyc` circuit (needs 2¹⁶ ptau — already on disk) and stage its verifier the same way as the v0.1 verifiers.
- Enroll Alice & Bob, then re-run the testnet demo with KYC active.

**Privacy upgrade:** the nullifier scheme also **breaks the spent-note link** that v0.1's `AnonEnc` exposes — spending publishes a nullifier instead of revealing the input commitment, so the transaction graph is no longer traceable.

**Dependencies / risks:** `@iden3/contracts` SMT integration; contract size growth (watch the EIP-170 limit); the nullifier tree adds per-transfer gas.

---

## v0.3 — Sanctions screening

**Goal:** prove that transacting parties are **not** on a sanctions list, on-chain, without revealing identities — a PPOI-style (Private Proof of Innocence) non-inclusion proof.

**Key work:**
- A new **sanctions circuit** proving the sender/recipient identity commitments are absent from a published sanctions set.
- Wire in the existing **`SanctionsModule`** (already built and tested).
- Define the sanctions-set data structure and its update/governance process (who curates it, how it's published on-chain, how proofs reference a version).
- Extend witness tooling and the verifier staging for the sanctions circuit.

**Dependencies / risks:** sanctions-list governance and update cadence; proof cost of non-inclusion over a large set; coordination with the KYC identity scheme from v0.2.

---

## v0.4 — Non-repudiation, DeRec custody, and audit trail

**Goal:** give regulators/auditors confidential oversight and give institutions resilient custody of the authority key — without weakening participant privacy from the public.

**Key work:**
- **Non-repudiation layer** — every transfer additionally encrypts its values/nullifiers under an **authority public key** embedded in the circuit. The authority (e.g. the issuing institution) can always decrypt; participants cannot. This produces a confidential, complete audit trail.
- **Viewing keys** — derived keys that let an auditor decrypt incoming UTXO amounts across the pool, providing a full ledger view without holding any spending keys.
- **DeRec threshold custody** — the authority decryption key is held under a threshold/recovery scheme (DeRec) so no single party holds it and it can be recovered.
- **HCS audit trail** — emit a structured event taxonomy to Hedera Consensus Service for a tamper-evident, timestamped log.

**Dependencies / risks:** authority-key lifecycle and DeRec integration; auditor SDK (scanner + decryption); careful design so the audit path does not leak to the public.

---

## v1.0 — Production hardening & mainnet

**Goal:** everything required to run real value on mainnet.

**Key work:**
- **Multi-party trusted-setup ceremony** — replace the v0.1 single-party (insecure) proving keys with a proper Groth16 Phase-2 ceremony. **This is the critical-path item** — it requires multi-participant coordination (estimated 3–6 months) and a single honest participant suffices for soundness (per HIP-1398-style TSS Powers of Tau).
- **Security audit** — independent audit of the contracts and circuits.
- **Deferred contract hardening** — ReentrancyGuard, pause, and recipient/output binding (PRD engineering issues E-1/E-3/E-8) applied to the production contract.
- **Mainnet deployment** — production deploy + operational runbooks.

**Dependencies / risks:**
- **Besu ≥ 25.3.0 on consensus nodes** — Hedera must ship the fix for CVE-2025-30147 (a BN254 point-on-curve check) before any mainnet ZK deployment. As of the last check the network was on 25.2.2 — this is a hard external gate.
- Ceremony and audit calendars drive the v1.0 date.

---

## Cross-cutting workstreams

These span multiple versions rather than belonging to a single one:

- **Trusted-setup ceremony** — insecure test keys today; the multi-party ceremony is the gate for v1.0/mainnet. Longest lead time, so plan early.
- **`@hiero-privacy/zeto-sdk`** — a TypeScript SDK wrapping `zeto-js`: BIP32 key derivation, an **output scanner with ECDH decryption** (so wallets can discover incoming notes — the mechanism described in [`tutorial/HOW-ZETO-WORKS.md`](tutorial/HOW-ZETO-WORKS.md)), viewing-key support, and authority-audit helpers. Scanner is needed from v0.2 onward; authority audit lands with v0.4.
- **Value-range handling** — extend/validate the supported value range and overflow behavior across circuits as amounts and decimals scale.
- **Atomic settlement (DvP/PvP)** — `Atom`/`AtomFactory` (from Paladin) for atomic cross-pool settlement; a P1 production feature beyond the MVP path.
- **Network prerequisites** — track Besu version on consensus nodes and any HTS/relay behavior changes that affect deploys (see the testnet gotchas in `AGENTS.md`).

---

## Sequencing & critical path

```
v0.1 ✅ ──▶ v0.2 (KYC) ──▶ v0.3 (sanctions) ──▶ v0.4 (audit/custody) ──▶ v1.0 (mainnet)
                                                                            ▲
        trusted-setup ceremony (long lead — start early) ───────────────────┤
        security audit ─────────────────────────────────────────────────────┤
        Besu ≥ 25.3.0 on consensus nodes (external gate) ───────────────────┘
```

The compliance features (v0.2–v0.4) can proceed on testnet in parallel with the ceremony, but **mainnet (v1.0) is gated on the ceremony, the audit, and the Besu upgrade** — none of which are on the critical engineering path but all of which have long external lead times.

---

## Explicitly out of scope (for now)

- A single Hiero-operated shared pool — Zeto uses a per-issuer deployment model; each institution deploys and controls its own pool, KYC registry, and verifiers.
- Cross-chain bridging beyond Hedera.
- Anything requiring the trusted-setup ceremony to be complete (i.e. real mainnet value) until v1.0.

---

*Statuses reflect the repository as of v0.1.0 (2026-06-18). See [`RELEASE-NOTES.md`](RELEASE-NOTES.md) for what has shipped; the detailed per-version build plan lives in the internal `BUILD-PLAN-Zeto-Hiero.md` (not included in this repo).*
