import { Keys } from "../storage/schemas.ts";
import { formatTelegramMessage } from "../github/formatter.ts";
import type { TelegramClient } from "../telegram/client.ts";
import type { DeliveryRecord } from "../models/delivery.ts";
import type { OutboxRecord } from "../models/outbox.ts";
import { isQueueMessage } from "../models/outbox.ts";
import type { ParsedGithubPayload } from "../models/event.ts";
import type { GithubEventRecord } from "../models/event.ts";
import type { Logger } from "../utils/logger.ts";

export interface QueueWorkerDeps {
  kv: Deno.Kv;
  telegram: TelegramClient;
  logger: Logger;
  maxAttempts: number;
}

/**
 * Registers the KV queue listener. listenQueue() is Deno's at-least-once
 * delivery primitive — it auto-retries a handler that throws, using the
 * backoffSchedule set at enqueue time. This worker is written to be
 * idempotent under that at-least-once contract.
 */
export function startQueueWorker(deps: QueueWorkerDeps): void {
  const { kv, telegram, logger, maxAttempts } = deps;

  kv.listenQueue(async (msg: unknown) => {
    if (!isQueueMessage(msg)) {
      logger.error("worker", "received malformed queue message, dropping", { msg });
      return;
    }

    const { task_id, delivery_id, event_type, record_key } = msg;

    // 1. Fetch the pending outbox task. Absence means it was already
    //    processed (delivered/failed) by a prior attempt — safe to no-op.
    const outboxKey = Keys.outboxPending(task_id);
    const outboxRes = await kv.get<OutboxRecord>(outboxKey);
    if (!outboxRes.value) {
      logger.debug("worker", "outbox task already resolved, skipping", { task_id });
      return;
    }

    const outbox = outboxRes.value;
    const attemptCount = outbox.attempt_count || 0;
    const targetChat = outbox.target_chat;

    if (!targetChat) {
      logger.warn("worker", "no routing configured, dropping task", { task_id, delivery_id });
      return;
    }

    // 2. Read the archived event payload for formatting.
    const eventEntry = await kv.get<GithubEventRecord>(Keys.githubEvent(delivery_id));
    if (!eventEntry.value) {
      logger.error("worker", "archived event missing, cannot format message", {
        delivery_id,
      });
      return;
    }

    const text = formatTelegramMessage(
      event_type,
      eventEntry.value.payload as ParsedGithubPayload,
    );

    // 3. Deliver to Telegram.
    const telegramResult = await telegram.sendMessage(targetChat, text);
    const now = Date.now();

    // 4. Read the delivery record for a CAS read-modify-write update.
    const recordRes = await kv.get<DeliveryRecord>(Keys.deliveryRecord(record_key));
    const record = recordRes.value;
    const installationId = record?.installation_id ?? "unknown";

    if (telegramResult.ok) {
      await handleDeliverySuccess({
        kv,
        logger,
        outboxKey,
        outboxRes,
        record,
        recordRes,
        recordKey: record_key,
        taskId: task_id,
        deliveryId: delivery_id,
        targetChat,
        installationId,
        messageId: telegramResult.result?.message_id ?? null,
        now,
      });
      return;
    }

    await handleDeliveryFailure({
      kv,
      logger,
      outboxKey,
      outboxRes,
      outbox,
      record,
      recordRes,
      recordKey: record_key,
      taskId: task_id,
      deliveryId: delivery_id,
      installationId,
      attemptCount,
      maxAttempts,
      errorPayload: telegramResult,
      now,
    });
  });
}

interface SuccessArgs {
  kv: Deno.Kv;
  logger: Logger;
  outboxKey: readonly ["outbox", "pending", string];
  outboxRes: Deno.KvEntryMaybe<OutboxRecord>;
  record: DeliveryRecord | null;
  recordRes: Deno.KvEntryMaybe<DeliveryRecord>;
  recordKey: string;
  taskId: string;
  deliveryId: string;
  targetChat: string;
  installationId: string;
  messageId: number | null;
  now: number;
}

