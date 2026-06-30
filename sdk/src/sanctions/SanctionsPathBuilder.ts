// @hiero-privacy/zeto-sdk — sanctions non-inclusion path builder.
//
// Productized form of the test-lib helper: given an off-chain sanctions Sparse Merkle Tree
// (@iden3/js-merkletree, whose root is published on-chain via SanctionsModule) and a key (a spent
// nullifier), produce the SMTVerifier(fnc=1) inputs proving the key is NOT in the tree.

import type { Merkletree } from "@iden3/js-merkletree";

export interface NonInclusionPath {
  siblings: bigint[];
  oldKey: bigint;
  oldValue: bigint;
  isOld0: bigint;
}

/**
 * Build a non-inclusion path for `key` against `smt` at `root`. For an absent key, js-merkletree's
 * generateCircomVerifierProof returns fnc=1 with the "near" leaf (oldKey/oldValue) and isOld0,
 * which the circuit's SMTVerifier(fnc=1) accepts.
 */
export async function buildNonInclusionPath(smt: Merkletree, key: bigint, root: any): Promise<NonInclusionPath> {
  const p = await smt.generateCircomVerifierProof(key, root);
  return {
    siblings: p.siblings.map((s: any) => s.bigInt()),
    oldKey: (p.oldKey?.bigInt?.() ?? 0n) as bigint,
    oldValue: (p.oldValue?.bigInt?.() ?? 0n) as bigint,
    isOld0: p.isOld0 ? 1n : 0n,
  };
}
