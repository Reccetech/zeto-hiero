// v0.3 Phase 2 — real-proof witness/proof helpers for the KYC + sanctions transfer circuit
// (anon_enc_nullifier_kyc_sanctions). Extends the v0.2 KYC witness with a per-input sanctions
// **non-inclusion** proof against an off-chain sanctions Sparse Merkle Tree.
//
// Confirmed empirically (Phase 1.1): iden3 SMTVerifier uses fnc=1 for non-membership (the PRD
// had this backwards), and @iden3/js-merkletree `generateCircomVerifierProof(absentKey, root)`
// returns the SMTVerifier inputs directly (siblings/oldKey/oldValue/isOld0, fnc=1).
//
// Public-signal order (snarkjs = [outputs, then public inputs in declaration order]): the circuit
// declares `sanctionsRoot` last, so it appends at index 19 — the on-chain pool builds the same 19
// KYC public inputs and appends sanctionsRoot as the 20th.

import * as path from "path";
import * as snarkjs from "snarkjs";
import { Merkletree, InMemoryDB, str2Bytes } from "@iden3/js-merkletree";
import type { User, UTXO } from "./zeto-witness";
import { newNullifier } from "./zeto-witness-kyc";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair, formatPrivKeyForBabyJub, stringifyBigInts } = require("maci-crypto");
const { newEncryptionNonce, encodeProof, kycHash } = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const BUILD = path.join(__dirname, "..", "..", "circuits", "build");
const WASM = path.join(BUILD, "anon_enc_nullifier_kyc_sanctions_js", "anon_enc_nullifier_kyc_sanctions.wasm");
const ZKEY = path.join(BUILD, "anon_enc_nullifier_kyc_sanctions_final.zkey");

export const SANCTIONS_SMT_DEPTH = 64;

export interface EncodedProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/** A fresh off-chain sanctions SMT (depth 64). Only its root is published on-chain. */
export function newSanctionsSmt(label: string): Merkletree {
  return new Merkletree(new InMemoryDB(str2Bytes(label)), true, SANCTIONS_SMT_DEPTH);
}

/** Add a sanctioned entry (keyed by nullifier, per PRD §6.2). */
export async function addSanctioned(smt: Merkletree, key: bigint): Promise<void> {
  await smt.add(key, key);
}

/**
 * Non-inclusion path for `key` against `smt` at `root`. For an absent key this yields fnc=1 with
 * the "near" leaf (oldKey/oldValue) and isOld0; the circuit's SMTVerifier(fnc=1) accepts it.
 */
export async function buildNonInclusionPath(smt: Merkletree, key: bigint, root: any) {
  const p = await smt.generateCircomVerifierProof(key, root);
  return {
    siblings: p.siblings.map((s: any) => s.bigInt()),
    oldKey: (p.oldKey?.bigInt?.() ?? 0n) as bigint,
    oldValue: (p.oldValue?.bigInt?.() ?? 0n) as bigint,
    isOld0: p.isOld0 ? 1n : 0n,
  };
}

async function idSiblings(smt: Merkletree, key: bigint, root: any): Promise<bigint[]> {
  const p = await smt.generateCircomVerifierProof(key, root);
  return p.siblings.map((s: any) => s.bigInt());
}

/**
 * Build + prove a KYC + sanctions-screened transfer (2-in / 2-out). Same as the v0.2 KYC transfer,
 * plus a per-input sanctions non-inclusion proof against `sanctionsSmt`.
 *
 * @param utxoSmt       off-chain mirror of the pool's commitments tree (contains `inputs`)
 * @param idSmt         off-chain mirror of the pool's identities tree (contains all parties)
 * @param sanctionsSmt  off-chain sanctions tree; its root must equal the pool's sanctions root
 */
