// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title MockERC721
/// @notice Minimal mintable ERC-721 for tests + demos. Stands in for a plain ERC-721 collection on
/// HSCS, or (via the same ERC-721 interface an HTS NFT exposes at its EVM address) an HTS NFT.
contract MockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
