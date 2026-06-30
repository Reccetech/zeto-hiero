import { expect } from "chai";
import {
  encodeAuditEvent,
  decodeAuditEvent,
  AUDIT_EVENT_TYPES,
  type AuditEvent,
} from "../sdk/src/hcs/eventTaxonomy";

// v0.4 Phase 6 — HCS audit event taxonomy round-trips. (Transport — postAuditEvent /
// subscribeAuditEvents — is exercised against a live topic in the testnet demo; here we lock down
// the schema + codec that the audit trail's integrity depends on.)

describe("v0.4 Phase 6 — HCS audit event taxonomy", function () {
  const pool = "0xed8661D592A88A81382996ea17e4323bA64Df8df";

  it("round-trips every event type in the taxonomy", function () {
    for (const type of AUDIT_EVENT_TYPES) {
      const ev: AuditEvent = { type, pool, timestamp: 1781820713, data: { k: "v", n: 42, b: true } };
      const decoded = decodeAuditEvent(encodeAuditEvent(ev));
      expect(decoded.type).to.equal(type);
      expect(decoded.pool).to.equal(pool);
      expect(decoded.data.n).to.equal(42);
      expect(decoded.data.b).to.equal(true);
    }
  });

  it("covers the F-7 admin actions the pool emits", function () {
    for (const t of [
      "sanctions_root_updated",
      "identities_root_updated",
      "pause_state_changed",
      "vkey_committed",
      "vkey_locked",
      "implementation_upgraded",
      "authority_key_registered",
    ]) {
      expect(AUDIT_EVENT_TYPES).to.include(t);
    }
  });

  it("rejects an unknown event type on encode and a malformed message on decode", function () {
    expect(() => encodeAuditEvent({ type: "bogus" as any, pool, timestamp: 0, data: {} }))
      .to.throw(/unknown audit event type/);
    expect(() => decodeAuditEvent('{"pool":"0x","data":{}}')).to.throw(/malformed audit event/);
  });
});
