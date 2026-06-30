// @hiero-privacy/zeto-sdk — ECDH/Poseidon decryption primitives shared by the scanners.
// Wraps maci-crypto (ECDH) + zeto-js (Poseidon) so scanner code stays declarative.

/* eslint-disable @typescript-eslint/no-var-requires */
const { genEcdhSharedKey } = require("maci-crypto");
const { poseidonDecrypt, Poseidon } = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const poseidon4 = Poseidon.poseidon4;

/** Recompute a UTXO commitment hash to confirm a decrypted note matches an on-chain output. */
export function commitmentHash(value: bigint, salt: bigint, ownerPubKey: readonly [bigint, bigint]): bigint {
  return poseidon4([value, salt, ownerPubKey[0], ownerPubKey[1]]) as bigint;
}

/**
 * Decrypt one recipient ciphertext slice (4 elements per output) using the recipient's BJJ private
 * key and the transfer's ephemeral public key. Returns { value, salt } or throws on a bad slice.
 */
export function decryptRecipientNote(
  recipientPrivKey: bigint,
  encryptedValues: bigint[],
  encryptionNonce: bigint,
  ecdhPublicKey: readonly [bigint, bigint],
  outputIndex: number,
): { value: bigint; salt: bigint } {
  const shared = genEcdhSharedKey(recipientPrivKey, ecdhPublicKey);
  const slice = encryptedValues.slice(4 * outputIndex, 4 * outputIndex + 4);
  const plain = poseidonDecrypt(slice, shared, encryptionNonce, 2);
  return { value: BigInt(plain[0]), salt: BigInt(plain[1]) };
}

/**
 * Decrypt the authority ciphertext with the pool's authority private key, recovering the full
 * plaintext: [ownerPub(2), per-input value+salt, per-output ownerPub, per-output value+salt].
 */
export function decryptAuthorityCiphertext(
  authorityPrivKey: bigint,
  cipherTextAuthority: bigint[],
  encryptionNonce: bigint,
  ecdhPublicKey: readonly [bigint, bigint],
  plaintextLen: number,
): bigint[] {
  const shared = genEcdhSharedKey(authorityPrivKey, ecdhPublicKey);
  return poseidonDecrypt(cipherTextAuthority, shared, encryptionNonce, plaintextLen).map((x: any) => BigInt(x));
}
