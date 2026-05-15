// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/// @title HederaResponseCodes
/// @notice Response code constants returned by the HTS system contract at 0x167.
/// Source: https://github.com/hashgraph/hedera-protobufs/blob/main/services/response_code.proto
/// @dev See PRD §21.5 for operational meaning of each code.
library HederaResponseCodes {
    int64 internal constant SUCCESS                              = 22;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT  = 194;
    int64 internal constant INVALID_TOKEN_ID                     = 167;
    int64 internal constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT      = 184;
    int64 internal constant INSUFFICIENT_TOKEN_BALANCE           = 96;
    int64 internal constant ACCOUNT_FROZEN_FOR_TOKEN             = 131;
    int64 internal constant ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN    = 132;
}
