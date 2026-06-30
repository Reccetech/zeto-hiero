// @hiero-privacy/zeto-sdk — viewing keys.
//
// In Zeto's anon_enc (ECDH) scheme there is no separate "view-only" key that is cryptographically
// distinct from the spending key: decrypting an incoming note requires the recipient's BabyJubJub
// private key, which is also the spending key. So the per-account **viewing key IS the BJJ private
// key** — sharing it with an auditor grants read access (and, unavoidably, spend access; for
// read-only delegation use the pool-level authority path instead).
//
// Two selective-disclosure capabilities exist:
//   1. Per-recipient: the recipient's BJJ private key decrypts notes addressed to them (OutputScanner).
//   2. Pool-level audit: the holder of the pool's authority private key (`sk_auth`) decrypts the
//      authority ciphertext on EVERY transfer, reconstructing the full ledger (AuthorityAuditScanner).
//
// This module documents the model and provides a typed wrapper so callers don't pass bare bigints.

export interface ViewingKey {
  /** BabyJubJub private key (raw; ECDH helpers format it internally). */
  readonly privateKey: bigint;
  readonly publicKey: readonly [bigint, bigint];
}

export function viewingKeyFromBjj(privateKey: bigint, publicKey: [bigint, bigint]): ViewingKey {
  return { privateKey, publicKey };
}
