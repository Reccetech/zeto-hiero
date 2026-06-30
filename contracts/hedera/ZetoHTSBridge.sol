// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IHederaTokenService} from "./IHederaTokenService.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";

/// @title ZetoHTSBridge
/// @notice Mixin that manages HTS token association for a Zeto pool contract.
/// HTS tokens must be associated before the contract can hold a balance of them.
/// Inherit alongside the upstream Zeto contract; the composing contract is responsible
/// for initializing Ownable via the upstream init chain (do NOT call __Ownable_init here).
abstract contract ZetoHTSBridge is OwnableUpgradeable {
    error AssociationFailed(int64 responseCode);
    error DissociationFailed(int64 responseCode);
    error TokenNotAssociated(address token);
    error OutstandingShieldedSupply(address token, uint256 amount);

    IHederaTokenService private constant HTS = IHederaTokenService(address(0x167));
    mapping(address => bool) public htsAssociated;
    mapping(address => uint256) public shieldedSupply;
    /// @dev Tokens custodied as a plain ERC-20 (not an HTS token) — no `0x167` association needed.
    /// Lets the same pool back a native HTS fungible token OR a vanilla ERC-20 deployed on HSCS.
    mapping(address => bool) public ercCustody;

    event HTSTokenAssociated(address indexed token);
    event HTSTokenDissociated(address indexed token);
    event ERC20CustodyEnabled(address indexed token);

    /// @dev No-op init; owner is initialized by the composing contract via upstream's
    /// __ZetoCommon_init → __Ownable_init. Present for the `onlyInitializing` discipline.
    function __ZetoHTSBridge_init() internal onlyInitializing {}

    function associateHTSToken(address tokenAddress) external onlyOwner {
        _associate(tokenAddress);
    }

    /// @dev Association logic shared by the external owner-gated entry point and by
    /// composing contracts (e.g. HederaZetoTokenLite.setupHTS) that are themselves
    /// owner-gated and need to associate without an external self-call.
    function _associate(address tokenAddress) internal {
        if (!htsAssociated[tokenAddress]) {
            int64 responseCode = HTS.associateToken(address(this), tokenAddress);
            if (
                responseCode != HederaResponseCodes.SUCCESS &&
                responseCode != HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
            ) revert AssociationFailed(responseCode);
            htsAssociated[tokenAddress] = true;
            emit HTSTokenAssociated(tokenAddress);
        }
    }

    function batchAssociateHTSTokens(address[] calldata tokenAddresses) external onlyOwner {
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            if (!htsAssociated[tokenAddresses[i]]) {
                int64 responseCode = HTS.associateToken(address(this), tokenAddresses[i]);
                if (
                    responseCode != HederaResponseCodes.SUCCESS &&
                    responseCode != HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
                ) revert AssociationFailed(responseCode);
                htsAssociated[tokenAddresses[i]] = true;
                emit HTSTokenAssociated(tokenAddresses[i]);
            }
        }
    }

    function isHTSAssociated(address tokenAddress) external view returns (bool) {
        return htsAssociated[tokenAddress];
    }

    function dissociateHTSToken(address tokenAddress) external onlyOwner {
        if (shieldedSupply[tokenAddress] != 0) {
            revert OutstandingShieldedSupply(tokenAddress, shieldedSupply[tokenAddress]);
        }
        if (htsAssociated[tokenAddress]) {
            int64 responseCode = HTS.dissociateToken(address(this), tokenAddress);
            if (responseCode != HederaResponseCodes.SUCCESS) revert DissociationFailed(responseCode);
            htsAssociated[tokenAddress] = false;
            emit HTSTokenDissociated(tokenAddress);
        }
    }

    /// @dev Mark a token as custodied via the plain ERC-20 interface (no HTS association).
    /// Called by the composing pool's owner-gated ERC-20 setup path.
    function _enableErcCustody(address tokenAddress) internal {
        ercCustody[tokenAddress] = true;
        emit ERC20CustodyEnabled(tokenAddress);
    }

    /// @dev The deposit custody gate: satisfied by an HTS association OR by ERC-20 custody mode.
    function _requireHTSAssociated(address tokenAddress) internal view {
        if (htsAssociated[tokenAddress] || ercCustody[tokenAddress]) return;
        revert TokenNotAssociated(tokenAddress);
    }

    /// @dev Composing contract calls these to maintain the invariant
    /// (shieldedSupply == sum(deposits) - sum(withdraws)).
    function _incrementShieldedSupply(address token, uint256 amount) internal {
        shieldedSupply[token] += amount;
    }

    function _decrementShieldedSupply(address token, uint256 amount) internal {
        shieldedSupply[token] -= amount;
    }

    uint256[49] private __gap;
}
