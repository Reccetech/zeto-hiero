// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {Zeto_AnonEncNullifierKyc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc_nullifier_kyc.sol";
import {ZetoHTSBridge} from "./ZetoHTSBridge.sol";
import {SanctionsModule} from "./SanctionsModule.sol";
import {Commonlib} from "../../vendor/zeto/solidity/contracts/lib/common.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Groth16 verifier for the production transfer circuit
/// (anon_enc_nullifier_kyc_sanctions_non_repudiation) — 38 public signals.
interface IKycSanctionsNRVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[38] calldata pubSignals
    ) external view returns (bool);
}

/// @title HederaZetoToken
/// @notice v0.4 production Hedera pool: KYC + sanctions + **non-repudiation**. Extends the v0.3
/// KYC+sanctions design with an authority-encryption layer — every confidential transfer also
/// emits a ciphertext decryptable only by the holder of the pool's authority key (`sk_auth`),
/// giving a regulator a complete audit trail while keeping data private from all other parties.
///
/// Inherits the embedded KYC `Registry`, the nullifier SMT, `ZetoHTSBridge` (HTS custody +
/// shielded-supply invariant), and `SanctionsModule` (off-chain-rooted sanctions tree). Adds a
/// stored `authorityPublicKey` (owner-set), a lightweight pause switch, and a reentrancy mutex.
///
/// `transferConfidential` is the production transfer. It builds 38 public signals:
///   outputs  [ecdhPublicKey(2), cipherTexts(8), cipherTextAuthority(16)]
///   inputs   [nullifiers(2), root(1), enabled(2), identitiesRoot(1), outputs(2), nonce(1),
///             sanctionsRoot(1), authorityPublicKey(2)]
/// matching the circuit (snarkjs orders public signals as [outputs, then inputs by declaration]).
/// The 38-signal verifier is stored in the inherited `_verifier` slot; the inherited 19-signal
/// `transfer` is unusable on this pool — use `transferConfidential`.
///
/// Authority-key model: the key is a circuit PUBLIC INPUT bound from on-chain state (not baked
/// into the verifying key), so it can be rotated without recompiling/receremonying the circuit.
contract HederaZetoToken is Zeto_AnonEncNullifierKyc, ZetoHTSBridge, SanctionsModule {
    error NRTransferProofInvalid();
    error AuthorityKeyUnset();
    error PoolPaused();
    error Reentrancy();

    uint256 private constant NR_INPUT_SIZE = 38;
    uint256 private constant CT_AUTH_LEN = 16; // cipherTextAuthority length for (2,2)

    uint256[2] public authorityPublicKey;
    bool public paused;
    bool private _entered;

    event AuthorityKeySet(uint256 x, uint256 y);
    event PauseStateChanged(bool paused);

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }
    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice One-time setup for a native **HTS** fungible token: associate it (`0x167`) and wire
    /// it as the pool's ERC-20.
    function setupHTS(address token) external onlyOwner {
        _associate(token);
        setERC20(IERC20(token));
    }

    /// @notice One-time setup for a plain **ERC-20** token (e.g. a vanilla OpenZeppelin token on
    /// HSCS): wire it as the pool's ERC-20 with no HTS association. The full compliance stack
    /// (KYC + sanctions + non-repudiation) applies identically — only the custody mechanism differs.
    function setupERC20(address token) external onlyOwner {
        _enableErcCustody(token);
        setERC20(IERC20(token));
    }

    /// @notice Set/rotate the pool's authority BabyJubJub public key. Confidential transfers bind
    /// to this key, so rotating it makes prior-built proofs (for a different key) fail verification.
    function setAuthorityKey(uint256[2] calldata pk) external onlyOwner {
        authorityPublicKey = pk;
        emit AuthorityKeySet(pk[0], pk[1]);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PauseStateChanged(p);
    }

    function _deposit(
        uint256 amount,
        uint256[] memory outputs,
        Commonlib.Proof calldata proof
    ) public override whenNotPaused {
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
    ) public override whenNotPaused {
        _decrementShieldedSupply(address(_erc20), amount);
        super._withdrawWithNullifiers(amount, nullifiers, output, root, proof);
    }

    /// @notice Confidential transfer with KYC + sanctions + authority (non-repudiation) encryption.
    /// @param cipherTextAuthority the authority ciphertext (16 elements) from the proof's outputs.
    function transferConfidential(
        uint256[] memory nullifiers,
        uint256[] memory outputs,
        uint256 root,
        uint256 encryptionNonce,
        uint256[2] memory ecdhPublicKey,
        uint256[] memory encryptedValues,
        uint256[] memory cipherTextAuthority,
        uint256 sanctionsRoot,
        Commonlib.Proof calldata proof,
        bytes calldata data
    ) public whenNotPaused nonReentrant returns (bool) {
        if (authorityPublicKey[0] == 0 && authorityPublicKey[1] == 0) revert AuthorityKeyUnset();
        _requireCurrentSanctionsRoot(bytes32(sanctionsRoot));

        nullifiers = checkAndPadCommitments(nullifiers);
        outputs = checkAndPadCommitments(outputs);
        validateTransactionProposal(nullifiers, outputs, root, false);

        uint256[NR_INPUT_SIZE] memory pub = _buildNRPublicInputs(
            nullifiers, outputs, root, encryptionNonce, ecdhPublicKey, encryptedValues, cipherTextAuthority, sanctionsRoot
        );

        if (!IKycSanctionsNRVerifier(address(_verifier)).verifyProof(proof.pA, proof.pB, proof.pC, pub)) {
            revert NRTransferProofInvalid();
        }

        uint256[] memory empty;
        processInputsAndOutputs(nullifiers, outputs, empty, address(0));

        emit UTXOTransferWithEncryptedValues(
            nullifiers, outputs, encryptionNonce, ecdhPublicKey, encryptedValues, msg.sender, data
        );
        // The authority ciphertext is carried in calldata and recoverable from the tx by the
        // authority scanner; emitting a dedicated event keeps it cheaply indexable.
        emit AuthorityCiphertext(nullifiers, outputs, encryptionNonce, cipherTextAuthority, msg.sender);
        return true;
    }

    event AuthorityCiphertext(
        uint256[] nullifiers,
        uint256[] outputs,
        uint256 encryptionNonce,
        uint256[] cipherTextAuthority,
        address indexed submitter
    );

    /// @dev Builds the 38 public signals in the circuit's order:
    /// [ecdhPub(2), cipherTexts(8), cipherTextAuthority(16), nullifiers(2), root, enabled(2),
    ///  identitiesRoot, outputs(2), nonce, sanctionsRoot, authorityPublicKey(2)].
    function _buildNRPublicInputs(
        uint256[] memory nullifiers,
        uint256[] memory outputs,
        uint256 root,
        uint256 encryptionNonce,
        uint256[2] memory ecdhPublicKey,
        uint256[] memory encryptedValues,
        uint256[] memory cipherTextAuthority,
        uint256 sanctionsRoot
    ) internal view returns (uint256[NR_INPUT_SIZE] memory pub) {
        uint256 p;
        uint256 i;
        for (i = 0; i < ecdhPublicKey.length; ++i) pub[p++] = ecdhPublicKey[i];      // 2
        for (i = 0; i < encryptedValues.length; ++i) pub[p++] = encryptedValues[i];  // 8
        for (i = 0; i < CT_AUTH_LEN; ++i) pub[p++] = cipherTextAuthority[i];          // 16
        for (i = 0; i < nullifiers.length; ++i) pub[p++] = nullifiers[i];            // 2
        pub[p++] = root;                                                             // 1
        for (i = 0; i < nullifiers.length; ++i) pub[p++] = (nullifiers[i] == 0) ? 0 : 1; // 2
        pub[p++] = getIdentitiesRoot();                                              // 1
        for (i = 0; i < outputs.length; ++i) pub[p++] = outputs[i];                  // 2
        pub[p++] = encryptionNonce;                                                  // 1
        pub[p++] = sanctionsRoot;                                                    // 1
        pub[p++] = authorityPublicKey[0];                                            // 1
        pub[p++] = authorityPublicKey[1];                                            // 1
    }
}
