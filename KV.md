# Deno KV Storage Hierarchy

All key shapes are defined once, in `src/storage/schemas.ts` (`Keys`).
Nothing outside that file should construct a KV key by hand.

```text
github/
  events/{delivery_id}          Immutable, verified webhook archive
  installations/{installation_id}  GitHub App installation metadata (external write)

idempotency/{delivery_id}       TTL 7 days — replay protection

delivery_record/{timestamp}_{uuid}
                                 Hybrid: immutable fields written once at
                                 commit time, mutable fields updated by the
                                 worker via read-modify-write.
  Immutable: delivery_id, event_type, repository, installation_id,
             payload_hash, received_at
  Mutable:   processed_at, telegram_chat, telegram_message_id, status

outbox/
  pending/{task_id}             Awaiting delivery — includes attempt_count
  delivered/{task_id}           Terminal: confirmed delivery
  failed/{task_id}               Terminal: dead-letter, awaiting manual replay

routing/
  channels/{installation_id}    { chat_id } — set manually or by an
                                 installation-config flow you build on top
  groups/{installation_id}      Same shape, for group chats

aggregates/{installation_id}/
  total_delivered                Deno.KvU64 counter
  total_failed                   Deno.KvU64 counter

rate_limit/{installation_id}/{window_start_ms}
                                 Deno.KvU64 counter, TTL ~2x window
```

## Status field
`delivery_record.status` is one of `"pending" | "delivered" | "failed"`.
There is no `"delivering"` status — the runtime has no separate claim
step between reading a pending task and either delivering or retrying it.
If you add a claim/lease step later (e.g. to support multiple concurrent
workers with explicit ownership), add `"delivering"` then, not before —
undocumented states are worse than missing ones.

## CAS discipline
Every mutable entity (`delivery_record`, `outbox/pending`) is guarded by
a `.check()` against the `Deno.KvEntryMaybe` read immediately prior, in
the same worker invocation. This is what makes the worker safe under
`listenQueue()`'s at-least-once semantics: if two invocations somehow
race on the same task, the loser's commit fails and it simply returns
without writing anything, rather than corrupting state written by the
winner.

## Why `delivery_record` keys aren't `{delivery_id}`
Using `{timestamp}_{uuid}` instead of the GitHub delivery ID as the
primary key lets `delivery_record` entries be listed in roughly
chronological order via `kv.list()` with a prefix/range scan, which is
useful for building an operations dashboard later. The `delivery_id` is
still stored as a field on the record and is the join key back to
`github/events/{delivery_id}` and `idempotency/{delivery_id}`.
