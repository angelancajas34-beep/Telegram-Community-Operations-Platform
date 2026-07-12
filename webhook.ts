import type { AppConfig } from "../config/env.ts";
import type { Logger } from "../utils/logger.ts";
import { sha256Hex, verifyHmacSha256 } from "../utils/crypto.ts";
import { Keys } from "../storage/schemas.ts";
import { commitWebhook } from "./pipeline.ts";
import { checkRateLimit } from "./rate_limit.ts";
import { SUPPORTED_EVENT_TYPES } from "../models/event.ts";

export interface WebhookDeps {
  kv: Deno.Kv;
  config: AppConfig;
  logger: Logger;
}

/**
 * Handles POST /github/webhook.
 *
 * Ordering is load-bearing and must not change:
 *   1. Read raw bytes (before any parsing).
 *   2. Verify HMAC-SHA-256 over those raw bytes.
 *   3. Read X-GitHub-Delivery as the idempotency key.
 *   4. Short-circuit if already committed.
 *   5. Only now parse JSON.
 *   6. Commit all five KV categories atomically, enqueue inside the same
 *      transaction.
 *   7. Return HTTP 200 only after a successful commit.
 *
 * The Telegram API is never called from this handler — only from the queue
 * worker (src/worker/queue.ts). This keeps webhook latency low and decouples
 * GitHub's delivery timeout from Telegram's availability.
 */
export async function handleGithubWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const { kv, config, logger } = deps;

  // ── Payload size guard, before reading the body into memory ───────────
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > config.maxPayloadBytes) {
    logger.warn("webhook", "payload too large", { contentLength });
    return new Response("Payload Too Large", { status: 413 });
  }

  // Step 1: Read raw bytes — must remain unmodified for HMAC verification.
  const rawBody = await req.arrayBuffer();
  if (rawBody.byteLength > config.maxPayloadBytes) {
    return new Response("Payload Too Large", { status: 413 });
  }

  // Step 2: Verify X-Hub-Signature-256 against raw bytes, before parsing.
  const sigHeader = req.headers.get("X-Hub-Signature-256") ?? "";
  const valid = await verifyHmacSha256(rawBody, config.githubWebhookSecret, sigHeader);
  if (!valid) {
    logger.warn("webhook", "signature verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  // Step 3: Read X-GitHub-Delivery as the idempotency key.
  const deliveryId = req.headers.get("X-GitHub-Delivery");
  const eventType = req.headers.get("X-GitHub-Event") ?? "unknown";
  if (!deliveryId) {
    return new Response("Bad Request: missing X-GitHub-Delivery", { status: 400 });
  }

  // Step 4: Idempotency check — short-circuit if already committed.
  const existing = await kv.get(Keys.idempotency(deliveryId));
  if (existing.value !== null) {
    logger.info("webhook", "duplicate delivery ignored", { deliveryId });
    return new Response("OK", { status: 200 });
  }

  // Step 5: Parse body — only after signature is confirmed valid.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return new Response("Bad Request: invalid JSON", { status: 400 });
  }

  const installationRaw = (payload.installation as { id?: number | string } | undefined)?.id;
  const installationId = installationRaw !== undefined ? String(installationRaw) : "unknown";

  if (
    config.allowedInstallationIds &&
    !config.allowedInstallationIds.has(installationId)
  ) {
    logger.warn("webhook", "installation not allowlisted", { installationId });
    return new Response("Forbidden", { status: 403 });
  }

  const rateLimit = await checkRateLimit(kv, installationId, config.rateLimitPerMinute);
  if (!rateLimit.allowed) {
    logger.warn("webhook", "rate limit exceeded", { installationId, count: rateLimit.count });
    return new Response("Too Many Requests", { status: 429 });
  }

  if (!SUPPORTED_EVENT_TYPES.includes(eventType as never)) {
    // Still archive + acknowledge unsupported event types rather than
    // rejecting them — GitHub disables a webhook after repeated failures,
    // and we'd rather record-and-drop than lose delivery history.
    logger.info("webhook", "unsupported event type received", { eventType });
  }

  // Step 6: Compute payload fingerprint for the delivery record.
  const payloadHash = await sha256Hex(rawBody);

  // Step 7: One atomic transaction — all five categories + enqueue().
  const result = await commitWebhook({
    kv,
    deliveryId,
    eventType,
    installationId,
    payload,
    payloadHash,
    logger,
  });

  // Step 8: Return 200 only after a successful commit.
  if (!result.ok) {
    logger.error("webhook", "atomic commit failed", { deliveryId });
    return new Response("Internal Server Error", { status: 500 });
  }

  logger.info("webhook", "committed", { deliveryId, eventType, taskId: result.taskId });
  return new Response("OK", { status: 200 });
}
