// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {Zeto_AnonEncNullifierKyc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc_nullifier_kyc.sol";
import {ZetoHTSBridge} from "./ZetoHTSBridge.sol";
import {Commonlib} from "../../vendor/zeto/solidity/contracts/lib/common.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title HederaZetoTokenKyc
/// @notice v0.2 Hedera pool: upstream Zeto_AnonEncNullifierKyc (anonymity + ECDH encryption +
/// nullifier double-spend prevention + on-chain KYC identity registry) combined with our
/// ZetoHTSBridge for HTS token association.
///
/// What v0.2 adds over v0.1 (HederaZetoTokenLite / Zeto_AnonEnc):
///  - Nullifier SMT: each spent UTXO is recorded as a nullifier; re-spending reverts
///    (UTXOAlreadySpent). v0.1 had no nullifiers.
///  - KYC: the transfer circuit proves the sender and every output owner are BabyJubJub keys
///    registered in the pool's embedded identities Sparse Merkle Tree. Enrollment is via the
///    inherited (owner-only) `register(uint256[2] publicKey, bytes data)`; the current root is
///    `getIdentitiesRoot()`. Deposit/withdraw are intentionally NOT KYC-gated upstream (gas
///    saving) — circulation is still confined to KYC'd parties because only registered owners
///    can be on either side of a transfer.
///
/// Design notes (same pattern as HederaZetoTokenLite):
///  - Uses upstream's inherited `initialize(name, symbol, owner, VerifiersInfo)` directly — the
///    KYC variant's signature is identical to Zeto_AnonEnc; there is NO separate KYC-registry
///    address parameter because the registry is the inherited `Registry` base.
///  - We override the *internal* virtual `_deposit` / `_withdrawWithNullifiers` (the nullifier
///    withdraw path; v0.1 overrode `_withdraw`) to enforce HTS association and maintain the
///    shielded-supply invariant. The public `deposit`/`transfer`/`withdraw` are not virtual but
///    call these internals, so our hooks run on the standard call paths.
///
/// Deliberately NOT in v0.2 (see BUILD-PLAN-v0.2 scope): sanctions (v0.3), viewing-key scanner
/// (v0.3), non-repudiation / DeRec (v0.4), batch verifiers (passed as zero addresses), pause,
/// trusted-setup ceremony (v1.0).
contract HederaZetoTokenKyc is Zeto_AnonEncNullifierKyc, ZetoHTSBridge {
    /// @notice One-time Hedera setup: associate the HTS token and wire it as the ERC-20.
    /// Must be called by the owner after `initialize` and before any deposit.
    /// @param token EVM address of the HTS fungible token this pool will hold.
    function setupHTS(address token) external onlyOwner {
        _associate(token);          // pool associates so it can hold the HTS token
        setERC20(IERC20(token));    // wire upstream's _erc20 to the same token
    }

    function _deposit(
        uint256 amount,
        uint256[] memory outputs,
        Commonlib.Proof calldata proof
    ) public override {
        _requireHTSAssociated(address(_erc20));
        _incrementShieldedSupply(address(_erc20), amount);
        super._deposit(amount, outputs, proof);
    }

    function _withdrawWithNullifiers(
        uint256 amount,
        uint256[] memory nullifiers,
        uint256 output,
        uint256 root,
        Commonlib.Proof calldata proof
    ) public override {
        _decrementShieldedSupply(address(_erc20), amount);
        super._withdrawWithNullifiers(amount, nullifiers, output, root, proof);
    }
}
