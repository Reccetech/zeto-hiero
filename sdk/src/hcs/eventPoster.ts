// @hiero-privacy/zeto-sdk — HCS audit event poster/listener.
//
// Thin wrappers over the Hiero JS SDK. The poster submits an encoded audit event to the pool's
// HCS topic; the listener subscribes via a Mirror Node and decodes each message by `type`. Topic
// creation (with a 3-of-5 Helper threshold submit key) lives in scripts/create-hcs-topic.ts.
//
// These are transport adapters — the auditable behavior (taxonomy + codec) is unit-tested in
// eventTaxonomy; the SDK consumer wires a real Client/TopicId at runtime.

import { encodeAuditEvent, decodeAuditEvent, type AuditEvent } from "./eventTaxonomy";

/* eslint-disable @typescript-eslint/no-var-requires */
const { TopicMessageSubmitTransaction, TopicMessageQuery } = require("@hiero-ledger/sdk");
/* eslint-enable @typescript-eslint/no-var-requires */

/** Submit an audit event to `topicId` using an already-configured Hiero `client`. */
export async function postAuditEvent(client: any, topicId: string, ev: AuditEvent): Promise<string> {
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(encodeAuditEvent(ev))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return receipt.status.toString();
}

/**
 * Subscribe to a pool's audit topic; `onEvent` is called with each decoded AuditEvent.
 * Returns the subscription handle so the caller can unsubscribe.
 */
export function subscribeAuditEvents(
  client: any,
  topicId: string,
  onEvent: (ev: AuditEvent) => void,
  onError?: (e: unknown) => void,
): any {
  return new TopicMessageQuery()
    .setTopicId(topicId)
    .subscribe(
      client,
      (msg: any) => {
        try {
          onEvent(decodeAuditEvent(msg.contents));
        } catch (e) {
          onError?.(e);
        }
      },
      (e: unknown) => onError?.(e),
    );
}
