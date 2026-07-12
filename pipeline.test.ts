import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commitWebhook } from "../../src/github/pipeline.ts";
import { Keys } from "../../src/storage/schemas.ts";
import { createLogger } from "../../src/utils/logger.ts";

const logger = createLogger("error");

async function freshKv(): Promise<Deno.Kv> {
  // In-memory-ish: unique temp path per test run avoids cross-test bleed.
  return await Deno.openKv(":memory:");
}

Deno.test("commitWebhook writes all five categories atomically", async () => {
  const kv = await freshKv();
  try {
    await kv.set(Keys.routingChannel("123"), { chat_id: "@acme_channel" });

    const result = await commitWebhook({
      kv,
      deliveryId: "delivery-1",
      eventType: "push",
      installationId: "123",
      payload: { repository: { full_name: "acme/widgets" } },
      payloadHash: "abc123",
      logger,
    });

    assert(result.ok);

    const event = await kv.get(Keys.githubEvent("delivery-1"));
    const idempotency = await kv.get(Keys.idempotency("delivery-1"));
    const record = await kv.get(Keys.deliveryRecord(result.recordKey));
    const outbox = await kv.get(Keys.outboxPending(result.taskId));

    assert(event.value !== null);
    assert(idempotency.value !== null);
    assert(record.value !== null);
    assert(outbox.value !== null);
  } finally {
    kv.close();
  }
});

Deno.test("commitWebhook snapshots routing.chat_id into the outbox and delivery record", async () => {
  const kv = await freshKv();
  try {
    await kv.set(Keys.routingChannel("456"), { chat_id: "@snapshot_test" });

    const result = await commitWebhook({
      kv,
      deliveryId: "delivery-2",
      eventType: "push",
      installationId: "456",
      payload: {},
      payloadHash: "xyz",
      logger,
    });

    const record = await kv.get<{ telegram_chat: string | null }>(
      Keys.deliveryRecord(result.recordKey),
    );
    const outbox = await kv.get<{ target_chat: string | null }>(
      Keys.outboxPending(result.taskId),
    );

    assertEquals(record.value?.telegram_chat, "@snapshot_test");
    assertEquals(outbox.value?.target_chat, "@snapshot_test");
  } finally {
    kv.close();
  }
});

Deno.test("commitWebhook rejects a second commit for the same delivery ID (CAS guard)", async () => {
  const kv = await freshKv();
  try {
    const first = await commitWebhook({
      kv,
      deliveryId: "dupe-delivery",
      eventType: "push",
      installationId: "1",
      payload: {},
      payloadHash: "hash1",
      logger,
    });
    assert(first.ok);

    const second = await commitWebhook({
      kv,
      deliveryId: "dupe-delivery",
      eventType: "push",
      installationId: "1",
      payload: {},
      payloadHash: "hash2",
      logger,
    });
    assertEquals(second.ok, false);
  } finally {
    kv.close();
  }
});

Deno.test("commitWebhook still commits when no routing is configured (target_chat null)", async () => {
  const kv = await freshKv();
  try {
    const result = await commitWebhook({
      kv,
      deliveryId: "no-routing",
      eventType: "push",
      installationId: "unrouted-install",
      payload: {},
      payloadHash: "h",
      logger,
    });
    assert(result.ok);

    const outbox = await kv.get<{ target_chat: string | null }>(
      Keys.outboxPending(result.taskId),
    );
    assertEquals(outbox.value?.target_chat, null);
  } finally {
    kv.close();
  }
});
