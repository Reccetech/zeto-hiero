# Trusted Setup Ceremony (v1.0)

> **Status: NOT STARTED — this is the process template, not a completed ceremony.**
> Every circuit in this repo currently uses an **insecure single-party "toy" setup** (one
> `snarkjs zkey contribute` by the build). That is fine for testnet and CI; it is **not** acceptable
> for mainnet. Mainnet requires the multi-party ceremony described here. This is the longest-lead
> item before launch (estimated 3–6 months) and is gated on human coordination, not code.

## Why

A Groth16 proving/verifying key pair is only sound if no single party knows the "toxic waste"
randomness used to generate it. A multi-party computation (MPC) Phase-2 ceremony ensures soundness
as long as **at least one** of N contributors was honest and destroyed their entropy. With a single
contributor (today's state), that one party could forge proofs.

## Circuits in scope (freeze before the ceremony)

All circuits must be final — no value-range, identity-depth, or authority-key changes after this:

| Circuit | Public signals | ptau |
|---|---|---|
| `deposit` | 3 | 2¹⁴ |
| `withdraw_nullifier` | 7 | 2¹⁹ |
| `anon_enc_nullifier_kyc` | 19 | 2¹⁸ |
| `anon_enc_nullifier_kyc_sanctions` | 20 | 2¹⁹ |
| `anon_enc_nullifier_kyc_sanctions_non_repudiation` (production) | 38 | 2¹⁹ |

(The production deployment uses the non-repudiation circuit; the others are the increment ladder.)

## Pre-ceremony checklist

- [ ] **Security audit complete and clean** (Phase 9) — never freeze the circuits for the ceremony
      before the audit, or audit-driven circuit changes invalidate the ceremony output.
- [ ] Authority key model finalized. NOTE: our pool takes `authorityPublicKey` as a **public input**
      (not baked into the verifying key), so — unlike the PRD's F-1 design — the authority key does
      **not** need to be fixed before the ceremony. It can be set/rotated on-chain via `setAuthorityKey`.
- [ ] Recompile every circuit to fresh `.r1cs` from frozen sources.
- [ ] Choose + publish the Powers of Tau source hash (Hermez `powersOfTau28_hez_final_{14,18,19}`).
- [ ] Recruit ≥ 10 named contributors from diverse organizations (OQ-2).

## Running the ceremony (per circuit)

The coordinator initializes `circuit_0000.zkey` (`snarkjs groth16 setup <r1cs> <ptau> circuit_0000.zkey`),
then passes it contributor to contributor. Each contributor runs:

```bash
ts-node scripts/ceremony-contribute.ts \
  <circuit> circuit_<prev>.zkey circuit_<n>.zkey "Contributor N — Org" "<fresh entropy>"
```

`ceremony-contribute.ts` appends a transcript line (`{circuit, name, sha256, at}`) so the contribution
chain is auditable. Contributors should publish their `sha256` independently (e.g. on social media)
so the chain can be verified by anyone.

After the final contribution:

```bash
# verify the final zkey against the original r1cs + ptau
npx snarkjs zkey verify circuits/build/<circuit>.r1cs <ptau> circuit_final.zkey   # -> ZKey Ok!
# export the production vkey + Solidity verifier
npx snarkjs zkey export verificationkey circuit_final.zkey <circuit>_vkey.json
npx snarkjs zkey export solidityverifier circuit_final.zkey <Circuit>Verifier.sol
```

## Deploy production verifiers

1. Rename + pragma-bump each generated verifier (same convention as the `*VerifierMVP` contracts).
2. Deploy to **testnet first**; re-run the full v0.4 confidential flow against them — confirm parity.
3. Deploy to mainnet (Phase 11) and upload the vkeys to `ZetoVkeySetter`, then `lock()` (irreversible).

## Publish (this document, filled in)

- [ ] Contributors list (name + org + contribution order)
- [ ] Per-circuit contribution hash chain (from the `.transcript.jsonl` files)
- [ ] Final `.zkey` sha256 per circuit
- [ ] Powers of Tau source + hash
- [ ] Independent-verification commands (the `zkey verify` lines above) so any third party can re-verify
