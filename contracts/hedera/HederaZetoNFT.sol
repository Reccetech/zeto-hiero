// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {Zeto_NfAnonNullifier} from "../../vendor/zeto/solidity/contracts/zeto_nf_anon_nullifier.sol";
import {ZetoNFTBridge} from "./ZetoNFTBridge.sol";
import {Commonlib} from "../../vendor/zeto/solidity/contracts/lib/common.sol";

/// @title HederaZetoNFT
/// @notice v0.5 shielded **NFT** pool: upstream `Zeto_NfAnonNullifier` (anonymity + nullifier
/// double-spend prevention for non-fungible UTXOs) + our `ZetoNFTBridge` for custody of a real NFT.
/// Supports both a native **HTS NFT** (associate + ERC-721 interface) and a plain **ERC-721** on HSCS.
///
/// Flow:
///   - `depositNFT(token, tokenId, outputCommitment, data)` — take custody of the real NFT and mint
///     a shielded note (commitment binds tokenId+uri+salt+owner inside the ZK layer).
///   - `transfer(nullifier, output, root, proof, data)` — inherited private NF transfer; the spent
///     note is hidden (nullifier), the tokenId is preserved in-circuit but not revealed on-chain.
///   - `withdrawNFT(token, tokenId, nullifier, output, root, proof, to, data)` — spend a note
///     (nullifier; double-spend-safe via the same `transfer` proof check) and release the real NFT.
///
/// Compliance scope (per owner decision): **basic shielding** — anonymity + double-spend prevention.
/// No KYC/sanctions/non-repudiation (upstream has no NFT compliance circuits). The private transfer
/// is fully ZK-trustless; the tokenId↔note custody binding at withdraw is operator/caller-asserted
/// in this basic tier (full trustless binding needs a custom NFT deposit/withdraw circuit).
contract HederaZetoNFT is Zeto_NfAnonNullifier, ZetoNFTBridge {
    error NFTPoolPaused();

    bool public paused;
    event NFTPauseStateChanged(bool paused);

    modifier whenNotPaused() {
        if (paused) revert NFTPoolPaused();
        _;
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit NFTPauseStateChanged(p);
    }

    /// @notice Set up custody for a native HTS NFT collection (associate via 0x167).
    function setupHTSNFT(address token) external onlyOwner {
        _associateNFT(token);
    }

    /// @notice Set up custody for a plain ERC-721 collection (no association).
    function setupERC721(address token) external onlyOwner {
        _enableErc721Custody(token);
    }

    /// @notice Deposit a real NFT into the pool and mint its shielded note. Owner-gated: the basic
    /// tier relies on the operator to bind the minted commitment to the deposited tokenId.
    /// @param outputCommitment the shielded NFT note (Poseidon4(tokenId, uriHash, salt, ownerPubKey)).
    function depositNFT(
        address token,
        uint256 tokenId,
        uint256 outputCommitment,
        bytes calldata data
    ) external onlyOwner whenNotPaused {
        _takeNFTCustody(token, msg.sender, tokenId);
        uint256[] memory utxos = new uint256[](1);
        utxos[0] = outputCommitment;
        _mint(utxos, data); // ZetoNullifier._mint: validates + records the output commitment
    }

    /// @notice Spend a shielded NFT note and release the custodied real NFT to `to`.
    /// Reuses the inherited transfer-proof check (nullifier → double-spend-safe), then releases.
    function withdrawNFT(
        address token,
        uint256 tokenId,
        uint256 nullifier,
        uint256 output,
        uint256 root,
        Commonlib.Proof calldata proof,
        address to,
        bytes calldata data
    ) external whenNotPaused {
        uint256[] memory nullifiers = new uint256[](1);
        nullifiers[0] = nullifier;
        uint256[] memory outputs = new uint256[](1);
        outputs[0] = output;
        validateTransactionProposal(nullifiers, outputs, root, false);
        checkProof(nullifiers, outputs, root, proof); // inherited: verifies the NF transfer proof
        uint256[] memory empty;
        processInputsAndOutputs(nullifiers, outputs, empty, address(0)); // marks nullifier spent
        _releaseNFT(token, tokenId, to);
        emit UTXOTransfer(nullifiers, outputs, msg.sender, data);
    }
}
