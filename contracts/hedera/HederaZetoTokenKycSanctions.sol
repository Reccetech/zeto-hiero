// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {Zeto_AnonEncNullifierKyc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc_nullifier_kyc.sol";
import {ZetoHTSBridge} from "./ZetoHTSBridge.sol";
import {SanctionsModule} from "./SanctionsModule.sol";
import {Commonlib} from "../../vendor/zeto/solidity/contracts/lib/common.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Groth16 verifier with the 20-public-signal shape of the KYC+sanctions transfer circuit
/// (the KYC variant's 19 inputs plus a trailing `sanctionsRoot`).
interface IAnonEncNullifierKycSanctionsVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[20] calldata pubSignals
    ) external view returns (bool);
}

/// @title HederaZetoTokenKycSanctions
/// @notice v0.3 Hedera pool: upstream Zeto_AnonEncNullifierKyc (anonymity + ECDH + nullifiers +
/// KYC) + our ZetoHTSBridge + SanctionsModule. Adds ZK **sanctions screening**: every screened
/// transfer proves each spent nullifier is NOT in the on-chain sanctions Sparse Merkle Tree
/// (non-inclusion), binding the proof to the current `sanctionsMerkleRoot`.
///
/// Design:
///  - The KYC+sanctions transfer verifier (20 public signals) is stored in the inherited
///    `_verifier` slot (pass it as `VerifiersInfo.verifier` at init). `transferScreened` casts
///    `address(_verifier)` to the 20-signal interface. The INHERITED `transfer` (19-signal) must
///    NOT be used — it would call a [19] selector on the [20] verifier and revert. Use
///    `transferScreened`.
///  - Public-signal layout mirrors the upstream KYC `constructPublicInputs` (19 fields) with
///    `uint256(sanctionsMerkleRoot)` appended as the 20th — matching the circuit, which declares
///    `sanctionsRoot` last (snarkjs orders public signals as [outputs, then inputs by declaration]).
///  - Deposit/withdraw are unchanged from v0.2 (not sanctions-gated upstream); `_deposit` /
///    `_withdrawWithNullifiers` keep the HTS + shielded-supply overrides.
///  - KYC enrollment is the inherited owner-only `register(pubKey, data)`; sanctions root
///    management is `updateSanctionsMerkleRoot` (owner-or-oracle) from SanctionsModule.
///
/// Deferred to v0.4: non-repudiation / authority encryption / DeRec / HCS audit.
contract HederaZetoTokenKycSanctions is Zeto_AnonEncNullifierKyc, ZetoHTSBridge, SanctionsModule {
    error SanctionsTransferProofInvalid();

    uint256 private constant SANCTIONS_INPUT_SIZE = 20;

    /// @notice One-time Hedera setup: associate the HTS token and wire it as the ERC-20.
    function setupHTS(address token) external onlyOwner {
        _associate(token);
        setERC20(IERC20(token));
    }

    function _deposit(
        uint256 amount,
        uint256[] memory outputs,
        Commonlib.Proof calldata proof
    ) public override {
        _requireHTSAssociated(address(_erc20));
        _incrementShieldedSupply(address(_erc20), amount);
        super._deposit(amount, outputs, proof);
    }

    function _withdrawWithNullifiers(
        uint256 amount,
        uint256[] memory nullifiers,
        uint256 output,
        uint256 root,
        Commonlib.Proof calldata proof
    ) public override {
        _decrementShieldedSupply(address(_erc20), amount);
        super._withdrawWithNullifiers(amount, nullifiers, output, root, proof);
    }

    /// @notice A private transfer that additionally proves each spent nullifier is NOT on the
    /// sanctions list. `sanctionsRoot` must equal the current on-chain `sanctionsMerkleRoot`
    /// (checked up front for a clean, gas-cheap revert) and is bound into the proof's 20th public
    /// signal — so a proof for any other root also fails verification. Mirrors the upstream KYC
    /// `transfer` body, swapping in the 20-signal verifier. Use this, not the inherited `transfer`.
    function transferScreened(
        uint256[] memory nullifiers,
        uint256[] memory outputs,
        uint256 root,
        uint256 encryptionNonce,
        uint256[2] memory ecdhPublicKey,
        uint256[] memory encryptedValues,
        uint256 sanctionsRoot,
        Commonlib.Proof calldata proof,
        bytes calldata data
    ) public returns (bool) {
        // Fail fast if the caller's proof targets a stale sanctions root (before the costly verify).
        _requireCurrentSanctionsRoot(bytes32(sanctionsRoot));

        nullifiers = checkAndPadCommitments(nullifiers);
        outputs = checkAndPadCommitments(outputs);
        validateTransactionProposal(nullifiers, outputs, root, false);

        uint256[SANCTIONS_INPUT_SIZE] memory pub = _buildScreenedPublicInputs(
            nullifiers,
            outputs,
            root,
            encryptionNonce,
            ecdhPublicKey,
            encryptedValues
        );

        if (
            !IAnonEncNullifierKycSanctionsVerifier(address(_verifier)).verifyProof(
                proof.pA,
                proof.pB,
                proof.pC,
                pub
            )
        ) revert SanctionsTransferProofInvalid();

        uint256[] memory empty;
        processInputsAndOutputs(nullifiers, outputs, empty, address(0));

        emit UTXOTransferWithEncryptedValues(
            nullifiers,
            outputs,
            encryptionNonce,
            ecdhPublicKey,
            encryptedValues,
            msg.sender,
            data
        );
        return true;
    }

    /// @dev Builds the 20 public signals: the upstream KYC layout (19) + `sanctionsMerkleRoot`.
    /// Reverts (via SanctionsModule) is not needed here — binding the current root into the
    /// public inputs means a proof for any other root simply fails verification.
    function _buildScreenedPublicInputs(
        uint256[] memory nullifiers,
        uint256[] memory outputs,
        uint256 root,
        uint256 encryptionNonce,
        uint256[2] memory ecdhPublicKey,
        uint256[] memory encryptedValues
    ) internal view returns (uint256[SANCTIONS_INPUT_SIZE] memory pub) {
        uint256 i;
        uint256 p;
        for (i = 0; i < ecdhPublicKey.length; ++i) pub[p++] = ecdhPublicKey[i];
        for (i = 0; i < encryptedValues.length; ++i) pub[p++] = encryptedValues[i];
        for (i = 0; i < nullifiers.length; ++i) pub[p++] = nullifiers[i];
        pub[p++] = root;
        for (i = 0; i < nullifiers.length; ++i) pub[p++] = (nullifiers[i] == 0) ? 0 : 1;
        pub[p++] = getIdentitiesRoot();
        for (i = 0; i < outputs.length; ++i) pub[p++] = outputs[i];
        pub[p++] = encryptionNonce;
        pub[p++] = uint256(sanctionsMerkleRoot); // 20th signal — current on-chain sanctions root
    }
}
