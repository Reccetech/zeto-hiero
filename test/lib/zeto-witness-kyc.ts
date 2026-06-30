// v0.2 Phase 5 — real-proof witness/proof helpers for the Zeto_AnonEncNullifierKyc path.
//
// Extends the v0.1 zeto-witness.ts (anon_enc) with the two things the KYC nullifier variant
// adds to every transfer: (1) nullifiers + a UTXO Sparse-Merkle-Tree inclusion proof, and
// (2) an identities-SMT membership proof for the sender and every output owner.
//
// Mirrors the upstream reference vendor/zeto/solidity/test/zeto_anon_enc_nullifier_kyc.ts:
//   - off-chain SMTs via @iden3/js-merkletree (must stay in lock-step with the on-chain trees),
//   - kycHash + newNullifier hashing from zeto-js / poseidon,
//   - smt.generateCircomVerifierProof(...) for the circuit's merkleProof inputs,
//   - proof via snarkjs.groth16.fullProve against OUR circuits/build artifacts.
//
// The deposit circuit is unchanged from v0.1, so deposit proofs reuse prepareDepositProof
// from zeto-witness.ts.

import * as path from "path";
import * as snarkjs from "snarkjs";
import { Merkletree, InMemoryDB, str2Bytes } from "@iden3/js-merkletree";
import type { User, UTXO } from "./zeto-witness";

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  genKeypair,
  formatPrivKeyForBabyJub,
  genEcdhSharedKey,
  stringifyBigInts,
} = require("maci-crypto");
const { Poseidon, newEncryptionNonce, poseidonDecrypt, encodeProof, kycHash } = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const poseidonHash3 = Poseidon.poseidon3;

const BUILD = path.join(__dirname, "..", "..", "circuits", "build");
const KYC_WASM = path.join(BUILD, "anon_enc_nullifier_kyc_js", "anon_enc_nullifier_kyc.wasm");
const KYC_ZKEY = path.join(BUILD, "anon_enc_nullifier_kyc_final.zkey");

// SMT depths — must match the circuit's nUTXOSMTLevels (64) and nIdentitiesSMTLevels (10),
// and the on-chain Registry/ZetoNullifier (MAX_SMT_DEPTH = 64; identity proofs use 10 levels).
export const UTXO_SMT_DEPTH = 64;
export const IDENTITIES_SMT_DEPTH = 10;

export interface EncodedProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/** Nullifier for a UTXO: Poseidon(value, salt, ownerFormattedPrivKey) — matches CheckNullifiers. */
export function newNullifier(utxo: UTXO, owner: User): bigint {
  return poseidonHash3([BigInt(utxo.value), utxo.salt, owner.formattedPrivateKey]) as bigint;
}

/** A fresh off-chain UTXO commitments SMT (depth 64), kept in sync with the pool's tree. */
export function newUtxoSmt(label: string): Merkletree {
  return new Merkletree(new InMemoryDB(str2Bytes(label)), true, UTXO_SMT_DEPTH);
}

/** A fresh off-chain identities (KYC) SMT (depth 10), kept in sync with the pool's registry. */
export function newIdentitiesSmt(label: string): Merkletree {
  return new Merkletree(new InMemoryDB(str2Bytes(label)), true, IDENTITIES_SMT_DEPTH);
}

/** Add an enrolled BabyJubJub public key to an off-chain identities SMT (leaf = kycHash(pk)). */
export async function addIdentity(smt: Merkletree, pubKey: bigint[]): Promise<void> {
  const h = kycHash(pubKey);
  await smt.add(h, h);
}

/** Add a UTXO commitment to an off-chain UTXO SMT (leaf index = value = the commitment hash). */
export async function addCommitment(smt: Merkletree, hash: bigint): Promise<void> {
  await smt.add(hash, hash);
}

async function siblings(smt: Merkletree, key: bigint, root: any): Promise<bigint[]> {
  const proof = await smt.generateCircomVerifierProof(key, root);
  return proof.siblings.map((s: any) => s.bigInt());
}

/**
 * Build + prove a KYC transfer (2-in / 2-out). Spends `inputs` (one may be ZERO), creates
 * `outputs` owned by `outputOwners`, proving: sender owns inputs, value conservation, input
 * commitments are in the UTXO SMT, and sender + both output owners are in the identities SMT.
 *
 * @param utxoSmt   off-chain mirror of the pool's commitments tree (already contains `inputs`)
 * @param idSmt     off-chain mirror of the pool's identities tree (contains all parties)
 */
