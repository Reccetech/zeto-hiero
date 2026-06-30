// @hiero-privacy/zeto-sdk — authority BabyJubJub key custody (DeRec-style threshold model).
//
// PRD §16: a per-pool authority key whose private part `sk_auth` is never held whole. It is
// generated, Shamir-split T-of-N to a set of named Helpers (e.g. pool operator, regulator, Hiero
// governance, legal custodian, issuer treasury — 5 Helpers, T=3), each share encrypted to its
// Helper, then `sk_auth` is zeroed. Reconstruction combines any T shares locally for an authorized,
// HCS-anchored event. DeRec was unavailable as a dependency, so this uses field-Shamir (shamir.ts);
// transport encryption to each Helper is supplied by the caller (pluggable), keeping the threshold
// crypto independent of the chosen channel.

import { splitSecret, reconstruct, FIELD, type Share } from "./shamir";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair, genPubKey } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */

export interface Helper {
  /** Stable identifier (e.g. a Hedera account id). */
  id: string;
  /** Optional encryptor: seal a share's bytes to this Helper (e.g. ECIES to their key). */
  encrypt?: (plaintext: string) => string;
}

export interface DistributedShare {
  helperId: string;
  x: bigint;
  /** y, or its ciphertext if the Helper supplied an encryptor. */
  payload: string;
  encrypted: boolean;
}

export interface GenerateResult {
  /** Public authority key to set on the pool via setAuthorityKey(...). */
  authorityPublicKey: [bigint, bigint];
  /** One distributed share per Helper. `sk_auth` is NOT returned — only the shares. */
  shares: DistributedShare[];
  threshold: number;
}

/**
 * Generate a fresh authority keypair, split `sk_auth` T-of-N across `helpers`, (optionally) encrypt
 * each share to its Helper, and return the public key + distributed shares. The whole private key
 * is never returned and is dropped when this function returns.
 */
export function generateAndDistribute(helpers: Helper[], threshold: number): GenerateResult {
  if (threshold < 1 || threshold > helpers.length) throw new Error("require 1 <= threshold <= helpers");
  // genKeypair's raw private key is occasionally >= FIELD; regenerate until in-field so it can be
  // Shamir-split and reconstructed exactly (still a uniformly valid BJJ keypair).
  let privKey: bigint;
  let pubKey: bigint[];
  do {
    ({ privKey, pubKey } = genKeypair());
  } while ((privKey as bigint) >= FIELD);
  const shares = splitSecret(privKey as bigint, helpers.length, threshold);

  const distributed: DistributedShare[] = shares.map((s: Share, i: number) => {
    const helper = helpers[i];
    const plaintext = s.y.toString();
    if (helper.encrypt) {
      return { helperId: helper.id, x: s.x, payload: helper.encrypt(plaintext), encrypted: true };
    }
    return { helperId: helper.id, x: s.x, payload: plaintext, encrypted: false };
  });

  return {
    authorityPublicKey: [pubKey[0] as bigint, pubKey[1] as bigint],
    shares: distributed,
    threshold,
  };
}

/**
 * Reconstruct `sk_auth` from at least `threshold` decrypted shares. The caller is responsible for
 * decrypting Helper payloads (the inverse of Helper.encrypt) before passing them here.
 */
export function reconstructAuthorityKey(
  decryptedShares: { x: bigint; y: bigint }[],
  threshold: number,
): { privateKey: bigint; publicKey: [bigint, bigint] } {
  if (decryptedShares.length < threshold) throw new Error(`need >= ${threshold} shares`);
  const privateKey = reconstruct(decryptedShares.map((s) => ({ x: s.x, y: s.y })));
  const pub = genPubKey(privateKey);
  return { privateKey, publicKey: [pub[0] as bigint, pub[1] as bigint] };
}
