// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Stand-in for an HTS-token-as-ERC20 in MVP Phase 4 integration tests.
/// On Hedera, HTS fungible tokens present as ERC-20 at their EVM address; locally we
/// use this mock to exercise the pool's transferFrom/transfer paths.
/// @dev Test-only.
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
