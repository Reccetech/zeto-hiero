import { ethers } from "hardhat";

const ACCOUNTS = [
  { label: "Operator (Account1)", hederaId: "0.0.7628788", pk: "0x3baa63a88f89ab36d189eff1c9a608106eee72253136347391b401db2bf7257b" },
  { label: "Bob",                  hederaId: "0.0.7628853", pk: "0x408bc42bab3fbb267f50bdd9fd46dc1cecab1da67be9962055f0874c623f70d2" },
  { label: "Alice",                hederaId: "0.0.7775142", pk: "0x15d423c7718f0c88cf52df07860de271b502687ddeeb9d8faf5b3414abed7242" },
];

async function main() {
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  console.log(`Network: chainId ${network.chainId} (block ${await provider.getBlockNumber()})\n`);

  for (const a of ACCOUNTS) {
    const wallet = new ethers.Wallet(a.pk);
    const evmAddr = wallet.address;
    const balance = await provider.getBalance(evmAddr);
    const hbar = ethers.formatEther(balance);
    console.log(`${a.label}`);
    console.log(`  Hedera ID:   ${a.hederaId}`);
    console.log(`  EVM address: ${evmAddr}`);
    console.log(`  Balance:     ${hbar} HBAR`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
