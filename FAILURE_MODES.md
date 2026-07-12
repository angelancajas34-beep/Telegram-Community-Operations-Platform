# Failure Modes

This document enumerates known failure scenarios and how the system
behaves under each, so behavior under failure is a documented property,
not an assumption.

## Process crashes after webhook commit, before worker picks up the task
**Behavior:** No data loss. The commit already wrote `outbox/pending`
and enqueued the message atomically. On restart, `recoverPendingOutbox()`
scans `outbox/pending` and re-enqueues anything still there
(`main.ts` calls this before `Deno.serve()` starts accepting traffic).
**Caveat:** if `listenQueue()` had already dequeued the message but not
finished processing when the crash occurred, both the queue's own retry
and `recoverPendingOutbox()` may fire for the same task. This is safe —
the worker treats an already-absent `outbox/pending` entry as "already
resolved" and no-ops.

## Process crashes after Telegram accepts the message, before the KV commit marking delivery
**Behavior:** This is the one unavoidable window in an at-least-once
system with an external side effect. The message was sent, but KV still
shows `status: "pending"`. On retry (via `recoverPendingOutbox()` or the
queue's own retry), the worker will send the message **again**, resulting
in a duplicate Telegram message for that delivery.
**Mitigation:** none built in — this is a fundamental limitation of
"at-least-once queue + non-idempotent external API" without response
deduplication on Telegram's side. If exactly-once delivery to Telegram is
a hard requirement, you'd need to track a Telegram-side idempotency
signal (Telegram doesn't provide one for `sendMessage`) or accept
occasional duplicates as the cost of guaranteed delivery.

## Telegram API is down or rate-limiting the bot
**Behavior:** `sendMessage` returns `ok: false`. The worker increments
`attempt_count` and throws, triggering the queue's `backoffSchedule`
(`[1s, 2s, 4s, 8s, 16s]`). After `MAX_ATTEMPTS` (default 5), the task is
dead-lettered.
**Recovery:** once Telegram recovers, replay dead-lettered tasks per
`docs/RUNBOOK.md`.

## `routing/channels/{installation_id}` is missing or misconfigured
**Behavior:** The webhook still commits successfully — routing is
snapshotted as `null` rather than blocking the commit. The worker logs a
warning and drops the task without marking it failed or delivered (it
remains, unresolved, in neither `delivered` nor `failed` — this is a
known gap, see below).
**Gap:** an unrouted task is neither delivered nor dead-lettered, so it
won't show up in `outbox/failed` for operator visibility. If you rely on
dead-letter monitoring as your primary signal, also monitor
`outbox/pending` entries with `target_chat: null` directly, or add
explicit handling to fail-fast these tasks in `src/worker/queue.ts`.

## Duplicate GitHub webhook delivery (GitHub's own retry)
**Behavior:** Handled by design. `idempotency/{delivery_id}` is checked
before any parsing; a duplicate delivery ID short-circuits to `200 OK`
with zero additional writes.

## Malformed or oversized webhook body
**Behavior:** Oversized bodies are rejected with `413` before being read
into memory (when `Content-Length` is present) or immediately after (as
a fallback). Bodies that fail HMAC verification are rejected with `401`
regardless of well-formed JSON. Bodies that pass HMAC verification but
aren't valid JSON are rejected with `400` — this can only happen if an
attacker has the webhook secret, at which point JSON validity is the
least of the concerns.

## Two workers processing the same task concurrently
**Behavior:** Deno KV's `listenQueue()` is documented as at-least-once,
not exactly-once, so concurrent delivery of the same message to multiple
worker invocations is possible (e.g. during a deploy where old and new
revisions briefly overlap). CAS checks (`.check(outboxRes)`,
`.check(recordRes)`) ensure only one invocation's commit succeeds; the
loser's `kv.atomic().commit()` returns `ok: false` and the function
returns without further side effects on the KV side — but note the
Telegram `sendMessage` call itself happens *before* the CAS check, so
both invocations may still each send a Telegram message. This is the
same fundamental limitation described above under "crashes after
Telegram accepts the message."
