// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title SanctionsModule
/// @notice Abstract mixin that manages a sanctions Sparse Merkle Tree root.
/// Used by HederaZetoToken to require non-inclusion proofs on withdraw().
/// The composing contract is responsible for initializing Ownable via the upstream init chain.
abstract contract SanctionsModule is OwnableUpgradeable {
    error NotOwnerOrOracle();
    error SanctionsRootMismatch();

    bytes32 public sanctionsMerkleRoot;
    uint256 public sanctionsMerkleRootBlock;
    address public sanctionsOracle;

    event SanctionsMerkleRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 blockNumber);
    event SanctionsOracleSet(address indexed oracle);

    function __SanctionsModule_init() internal onlyInitializing {}

    modifier onlyOwnerOrOracle() {
        if (
            msg.sender != owner() &&
            !(sanctionsOracle != address(0) && msg.sender == sanctionsOracle)
        ) revert NotOwnerOrOracle();
        _;
    }

    function updateSanctionsMerkleRoot(bytes32 newRoot) external onlyOwnerOrOracle {
        bytes32 oldRoot = sanctionsMerkleRoot;
        sanctionsMerkleRoot = newRoot;
        sanctionsMerkleRootBlock = block.number;
        emit SanctionsMerkleRootUpdated(oldRoot, newRoot, block.number);
    }

    function setSanctionsOracle(address oracle) external onlyOwner {
        sanctionsOracle = oracle;
        emit SanctionsOracleSet(oracle);
    }

    function _requireCurrentSanctionsRoot(bytes32 proofSanctionsRoot) internal view {
        if (proofSanctionsRoot != sanctionsMerkleRoot) revert SanctionsRootMismatch();
    }

    uint256[50] private __gap;
}
