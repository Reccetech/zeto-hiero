// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {PoseidonUnit2L, PoseidonUnit3L} from "@iden3/contracts/contracts/lib/Poseidon.sol";

/// @notice v0.2 Phase 2 linking verification. Calls the externally-linked Poseidon
/// libraries so a test can assert the deployed circomlibjs bytecode is wired correctly.
contract TestPoseidonConsumer {
    function hash2(uint256 a, uint256 b) external pure returns (uint256) {
        return PoseidonUnit2L.poseidon([a, b]);
    }

    function hash3(uint256 a, uint256 b, uint256 c) external pure returns (uint256) {
        return PoseidonUnit3L.poseidon([a, b, c]);
    }
}
