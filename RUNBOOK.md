# Runbook

## Symptom: messages not arriving in Telegram

1. Check `/health` — is the process up at all?
2. Check `outbox/pending/*` count via `/metrics`. A growing backlog with
   no corresponding `outbox/delivered` growth suggests the queue worker
   isn't running or is erroring on every attempt.
3. Check recent `outbox/failed/*` entries for `last_error` — a Telegram
   `403`/`chat not found` almost always means the bot was removed from
   the target chat, or `routing/channels/{installation_id}.chat_id` is
   wrong.
4. Check `routing/channels/{installation_id}` exists at all — if it's
   missing, `target_chat` is `null` and the worker silently drops the
   task (logged as a warning, not an error, since "no routing configured
   yet" is an expected state for a newly-installed app).

## Symptom: webhook returns 401
- Compare the GitHub App's configured webhook secret against
  `GITHUB_WEBHOOK_SECRET` in Deno Deploy. These must match exactly,
  including no trailing whitespace.
- Confirm GitHub is sending `X-Hub-Signature-256` (not the deprecated
  `X-Hub-Signature` / SHA-1 header only) — check the GitHub App's
  webhook delivery log ("Recent Deliveries" tab) for the actual headers
  sent.

## Symptom: webhook returns 429 unexpectedly
- Check `RATE_LIMIT_PER_MINUTE`. A legitimate installation generating
  more than the configured limit (default 120/min) in bursts (e.g. a
  large monorepo's CI triggering many `workflow_run` events at once)
  will trip this. Raise the limit or exempt trusted installations via
  a higher default.

## Symptom: duplicate Telegram messages for one GitHub event
This should not happen under normal operation — `idempotency/{delivery_id}`
prevents re-committing the same webhook, and the worker's CAS checks
prevent double-processing a single outbox task. If you observe this:
1. Check whether GitHub itself redelivered the webhook with a **new**
   `X-GitHub-Delivery` ID (visible in the App's delivery log) — this is
   GitHub's own retry behavior on timeout, not a bug here, and is
   expected to produce a second, distinct delivery.
2. If the delivery IDs are identical, that's a genuine bug — capture the
   `delivery_id` and open an issue; it likely indicates the idempotency
   check or a CAS guard was bypassed somewhere.

## Manual replay of a dead-lettered delivery
```typescript
const kv = await Deno.openKv();
const failedEntries = kv.list({ prefix: ["outbox", "failed"] });
for await (const entry of failedEntries) {
  const { delivery_id } = entry.value as { delivery_id: string };
  if (delivery_id !== "<the delivery_id you want to replay>") continue;

  // Re-derive the original outbox shape from the delivery_record so the
  // worker has everything it needs, then re-enqueue.
  // (Adjust field names if you've extended the schema.)
  const recordIter = kv.list({ prefix: ["delivery_record"] });
  for await (const rec of recordIter) {
    const r = rec.value as { delivery_id: string };
    if (r.delivery_id !== delivery_id) continue;
    const recordKey = (rec.key[1] as string);
    await kv.enqueue({
      task_id: crypto.randomUUID(),
      delivery_id,
      event_type: (entry.value as { event_type?: string }).event_type ?? "unknown",
      record_key: recordKey,
    });
  }
}
```
Note this creates a *new* `task_id` — the original `outbox/failed` entry
is left in place as a historical record. Consider deleting or archiving
it separately if you don't want duplicate audit trails.

## Disaster recovery
See the "Backup & DR" section in the root README for the full restore
playbook (PITR restore → `recoverPendingOutbox()` → replay
`outbox/failed` as needed → reopen the webhook endpoint).
