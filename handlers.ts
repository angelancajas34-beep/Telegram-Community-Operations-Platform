import { Keys } from "../storage/schemas.ts";

const VERSION = "2.3.2";

export function handleHealth(): Response {
  return Response.json({ status: "ok", version: VERSION, time: new Date().toISOString() });
}

/**
 * Lightweight operational snapshot: outbox backlog size and a readiness
 * check against KV. Not a full metrics/observability pipeline — pairs with
 * an external scraper (e.g. Deno Deploy's own dashboards or a cron job that
 * polls this endpoint) rather than replacing one.
 */
export async function handleMetrics(kv: Deno.Kv): Promise<Response> {
  let pendingCount = 0;
  const iter = kv.list({ prefix: Keys.outboxPendingPrefix() }, { limit: 1000 });
  for await (const _ of iter) pendingCount++;

  return Response.json({
    outbox_pending_sampled: pendingCount,
    sample_limit: 1000,
    time: new Date().toISOString(),
  });
}
