import { Keys, newRecordKey } from "../storage/schemas.ts";
import { buildInitialDeliveryRecord } from "../models/delivery.ts";
import type { ParsedGithubPayload } from "../models/event.ts";
import type { OutboxRecord } from "../models/outbox.ts";
import type { Logger } from "../utils/logger.ts";

const MAX_ATTEMPTS_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export interface CommitWebhookInput {
  kv: Deno.Kv;
  deliveryId: string;
  eventType: string;
  installationId: string;
  payload: ParsedGithubPayload & Record<string, unknown>;
  payloadHash: string;
  logger: Logger;
}

export interface CommitWebhookResult {
  ok: boolean;
  taskId: string;
  recordKey: string;
}

/**
 * Fetches the routing snapshot for an installation, then commits all five
 * KV categories — event archive, delivery record, idempotency key, outbox
 * record, and queue enqueue — in a single kv.atomic() transaction.
 *
 * The routing lookup happens *before* the atomic block intentionally: it's
 * a read of near-static config, and re-reading it inside a retry loop would
 * not change the correctness properties here (routing changes take effect
 * on the next webhook, not retroactively on in-flight ones).
 */
export async function commitWebhook(input: CommitWebhookInput): Promise<CommitWebhookResult> {
  const { kv, deliveryId, eventType, installationId, payload, payloadHash, logger } = input;

  const routing = await kv.get<{ chat_id: string }>(Keys.routingChannel(installationId));
  const targetChat = routing.value?.chat_id ?? null;

  if (!targetChat) {
    logger.warn("pipeline", "no routing configured for installation", { installationId });
  }

  const taskId = crypto.randomUUID();
  const recordKey = newRecordKey();
  const repository = (payload.repository as { full_name?: string } | undefined)?.full_name ??
    null;

  const deliveryRecord = buildInitialDeliveryRecord({
    delivery_id: deliveryId,
    event_type: eventType,
    repository,
    installation_id: installationId,
    payload_hash: payloadHash,
    telegram_chat: targetChat,
  });

  const outboxRecord: OutboxRecord = {
    delivery_id: deliveryId,
    event_type: eventType,
    event_ref: Keys.githubEvent(deliveryId),
    record_key: recordKey,
    target: "telegram",
    target_chat: targetChat,
    created_at: Date.now(),
    attempt_count: 0,
  };

  const result = await kv.atomic()
    // CAS guard — rejects concurrent duplicate commits for this delivery ID
    .check({ key: Keys.githubEvent(deliveryId), versionstamp: null })
    // 1. Immutable event archive
    .set(Keys.githubEvent(deliveryId), {
      payload,
      headers: { event: eventType, delivery: deliveryId },
      received_at: Date.now(),
      verified: true,
    })
    // 2. Operational delivery record
    .set(Keys.deliveryRecord(recordKey), deliveryRecord)
    // 3. Idempotency key — TTL 7 days
    .set(
      Keys.idempotency(deliveryId),
      { committed_at: Date.now() },
      { expireIn: 7 * 24 * 60 * 60 * 1000 },
    )
    // 4. Outbox record
    .set(Keys.outboxPending(taskId), outboxRecord)
    // 5. Atomic enqueue
    .enqueue(
      { task_id: taskId, delivery_id: deliveryId, event_type: eventType, record_key: recordKey },
      { backoffSchedule: [...MAX_ATTEMPTS_BACKOFF_MS] },
    )
    .commit();

  return { ok: result.ok, taskId, recordKey };
}
