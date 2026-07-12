# Architecture

## Overview
This service receives GitHub App webhooks, persists them durably, and
delivers a formatted notification to Telegram. It runs as a single Deno
Deploy process with Deno KV as its only datastore — no external queue,
cache, or database.

## Request flow

```
POST /github/webhook
      │
      ▼
Verify X-Hub-Signature-256 over raw bytes (before parsing)
      │
      ▼
Check X-GitHub-Delivery against idempotency/{delivery_id}
      │  (duplicate → return 200 immediately, no further work)
      ▼
Parse JSON
      │
      ▼
kv.atomic()
      ├── set github/events/{delivery_id}          (immutable archive)
      ├── set delivery_record/{timestamp}_{uuid}    (mutable operational record)
      ├── set idempotency/{delivery_id}              (TTL 7 days)
      ├── set outbox/pending/{task_id}                (attempt_count: 0)
      └── enqueue({task_id, delivery_id, ...})        (same transaction)
      │
      ▼
HTTP 200 (only if the atomic commit succeeded)
```

The queue message is created **inside** the same `kv.atomic()` call as
every other write. If the commit fails for any reason, no queue message
exists — there is no code path that enqueues without also persisting state,
and no code path that returns 200 without both.

## Delivery flow

```
kv.listenQueue()
      │
      ├─ load outbox/pending/{task_id}   (absence = already resolved, no-op)
      ├─ load github/events/{delivery_id} (payload for formatting)
      ├─ POST to Telegram Bot API
      │
      ├─ success → atomic: delete pending, write outbox/delivered,
      │            read-modify-write delivery_record, increment aggregate
      │
      └─ failure → attempt_count + 1 < MAX_ATTEMPTS:
                       update attempt_count, throw (queue retries with backoff)
                   attempt_count + 1 == MAX_ATTEMPTS:
                       atomic dead-letter promotion, return (no further retry)
```

The Telegram API is called **only** from the queue worker
(`src/worker/queue.ts`). The webhook handler never calls out to Telegram —
this keeps webhook response latency independent of Telegram's availability
and avoids GitHub's own webhook delivery timeout being affected by a slow
or down downstream service.

## Why Deno KV
- `kv.atomic()` gives multi-key, multi-operation transactions with
  optional CAS (`.check()`) guards in a single round trip.
- `kv.enqueue()` inside `kv.atomic()` gives the transactional-outbox
  pattern natively, without a separate message broker.
- `kv.listenQueue()` gives at-least-once delivery with configurable
  per-message backoff, again without extra infrastructure.
- Deno Deploy operates KV with continuous point-in-time recovery, so a
  single-region single-process design does not sacrifice durability.

## Non-goals
This repository intentionally implements one thing well: a reliable
GitHub → Telegram relay. It does not include a workflow engine, broadcast
scheduler, ticketing system, or analytics service — none of that is
specified here, and none of it is required to satisfy the reliability
guarantees documented in this file. See the root README for how to extend
the platform if you need those capabilities.
