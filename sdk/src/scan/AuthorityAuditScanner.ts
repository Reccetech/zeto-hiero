// @hiero-privacy/zeto-sdk — authority audit scanner (regulator view).
//
// The holder of the pool's authority private key decrypts the authority ciphertext emitted on
// every confidential transfer, reconstructing the full plaintext — sender key, input values, and
// each output's owner key + value. This gives a complete, confidential audit trail without any
// spending capability over the pool.

import { decryptAuthorityCiphertext } from "../crypto";

/** Minimal shape of an AuthorityCiphertext event (from HederaZetoToken). */
export interface AuthorityEvent {
  nullifiers: bigint[];
  outputs: bigint[];
  encryptionNonce: bigint;
  ecdhPublicKey: [bigint, bigint];
  cipherTextAuthority: bigint[];
}

export interface AuditedTransfer {
  senderPubKey: [bigint, bigint];
  inputs: { value: bigint; salt: bigint }[];
  outputs: { ownerPubKey: [bigint, bigint]; value: bigint; salt: bigint }[];
  nullifiers: bigint[];
  outputCommitments: bigint[];
}

/**
 * Reconstruct a single transfer from its authority ciphertext. `nInputs`/`nOutputs` give the
 * plaintext layout: [ownerPub(2), nInputs×(value,salt), nOutputs×ownerPub(2), nOutputs×(value,salt)].
 */
export function auditTransfer(
  authorityPrivKey: bigint,
  ev: AuthorityEvent,
  nInputs: number,
  nOutputs: number,
): AuditedTransfer {
  const ptLen = 2 + 2 * nInputs + 4 * nOutputs;
  const p = decryptAuthorityCiphertext(authorityPrivKey, ev.cipherTextAuthority, ev.encryptionNonce, ev.ecdhPublicKey, ptLen);

  let idx = 0;
  const senderPubKey: [bigint, bigint] = [p[idx++], p[idx++]];
  const inputs: { value: bigint; salt: bigint }[] = [];
  for (let i = 0; i < nInputs; i++) inputs.push({ value: p[idx++], salt: p[idx++] });
  const outOwners: [bigint, bigint][] = [];
  for (let i = 0; i < nOutputs; i++) outOwners.push([p[idx++], p[idx++]]);
  const outputs: { ownerPubKey: [bigint, bigint]; value: bigint; salt: bigint }[] = [];
  for (let i = 0; i < nOutputs; i++) outputs.push({ ownerPubKey: outOwners[i], value: p[idx++], salt: p[idx++] });

  return { senderPubKey, inputs, outputs, nullifiers: ev.nullifiers, outputCommitments: ev.outputs };
}

/** Audit an entire pool history (all authority events). */
export function auditAll(
  authorityPrivKey: bigint,
  events: AuthorityEvent[],
  nInputs: number,
  nOutputs: number,
): AuditedTransfer[] {
  return events.map((ev) => auditTransfer(authorityPrivKey, ev, nInputs, nOutputs));
}
