// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

interface IDepositVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[3] calldata pubSignals
    ) external view returns (bool);
}

/// @title VerifierGasProbe
/// @notice Wraps a `view` Groth16 verifyProof in a state-changing call so we get a
/// real transaction receipt (with gasUsed) on testnet. This measures what the BN254
/// pairing verification actually costs inside a transaction — representative of the
/// verification component of a real deposit. Test/measurement-only.
contract VerifierGasProbe {
    IDepositVerifier public immutable verifier;
    bool public lastResult;
    uint256 public verifyCount;

    event Verified(bool result, uint256 gasLeftAtEmit);

    constructor(address _verifier) {
        verifier = IDepositVerifier(_verifier);
    }

    function probe(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[3] calldata pubSignals
    ) external {
        bool ok = verifier.verifyProof(pA, pB, pC, pubSignals);
        lastResult = ok;
        verifyCount += 1;
        emit Verified(ok, gasleft());
    }
}
