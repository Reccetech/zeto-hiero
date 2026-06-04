// MVP Phase 5 — real-proof witness/proof helpers for the Zeto_AnonEnc path.
//
// Mirrors upstream vendor/zeto/solidity/test/{utils.ts, zeto_anon_enc.ts} (`prepareProof`,
// `prepareDepositProof`, `prepareWithdrawProof`, `newUser`, `newUTXO`) but:
//   - generates proofs with snarkjs.groth16.fullProve against OUR compiled artifacts in
//     circuits/build/ (our trusted setup → matches our staged *VerifierMVP contracts),
//   - avoids upstream `loadProvingKeys`/`loadCircuit` (which expect a different on-disk
//     file-naming convention and CIRCUITS_ROOT env).
//
// BabyJubJub key handling + ECDH come from maci-crypto (validated to load on Windows);
// Poseidon, salts, nonce, proof encoding and note decryption come from zeto-js.

import * as path from "path";
import * as snarkjs from "snarkjs";

// Untyped CommonJS deps — require() avoids missing-declaration TS errors.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  genKeypair,
  formatPrivKeyForBabyJub,
  genEcdhSharedKey,
  stringifyBigInts,
} = require("maci-crypto");
const {
  Poseidon,
  newSalt,
  newEncryptionNonce,
  poseidonDecrypt,
  encodeProof,
} = require("zeto-js");
/* eslint-enable @typescript-eslint/no-var-requires */

const poseidonHash4 = Poseidon.poseidon4;

const BUILD = path.join(__dirname, "..", "..", "circuits", "build");
const ART = (name: string) => ({
  wasm: path.join(BUILD, `${name}_js`, `${name}.wasm`),
  zkey: path.join(BUILD, `${name}_final.zkey`),
});

export interface User {
  signer: any;
  ethAddress: string;
  babyJubPrivateKey: bigint;
  babyJubPublicKey: bigint[];
  formattedPrivateKey: bigint;
}

export interface UTXO {
  value: number;
  hash: bigint;
  salt: bigint;
}

export const ZERO_UTXO: UTXO = { value: 0, hash: 0n, salt: 0n };

export async function newUser(signer: any): Promise<User> {
  const { privKey, pubKey } = genKeypair();
  return {
    signer,
    ethAddress: await signer.getAddress(),
    babyJubPrivateKey: privKey,
    babyJubPublicKey: pubKey,
    formattedPrivateKey: formatPrivKeyForBabyJub(privKey),
  };
}

export function newUTXO(value: number, owner: User, salt?: bigint): UTXO {
  const s = salt ?? (newSalt() as bigint);
  const hash = poseidonHash4([
    BigInt(value),
    s,
    owner.babyJubPublicKey[0],
    owner.babyJubPublicKey[1],
  ]) as bigint;
  return { value, hash, salt: s };
}

export interface EncodedProof {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
}

async function prove(circuit: string, input: any) {
  const { wasm, zkey } = ART(circuit);
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    stringifyBigInts(input),
    wasm,
    zkey,
  );
  const ms = Date.now() - t0;
  return { encodedProof: encodeProof(proof) as EncodedProof, publicSignals, ms };
}

/** Deposit: prove two output commitments sum to `amount`. outputs[1] may be ZERO_UTXO. */
export async function prepareDepositProof(owner: User, outputs: [UTXO, UTXO]) {
  const input = {
    outputCommitments: [outputs[0].hash, outputs[1].hash],
    outputValues: [BigInt(outputs[0].value), BigInt(outputs[1].value)],
    outputSalts: [outputs[0].salt, outputs[1].salt],
    outputOwnerPublicKeys: [
      owner.babyJubPublicKey,
      outputs[1].hash !== 0n ? owner.babyJubPublicKey : [0n, 0n],
    ],
  };
  const { encodedProof, ms } = await prove("deposit", input);
  return {
    outputCommitments: [outputs[0].hash, outputs[1].hash] as [bigint, bigint],
    encodedProof,
    ms,
  };
}

/**
 * Transfer (anon_enc): prove sender owns inputs, inputs==outputs by value, and each output's
 * (value, salt) is ECDH-encrypted to its owner using a fresh ephemeral keypair.
 * Returns everything the on-chain `transfer(...)` needs.
 */
export async function prepareTransferProof(
  sender: User,
  inputs: [UTXO, UTXO],
  outputs: [UTXO, UTXO],
  outputOwners: [User, User],
) {
  const ephemeral = genKeypair();
  const encryptionNonce = newEncryptionNonce() as bigint;

  const input = {
    inputCommitments: [inputs[0].hash, inputs[1].hash],
    inputValues: [BigInt(inputs[0].value), BigInt(inputs[1].value)],
    inputSalts: [inputs[0].salt, inputs[1].salt],
    inputOwnerPrivateKey: sender.formattedPrivateKey,
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

  const { encodedProof, publicSignals, ms } = await prove("anon_enc", input);

  // Public signal layout (INPUT_SIZE = 15): [ecdhPub(2), encrypted(8), inputs(2), outputs(2), nonce(1)]
  const encryptedValues = publicSignals.slice(2, 10).map((x: string) => BigInt(x));

  return {
    inputCommitments: [inputs[0].hash, inputs[1].hash] as [bigint, bigint],
    outputCommitments: [outputs[0].hash, outputs[1].hash] as [bigint, bigint],
    encryptedValues,
    encryptionNonce,
    ecdhPublicKey: ephemeral.pubKey as bigint[],
    encodedProof,
    ms,
  };
}

/** Withdraw: prove spent inputs cover `amount`, with a single change output commitment. */
export async function prepareWithdrawProof(
  owner: User,
  inputs: [UTXO, UTXO],
  output: UTXO,
) {
  const input = {
    inputCommitments: [inputs[0].hash, inputs[1].hash],
    inputValues: [BigInt(inputs[0].value), BigInt(inputs[1].value)],
    inputSalts: [inputs[0].salt, inputs[1].salt],
    inputOwnerPrivateKey: owner.formattedPrivateKey,
    outputCommitments: [output.hash],
    outputValues: [BigInt(output.value)],
    outputSalts: [output.salt],
    outputOwnerPublicKeys: [owner.babyJubPublicKey],
  };
  const { encodedProof, ms } = await prove("withdraw", input);
  return {
    inputCommitments: [inputs[0].hash, inputs[1].hash] as [bigint, bigint],
    output: output.hash,
    encodedProof,
    ms,
  };
}

/**
 * Recover a received note from a transfer's on-chain event data.
 * `recipient` computes the ECDH shared key from their BJJ private key + the ephemeral
 * public key, then Poseidon-decrypts their slice (each output is 4 ciphertext elements).
 * Returns the decrypted { value, salt }.
 */
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