export async function prepareKycSanctionsTransferProof(
  sender: User,
  inputs: [UTXO, UTXO],
  outputs: [UTXO, UTXO],
  outputOwners: [User, User],
  utxoSmt: Merkletree,
  idSmt: Merkletree,
  sanctionsSmt: Merkletree,
) {
  const nullifiers: [bigint, bigint] = [
    inputs[0].hash !== 0n ? newNullifier(inputs[0], sender) : 0n,
    inputs[1].hash !== 0n ? newNullifier(inputs[1], sender) : 0n,
  ];

  const utxosRoot = await utxoSmt.root();
  const utxosMerkleProof = [
    await idSiblings(utxoSmt, inputs[0].hash, utxosRoot),
    inputs[1].hash !== 0n
      ? await idSiblings(utxoSmt, inputs[1].hash, utxosRoot)
      : await idSiblings(utxoSmt, 0n, utxosRoot),
  ];

  const identitiesRoot = await idSmt.root();
  const identitiesMerkleProof = [
    await idSiblings(idSmt, kycHash(sender.babyJubPublicKey), identitiesRoot),
    await idSiblings(idSmt, kycHash(outputOwners[0].babyJubPublicKey), identitiesRoot),
    await idSiblings(idSmt, kycHash(outputOwners[1].babyJubPublicKey), identitiesRoot),
  ];

  // sanctions non-inclusion per input (the spent nullifier must be absent from the tree)
  const sanctionsRoot = await sanctionsSmt.root();
  const sanc0 = await buildNonInclusionPath(sanctionsSmt, nullifiers[0], sanctionsRoot);
  const sanc1 = await buildNonInclusionPath(sanctionsSmt, nullifiers[1] !== 0n ? nullifiers[1] : 0n, sanctionsRoot);

  const ephemeral = genKeypair();
  const encryptionNonce = newEncryptionNonce() as bigint;

  const input = {
    nullifiers,
    inputCommitments: [inputs[0].hash, inputs[1].hash],
    inputValues: [BigInt(inputs[0].value), BigInt(inputs[1].value)],
    inputSalts: [inputs[0].salt, inputs[1].salt],
    inputOwnerPrivateKey: sender.formattedPrivateKey,
    ecdhPrivateKey: formatPrivKeyForBabyJub(ephemeral.privKey),
    utxosRoot: utxosRoot.bigInt(),
    utxosMerkleProof,
    enabled: [nullifiers[0] !== 0n ? 1n : 0n, nullifiers[1] !== 0n ? 1n : 0n],
    identitiesRoot: identitiesRoot.bigInt(),
    identitiesMerkleProof,
    outputCommitments: [outputs[0].hash, outputs[1].hash],
    outputValues: [BigInt(outputs[0].value), BigInt(outputs[1].value)],
    outputOwnerPublicKeys: [
      outputOwners[0].babyJubPublicKey,
      outputOwners[1].babyJubPublicKey,
    ],
    outputSalts: [outputs[0].salt, outputs[1].salt],
    encryptionNonce,
    sanctionsSiblings: [sanc0.siblings, sanc1.siblings],
    sanctionsOldKey: [sanc0.oldKey, sanc1.oldKey],
    sanctionsOldValue: [sanc0.oldValue, sanc1.oldValue],
    sanctionsIsOld0: [sanc0.isOld0, sanc1.isOld0],
    sanctionsRoot: sanctionsRoot.bigInt(),
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(stringifyBigInts(input), WASM, ZKEY);
  const ms = Date.now() - t0;

  // [ecdhPub(2), cipherTexts(8), ...]; encryptedValues = slice(2,10) for non-batch
  const encryptedValues = publicSignals.slice(2, 10).map((x: string) => BigInt(x));

  return {
    nullifiers,
    outputCommitments: [outputs[0].hash, outputs[1].hash] as [bigint, bigint],
    root: utxosRoot.bigInt(),
    sanctionsRoot: sanctionsRoot.bigInt(),
    encryptedValues,
    encryptionNonce,
    ecdhPublicKey: ephemeral.pubKey as bigint[],
    encodedProof: encodeProof(proof) as EncodedProof,
    ms,
  };
}
