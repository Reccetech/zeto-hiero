// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

// MVP Phase 1 smoke test: prove Hardhat can resolve and compile upstream Zeto
// contracts via relative imports from `vendor/zeto/`. This contract is intentionally
// trivial — it just imports Zeto_AnonEnc so the compiler must walk the dependency tree.
// No deployment, no logic. The test that verifies success is `npx hardhat compile`
// finishing cleanly plus artifacts being present.
import {Zeto_AnonEnc} from "../../vendor/zeto/solidity/contracts/zeto_anon_enc.sol";

contract UpstreamZetoSmoke {
    Zeto_AnonEnc public smoke;
}
