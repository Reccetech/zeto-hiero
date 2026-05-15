import { ethers, network } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const blockNumber = await provider.getBlockNumber();
  const chainId = (await provider.getNetwork()).chainId;
  console.log(`Network: ${network.name}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Latest block: ${blockNumber}`);

  if (process.env.HEDERA_OPERATOR_PRIVATE_KEY_HEX) {
    const [deployer] = await ethers.getSigners();
    const balance = await provider.getBalance(deployer.address);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(balance)} HBAR (or ETH equivalent)`);
  } else {
    console.log("No HEDERA_OPERATOR_PRIVATE_KEY_HEX set — read-only check only.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
