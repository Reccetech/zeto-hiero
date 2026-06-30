// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IHederaTokenService} from "./IHederaTokenService.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";

/// @title ZetoNFTBridge
/// @notice NFT-custody mixin for a Zeto non-fungible pool. Mirrors ZetoHTSBridge but for NFTs:
/// the pool takes custody of a real NFT via the **ERC-721 interface** (`transferFrom`), which is
/// what both a plain ERC-721 *and* an HTS NFT expose at their EVM address. The only HTS-specific
/// step is associating the NFT collection token with the pool (the `0x167` precompile) before it
/// can hold one — exactly like the fungible bridge. ERC-721 custody needs no association.
///
/// Custody binding (basic tier): the pool records which tokenId is escrowed against the shielded
/// note minted at deposit. The private *transfer* is fully ZK (nullifier-backed); the tokenId↔note
/// binding through transfers is operator/caller-asserted at withdraw — full trustless binding needs
/// a custom NFT deposit/withdraw circuit (the declined "full parity" path).
abstract contract ZetoNFTBridge is OwnableUpgradeable {
    error NFTAssociationFailed(int64 responseCode);
    error NFTTokenNotReady(address token);
    error NFTNotCustodied(address token, uint256 tokenId);

    IHederaTokenService private constant HTS = IHederaTokenService(address(0x167));

    mapping(address => bool) public nftHtsAssociated; // HTS NFT collection associated
    mapping(address => bool) public nftErcCustody;    // plain ERC-721 custody mode
    // token => tokenId => escrowed?  (true while the pool holds the real NFT)
    mapping(address => mapping(uint256 => bool)) public nftEscrowed;

    event NFTCollectionAssociated(address indexed token);
    event NFTErc721CustodyEnabled(address indexed token);
    event NFTDepositedToCustody(address indexed token, uint256 indexed tokenId);
    event NFTReleasedFromCustody(address indexed token, uint256 indexed tokenId, address indexed to);

    function __ZetoNFTBridge_init() internal onlyInitializing {}

    /// @dev HTS NFT collection: associate via 0x167 (idempotent), then custody via ERC-721.
    function _associateNFT(address token) internal {
        if (!nftHtsAssociated[token]) {
            int64 rc = HTS.associateToken(address(this), token);
            if (
                rc != HederaResponseCodes.SUCCESS &&
                rc != HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
            ) revert NFTAssociationFailed(rc);
            nftHtsAssociated[token] = true;
            emit NFTCollectionAssociated(token);
        }
    }

    /// @dev Plain ERC-721: no association required.
    function _enableErc721Custody(address token) internal {
        nftErcCustody[token] = true;
        emit NFTErc721CustodyEnabled(token);
    }

    function _requireNFTReady(address token) internal view {
        if (!nftHtsAssociated[token] && !nftErcCustody[token]) revert NFTTokenNotReady(token);
    }

    /// @dev Pull a real NFT into custody (ERC-721 transferFrom — works for ERC-721 and HTS NFT).
    function _takeNFTCustody(address token, address from, uint256 tokenId) internal {
        _requireNFTReady(token);
        IERC721(token).transferFrom(from, address(this), tokenId);
        nftEscrowed[token][tokenId] = true;
        emit NFTDepositedToCustody(token, tokenId);
    }

    /// @dev Release a custodied NFT.
    function _releaseNFT(address token, uint256 tokenId, address to) internal {
        if (!nftEscrowed[token][tokenId]) revert NFTNotCustodied(token, tokenId);
        nftEscrowed[token][tokenId] = false;
        IERC721(token).transferFrom(address(this), to, tokenId);
        emit NFTReleasedFromCustody(token, tokenId, to);
    }

    uint256[49] private __gap;
}
