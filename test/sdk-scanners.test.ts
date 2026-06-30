import { expect } from "chai";
import { ethers } from "hardhat";
import { newUser, newUTXO, ZERO_UTXO, type User } from "./lib/zeto-witness";
import { newUtxoSmt, newIdentitiesSmt, addIdentity, addCommitment } from "./lib/zeto-witness-kyc";
import { newSanctionsSmt, addSanctioned } from "./lib/zeto-witness-sanctions";
import { prepareNRTransferProof } from "./lib/zeto-witness-nr";
import { scanForRecipient } from "../sdk/src/scan/OutputScanner";
import { auditTransfer } from "../sdk/src/scan/AuthorityAuditScanner";

/* eslint-disable @typescript-eslint/no-var-requires */
const { genKeypair } = require("maci-crypto");
/* eslint-enable @typescript-eslint/no-var-requires */

// v0.4 Phase 4 — exercise the SDK scanners against the output of a REAL production-circuit proof.
// (No chain needed: we generate a real transfer proof and feed its public outputs to the scanners.)

describe("v0.4 Phase 4 — SDK scanners (recipient + authority audit)", function () {
  this.timeout(900_000);

  it("recipient scanner finds only its note; authority scanner reconstructs everything", async function () {
    const [a, b, c] = await ethers.getSigners();
    const Alice: User = await newUser(a);
    const Bob: User = await newUser(b);
    const Eve: User = await newUser(c); // a non-recipient
    const authority = genKeypair();

    // Off-chain trees (no deployment — we only need a valid proof's public signals)
    const utxo100 = newUTXO(100, Alice);
    const utxoSmt = newUtxoSmt("u");
    await addCommitment(utxoSmt, utxo100.hash);
    const idSmt = newIdentitiesSmt("i");
    await addIdentity(idSmt, Alice.babyJubPublicKey);
    await addIdentity(idSmt, Bob.babyJubPublicKey);
    const sanc = newSanctionsSmt("s");
    await addSanctioned(sanc, 111n);

    const utxoBob40 = newUTXO(40, Bob);
    const utxoAlice60 = newUTXO(60, Alice);
    const xfer = await prepareNRTransferProof(
      Alice, [utxo100, ZERO_UTXO], [utxoBob40, utxoAlice60], [Bob, Alice],
      utxoSmt, idSmt, sanc, authority.pubKey,
    );

    const transferEvent = {
      outputs: [utxoBob40.hash, utxoAlice60.hash],
      encryptionNonce: xfer.encryptionNonce,
      ecdhPublicKey: xfer.ecdhPublicKey as [bigint, bigint],
      encryptedValues: xfer.encryptedValues,
    };

    // Bob finds his 40 note; Alice finds her 60 change; Eve finds nothing.
    const bobNotes = scanForRecipient([transferEvent], Bob.babyJubPrivateKey, Bob.babyJubPublicKey as [bigint, bigint]);
    expect(bobNotes.length).to.equal(1);
    expect(bobNotes[0].value).to.equal(40n);
    expect(bobNotes[0].commitment).to.equal(utxoBob40.hash);

    const aliceNotes = scanForRecipient([transferEvent], Alice.babyJubPrivateKey, Alice.babyJubPublicKey as [bigint, bigint]);
    expect(aliceNotes.length).to.equal(1);
    expect(aliceNotes[0].value).to.equal(60n);

    const eveNotes = scanForRecipient([transferEvent], Eve.babyJubPrivateKey, Eve.babyJubPublicKey as [bigint, bigint]);
    expect(eveNotes.length).to.equal(0);

    // Authority reconstructs the whole transfer.
    const audited = auditTransfer(
      authority.privKey,
      {
        nullifiers: [xfer.nullifiers[0]],
        outputs: [utxoBob40.hash, utxoAlice60.hash],
        encryptionNonce: xfer.encryptionNonce,
        ecdhPublicKey: xfer.ecdhPublicKey as [bigint, bigint],
        cipherTextAuthority: xfer.cipherTextAuthority,
      },
      2,
      2,
    );
    expect(audited.inputs[0].value).to.equal(100n);
    expect(audited.outputs[0].value).to.equal(40n);
    expect(audited.outputs[1].value).to.equal(60n);
    // sender key in the plaintext matches Alice's BJJ public key
    expect(audited.senderPubKey[0]).to.equal(Alice.babyJubPublicKey[0]);
  });
});
