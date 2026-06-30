// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/// @title MockGroth16Verifier
/// @notice Permissive verifier that returns true for any proof. Used in MVP Phase 4
/// integration tests to exercise the contract wiring (HTS association, shielded-supply
/// tracking, ERC-20 movement) without generating real ZK proofs. Real proofs against
/// upstream test keys are exercised in MVP Phase 5.
/// @dev Declares the verifyProof overloads used by the AnonEnc path's deposit ([3]),
/// withdraw ([4]), and transfer ([15]) verifiers. Test-only — never deployed to a real network.
contract MockGroth16Verifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[3] calldata
    ) external pure returns (bool) {
        return true;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata
    ) external pure returns (bool) {
        return true;
    }

    // v0.2 KYC path: nullifier withdraw public signals [7]
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[7] calldata
    ) external pure returns (bool) {
        return true;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[15] calldata
    ) external pure returns (bool) {
        return true;
    }

    // v0.2 KYC path: anon_enc_nullifier_kyc transfer public signals [19]
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[19] calldata
    ) external pure returns (bool) {
        return true;
    }
}
