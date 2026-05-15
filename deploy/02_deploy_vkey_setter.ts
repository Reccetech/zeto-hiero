import { ethers, upgrades, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Canonical list of circuits expected for the Hedera production deployment.
// MUST match the ceremony scope and the HEDERA_CIRCUITS constant in 05_setup_vkeys.ts.
// Until Phase 3 (circuits) finalizes the real circuit names, these are placeholders
// that will be replaced once the production circom files exist.
const HEDERA_CIRCUITS = [
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_1_1",
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_2_2",
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_5_5",
  "anon_enc_nullifier_kyc_sanctions_non_repudiation_10_10",
  "withdraw_kyc_sanctions_non_repudiation_2_1",
  "withdraw_kyc_sanctions_non_repudiation_10_1",
  "deposit_kyc_non_repudiation",
  "lock",
  "batch_lock",
];

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { getNamedAccounts, deployments: deps } = hre;
  const { deployer } = await getNamedAccounts();

  const adminAddress = process.env.ADMIN_ADDRESS ?? deployer;

  // Deploy a placeholder verifier registry. In production this is the Zeto-generated
  // Groth16Verifier registry contract. For Phase 1.5 we use MockVerifierRegistry so
  // the vkey-setter has something to talk to; Phase 3 will swap in the real registry.
  const MockRegistry = await ethers.getContractFactory("MockVerifierRegistry");
  const mockRegistry = await MockRegistry.deploy();
  await mockRegistry.waitForDeployment();
  await deps.save("MockVerifierRegistry", {
    abi: MockRegistry.interface.format() as any,
    address: await mockRegistry.getAddress(),
  });

  const expectedCircuitIds = HEDERA_CIRCUITS.map((name) =>
    ethers.keccak256(ethers.toUtf8Bytes(name))
  );

  const Factory = await ethers.getContractFactory("ZetoVkeySetter");
  const setter = await upgrades.deployProxy(
    Factory,
    [adminAddress, await mockRegistry.getAddress(), expectedCircuitIds],
    { kind: "uups", initializer: "initialize" }
  );
  await setter.waitForDeployment();
  const setterAddress = await setter.getAddress();

  await deps.save("ZetoVkeySetter", {
    abi: Factory.interface.format() as any,
    address: setterAddress,
  });

  console.log(`ZetoVkeySetter proxy: ${setterAddress}`);
  console.log(`MockVerifierRegistry: ${await mockRegistry.getAddress()}`);
  console.log(`Expected circuits:    ${HEDERA_CIRCUITS.length}`);
  console.log(`Admin (initial owner): ${adminAddress}`);
  console.log("");
  console.log("Next: stage and commit verifying keys via deploy/05_setup_vkeys.ts");
  console.log(`lock() will revert until all ${HEDERA_CIRCUITS.length} circuits are committed.`);
};

func.tags = ["vkey-setter"];
export default func;
