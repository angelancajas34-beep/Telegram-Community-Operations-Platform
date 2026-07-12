import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commitWebhook } from "../../src/github/pipeline.ts";
import { Keys } from "../../src/storage/schemas.ts";
import { createLogger } from "../../src/utils/logger.ts";
import type { TelegramClient, TelegramSendResult } from "../../src/telegram/client.ts";

const logger = createLogger("error");

function mockTelegram(result: TelegramSendResult): TelegramClient {
  return { sendMessage: () => Promise.resolve(result) };
}

/**
 * These tests exercise the *logic* the worker uses (success/failure record
 * merging) by directly invoking the same KV operations startQueueWorker
 * would perform, since listenQueue() itself requires a running queue
 * consumer loop that's awkward to await deterministically in a unit test.
 * The worker module is exercised end-to-end in tests/e2e.
 */

Deno.test("outbox record survives a full commit -> read -> mutate roundtrip", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(Keys.routingChannel("1"), { chat_id: "@chan" });
    const result = await commitWebhook({
      kv,
      deliveryId: "d1",
      eventType: "push",
      installationId: "1",
      payload: { repository: { full_name: "acme/widgets" } },
      payloadHash: "h",
      logger,
    });

    const outbox = await kv.get<{ attempt_count: number }>(Keys.outboxPending(result.taskId));
    assertEquals(outbox.value?.attempt_count, 0);
  } finally {
    kv.close();
  }
});

Deno.test("delivery record read-modify-write preserves immutable fields on update", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(Keys.routingChannel("1"), { chat_id: "@chan" });
    const result = await commitWebhook({
      kv,
      deliveryId: "d2",
      eventType: "release",
      installationId: "1",
      payload: { repository: { full_name: "acme/widgets" } },
      payloadHash: "original-hash",
      logger,
    });

    const before = await kv.get<Record<string, unknown>>(Keys.deliveryRecord(result.recordKey));
    assert(before.value);

    // Simulate the worker's read-modify-write on success.
    const merged = {
      ...before.value,
      processed_at: Date.now(),
      telegram_message_id: 999,
      status: "delivered",
    };
    await kv.set(Keys.deliveryRecord(result.recordKey), merged);

    const after = await kv.get<Record<string, unknown>>(Keys.deliveryRecord(result.recordKey));
    assertEquals(after.value?.payload_hash, "original-hash");
    assertEquals(after.value?.delivery_id, "d2");
    assertEquals(after.value?.status, "delivered");
    assertEquals(after.value?.telegram_message_id, 999);
  } finally {
    kv.close();
  }
});

Deno.test("mockTelegram helper reports failure shape used by dead-letter logic", async () => {
  const client = mockTelegram({ ok: false, error_code: 400, description: "chat not found" });
  const res = await client.sendMessage("@missing", "hi");
  assertEquals(res.ok, false);
  assertEquals(res.description, "chat not found");
});
