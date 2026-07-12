import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commitWebhook } from "../../src/github/pipeline.ts";
import { startQueueWorker } from "../../src/worker/queue.ts";
import { Keys } from "../../src/storage/schemas.ts";
import { createLogger } from "../../src/utils/logger.ts";
import type { TelegramClient } from "../../src/telegram/client.ts";

const logger = createLogger("error");

/** Resolves once handleDeliverySuccess has written the outbox/delivered entry. */
function waitForKey(kv: Deno.Kv, key: readonly unknown[], timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      const entry = await kv.get(key);
      if (entry.value !== null) return resolve(entry.value);
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for key ${key}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

Deno.test({
  name: "full flow: webhook commit -> queue -> successful Telegram delivery",
  async fn() {
    const kv = await Deno.openKv(":memory:");
    try {
      await kv.set(Keys.routingChannel("e2e-install"), { chat_id: "@e2e_channel" });

      const telegram: TelegramClient = {
        sendMessage: () => Promise.resolve({ ok: true, result: { message_id: 4242 } }),
      };
      startQueueWorker({ kv, telegram, logger, maxAttempts: 5 });

      const result = await commitWebhook({
        kv,
        deliveryId: "e2e-delivery-1",
        eventType: "push",
        installationId: "e2e-install",
        payload: { repository: { full_name: "acme/widgets" }, ref: "refs/heads/main", commits: [] },
        payloadHash: "e2e-hash",
        logger,
      });
      assert(result.ok);

      const delivered = await waitForKey(kv, Keys.outboxDelivered(result.taskId)) as {
        telegram_message_id: number;
      };
      assertEquals(delivered.telegram_message_id, 4242);

      const record = await kv.get<{ status: string }>(Keys.deliveryRecord(result.recordKey));
      assertEquals(record.value?.status, "delivered");

      const pending = await kv.get(Keys.outboxPending(result.taskId));
      assertEquals(pending.value, null);
    } finally {
      kv.close();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "full flow: permanent Telegram failure dead-letters after MAX_ATTEMPTS",
  async fn() {
    const kv = await Deno.openKv(":memory:");
    try {
      await kv.set(Keys.routingChannel("e2e-fail"), { chat_id: "@will_fail" });

      const telegram: TelegramClient = {
        sendMessage: () =>
          Promise.resolve({ ok: false, error_code: 400, description: "chat not found" }),
      };
      startQueueWorker({ kv, telegram, logger, maxAttempts: 2 });

      const result = await commitWebhook({
        kv,
        deliveryId: "e2e-delivery-fail",
        eventType: "push",
        installationId: "e2e-fail",
        payload: { repository: { full_name: "acme/widgets" }, commits: [] },
        payloadHash: "h",
        logger,
      });

      const failed = await waitForKey(kv, Keys.outboxFailed(result.taskId), 10_000) as {
        attempt_count: number;
      };
      assertEquals(failed.attempt_count, 2);

      const record = await kv.get<{ status: string }>(Keys.deliveryRecord(result.recordKey));
      assertEquals(record.value?.status, "failed");
    } finally {
      kv.close();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
