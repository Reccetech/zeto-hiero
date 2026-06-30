// SPDX-License-Identifier: Apache-2.0
//
// zeto-hiero v0.4 — production transfer circuit: KYC + sanctions + non-repudiation.
//
// Extends the v0.3 KYC+sanctions circuit with an **authority encryption** block: every output's
// secrets (plus input owner key and per-input value/salt) are additionally encrypted to a
// designated authority's BabyJubJub public key, so a regulator holding `sk_auth` can decrypt the
// full transaction (non-repudiation), while on-chain observers and even the counterparties cannot.
//
// Authority key is a PUBLIC INPUT (`authorityPublicKey`), matching upstream
// anon_enc_nullifier_non_repudiation — NOT baked into the verifying key. The pool checks it
// against a stored value on-chain. (This deviates from PRD §6.2/F-1, which bakes pk_auth into the
// circuit; the public-input approach is simpler, avoids per-key recompilation, and means the
// authority key need NOT be fixed before the trusted-setup ceremony.)
//
// Public-signal order: snarkjs = [outputs, then public inputs in signal-declaration order].
// `sanctionsRoot` then `authorityPublicKey` are declared last → they append at the end of the
// public-input vector. On-chain the pool builds the v0.3 layout and appends sanctionsRoot +
// authorityPublicKey[0] + authorityPublicKey[1].
//
// Compile from vendor/zeto/zkp/circuits with: -l node_modules -l .
pragma circom 2.2.2;

include "lib/check-positive.circom";
include "lib/check-hashes.circom";
include "lib/check-sum.circom";
include "lib/check-nullifiers.circom";
include "lib/check-smt-proof.circom";
include "lib/encrypt-outputs.circom";
include "lib/ecdh.circom";
include "lib/encrypt.circom";
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/smt/smtverifier.circom";

