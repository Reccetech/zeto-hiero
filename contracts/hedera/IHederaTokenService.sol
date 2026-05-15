// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/// @title IHederaTokenService
/// @notice Interface for the Hedera Token Service system contract at address 0x167.
/// Full spec: https://github.com/hashgraph/hedera-smart-contracts/tree/main/contracts/hts-precompile
interface IHederaTokenService {
    /// @notice Associate a single HTS token with an account.
    /// @param account The account to associate the token with (use address(this) for self-association)
    /// @param token The EVM address of the HTS fungible token
    /// @return responseCode 22 = SUCCESS; 194 = TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
    function associateToken(address account, address token) external returns (int64 responseCode);

    /// @notice Dissociate a single HTS token from an account.
    /// @param account The account to dissociate (must have zero balance for the token)
    /// @param token The EVM address of the HTS fungible token
    /// @return responseCode 22 = SUCCESS
    function dissociateToken(address account, address token) external returns (int64 responseCode);

    /// @notice Associate multiple HTS tokens with an account in a single call.
    /// @param account The account to associate
    /// @param tokens Array of HTS token EVM addresses
    /// @return responseCode 22 = SUCCESS
    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode);
}
