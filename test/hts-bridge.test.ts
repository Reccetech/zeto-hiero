import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { TestZetoHTSBridge, MockHTSPrecompile } from "../typechain-types";

// HTS precompile address on Hedera. We inject the mock here for local tests.
const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

async function installMockHTS(): Promise<MockHTSPrecompile> {
  // Deploy the mock to a normal address, then copy its runtime bytecode to 0x167.
  const MockFactory = await ethers.getContractFactory("MockHTSPrecompile");
  const mock = (await MockFactory.deploy()) as unknown as MockHTSPrecompile;
  await mock.waitForDeployment();
  const runtimeCode = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [HTS_ADDRESS, runtimeCode]);
  // hardhat_setCode preserves prior storage at 0x167 between tests. Reset the slot
  // that holds (forceResponseCode, forceOnce) so a previous test's forced-error
  // state doesn't leak. The `associated` mapping at slot 0 doesn't need clearing
  // because each test's bridge has a fresh address (mapping keys never collide).
  await network.provider.send("hardhat_setStorageAt", [
    HTS_ADDRESS,
    "0x1",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);
  // Bind a contract instance at 0x167 so the test can call setForceResponseCode / read associated state
  return MockFactory.attach(HTS_ADDRESS) as unknown as MockHTSPrecompile;
}

async function deployBridge(owner: string): Promise<TestZetoHTSBridge> {
  const Factory = await ethers.getContractFactory("TestZetoHTSBridge");
  const bridge = (await upgrades.deployProxy(Factory, [owner], {
    kind: "uups",
    initializer: "initialize",
    unsafeAllow: ["missing-public-upgradeto"],
  })) as unknown as TestZetoHTSBridge;
  await bridge.waitForDeployment();
  return bridge;
}

