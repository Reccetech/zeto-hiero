import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Deploys the 5 Groth16 verifiers needed for the Zeto_AnonEnc MVP path.
//
// IMPORTANT (MVP Phase 5): the deposit/anon_enc/withdraw verifiers are OUR OWN, generated
// from our trusted setup (circuits/build/*_verifier.sol, staged into contracts/verifiers/).
// Upstream's committed verifiers embed UPSTREAM's vkey, so proofs from our keys would NOT
// verify against them. We must use our verifiers for every circuit we actually invoke.
//
// The *batch* verifiers (used only when inputs/outputs > 2) are NOT exercised by the v0.1
// 2-input/2-output demo, so upstream's committed batch verifiers stay as placeholders.
// When a batch path is added, generate + stage our own batch verifiers the same way.
//
// Hardhat-deploy artifacts are saved under deployments/<network>/ for downstream scripts
// (02_deploy_lite_pool.ts) to consume via deployments.get().

const VERIFIERS = [
  // Solidity contract name from the artifact          deployment name (stable across versions)
  { contract: "AnonEncVerifierMVP",            name: "Verifier_AnonEnc" },        // ours
  { contract: "Groth16Verifier_AnonEncBatch",  name: "Verifier_AnonEncBatch" },   // upstream placeholder (batch unused in v0.1)
  { contract: "DepositVerifierMVP",            name: "Verifier_Deposit" },        // ours
  { contract: "WithdrawVerifierMVP",           name: "Verifier_Withdraw" },       // ours
  { contract: "Groth16Verifier_WithdrawBatch", name: "Verifier_WithdrawBatch" },  // upstream placeholder (batch unused in v0.1)
];

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  for (const v of VERIFIERS) {
    const result = await deploy(v.name, {
      contract: v.contract,
      from: deployer,
      log: true,
      waitConfirmations: 1,
    });
    log(`  ${v.name} (${v.contract}) -> ${result.address}`);
  }
};

func.tags = ["verifiers", "verifiers-anonenc"];
func.dependencies = [];
export default func;