template ZetoSanctionsNR(nInputs, nOutputs, nUTXOSMTLevels, nIdentitiesSMTLevels, nSanctionsSMTLevels) {
  // --- inherited from anon_enc_nullifier_kyc (+ v0.3 sanctions) ---
  signal input nullifiers[nInputs];
  signal input inputCommitments[nInputs];
  signal input inputValues[nInputs];
  signal input inputSalts[nInputs];
  signal input inputOwnerPrivateKey;
  signal input ecdhPrivateKey;
  signal input utxosRoot;
  signal input utxosMerkleProof[nInputs][nUTXOSMTLevels];
  signal input enabled[nInputs];
  signal input identitiesRoot;
  signal input identitiesMerkleProof[nOutputs + 1][nIdentitiesSMTLevels];
  signal input outputCommitments[nOutputs];
  signal input outputValues[nOutputs];
  signal input outputOwnerPublicKeys[nOutputs][2];
  signal input outputSalts[nOutputs];
  signal input encryptionNonce;

  // v0.3 sanctions non-inclusion
  signal input sanctionsSiblings[nInputs][nSanctionsSMTLevels];
  signal input sanctionsOldKey[nInputs];
  signal input sanctionsOldValue[nInputs];
  signal input sanctionsIsOld0[nInputs];
  // public inputs declared last → append to the public-signal vector in this order:
  signal input sanctionsRoot;
  signal input authorityPublicKey[2];

  // outputs
  signal output ecdhPublicKey[2];
  signal output cipherTexts[nOutputs][4];
  // authority ciphertext. Poseidon SymmetricEncrypt pads the plaintext up to a multiple of 3,
  // then the ciphertext is paddedLen + 1. plaintext = [ownerPub(2), per-input value+salt
  // (2*nInputs), per-output ownerPub (2*nOutputs), per-output value+salt (2*nOutputs)].
  var AUTH_PT_LEN = 2 + 2 * nInputs + 4 * nOutputs;                         // 14 for (2,2)
  var AUTH_PAD = AUTH_PT_LEN + ((AUTH_PT_LEN % 3 == 0) ? 0 : (3 - (AUTH_PT_LEN % 3))); // 15
  signal output cipherTextAuthority[AUTH_PAD + 1];                          // 16 for (2,2)

  var inputOwnerPubKeyAx, inputOwnerPubKeyAy;
  (inputOwnerPubKeyAx, inputOwnerPubKeyAy) = BabyPbk()(in <== inputOwnerPrivateKey);

  CheckPositive(nOutputs)(outputValues <== outputValues);

  CommitmentInputs() inAuxInputs[nInputs];
  for (var i = 0; i < nInputs; i++) {
    inAuxInputs[i].value <== inputValues[i];
    inAuxInputs[i].salt <== inputSalts[i];
    inAuxInputs[i].ownerPublicKey <== [inputOwnerPubKeyAx, inputOwnerPubKeyAy];
  }
  CommitmentInputs() outAuxInputs[nOutputs];
  for (var i = 0; i < nOutputs; i++) {
    outAuxInputs[i].value <== outputValues[i];
    outAuxInputs[i].salt <== outputSalts[i];
    outAuxInputs[i].ownerPublicKey <== outputOwnerPublicKeys[i];
  }

  CheckHashes(nInputs)(commitmentHashes <== inputCommitments, commitmentInputs <== inAuxInputs);
  CheckHashes(nOutputs)(commitmentHashes <== outputCommitments, commitmentInputs <== outAuxInputs);
  CheckNullifiers(nInputs)(nullifiers <== nullifiers, values <== inputValues, salts <== inputSalts, ownerPrivateKey <== inputOwnerPrivateKey);
  CheckSum(nInputs, nOutputs)(inputValues <== inputValues, outputValues <== outputValues);
  CheckSMTProof(nInputs, nUTXOSMTLevels)(root <== utxosRoot, merkleProof <== utxosMerkleProof, enabled <== enabled, leafNodeIndexes <== inputCommitments, leafNodeValues <== inputCommitments);

  // KYC: sender + all output owners are members of the identities SMT
  var ownerPublicKeyHashes[nOutputs + 1];
  ownerPublicKeyHashes[0] = Poseidon(2)(inputs <== [inputOwnerPubKeyAx, inputOwnerPubKeyAy]);
  var identitiesMTPCheckEnabled[nOutputs + 1];
  identitiesMTPCheckEnabled[0] = 1;
  for (var i = 0; i < nOutputs; i++) {
    ownerPublicKeyHashes[i+1] = Poseidon(2)(inputs <== outputOwnerPublicKeys[i]);
    identitiesMTPCheckEnabled[i+1] = 1;
  }
  CheckSMTProof(nOutputs + 1, nIdentitiesSMTLevels)(root <== identitiesRoot, merkleProof <== identitiesMerkleProof, enabled <== identitiesMTPCheckEnabled, leafNodeIndexes <== ownerPublicKeyHashes, leafNodeValues <== ownerPublicKeyHashes);

  // v0.3 sanctions: each spent nullifier is NOT in the sanctions SMT (fnc=1)
  for (var i = 0; i < nInputs; i++) {
    var sib[nSanctionsSMTLevels];
    for (var j = 0; j < nSanctionsSMTLevels; j++) { sib[j] = sanctionsSiblings[i][j]; }
    SMTVerifier(nSanctionsSMTLevels)(
      enabled <== enabled[i], root <== sanctionsRoot, siblings <== sib,
      key <== nullifiers[i], value <== 0, fnc <== 1,
      oldKey <== sanctionsOldKey[i], oldValue <== sanctionsOldValue[i], isOld0 <== sanctionsIsOld0[i]
    );
  }

  // recipient ECDH encryption (same as KYC variant)
  (ecdhPublicKey, cipherTexts) <== EncryptOutputs(nOutputs)(ecdhPrivateKey <== ecdhPrivateKey, encryptionNonce <== encryptionNonce, commitmentInputs <== outAuxInputs);

  // v0.4 non-repudiation: encrypt all secrets to the authority's public key
  var sharedSecretAuthority[2];
  (sharedSecretAuthority) = Ecdh()(privKey <== ecdhPrivateKey, pubKey <== authorityPublicKey);
  var plainText[2 + 2 * nInputs + 4 * nOutputs];
  plainText[0] = inputOwnerPubKeyAx;
  plainText[1] = inputOwnerPubKeyAy;
  var idx = 2;
  for (var i = 0; i < nInputs; i++) { plainText[idx] = inputValues[i]; idx++; plainText[idx] = inputSalts[i]; idx++; }
  for (var i = 0; i < nOutputs; i++) { plainText[idx] = outputOwnerPublicKeys[i][0]; idx++; plainText[idx] = outputOwnerPublicKeys[i][1]; idx++; }
  for (var i = 0; i < nOutputs; i++) { plainText[idx] = outputValues[i]; idx++; plainText[idx] = outputSalts[i]; idx++; }
  cipherTextAuthority <== SymmetricEncrypt(2 + 2 * nInputs + 4 * nOutputs)(plainText <== plainText, key <== sharedSecretAuthority, nonce <== encryptionNonce);
}

// 2-in / 2-out; UTXO depth 64, identities depth 10, sanctions depth 64.
component main { public [ nullifiers, outputCommitments, encryptionNonce, utxosRoot, identitiesRoot, enabled, sanctionsRoot, authorityPublicKey ] } = ZetoSanctionsNR(2, 2, 64, 10, 64);
