import { Keys } from "../storage/schemas.ts";

const WINDOW_MS = 60_000;

/**
 * Fixed-window rate limiter keyed by installation ID. Uses KV's atomic sum
 * mutation so concurrent requests in the same window count correctly.
 * This is intentionally coarse (fixed window, not sliding) — good enough to
 * blunt abusive senders without adding another moving part.
 */
export async function checkRateLimit(
  kv: Deno.Kv,
  installationId: string,
  limitPerMinute: number,
): Promise<{ allowed: boolean; count: number }> {
  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const key = Keys.rateLimit(installationId, windowStart);

  const result = await kv.atomic()
    .mutate({ type: "sum", key, value: new Deno.KvU64(1n) })
    .commit();

  if (!result.ok) {
    // Fail open: a rate-limit bookkeeping failure should not block delivery.
    return { allowed: true, count: 0 };
  }

  const current = await kv.get<Deno.KvU64>(key);
  const count = current.value ? Number(current.value.value) : 1;

  // Expire the counter shortly after the window closes so it doesn't
  // accumulate indefinitely.
  if (count === 1) {
    await kv.set(key, new Deno.KvU64(1n), { expireIn: WINDOW_MS * 2 });
  }

  return { allowed: count <= limitPerMinute, count };
}
