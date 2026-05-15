// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {IZetoVerifierRegistry} from "../hedera/ZetoVkeySetter.sol";

/// @title MockVerifierRegistry
/// @notice Test-only verifier registry that records which circuits have had vkeys set.
/// In production this is the on-chain Groth16 verifier the pool consults.
/// @dev Test-only. NOT deployed to testnet or mainnet.
contract MockVerifierRegistry is IZetoVerifierRegistry {
    mapping(bytes32 => bool) public hasVkey;
    mapping(bytes32 => VerifyingKey) private _stored;
    uint256 public setCount;

    event MockVkeySet(bytes32 indexed circuitId);

    function setVerifyingKey(bytes32 circuitId, VerifyingKey calldata vk) external {
        // Copy the verifying key into storage. Solidity doesn't allow direct calldata-to-storage
        // for nested types with dynamic arrays, so we do field-by-field.
        VerifyingKey storage stored = _stored[circuitId];
        stored.alpha1 = vk.alpha1;
        stored.beta2 = vk.beta2;
        stored.gamma2 = vk.gamma2;
        stored.delta2 = vk.delta2;
        // Clear and replace ic array
        delete stored.ic;
        for (uint256 i = 0; i < vk.ic.length; i++) {
            stored.ic.push(vk.ic[i]);
        }
        if (!hasVkey[circuitId]) {
            hasVkey[circuitId] = true;
            setCount++;
        }
        emit MockVkeySet(circuitId);
    }

    function getIcLength(bytes32 circuitId) external view returns (uint256) {
        return _stored[circuitId].ic.length;
    }
}
