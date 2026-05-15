// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {ZetoHTSBridge} from "../hedera/ZetoHTSBridge.sol";

/// @title TestZetoHTSBridge
/// @notice Concrete subclass of the ZetoHTSBridge abstract mixin for unit tests.
/// Adds:
///  - A standalone `initialize` that calls `__Ownable_init` directly (in production this
///    happens via the upstream Zeto init chain; here we have no upstream).
///  - External wrappers around the internal `_requireHTSAssociated`,
///    `_incrementShieldedSupply`, and `_decrementShieldedSupply` so tests can drive them.
/// @dev Test-only. NOT deployed to testnet or mainnet.
contract TestZetoHTSBridge is ZetoHTSBridge {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __ZetoHTSBridge_init();
    }

    function requireHTSAssociated(address tokenAddress) external view {
        _requireHTSAssociated(tokenAddress);
    }

    function incrementShieldedSupply(address token, uint256 amount) external {
        _incrementShieldedSupply(token, amount);
    }

    function decrementShieldedSupply(address token, uint256 amount) external {
        _decrementShieldedSupply(token, amount);
    }
}
