// SPDX-License-Identifier: Apache-2.0
//
// zeto-hiero v0.3 — KYC + sanctions screening transfer circuit.
//
// Extends upstream Zeto's anon_enc_nullifier_kyc (anonymity + ECDH encryption + nullifiers +
// KYC identity membership) with a per-input **sanctions non-inclusion** proof: for each spent
// input, prove its nullifier is NOT a member of an off-chain sanctions Sparse Merkle Tree whose
// root (`sanctionsRoot`) is published on-chain. This is the PPOI (Proof of Proof of Innocence)
// equivalent.
//
// Non-inclusion uses iden3 SMTVerifier with fnc=1 (0=inclusion, 1=exclusion — per the in-repo
// circomlib header; the PRD had this backwards). The @iden3/js-merkletree
// generateCircomVerifierProof for an absent key supplies siblings/oldKey/oldValue/isOld0 directly.
//
// IMPORTANT — public signal ordering: snarkjs orders public signals as [outputs, then public
// inputs in SIGNAL-DECLARATION order]. `sanctionsRoot` is declared LAST so it appends at the end
// of the public-signal vector. The on-chain pool therefore builds the same 19 public inputs as
// the KYC variant and appends `sanctionsRoot` as the 20th.
//
// Compile from vendor/zeto/zkp/circuits with: -l node_modules -l .
pragma circom 2.2.2;

include "lib/check-positive.circom";
include "lib/check-hashes.circom";
include "lib/check-sum.circom";
include "lib/check-nullifiers.circom";
include "lib/check-smt-proof.circom";
include "lib/encrypt-outputs.circom";
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/smt/smtverifier.circom";

template ZetoSanctions(nInputs, nOutputs, nUTXOSMTLevels, nIdentitiesSMTLevels, nSanctionsSMTLevels) {
  // --- inherited from anon_enc_nullifier_kyc ---
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

  // --- v0.3 sanctions non-inclusion (declared last → sanctionsRoot appends to public signals) ---
  signal input sanctionsSiblings[nInputs][nSanctionsSMTLevels];
  signal input sanctionsOldKey[nInputs];
  signal input sanctionsOldValue[nInputs];
  signal input sanctionsIsOld0[nInputs];
  signal input sanctionsRoot;

  // outputs (same as KYC variant)
  signal output ecdhPublicKey[2];
  signal output cipherTexts[nOutputs][4];

  // derive sender's public key from the secret input key
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

  // input commitments are members of the UTXO SMT
  CheckSMTProof(nInputs, nUTXOSMTLevels)(root <== utxosRoot, merkleProof <== utxosMerkleProof, enabled <== enabled, leafNodeIndexes <== inputCommitments, leafNodeValues <== inputCommitments);

  // sender + all output owners are members of the identities SMT (KYC)
  var ownerPublicKeyHashes[nOutputs + 1];
  ownerPublicKeyHashes[0] = Poseidon(2)(inputs <== [inputOwnerPubKeyAx, inputOwnerPubKeyAy]);
  var identitiesMTPCheckEnabled[nOutputs + 1];
  identitiesMTPCheckEnabled[0] = 1;
  for (var i = 0; i < nOutputs; i++) {
    ownerPublicKeyHashes[i+1] = Poseidon(2)(inputs <== outputOwnerPublicKeys[i]);
    identitiesMTPCheckEnabled[i+1] = 1;
  }
  CheckSMTProof(nOutputs + 1, nIdentitiesSMTLevels)(root <== identitiesRoot, merkleProof <== identitiesMerkleProof, enabled <== identitiesMTPCheckEnabled, leafNodeIndexes <== ownerPublicKeyHashes, leafNodeValues <== ownerPublicKeyHashes);

  // v0.3: each spent nullifier is NOT a member of the sanctions SMT (non-inclusion, fnc=1).
  // `enabled[i]` skips zero/padding inputs (a padded input has nullifier 0, enabled 0).
  for (var i = 0; i < nInputs; i++) {
    var sib[nSanctionsSMTLevels];
    for (var j = 0; j < nSanctionsSMTLevels; j++) {
      sib[j] = sanctionsSiblings[i][j];
    }
    SMTVerifier(nSanctionsSMTLevels)(
      enabled <== enabled[i],
      root <== sanctionsRoot,
      siblings <== sib,
      key <== nullifiers[i],
      value <== 0,
      fnc <== 1, // 1 = exclusion / non-membership
      oldKey <== sanctionsOldKey[i],
      oldValue <== sanctionsOldValue[i],
      isOld0 <== sanctionsIsOld0[i]
    );
  }

  (ecdhPublicKey, cipherTexts) <== EncryptOutputs(nOutputs)(ecdhPrivateKey <== ecdhPrivateKey, encryptionNonce <== encryptionNonce, commitmentInputs <== outAuxInputs);
}

// 2 inputs, 2 outputs, UTXO tree depth 64, identities tree depth 10, sanctions tree depth 64.
// Public inputs (declaration order): nullifiers, utxosRoot, enabled, identitiesRoot,
// outputCommitments, encryptionNonce, sanctionsRoot.
component main { public [ nullifiers, outputCommitments, encryptionNonce, utxosRoot, identitiesRoot, enabled, sanctionsRoot ] } = ZetoSanctions(2, 2, 64, 10, 64);
