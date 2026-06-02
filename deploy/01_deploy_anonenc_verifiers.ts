import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Deploys the 5 Groth16 verifiers needed for the Zeto_AnonEnc MVP path.
// These were compiled transitively in Phase 1 (vendor/zeto/solidity/contracts/verifiers/*.sol).
// Hardhat-deploy artifacts are saved under deployments/<network>/ for downstream scripts
// (MVP Phase 4 04_deploy_token.ts) to consume via deployments.get().

const VERIFIERS = [
  // Solidity contract name from the artifact          deployment name (stable across versions)
  { contract: "Groth16Verifier_AnonEnc",       name: "Verifier_AnonEnc" },
  { contract: "Groth16Verifier_AnonEncBatch",  name: "Verifier_AnonEncBatch" },
  { contract: "Groth16Verifier_Deposit",       name: "Verifier_Deposit" },
  { contract: "Groth16Verifier_Withdraw",      name: "Verifier_Withdraw" },
  { contract: "Groth16Verifier_WithdrawBatch", name: "Verifier_WithdrawBatch" },
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
