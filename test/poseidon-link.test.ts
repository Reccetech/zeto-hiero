import { expect } from "chai";
import { ethers } from "hardhat";
import { deployPoseidonAndSmt, poseidonOnlyMap } from "./lib/poseidon-deploy";

// v0.2 Phase 2 — verify the circomlibjs-generated Poseidon libraries deploy and link
// correctly, producing the same hashes the off-chain witness (zeto-js) computes.
// Known-answer values precomputed with zeto-js Poseidon.
const POSEIDON2_1_2 =
  7853200120776062878684798364095072458815029376092732009249414926327459813530n;
const POSEIDON2_0_0 =
  14744269619966411208579211824598458697587494354926760081771325075741142829156n;
const POSEIDON3_1_2_3 =
  6542985608222806190361240322586112750744169038454362455181422643027100751666n;

describe("v0.2 Phase 2 — Poseidon + SmtLib linking", function () {
  it("deploys PoseidonUnit2L/3L + SmtLib to non-zero addresses", async function () {
    const [deployer] = await ethers.getSigners();
    const libs = await deployPoseidonAndSmt(deployer);
    for (const addr of [libs.poseidon2, libs.poseidon3, libs.smtLib]) {
      expect(addr).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(addr).to.not.equal(ethers.ZeroAddress);
    }
  });

  it("linked PoseidonUnit2L matches off-chain zeto-js Poseidon", async function () {
    const [deployer] = await ethers.getSigners();
    const libs = await deployPoseidonAndSmt(deployer);

    const Consumer = await ethers.getContractFactory("TestPoseidonConsumer", {
      libraries: poseidonOnlyMap(libs),
    });
    const consumer = await Consumer.deploy();
    await consumer.waitForDeployment();

    expect(await consumer.hash2(1, 2)).to.equal(POSEIDON2_1_2);
    expect(await consumer.hash2(0, 0)).to.equal(POSEIDON2_0_0);
  });

  it("linked PoseidonUnit3L matches off-chain zeto-js Poseidon", async function () {
    const [deployer] = await ethers.getSigners();
    const libs = await deployPoseidonAndSmt(deployer);

    const Consumer = await ethers.getContractFactory("TestPoseidonConsumer", {
      libraries: poseidonOnlyMap(libs),
    });
    const consumer = await Consumer.deploy();
    await consumer.waitForDeployment();

    expect(await consumer.hash3(1, 2, 3)).to.equal(POSEIDON3_1_2_3);
  });
});
