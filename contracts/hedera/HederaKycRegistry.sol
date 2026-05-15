// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title HederaKycRegistry
/// @notice Hedera-specific KYC registry extending Zeto's identity registry pattern.
/// UUPS-upgradeable; deployed via proxy. Operator (deploying institution) controls enrollment.
contract HederaKycRegistry is OwnableUpgradeable, UUPSUpgradeable {
    error KeyAlreadyEnrolled();
    error AccountAlreadyBound();
    error ZeroAddress();
    error KeyNotEnrolled();
    error ArrayLengthMismatch();

    // Storage
    mapping(bytes32 => address) public bjjKeyToAccount;
    mapping(address => bytes32) public accountToBjjKey;
    mapping(bytes32 => bool) public isEnrolled;
    bytes32 public identitiesRoot;
    uint256 public enrollmentCount;

    event ParticipantEnrolled(
        bytes32 indexed bjjKeyHash,
        address indexed hederaAccount,
        uint256 bjjKeyX,
        uint256 bjjKeyY,
        uint256 enrollmentId
    );
    event ParticipantRevoked(bytes32 indexed bjjKeyHash, address indexed hederaAccount);
    event IdentitiesRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 blockNumber);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        // OZ 5.x UUPSUpgradeable has no __init function — inheriting the contract is sufficient.
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _bjjKeyHash(uint256 bjjKeyX, uint256 bjjKeyY) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bjjKeyX, bjjKeyY));
    }

    function enroll(address hederaAccount, uint256 bjjKeyX, uint256 bjjKeyY) external onlyOwner {
        if (hederaAccount == address(0)) revert ZeroAddress();
        bytes32 keyHash = _bjjKeyHash(bjjKeyX, bjjKeyY);
        if (isEnrolled[keyHash]) revert KeyAlreadyEnrolled();
        if (accountToBjjKey[hederaAccount] != bytes32(0)) revert AccountAlreadyBound();

        bjjKeyToAccount[keyHash]       = hederaAccount;
        accountToBjjKey[hederaAccount] = keyHash;
        isEnrolled[keyHash]            = true;
        enrollmentCount++;

        emit ParticipantEnrolled(keyHash, hederaAccount, bjjKeyX, bjjKeyY, enrollmentCount);
    }

    function batchEnroll(
        address[] calldata hederaAccounts,
        uint256[] calldata bjjKeyXs,
        uint256[] calldata bjjKeyYs
    ) external onlyOwner {
        if (hederaAccounts.length != bjjKeyXs.length || hederaAccounts.length != bjjKeyYs.length)
            revert ArrayLengthMismatch();
        for (uint256 i = 0; i < hederaAccounts.length; i++) {
            bytes32 keyHash = _bjjKeyHash(bjjKeyXs[i], bjjKeyYs[i]);
            if (!isEnrolled[keyHash] && hederaAccounts[i] != address(0)
                && accountToBjjKey[hederaAccounts[i]] == bytes32(0)) {
                bjjKeyToAccount[keyHash]            = hederaAccounts[i];
                accountToBjjKey[hederaAccounts[i]]  = keyHash;
                isEnrolled[keyHash]                 = true;
                enrollmentCount++;
                emit ParticipantEnrolled(keyHash, hederaAccounts[i], bjjKeyXs[i], bjjKeyYs[i], enrollmentCount);
            }
        }
    }

    /// @notice Revoke a participant's enrollment. Clears both maps so the address
    /// can be re-bound to a fresh BJJ key later (e.g., after key rotation).
    function revoke(uint256 bjjKeyX, uint256 bjjKeyY) external onlyOwner {
        bytes32 keyHash = _bjjKeyHash(bjjKeyX, bjjKeyY);
        if (!isEnrolled[keyHash]) revert KeyNotEnrolled();
        address account = bjjKeyToAccount[keyHash];
        delete bjjKeyToAccount[keyHash];
        delete accountToBjjKey[account];
        isEnrolled[keyHash] = false;
        emit ParticipantRevoked(keyHash, account);
    }

    function updateIdentitiesRoot(bytes32 newRoot) external onlyOwner {
        bytes32 oldRoot = identitiesRoot;
        identitiesRoot = newRoot;
        emit IdentitiesRootUpdated(oldRoot, newRoot, block.number);
    }

    function getAccountForKey(uint256 bjjKeyX, uint256 bjjKeyY) external view returns (address) {
        return bjjKeyToAccount[_bjjKeyHash(bjjKeyX, bjjKeyY)];
    }

    function isKeyEnrolled(uint256 bjjKeyX, uint256 bjjKeyY) external view returns (bool) {
        return isEnrolled[_bjjKeyHash(bjjKeyX, bjjKeyY)];
    }

    uint256[50] private __gap;
}
