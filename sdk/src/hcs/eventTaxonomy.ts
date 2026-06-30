// @hiero-privacy/zeto-sdk — HCS audit event taxonomy (PRD §16.7 / F-7).
//
// Every privacy-relevant admin action is mirrored to a per-pool Hedera Consensus Service topic so
// there is an immutable, independently-verifiable audit trail. The topic uses a threshold submit
// key (e.g. 3-of-5 Helpers) so no single party can forge the log. This module defines the message
// schema + codec; eventPoster/eventListener handle transport.

export type AuditEventType =
  | "authority_key_registered"
  | "authority_key_reconstructed"
  | "sanctions_root_updated"
  | "identities_root_updated"
  | "pause_state_changed"
  | "vkey_committed"
  | "vkey_locked"
  | "implementation_upgraded"
  | "participant_enrolled"
  | "pool_deployed";

export interface AuditEvent {
  type: AuditEventType;
  pool: string; // pool contract address
  timestamp: number; // unix seconds (client clock; consensus timestamp is authoritative)
  data: Record<string, string | number | boolean>;
}

export const AUDIT_EVENT_TYPES: AuditEventType[] = [
  "authority_key_registered",
  "authority_key_reconstructed",
  "sanctions_root_updated",
  "identities_root_updated",
  "pause_state_changed",
  "vkey_committed",
  "vkey_locked",
  "implementation_upgraded",
  "participant_enrolled",
  "pool_deployed",
];

/** Serialize an audit event to the bytes posted as an HCS topic message. */
export function encodeAuditEvent(ev: AuditEvent): Uint8Array {
  if (!AUDIT_EVENT_TYPES.includes(ev.type)) throw new Error(`unknown audit event type: ${ev.type}`);
  return new TextEncoder().encode(JSON.stringify(ev));
}

/** Parse an HCS topic message back into an audit event (throws on a malformed / unknown type). */
export function decodeAuditEvent(bytes: Uint8Array | string): AuditEvent {
  const json = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  const ev = JSON.parse(json) as AuditEvent;
  if (!ev.type || !AUDIT_EVENT_TYPES.includes(ev.type)) throw new Error("malformed audit event");
  if (typeof ev.pool !== "string") throw new Error("malformed audit event: pool");
  return ev;
}
