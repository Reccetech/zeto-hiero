// v0.5 — real-proof witness/proof helpers for the non-fungible (NFT) pool circuit
// (nf_anon_nullifier_transfer, 1-in / 1-out). Mirrors upstream vendor/.../zeto_nf_anon_nullifier.ts.
//
// NFT note commitment = Poseidon5(tokenId, uriHash, salt, ownerPubKeyX, ownerPubKeyY).
// NFT nullifier        = Poseidon4(tokenId, uriHash, salt, ownerFormattedPrivKey).
// The transfer circuit binds tokenId + tokenUri privately and preserves them input→output.
// Public signals: [nullifier, root, outputCommitment].

import * as path from "path";
import * as snarkjs from "snarkjs";
import { Merkletree } from "@iden3/js-merkletree";
import type { User } from "./zeto-witness";

/* eslint-disable @typescript-eslint/no-var-requires */
const { stringifyBigInts } = require("maci-crypto");
const { Poseidon, newSalt, encodeProof, tokenUriHash } = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const poseidon5 = Poseidon.poseidon5;
const poseidon4 = Poseidon.poseidon4;

const BUILD = path.join(__dirname, "..", "..", "circuits", "build");
const NAME = "nf_anon_nullifier_transfer";
const WASM = path.join(BUILD, `${NAME}_js`, `${NAME}.wasm`);
const ZKEY = path.join(BUILD, `${NAME}_final.zkey`);

export interface AssetUTXO {
  tokenId: number;
  uri: string;
  salt: bigint;
  hash: bigint;
}

export interface EncodedProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

/** Build an NFT note (commitment) owned by `owner`. */
export function newAssetUTXO(tokenId: number, uri: string, owner: User, salt?: bigint): AssetUTXO {
  const s = salt ?? (newSalt() as bigint);
  const hash = poseidon5([
    BigInt(tokenId),
    tokenUriHash(uri),
    s,
    owner.babyJubPublicKey[0],
    owner.babyJubPublicKey[1],
  ]) as bigint;
  return { tokenId, uri, salt: s, hash };
}

/** Nullifier for an NFT note spent by `owner`. */
export function newAssetNullifier(utxo: AssetUTXO, owner: User): bigint {
  return poseidon4([BigInt(utxo.tokenId), tokenUriHash(utxo.uri), utxo.salt, owner.formattedPrivateKey]) as bigint;
}

/**
 * Build + prove an NFT transfer: spend `input` (owned by `sender`), create `output` (owned by
 * `outputOwner`, same tokenId+uri). `utxoSmt` is the off-chain mirror of the pool's commitments
 * tree (already contains `input.hash`).
 */
export async function prepareNfTransferProof(
  sender: User,
  input: AssetUTXO,
  output: AssetUTXO,
  outputOwner: User,
  utxoSmt: Merkletree,
) {
  const nullifier = newAssetNullifier(input, sender);
  const root = await utxoSmt.root();
  const p = await utxoSmt.generateCircomVerifierProof(input.hash, root);
  const merkleProof = p.siblings.map((s: any) => s.bigInt());

  const input_ = {
    nullifier,
    inputCommitment: input.hash,
    tokenId: BigInt(input.tokenId),
    tokenUri: tokenUriHash(input.uri),
    inputSalt: input.salt,
    inputOwnerPrivateKey: sender.formattedPrivateKey,
    root: root.bigInt(),
    merkleProof,
    outputCommitment: output.hash,
    outputSalt: output.salt,
    outputOwnerPublicKey: [outputOwner.babyJubPublicKey[0], outputOwner.babyJubPublicKey[1]],
  };

  const t0 = Date.now();
  const { proof } = await snarkjs.groth16.fullProve(stringifyBigInts(input_), WASM, ZKEY);
  const ms = Date.now() - t0;

  return {
    nullifier,
    outputCommitment: output.hash,
    root: root.bigInt(),
    encodedProof: encodeProof(proof) as EncodedProof,
    ms,
  };
}
