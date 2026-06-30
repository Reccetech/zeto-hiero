import { expect } from "chai";
import { splitSecret, reconstruct, FIELD } from "../sdk/src/authority/shamir";
import { generateAndDistribute, reconstructAuthorityKey } from "../sdk/src/authority/AuthorityKeyManager";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genPubKey } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */

// v0.4 Phase 5 — authority key custody (Shamir T-of-N fallback for DeRec).

describe("v0.4 Phase 5 — authority key Shamir custody", function () {
  it("splits 3-of-5 and reconstructs from ANY 3 shares", function () {
    const secret = 123456789012345678901234567890n % FIELD;
    const shares = splitSecret(secret, 5, 3);
    expect(shares.length).to.equal(5);

    // every 3-subset reconstructs the original
    const subsets = [
      [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 4], [1, 3, 4], [2, 3, 4],
    ];
    for (const idx of subsets) {
      const got = reconstruct(idx.map((i) => shares[i]));
      expect(got).to.equal(secret);
    }
    // more than threshold also works
    expect(reconstruct([shares[0], shares[1], shares[2], shares[3]])).to.equal(secret);
  });

  it("fewer than threshold does NOT reveal the secret", function () {
    const secret = 999n;
    const shares = splitSecret(secret, 5, 3);
    const wrong = reconstruct([shares[0], shares[1]]); // only 2 of 3
    expect(wrong).to.not.equal(secret);
  });

  it("generateAndDistribute: 5 shares, never returns sk_auth, key reconstructs", function () {
    const helpers = ["operator", "regulator", "hiero-gov", "legal", "treasury"].map((id) => ({ id }));
    const res = generateAndDistribute(helpers, 3);
    expect(res.shares.length).to.equal(5);
    expect(res.threshold).to.equal(3);
    expect((res as any).privateKey).to.equal(undefined); // sk_auth is never exposed

    // reconstruct from any 3 decrypted shares → public key matches the distributed one
    const three = res.shares.slice(0, 3).map((s) => ({ x: s.x, y: BigInt(s.payload) }));
    const recon = reconstructAuthorityKey(three, 3);
    expect(recon.publicKey[0]).to.equal(res.authorityPublicKey[0]);
    expect(recon.publicKey[1]).to.equal(res.authorityPublicKey[1]);
    // sanity: the reconstructed private key really derives that public key
    const pub = genPubKey(recon.privateKey);
    expect(pub[0]).to.equal(res.authorityPublicKey[0]);
  });

  it("honors a Helper encryptor (pluggable transport)", function () {
    const seen: string[] = [];
    const helpers = [
      { id: "h1", encrypt: (p: string) => { seen.push(p); return "enc:" + p; } },
      { id: "h2", encrypt: (p: string) => "enc:" + p },
      { id: "h3", encrypt: (p: string) => "enc:" + p },
    ];
    const res = generateAndDistribute(helpers, 2);
    expect(res.shares.every((s) => s.encrypted)).to.equal(true);
    expect(res.shares[0].payload.startsWith("enc:")).to.equal(true);
    // caller "decrypts" by stripping the prefix, then reconstructs
    const dec = res.shares.slice(0, 2).map((s) => ({ x: s.x, y: BigInt(s.payload.replace("enc:", "")) }));
    const recon = reconstructAuthorityKey(dec, 2);
    expect(recon.publicKey[0]).to.equal(res.authorityPublicKey[0]);
  });
});