export async function prepareKycTransferProof(
  sender: User,
  inputs: [UTXO, UTXO],
  outputs: [UTXO, UTXO],
  outputOwners: [User, User],
  utxoSmt: Merkletree,
  idSmt: Merkletree,
) {
  const nullifiers: [bigint, bigint] = [
    inputs[0].value || inputs[0].hash ? newNullifier(inputs[0], sender) : 0n,
    inputs[1].value || inputs[1].hash ? newNullifier(inputs[1], sender) : 0n,
  ];

  const utxosRoot = await utxoSmt.root();
  const utxosMerkleProof = [
    await siblings(utxoSmt, inputs[0].hash, utxosRoot),
    inputs[1].hash !== 0n
      ? await siblings(utxoSmt, inputs[1].hash, utxosRoot)
      : await siblings(utxoSmt, 0n, utxosRoot),
  ];

  const identitiesRoot = await idSmt.root();
  const senderProof = await siblings(idSmt, kycHash(sender.babyJubPublicKey), identitiesRoot);
  const owner0Proof = await siblings(idSmt, kycHash(outputOwners[0].babyJubPublicKey), identitiesRoot);
  const owner1Proof = await siblings(idSmt, kycHash(outputOwners[1].babyJubPublicKey), identitiesRoot);
  // [sender, output-owner-0, output-owner-1] — matches ownerPublicKeyHashes order in the circuit.
  const identitiesMerkleProof = [senderProof, owner0Proof, owner1Proof];

  const ephemeral = genKeypair();
  const encryptionNonce = newEncryptionNonce() as bigint;

  const input = {
    nullifiers,
    inputCommitments: [inputs[0].hash, inputs[1].hash],
    inputValues: [BigInt(inputs[0].value), BigInt(inputs[1].value)],
    inputSalts: [inputs[0].salt, inputs[1].salt],
    inputOwnerPrivateKey: sender.formattedPrivateKey,
    utxosRoot: utxosRoot.bigInt(),
    enabled: [nullifiers[0] !== 0n ? 1n : 0n, nullifiers[1] !== 0n ? 1n : 0n],
    utxosMerkleProof,
    identitiesRoot: identitiesRoot.bigInt(),
    identitiesMerkleProof,
    outputCommitments: [outputs[0].hash, outputs[1].hash],
    outputValues: [BigInt(outputs[0].value), BigInt(outputs[1].value)],
    outputSalts: [outputs[0].salt, outputs[1].salt],
    outputOwnerPublicKeys: [
      outputOwners[0].babyJubPublicKey,
      outputOwners[1].babyJubPublicKey,
    ],
    encryptionNonce,
    ecdhPrivateKey: formatPrivKeyForBabyJub(ephemeral.privKey),
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    stringifyBigInts(input),
    KYC_WASM,
    KYC_ZKEY,
  );
  const ms = Date.now() - t0;

  // Non-batch public signal layout: [ecdhPub(2), encrypted(8), ...]; encryptedValues = slice(2,10).
  const encryptedValues = publicSignals.slice(2, 10).map((x: string) => BigInt(x));

  return {
    nullifiers,
    outputCommitments: [outputs[0].hash, outputs[1].hash] as [bigint, bigint],
    root: utxosRoot.bigInt(),
    encryptedValues,
    encryptionNonce,
    ecdhPublicKey: ephemeral.pubKey as bigint[],
    encodedProof: encodeProof(proof) as EncodedProof,
    ms,
  };
}

const WITHDRAW_WASM = path.join(BUILD, "withdraw_nullifier_js", "withdraw_nullifier.wasm");
const WITHDRAW_ZKEY = path.join(BUILD, "withdraw_nullifier_final.zkey");

/**
 * Build + prove a nullifier withdraw (2-in / 1-out change). Proves the spent inputs cover
 * `amount`, the inputs are in the UTXO SMT, and the single change output is well-formed.
 * Uses the `withdraw_nullifier` circuit (distinct from v0.1's plain `withdraw`).
 */
export async function prepareKycWithdrawProof(
  owner: User,
  inputs: [UTXO, UTXO],
  changeOutput: UTXO,
  utxoSmt: Merkletree,
) {
  const nullifiers: [bigint, bigint] = [
    inputs[0].hash !== 0n ? newNullifier(inputs[0], owner) : 0n,
    inputs[1].hash !== 0n ? newNullifier(inputs[1], owner) : 0n,
  ];

  const root = await utxoSmt.root();
  const merkleProof = [
    await siblings(utxoSmt, inputs[0].hash, root),
    inputs[1].hash !== 0n
      ? await siblings(utxoSmt, inputs[1].hash, root)
      : await siblings(utxoSmt, 0n, root),
  ];

  const input = {
    nullifiers,
    inputCommitments: [inputs[0].hash, inputs[1].hash],
    inputValues: [BigInt(inputs[0].value), BigInt(inputs[1].value)],
    inputSalts: [inputs[0].salt, inputs[1].salt],
    inputOwnerPrivateKey: owner.formattedPrivateKey,
    root: root.bigInt(),
    merkleProof,
    enabled: [nullifiers[0] !== 0n ? 1n : 0n, nullifiers[1] !== 0n ? 1n : 0n],
    outputCommitments: [changeOutput.hash],
    outputValues: [BigInt(changeOutput.value)],
    outputSalts: [changeOutput.salt],
    outputOwnerPublicKeys: [owner.babyJubPublicKey],
  };

  const t0 = Date.now();
  const { proof } = await snarkjs.groth16.fullProve(
    stringifyBigInts(input),
    WITHDRAW_WASM,
    WITHDRAW_ZKEY,
  );
  const ms = Date.now() - t0;

  return {
    nullifiers,
    output: changeOutput.hash,
    root: root.bigInt(),
    encodedProof: encodeProof(proof) as EncodedProof,
    ms,
  };
}

/** Recover a received note from a transfer event (same ECDH scheme as v0.1's decryptNote). */
export function decryptNote(
  recipient: User,
  encryptedValues: bigint[],
  encryptionNonce: bigint,
  ecdhPublicKey: bigint[],
  outputIndex: number,
): { value: bigint; salt: bigint } {
  const sharedKey = genEcdhSharedKey(recipient.babyJubPrivateKey, ecdhPublicKey);
  const slice = encryptedValues.slice(4 * outputIndex, 4 * outputIndex + 4);
  const plain = poseidonDecrypt(slice, sharedKey, encryptionNonce, 2);
  return { value: BigInt(plain[0]), salt: BigInt(plain[1]) };
}
