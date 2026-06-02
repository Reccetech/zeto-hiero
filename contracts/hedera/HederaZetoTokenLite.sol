// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {Zeto_AnonEnc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc.sol";
import {ZetoHTSBridge} from "./ZetoHTSBridge.sol";
import {Commonlib} from "../../vendor/zeto/solidity/contracts/lib/common.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title HederaZetoTokenLite
/// @notice MVP (v0.1) Hedera pool: upstream Zeto_AnonEnc (anonymity + ECDH encryption)
/// combined with our ZetoHTSBridge for HTS token association.
///
/// Design notes (differs from the production PRD §13 / B.13 design — intentional for v0.1):
///  - Uses upstream's inherited `initialize(name, symbol, owner, VerifiersInfo)` directly.
///    No custom initializer; no mirroring of upstream's init chain.
///  - ERC-20/HTS token movement is handled by upstream's `_deposit`/`_withdraw` (which call
///    `_erc20.transferFrom` / `_erc20.transfer`). We wire `_erc20` via the inherited owner-only
///    `setERC20()`, and associate the HTS token via `associateHTSToken()` — both at setup time.
///  - We override the *internal* `_deposit` / `_withdraw` (which ARE virtual) to enforce HTS
///    association and maintain the E-9 shielded-supply invariant. The public `deposit`/`transfer`/
///    `withdraw` in upstream are NOT virtual, so they cannot be overridden — but they call the
///    internal virtual functions, so our hooks run on the standard call paths.
///
/// Deliberately NOT in v0.1 (see BUILD-PLAN-MVP Appendix B):
///  - KYC enforcement, sanctions, non-repudiation, DeRec, HCS audit (v0.2–v0.4)
///  - ReentrancyGuard: upstream public functions aren't virtual so a clean nonReentrant wrap
///    isn't available without mirroring upstream's initializer. Native HTS tokens have no
///    callbacks (PRD §13.6 E-3), and the v0.1 testnet token is operator-created, so the
///    reentrancy surface is nil. The production contract (main BUILD-PLAN Phase 4) adds it.
///  - Pause (E-8): deferred to v0.4 when the pool holds material value.
contract HederaZetoTokenLite is Zeto_AnonEnc, ZetoHTSBridge {
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

    function _withdraw(
        uint256 amount,
        uint256[] memory inputs,
        uint256 output,
        Commonlib.Proof calldata proof
    ) public override {
        _decrementShieldedSupply(address(_erc20), amount);
        super._withdraw(amount, inputs, output, proof);
    }
}
