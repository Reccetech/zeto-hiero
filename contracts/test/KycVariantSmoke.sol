// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

// Phase 1 smoke import: confirm the upstream KYC variant and its full @iden3/contracts
// dependency tree (SmtLib, Poseidon units) compile cleanly under our cancun/^0.8.27 target.
// No logic — existence of the artifact is the test.
import {Zeto_AnonEncNullifierKyc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc_nullifier_kyc.sol";

contract KycVariantSmoke {
    // Reference the type so the import isn't elided by the optimizer.
    function variantCodehash() external pure returns (string memory) {
        return type(Zeto_AnonEncNullifierKyc).name;
    }
}
