// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @dev Minimal interface for the Groth16 verifier registry.
interface IZetoVerifierRegistry {
    struct G1Point { uint256 x; uint256 y; }
    struct G2Point { uint256[2] x; uint256[2] y; }
    struct VerifyingKey {
        G1Point alpha1;
        G2Point beta2;
        G2Point gamma2;
        G2Point delta2;
        G1Point[] ic;
    }
    function setVerifyingKey(bytes32 circuitId, VerifyingKey calldata vk) external;
}

/// @title ZetoVkeySetter
/// @notice Owner-only verifying key management for Zeto circuits on Hedera.
/// UUPS-upgradeable until lock() is called; after lock, vkeys cannot change.
contract ZetoVkeySetter is OwnableUpgradeable, UUPSUpgradeable {
    error VkeysLocked();
    error NoStagedKey(bytes32 circuitId);
    error ArrayLengthMismatch();
    error MissingCircuit(bytes32 circuitId);
    error EmptyExpectedCircuits();

    IZetoVerifierRegistry public verifierRegistry;
    bool public locked;
    mapping(bytes32 => IZetoVerifierRegistry.VerifyingKey) private stagedKeys;
    mapping(bytes32 => bool) public hasStaged;
    mapping(bytes32 => bool) public isCommitted;
    bytes32[] public expectedCircuits;

    event VerifyingKeyStaged(bytes32 indexed circuitId, string circuitName);
    event VerifyingKeyCommitted(bytes32 indexed circuitId, string circuitName);
    event VKeySetLocked();

    modifier onlyUnlocked() {
        if (locked) revert VkeysLocked();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @param expectedCircuits_ keccak256 circuit IDs that MUST be committed before
    /// lock() succeeds. Set once; cannot be modified after initialize.
    function initialize(
        address initialOwner,
        address _verifierRegistry,
        bytes32[] calldata expectedCircuits_
    ) external initializer {
        if (expectedCircuits_.length == 0) revert EmptyExpectedCircuits();
        __Ownable_init(initialOwner);
        verifierRegistry = IZetoVerifierRegistry(_verifierRegistry);
        for (uint256 i = 0; i < expectedCircuits_.length; i++) {
            expectedCircuits.push(expectedCircuits_[i]);
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function stageVerifyingKey(
        string calldata circuitName,
        IZetoVerifierRegistry.VerifyingKey calldata vk
    ) external onlyOwner onlyUnlocked {
        bytes32 circuitId = keccak256(bytes(circuitName));
        stagedKeys[circuitId] = vk;
        hasStaged[circuitId] = true;
        emit VerifyingKeyStaged(circuitId, circuitName);
    }

    function batchStageVerifyingKeys(
        string[] calldata circuitNames,
        IZetoVerifierRegistry.VerifyingKey[] calldata vks
    ) external onlyOwner onlyUnlocked {
        if (circuitNames.length != vks.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < circuitNames.length; i++) {
            bytes32 circuitId = keccak256(bytes(circuitNames[i]));
            stagedKeys[circuitId] = vks[i];
            hasStaged[circuitId] = true;
            emit VerifyingKeyStaged(circuitId, circuitNames[i]);
        }
    }

    function commitVerifyingKey(string calldata circuitName) external onlyOwner onlyUnlocked {
        bytes32 circuitId = keccak256(bytes(circuitName));
        if (!hasStaged[circuitId]) revert NoStagedKey(circuitId);
        verifierRegistry.setVerifyingKey(circuitId, stagedKeys[circuitId]);
        isCommitted[circuitId] = true;
        emit VerifyingKeyCommitted(circuitId, circuitName);
    }

    function batchCommitVerifyingKeys(string[] calldata circuitNames) external onlyOwner onlyUnlocked {
        for (uint256 i = 0; i < circuitNames.length; i++) {
            bytes32 circuitId = keccak256(bytes(circuitNames[i]));
            if (!hasStaged[circuitId]) revert NoStagedKey(circuitId);
            verifierRegistry.setVerifyingKey(circuitId, stagedKeys[circuitId]);
            isCommitted[circuitId] = true;
            emit VerifyingKeyCommitted(circuitId, circuitNames[i]);
        }
    }

    /// @notice Permanently lock the vkey set. Reverts unless every circuit in
    /// `expectedCircuits` has been committed via commitVerifyingKey(). Irreversible.
    function lock() external onlyOwner {
        for (uint256 i = 0; i < expectedCircuits.length; i++) {
            if (!isCommitted[expectedCircuits[i]]) revert MissingCircuit(expectedCircuits[i]);
        }
        locked = true;
        emit VKeySetLocked();
    }

    /// @notice True if all expected circuits are committed and lock() would succeed.
    function readyToLock() external view returns (bool) {
        for (uint256 i = 0; i < expectedCircuits.length; i++) {
            if (!isCommitted[expectedCircuits[i]]) return false;
        }
        return true;
    }

    /// @notice Return the subset of expected circuits that have not yet been committed.
    function uncommittedCircuits() external view returns (bytes32[] memory) {
        uint256 n;
        for (uint256 i = 0; i < expectedCircuits.length; i++) {
            if (!isCommitted[expectedCircuits[i]]) n++;
        }
        bytes32[] memory out = new bytes32[](n);
        uint256 k;
        for (uint256 i = 0; i < expectedCircuits.length; i++) {
            if (!isCommitted[expectedCircuits[i]]) {
                out[k++] = expectedCircuits[i];
            }
        }
        return out;
    }

    function expectedCircuitsCount() external view returns (uint256) {
        return expectedCircuits.length;
    }

    uint256[50] private __gap;
}