describe("ZetoHTSBridge", function () {
  let mock: MockHTSPrecompile;
  let bridge: TestZetoHTSBridge;
  let owner: any;
  let alice: any;

  // EVM addresses representing HTS fungible tokens (any non-zero address works for the mock)
  const TOKEN_A = "0x0000000000000000000000000000000000001111";
  const TOKEN_B = "0x0000000000000000000000000000000000002222";

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    mock = await installMockHTS();
    bridge = await deployBridge(owner.address);
  });

  describe("associateHTSToken", function () {
    it("succeeds on first call and emits HTSTokenAssociated", async function () {
      await expect(bridge.associateHTSToken(TOKEN_A))
        .to.emit(bridge, "HTSTokenAssociated")
        .withArgs(TOKEN_A);
      expect(await bridge.htsAssociated(TOKEN_A)).to.equal(true);
    });

    it("is idempotent — second call is a no-op and emits no event", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      // Second call: no event, no revert
      const tx = await bridge.associateHTSToken(TOKEN_A);
      const receipt = await tx.wait();
      const eventTopic = bridge.interface.getEvent("HTSTokenAssociated").topicHash;
      const events = receipt!.logs.filter((l) => l.topics[0] === eventTopic);
      expect(events.length).to.equal(0);
      expect(await bridge.htsAssociated(TOKEN_A)).to.equal(true);
    });

    it("non-owner cannot associate", async function () {
      await expect(bridge.connect(alice).associateHTSToken(TOKEN_A))
        .to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
    });

    it("propagates HTS error response codes via AssociationFailed", async function () {
      // Force the next call to return INVALID_TOKEN_ID (167)
      await mock.setForceResponseCode(167);
      await expect(bridge.associateHTSToken(TOKEN_A))
        .to.be.revertedWithCustomError(bridge, "AssociationFailed")
        .withArgs(167);
    });
  });

  describe("batchAssociateHTSTokens", function () {
    it("associates multiple tokens in one call", async function () {
      const tokens = [
        "0x0000000000000000000000000000000000001001",
        "0x0000000000000000000000000000000000001002",
        "0x0000000000000000000000000000000000001003",
        "0x0000000000000000000000000000000000001004",
        "0x0000000000000000000000000000000000001005",
      ];
      await bridge.batchAssociateHTSTokens(tokens);
      for (const t of tokens) {
        expect(await bridge.htsAssociated(t)).to.equal(true);
      }
    });

    it("skips already-associated tokens", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      // batchAssociate including TOKEN_A — should not revert, TOKEN_A stays associated
      await bridge.batchAssociateHTSTokens([TOKEN_A, TOKEN_B]);
      expect(await bridge.htsAssociated(TOKEN_A)).to.equal(true);
      expect(await bridge.htsAssociated(TOKEN_B)).to.equal(true);
    });
  });

  describe("_requireHTSAssociated", function () {
    it("reverts with TokenNotAssociated before association", async function () {
      await expect(bridge.requireHTSAssociated(TOKEN_A))
        .to.be.revertedWithCustomError(bridge, "TokenNotAssociated")
        .withArgs(TOKEN_A);
    });

    it("passes after association", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      // No revert means success
      await bridge.requireHTSAssociated(TOKEN_A);
    });
  });

  describe("dissociateHTSToken — E-9 shielded supply invariant", function () {
    it("succeeds when shielded supply is zero", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      expect(await bridge.shieldedSupply(TOKEN_A)).to.equal(0n);
      await expect(bridge.dissociateHTSToken(TOKEN_A))
        .to.emit(bridge, "HTSTokenDissociated")
        .withArgs(TOKEN_A);
      expect(await bridge.htsAssociated(TOKEN_A)).to.equal(false);
    });

    it("reverts with OutstandingShieldedSupply when supply > 0", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      await bridge.incrementShieldedSupply(TOKEN_A, 100n);
      await expect(bridge.dissociateHTSToken(TOKEN_A))
        .to.be.revertedWithCustomError(bridge, "OutstandingShieldedSupply")
        .withArgs(TOKEN_A, 100n);
    });

    it("succeeds after the supply is fully decremented", async function () {
      await bridge.associateHTSToken(TOKEN_A);
      await bridge.incrementShieldedSupply(TOKEN_A, 100n);
      await bridge.decrementShieldedSupply(TOKEN_A, 100n);
      expect(await bridge.shieldedSupply(TOKEN_A)).to.equal(0n);
      await expect(bridge.dissociateHTSToken(TOKEN_A))
        .to.emit(bridge, "HTSTokenDissociated");
    });

    it("does nothing if the token was never associated (no revert, no event)", async function () {
      const tx = await bridge.dissociateHTSToken(TOKEN_A);
      const receipt = await tx.wait();
      const eventTopic = bridge.interface.getEvent("HTSTokenDissociated").topicHash;
      expect(receipt!.logs.filter((l) => l.topics[0] === eventTopic).length).to.equal(0);
    });
  });

  describe("_incrementShieldedSupply / _decrementShieldedSupply", function () {
    it("increments correctly", async function () {
      await bridge.incrementShieldedSupply(TOKEN_A, 100n);
      await bridge.incrementShieldedSupply(TOKEN_A, 50n);
      expect(await bridge.shieldedSupply(TOKEN_A)).to.equal(150n);
    });

    it("decrements correctly", async function () {
      await bridge.incrementShieldedSupply(TOKEN_A, 100n);
      await bridge.decrementShieldedSupply(TOKEN_A, 40n);
      expect(await bridge.shieldedSupply(TOKEN_A)).to.equal(60n);
    });

    it("reverts on underflow (Solidity 0.8 default)", async function () {
      // No revert reason — just a panic, expect generic revert
      await expect(bridge.decrementShieldedSupply(TOKEN_A, 1n)).to.be.reverted;
    });

    it("tracks supply per-token independently", async function () {
      await bridge.incrementShieldedSupply(TOKEN_A, 100n);
      await bridge.incrementShieldedSupply(TOKEN_B, 200n);
      expect(await bridge.shieldedSupply(TOKEN_A)).to.equal(100n);
      expect(await bridge.shieldedSupply(TOKEN_B)).to.equal(200n);
    });
  });
});
