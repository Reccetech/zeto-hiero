// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {IHederaTokenService} from "../hedera/IHederaTokenService.sol";
import {HederaResponseCodes} from "../hedera/HederaResponseCodes.sol";

/// @title MockHTSPrecompile
/// @notice Local emulation of the Hedera Token Service precompile at address 0x167.
/// Used by Hardhat tests via `hardhat_setCode` to inject this bytecode at 0x167.
/// Tracks (account, token) → associated state in storage so tests can assert behavior.
/// @dev Test-only contract. NOT deployed to testnet or mainnet.
contract MockHTSPrecompile is IHederaTokenService {
    /// @notice associated[account][token] == true after a successful associateToken
    mapping(address => mapping(address => bool)) public associated;

    /// @notice If set, the next call to associateToken/dissociateToken returns this
    /// code regardless of state. Used to test error-path branches. Cleared after one use.
    int64 public forceResponseCode;
    bool public forceOnce;

    /// @notice Set a return code to force on the next call. Single-use; consumed.
    function setForceResponseCode(int64 code) external {
        forceResponseCode = code;
        forceOnce = true;
    }

    function _consumeForce() internal returns (int64 code, bool used) {
        if (forceOnce) {
            code = forceResponseCode;
            used = true;
            forceOnce = false;
            forceResponseCode = 0;
        }
    }

    function associateToken(address account, address token) external returns (int64 responseCode) {
        (int64 forced, bool used) = _consumeForce();
        if (used) return forced;
        if (associated[account][token]) {
            return HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT;
        }
        associated[account][token] = true;
        return HederaResponseCodes.SUCCESS;
    }

    function dissociateToken(address account, address token) external returns (int64 responseCode) {
        (int64 forced, bool used) = _consumeForce();
        if (used) return forced;
        if (!associated[account][token]) {
            return HederaResponseCodes.TOKEN_NOT_ASSOCIATED_TO_ACCOUNT;
        }
        associated[account][token] = false;
        return HederaResponseCodes.SUCCESS;
    }

    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode) {
        (int64 forced, bool used) = _consumeForce();
        if (used) return forced;
        for (uint256 i = 0; i < tokens.length; i++) {
            associated[account][tokens[i]] = true;
        }
        return HederaResponseCodes.SUCCESS;
    }
}
