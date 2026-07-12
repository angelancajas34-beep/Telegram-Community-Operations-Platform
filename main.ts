/**
 * Telegram Community & Operations Platform — GitHub → Telegram relay
 * Entry point: wires config, KV, the queue worker, crash recovery, and the
 * HTTP server together.
 *
 * Reliability invariants enforced by this codebase (see docs/ARCHITECTURE.md):
 *   1. HMAC-SHA-256 verified against raw bytes — before any JSON parsing
 *   2. X-GitHub-Delivery used as the idempotency key
 *   3. All five KV categories committed in one kv.atomic() — including enqueue()
 *   4. HTTP 200 returned only after a successful commit
 *   5. Telegram API called only inside the queue worker — never in the webhook handler
 */

import { loadConfig } from "./src/config/env.ts";
import { createLogger } from "./src/utils/logger.ts";
import { getKv } from "./src/storage/kv.ts";
import { createRouter } from "./src/http/router.ts";
import { startQueueWorker, recoverPendingOutbox } from "./src/worker/queue.ts";
import { createTelegramClient } from "./src/telegram/client.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const kv = await getKv();
const telegram = createTelegramClient(config.telegramBotToken);

// Start the queue worker before serving traffic, so no webhook can be
// accepted while there's nothing listening to drain the queue.
startQueueWorker({ kv, telegram, logger, maxAttempts: config.maxAttempts });

// If the process restarted before a retry could fire, re-enqueue anything
// still sitting in outbox/pending.
await recoverPendingOutbox(kv, logger);

const router = createRouter({ kv, config, logger });

logger.info("main", "starting server", { version: "2.3.2" });

Deno.serve(router);
