// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {HederaKycRegistry} from "../hedera/HederaKycRegistry.sol";

/// @title HederaKycRegistryV2
/// @notice Test-only v2 of HederaKycRegistry that adds one new field before the storage gap.
/// Used to verify UUPS upgrade safety: existing storage (bjjKeyToAccount, accountToBjjKey,
/// isEnrolled, identitiesRoot, enrollmentCount) survives the upgrade unchanged.
/// @dev Test-only. NOT deployed to testnet or mainnet.
contract HederaKycRegistryV2 is HederaKycRegistry {
    /// @notice New field added in v2.
    uint256 public v2NewField;

    /// @notice v2-only reinitializer. OZ Upgrades requires v2 to declare an initializer
    /// (even one that does nothing) so the plugin's upgrade-safety check passes.
    /// Not called automatically on upgrade — operator decides whether to invoke it
    /// for any v2-specific bootstrapping.
    function initializeV2() external reinitializer(2) {
        // No v2-specific setup needed; the new field defaults to 0
    }

    /// @notice v2-only setter; demonstrates the new field works.
    function setV2NewField(uint256 v) external onlyOwner {
        v2NewField = v;
    }
}
