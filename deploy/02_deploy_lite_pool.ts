import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";

// Deploys HederaZetoTokenLite as a UUPS proxy and wires the 5 AnonEnc-path verifiers
// into upstream's VerifiersInfo struct. Lock/burn verifier fields are left as zero
// address (Zeto_AnonEnc does not use them).
//
// Post-deploy, the token must still be set up via `pool.setupHTS(<token>)` by the owner.
// That step is deferred to the demo/testnet phase (MVP Phase 5/6) since it needs a real
// (or mock) HTS token address.

const ZERO = "0x0000000000000000000000000000000000000000";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;
  const { log, save } = deployments;
  const { deployer } = await getNamedAccounts();

  // Pull verifier addresses deployed by 01_deploy_anonenc_verifiers.ts
  const verifier = (await deployments.get("Verifier_AnonEnc")).address;
  const batchVerifier = (await deployments.get("Verifier_AnonEncBatch")).address;
  const depositVerifier = (await deployments.get("Verifier_Deposit")).address;
  const withdrawVerifier = (await deployments.get("Verifier_Withdraw")).address;
  const batchWithdrawVerifier = (await deployments.get("Verifier_WithdrawBatch")).address;

  // VerifiersInfo struct (9 fields; Zeto_AnonEnc uses 5, rest zero).
  const verifiersInfo = {
    verifier,
    depositVerifier,
    withdrawVerifier,
    lockVerifier: ZERO,
    burnVerifier: ZERO,
    batchVerifier,
    batchWithdrawVerifier,
    batchLockVerifier: ZERO,
    batchBurnVerifier: ZERO,
  };

  const admin = process.env.ADMIN_ADDRESS && process.env.ADMIN_ADDRESS !== ZERO
    ? process.env.ADMIN_ADDRESS
    : deployer;

  const name = process.env.POOL_NAME ?? "Hedera Zeto MVP Pool";
  const symbol = process.env.POOL_SYMBOL ?? "ZTEST";

  const Factory = await ethers.getContractFactory("HederaZetoTokenLite");
  const pool = await upgrades.deployProxy(
    Factory,
    [name, symbol, admin, verifiersInfo],
    // `missing-initializer`: HederaZetoTokenLite inherits initialize() from Zeto_AnonEnc
    // rather than declaring its own. The OZ plugin's static analysis doesn't recognize
    // inherited initializers; the inherited one is structurally correct. See the
    // uups-init-pattern memory note.
    { kind: "uups", initializer: "initialize", unsafeAllow: ["missing-initializer"] }
  );
  await pool.waitForDeployment();
  const proxyAddress = await pool.getAddress();

  await save("HederaZetoTokenLite", {
    abi: JSON.parse(Factory.interface.formatJson()),
    address: proxyAddress,
  });

  log(`HederaZetoTokenLite proxy: ${proxyAddress}`);
  log(`  owner/admin: ${admin}`);
  log(`  NEXT: owner calls pool.setupHTS(<HTS token EVM address>) before deposits`);
};

func.tags = ["lite-pool"];
func.dependencies = ["verifiers"];
export default func;
