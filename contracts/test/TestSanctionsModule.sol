// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {SanctionsModule} from "../hedera/SanctionsModule.sol";

/// @title TestSanctionsModule
/// @notice Concrete subclass of SanctionsModule for unit tests.
/// Adds a standalone `initialize` that calls `__Ownable_init` (in production this
/// happens via the upstream Zeto init chain) and an external wrapper around the
/// internal `_requireCurrentSanctionsRoot` so tests can assert on it.
/// @dev Test-only. NOT deployed to testnet or mainnet.
contract TestSanctionsModule is SanctionsModule {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __SanctionsModule_init();
    }

    function requireCurrentSanctionsRoot(bytes32 proofSanctionsRoot) external view {
        _requireCurrentSanctionsRoot(proofSanctionsRoot);
    }
}