async function handleDeliverySuccess(args: SuccessArgs): Promise<void> {
  const {
    kv, logger, outboxKey, outboxRes, record, recordRes, recordKey,
    taskId, deliveryId, targetChat, installationId, messageId, now,
  } = args;

  const mergedRecord: Partial<DeliveryRecord> = {
    ...(record ?? {}),
    processed_at: now,
    telegram_chat: targetChat,
    telegram_message_id: messageId,
    status: "delivered",
  };

  const atomic = kv.atomic()
    .check(outboxRes) // CAS: no concurrent worker modified this task
    .delete(outboxKey)
    .set(Keys.outboxDelivered(taskId), {
      delivery_id: deliveryId,
      delivered_at: now,
      telegram_message_id: messageId,
    })
    .set(Keys.deliveryRecord(recordKey), mergedRecord)
    .mutate({
      type: "sum",
      key: Keys.aggregateDelivered(installationId),
      value: new Deno.KvU64(1n),
    });

  // Only CAS-guard the record if we actually read one — an absent record
  // is a data anomaly worth logging, but shouldn't block marking delivery.
  if (recordRes.versionstamp !== null) {
    atomic.check(recordRes);
  }

  const commitRes = await atomic.commit();

  if (commitRes.ok) {
    logger.info("worker", "delivered", { delivery_id: deliveryId, message_id: messageId });
  } else {
    logger.warn("worker", "delivery commit lost CAS race, will rely on next attempt", {
      delivery_id: deliveryId,
      task_id: taskId,
    });
  }
}

interface FailureArgs {
  kv: Deno.Kv;
  logger: Logger;
  outboxKey: readonly ["outbox", "pending", string];
  outboxRes: Deno.KvEntryMaybe<OutboxRecord>;
  outbox: OutboxRecord;
  record: DeliveryRecord | null;
  recordRes: Deno.KvEntryMaybe<DeliveryRecord>;
  recordKey: string;
  taskId: string;
  deliveryId: string;
  installationId: string;
  attemptCount: number;
  maxAttempts: number;
  errorPayload: unknown;
  now: number;
}

async function handleDeliveryFailure(args: FailureArgs): Promise<void> {
  const {
    kv, logger, outboxKey, outboxRes, outbox, record, recordRes, recordKey,
    taskId, deliveryId, installationId, attemptCount, maxAttempts, errorPayload, now,
  } = args;

  const nextAttempt = attemptCount + 1;

  if (nextAttempt < maxAttempts) {
    // Increment attempt count and throw to trigger the queue's own backoff.
    await kv.atomic()
      .check(outboxRes)
      .set(outboxKey, { ...outbox, attempt_count: nextAttempt })
      .commit();

    logger.warn("worker", "telegram delivery failed, will retry", {
      delivery_id: deliveryId,
      attempt: nextAttempt,
      error: errorPayload,
    });
    throw new Error(`Telegram delivery failed: ${JSON.stringify(errorPayload)}`);
  }

  // Exhausted — promote to dead-letter atomically.
  const mergedFailedRecord: Partial<DeliveryRecord> = {
    ...(record ?? {}),
    processed_at: now,
    status: "failed",
  };

  const atomic = kv.atomic()
    .check(outboxRes)
    .delete(outboxKey)
    .set(Keys.outboxFailed(taskId), {
      delivery_id: deliveryId,
      failed_at: now,
      attempt_count: nextAttempt,
      last_error: JSON.stringify(errorPayload),
    })
    .set(Keys.deliveryRecord(recordKey), mergedFailedRecord)
    .mutate({
      type: "sum",
      key: Keys.aggregateFailed(installationId),
      value: new Deno.KvU64(1n),
    });

  if (recordRes.versionstamp !== null) {
    atomic.check(recordRes);
  }

  await atomic.commit();

  logger.error("worker", "delivery exhausted, dead-lettered", {
    delivery_id: deliveryId,
    attempt_count: nextAttempt,
  });
  // Return without throwing — prevents the queue from retrying further.
}

/**
 * Crash recovery: if the process restarted before listenQueue() could
 * retry a task, any tasks still under outbox/pending are re-enqueued here
 * at startup. Idempotency keys and CAS checks make re-enqueueing safe even
 * if a task was actually mid-flight.
 */
export async function recoverPendingOutbox(kv: Deno.Kv, logger: Logger): Promise<number> {
  const iter = kv.list<OutboxRecord>({ prefix: Keys.outboxPendingPrefix() });
  let recovered = 0;

  for await (const entry of iter) {
    const { delivery_id, event_type, record_key } = entry.value;
    const task_id = entry.key[2] as string;
    await kv.enqueue({ task_id, delivery_id, event_type, record_key });
    recovered++;
  }

  if (recovered > 0) {
    logger.info("recovery", `re-enqueued pending outbox tasks`, { count: recovered });
  }

  return recovered;
}
