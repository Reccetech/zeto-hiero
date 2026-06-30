# Operator Runbook (v0.4 → v1.0)

Operational procedures for deploying and running a zeto-hiero confidential pool. Testnet procedures
are live today; mainnet procedures are gated (see the bottom) and must not be run until v1.0 gates pass.

## Deploy a pool (testnet)

The consolidated demo scripts double as reference deploy procedures:

- v0.2 KYC: `scripts/demo-v02-kyc-testnet.ts`
- v0.3 sanctions: `scripts/demo-v03-sanctions-testnet.ts`
- v0.4 confidential (production): `scripts/demo-v04-confidential-testnet.ts`

Each does, in order: deploy Poseidon + SmtLib → deploy verifiers → deploy the pool (UUPS) → `setupHTS`
→ (v0.4) `setAuthorityKey` → register KYC participants → set the sanctions root → (v0.4) create the
HCS audit topic. Run with `npx hardhat run <script> --network hedera_testnet`.

Pre-reqs: `.env` with `HEDERA_OPERATOR_*`, `ALICE_*`, `BOB_*`, `UNDERLYING_TOKEN_ADDRESS`;
`circuits/build/` populated (regenerate via `docs/rebuild-circuits.md`).

## Enroll a KYC participant

1. Obtain the participant's BabyJubJub public key `(x, y)`.
2. `pool.register([x, y], "0x")` (owner-only). The pool's identities SMT root advances.
3. Keep the off-chain identities SMT (`@iden3/js-merkletree`, depth 10) in lock-step — add
   `kycHash([x,y])`. The off-chain root must equal `pool.getIdentitiesRoot()`.
4. (v0.4) Anchor `participant_enrolled` on the HCS audit topic.

## Rotate the sanctions root

1. Rebuild the off-chain sanctions SMT from the current OFAC SDN list (keyed by nullifier).
2. `pool.updateSanctionsMerkleRoot(bytes32(root))` (owner or the configured oracle).
3. (v0.4) Anchor `sanctions_root_updated`. Optionally set a dedicated oracle: `pool.setSanctionsOracle(addr)`.

> Transfers build their non-inclusion proof against the **current** root; a proof for a stale root
> reverts `SanctionsRootMismatch`. Coordinate root rotations with active submitters.

## Rotate the authority key (v0.4)

1. Generate a new authority key (DeRec ceremony for production — `AuthorityKeyManager.generateAndDistribute`).
2. `pool.setAuthorityKey([x, y])` (owner-only).
3. (v0.4) Anchor `authority_key_registered`. Proofs built for the old key will fail after rotation.

## Pause / unpause

`pool.setPaused(true|false)` (owner-only). While paused, deposit / withdraw / transferConfidential
revert `PoolPaused`. Anchor `pause_state_changed`.

## Upgrade (UUPS)

`pool.upgradeToAndCall(newImpl, data)` (owner-only). Validate with the OZ upgrades plugin first.
Anchor `implementation_upgraded`.

## Reconstruct the authority key (audit / recovery)

When a regulator audit or key recovery is authorized: collect ≥ T Helper shares, decrypt each
(inverse of the distribution encryptor), then `reconstructAuthorityKey(shares, T)`. Use the
reconstructed key only on an air-gapped host; anchor `authority_key_reconstructed` with the reason.

---

## Mainnet (GATED — v1.0)

**Do not run until all three gates pass.** The launch script enforces them:

```
CEREMONY_COMPLETE=true AUDIT_CLEAN=true BESU_VERSION=25.3.0 I_UNDERSTAND_THIS_IS_MAINNET=yes \
  npx hardhat run scripts/mainnet-launch.ts --network hedera_mainnet
```

- **Ceremony** (`docs/ceremony.md`): deploy the **ceremony-produced** verifiers, not the
  single-party `*VerifierMVP` ones.
- **Audit**: third-party report clean; all findings resolved.
- **Besu ≥ 25.3.0**: hiero-consensus-node must ship the CVE-2025-30147 fix (BN254 point-on-curve).
- Then: deploy → `setupHTS` → `setAuthorityKey` (DeRec) → set OFAC sanctions root → create HCS topic
  with the 3-of-5 Helper threshold (`scripts/create-hcs-topic.ts`) → enroll initial participants →
  first production deposit/transfer/withdraw → upload + `lock()` vkeys on `ZetoVkeySetter`.
