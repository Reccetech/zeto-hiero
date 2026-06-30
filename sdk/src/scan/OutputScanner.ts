// @hiero-privacy/zeto-sdk — recipient output scanner.
//
// A recipient discovers notes addressed to them by trial-decrypting the recipient ciphertext of
// each transfer with their BabyJubJub private key. A decrypt that reproduces an on-chain output
// commitment is a note they own.

import { decryptRecipientNote, commitmentHash } from "../crypto";

/** Minimal shape of a UTXOTransferWithEncryptedValues event (from the pool ABI). */
export interface TransferEvent {
  outputs: bigint[]; // output commitments
  encryptionNonce: bigint;
  ecdhPublicKey: [bigint, bigint];
  encryptedValues: bigint[]; // 4 per output
}

export interface DiscoveredNote {
  value: bigint;
  salt: bigint;
  commitment: bigint;
  outputIndex: number;
}

/**
 * Scan transfer events for notes owned by `recipientPubKey` (decrypted with `recipientPrivKey`).
 * Only returns a note when the decrypted (value, salt, recipientPubKey) reproduces the on-chain
 * output commitment — so foreign outputs and failed decrypts are filtered out.
 */
export function scanForRecipient(
  events: TransferEvent[],
  recipientPrivKey: bigint,
  recipientPubKey: readonly [bigint, bigint],
): DiscoveredNote[] {
  const found: DiscoveredNote[] = [];
  for (const ev of events) {
    for (let i = 0; i < ev.outputs.length; i++) {
      if (ev.outputs[i] === 0n) continue;
      let note: { value: bigint; salt: bigint };
      try {
        note = decryptRecipientNote(recipientPrivKey, ev.encryptedValues, ev.encryptionNonce, ev.ecdhPublicKey, i);
      } catch {
        continue; // not addressed to us (or a different output slot)
      }
      if (commitmentHash(note.value, note.salt, recipientPubKey) === ev.outputs[i]) {
        found.push({ value: note.value, salt: note.salt, commitment: ev.outputs[i], outputIndex: i });
      }
    }
  }
  return found;
}
