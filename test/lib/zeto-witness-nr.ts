// v0.4 Phase 2/5 — real-proof witness/proof helpers for the production transfer circuit
// (anon_enc_nullifier_kyc_sanctions_non_repudiation): KYC + sanctions + authority encryption.
//
// Extends the v0.3 sanctions witness with `authorityPublicKey` (a public input) and extracts the
// authority ciphertext from the proof's public signals. The authority (holding sk_auth) can later
// decrypt the full transaction via ECDH with the ephemeral public key — see decryptAuthority().
//
// Public-signal order (snarkjs = [outputs, then public inputs by declaration]):
//   [ecdhPub(2), cipherTexts(8), cipherTextAuthority(16), nullifiers(2), root, enabled(2),
//    identitiesRoot, outputs(2), nonce, sanctionsRoot, authorityPublicKey(2)]  = 38

import * as path from "path";
import * as snarkjs from "snarkjs";
import { Merkletree } from "@iden3/js-merkletree";
import type { User, UTXO } from "./zeto-witness";
import { newNullifier } from "./zeto-witness-kyc";
import { buildNonInclusionPath } from "./zeto-witness-sanctions";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair, formatPrivKeyForBabyJub, genEcdhSharedKey, stringifyBigInts } = require("maci-crypto");
const { newEncryptionNonce, encodeProof, kycHash, poseidonDecrypt } = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const BUILD = path.join(__dirname, "..", "..", "circuits", "build");
const NAME = "anon_enc_nullifier_kyc_sanctions_non_repudiation";
const WASM = path.join(BUILD, `${NAME}_js`, `${NAME}.wasm`);
const ZKEY = path.join(BUILD, `${NAME}_final.zkey`);

const CT_RECIPIENT = 8; // cipherTexts: nOutputs(2) * 4
const CT_AUTHORITY = 16; // cipherTextAuthority for (2,2)

export interface EncodedProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

async function siblings(smt: Merkletree, key: bigint, root: any): Promise<bigint[]> {
  const p = await smt.generateCircomVerifierProof(key, root);
  return p.siblings.map((s: any) => s.bigInt());
}

/**
 * Build + prove a confidential transfer (KYC + sanctions + non-repudiation, 2-in / 2-out).
 * `authorityPubKey` is the pool's authority BabyJubJub public key (a public input).
 */
export async function prepareNRTransferProof(
  sender: User,
  inputs: [UTXO, UTXO],
  outputs: [UTXO, UTXO],
  outputOwners: [User, User],
  utxoSmt: Merkletree,
  idSmt: Merkletree,
  sanctionsSmt: Merkletree,
  authorityPubKey: bigint[],
) {
  const nullifiers: [bigint, bigint] = [
    inputs[0].hash !== 0n ? newNullifier(inputs[0], sender) : 0n,
    inputs[1].hash !== 0n ? newNullifier(inputs[1], sender) : 0n,
  ];

  const utxosRoot = await utxoSmt.root();
  const utxosMerkleProof = [
    await siblings(utxoSmt, inputs[0].hash, utxosRoot),
    inputs[1].hash !== 0n ? await siblings(utxoSmt, inputs[1].hash, utxosRoot) : await siblings(utxoSmt, 0n, utxosRoot),
  ];

  const identitiesRoot = await idSmt.root();
  const identitiesMerkleProof = [
    await siblings(idSmt, kycHash(sender.babyJubPublicKey), identitiesRoot),
    await siblings(idSmt, kycHash(outputOwners[0].babyJubPublicKey), identitiesRoot),
    await siblings(idSmt, kycHash(outputOwners[1].babyJubPublicKey), identitiesRoot),
  ];

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
    outputOwnerPublicKeys: [outputOwners[0].babyJubPublicKey, outputOwners[1].babyJubPublicKey],
    outputSalts: [outputs[0].salt, outputs[1].salt],
    encryptionNonce,
    sanctionsSiblings: [sanc0.siblings, sanc1.siblings],
    sanctionsOldKey: [sanc0.oldKey, sanc1.oldKey],
    sanctionsOldValue: [sanc0.oldValue, sanc1.oldValue],
    sanctionsIsOld0: [sanc0.isOld0, sanc1.isOld0],
    sanctionsRoot: sanctionsRoot.bigInt(),
    authorityPublicKey: [authorityPubKey[0], authorityPubKey[1]],
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(stringifyBigInts(input), WASM, ZKEY);
  const ms = Date.now() - t0;

  const encryptedValues = publicSignals.slice(2, 2 + CT_RECIPIENT).map((x: string) => BigInt(x));
  const cipherTextAuthority = publicSignals
    .slice(2 + CT_RECIPIENT, 2 + CT_RECIPIENT + CT_AUTHORITY)
    .map((x: string) => BigInt(x));

  return {
    nullifiers,
    outputCommitments: [outputs[0].hash, outputs[1].hash] as [bigint, bigint],
    root: utxosRoot.bigInt(),
    sanctionsRoot: sanctionsRoot.bigInt(),
    encryptedValues,
    cipherTextAuthority,
    encryptionNonce,
    ecdhPublicKey: ephemeral.pubKey as bigint[],
    encodedProof: encodeProof(proof) as EncodedProof,
    ms,
  };
}

/**
 * Authority audit decrypt: the authority (holding `authorityPrivKey`) recovers the full plaintext
 * [ownerPub(2), per-input value+salt, per-output ownerPub, per-output value+salt] from the
 * authority ciphertext via ECDH with the transfer's ephemeral public key.
 */
export function decryptAuthority(
  authorityPrivKey: bigint,
  cipherTextAuthority: bigint[],
  encryptionNonce: bigint,
  ecdhPublicKey: bigint[],
  plaintextLen: number,
): bigint[] {
  const shared = genEcdhSharedKey(authorityPrivKey, ecdhPublicKey);
  return poseidonDecrypt(cipherTextAuthority, shared, encryptionNonce, plaintextLen).map((x: any) => BigInt(x));
}
