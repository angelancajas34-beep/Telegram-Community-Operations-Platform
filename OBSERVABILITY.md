# Observability

## Structured Logs

Every log line is a single JSON object via `logger.ts`:

```json
{
  "ts": "2026-07-12T00:00:00.000Z",
  "level": "info",
  "scope": "webhook",
  "message": "github webhook committed",
  "deliveryId": "12345678-1234-1234-1234-123456789012",
  "eventType": "push",
  "correlationId": "github-delivery-abc123"
}
```

**Scope** identifies the module (`webhook`, `pipeline`, `worker`, `recovery`, `http`, `main`, `audit`, `queue`) so logs can be filtered without regex. **LOG_LEVEL** controls the minimum level emitted (`debug | info | warn | error`, default `info`).

**Security:** No secret values are ever passed as log fields — see `SECURITY.md`.

---

## Fields Recorded per GitHub Delivery (at webhook commit)

When a GitHub webhook is received and committed to the outbox:

| Field | Source | Type |
|-------|--------|------|
| `deliveryId` | `X-GitHub-Delivery` header | string (UUID) |
| `eventType` | `X-GitHub-Event` header | string |
| `repoId` | Parsed from payload | string |
| `installationId` | `payload.installation.id` | number |
| `payloadHash` | `sha256Hex(rawBody)` | string (hex digest) |
| `receivedAt` | Timestamp at handler entry | ISO-8601 string |
| `status` | Initial state | `"pending"` |

**Storage:** `["github", "deliveries", {deliveryId}]` as `GitHubDelivery`

---

## Fields Recorded per Outbox Entry (transient state machine)

Every deliverable message passes through the outbox before being sent:

| Field | Purpose | Values |
|-------|---------|--------|
| `outboxId` | Unique identifier | UUID |
| `correlationId` | References originating entity | deliveryId, broadcastId, ticketId, etc. |
| `correlationType` | Type of origin | `"github"`, `"broadcast"`, `"ticket"`, `"notification"` |
| `status` | Current delivery state | `"pending"` → `"processing"` → `"done"` / `"failed"` |
| `attempts` | Retry count | incremented on each failure |
| `createdAt` | Timestamp of creation | ISO-8601 |
| `processedAt` | Timestamp of final outcome | ISO-8601 (set on done/failed) |
| `payload` | Telegram message data | JSON (content, mediaUrl, targetGroups, etc.) |

**Storage:** `["outbox", {outboxId}]` as `OutboxEntry` (ephemeral, cleaned after finalization)

---

## Fields Recorded on Dead-Letter Queue

When an outbox entry exceeds `MAX_ATTEMPTS` (default: 5):

| Field | Source | Type |
|-------|--------|------|
| `outboxId` | From failed outbox entry | UUID |
| `failedAt` | Timestamp at exhaustion | ISO-8601 |
| `attemptCount` | Final attempt number | number |
| `lastError` | Stringified error | string (Telegram API error or system error) |
| `correlationId` | Reference to originating entity | string |
| `correlationType` | Type of originating entity | string |
| `payload` | Original message payload | JSON |

**Storage:** `["dlq", {outboxId}]` as `OutboxEntry` with status `"failed"`

**Replay:** `replayDeadLetter(kv, outboxId)` resets the entry to `"pending"` and re-enqueues it.

---

## Audit Events (immutable log)

Every significant state transition is recorded as an append-only audit event:

| Field | Purpose | Example |
|-------|---------|---------|
| `eventId` | Unique identifier | UUID |
| `timestamp` | When the event occurred | ISO-8601 (immutable, determines sort order) |
| `type` | Event classification | `"ticket.created"`, `"broadcast.published"`, `"github.delivery_failed"` |
| `actorId` | Who triggered the event | userId or `"system"` |
| `entityId` | What was affected | ticketId, broadcastId, deliveryId |
| `entityType` | Type of entity | `"ticket"`, `"broadcast"`, `"github_delivery"` |
| `before` | State before transition | partial entity object (optional) |
| `after` | State after transition | partial entity object (optional) |
| `metadata` | Additional context | arbitrary JSON (optional) |

**Storage:** `["audit", {isoTimestamp}, {eventId}]` as `AuditEvent`

**Query:** `AuditService.query({ since, until, type, entityId, limit })`

**Mandatory audit points:**

- **Support:** `ticket.created`, `ticket.resolved`, `ticket.closed`
- **Broadcasts:** `broadcast.scheduled`, `broadcast.published`, `broadcast.failed`
- **GitHub:** `github.delivery_failed`, `github.delivery_dead`
- **Groups:** `group.configured`, `group.feature_toggled`
- **Users:** `user.role_changed`
- **Admin:** `admin.action` (catch-all for administrative operations)

---

## Operational Aggregates (atomic counters)

All counters use Deno KV's native `bigint` sum mutations, which are atomic and require no read-modify-write:

| Counter | Key | Purpose |
|---------|-----|---------|
| Broadcasts Published | `["analytics", "counters", "broadcasts_published"]` | Total broadcasts sent successfully |
| Broadcasts Failed | `["analytics", "counters", "broadcasts_failed"]` | Total broadcasts that failed after max retries |
| Tickets Open | `["analytics", "counters", "tickets_open"]` | Currently open support tickets |
| Tickets Closed | `["analytics", "counters", "tickets_closed"]` | Total resolved/closed tickets |
| GitHub Deliveries Success | `["analytics", "counters", "deliveries_success"]` | Successfully processed GitHub webhooks |
| GitHub Deliveries Failed | `["analytics", "counters", "deliveries_failed"]` | GitHub deliveries dead-lettered |

**Usage pattern:**

```typescript
// Increment atomically (never blocks)
await kv.atomic()
  .sum(["analytics", "counters", "broadcasts_published"], 1n)
  .commit();

// Read all counters for metrics endpoint
async function readCounters(kv: Deno.Kv): Promise<Record<string, number>> {
  const entries = await kv.getMany(Object.values(COUNTER_KEYS));
  return Object.fromEntries(
    Object.entries(COUNTER_KEYS).map(([name], i) => [
      name,
      Number((entries[i].value as bigint | null) ?? 0n),
    ])
  );
}
```

---

## Health & Metrics Endpoints

### GET /health

Returns overall system health and operational metrics:

```json
{
  "status": "healthy",
  "checks": {
    "kv": "ok"
  },
  "metrics": {
    "pendingOutbox": 3,
    "dlqSize": 0,
    "broadcastsPublished": 150,
    "broadcastsFailed": 2,
    "ticketsOpen": 5,
    "ticketsClosed": 142,
    "deliveriesSuccess": 1200,
    "deliveriesFailed": 8
  },
  "timestamp": "2026-07-12T00:00:00.000Z"
}
```

**Status codes:**
- `200 OK` — all checks pass
- `503 Service Unavailable` — KV unavailable or DLQ growing (degraded)

### GET /metrics

Exposes metrics in Prometheus text format:

```
# HELP telegram_ops_broadcasts_published Total broadcasts sent successfully
# TYPE telegram_ops_broadcasts_published gauge
telegram_ops_broadcasts_published 150

# HELP telegram_ops_broadcasts_failed Total broadcast failures
# TYPE telegram_ops_broadcasts_failed gauge
telegram_ops_broadcasts_failed 2

# ... (all counters listed)
```

---

## Observability Patterns

### Idempotency Tracking

Each outbox entry includes a `correlationId` that ties it to the originating entity. When a message is replayed (e.g., after a crash recovery), the same `correlationId` is used, allowing deduplication at the application layer:

```typescript
// Check if this delivery was already processed
const existingOutbox = await kv.list<OutboxEntry>({
  prefix: ["outbox"],
});

for await (const entry of existingOutbox) {
  if (entry.value.correlationId === deliveryId && entry.value.status === "done") {
    // Already sent — skip
    return;
  }
}
```

### Dead-Letter Analysis

Query the DLQ to diagnose systemic failures:

```typescript
async function analyzeDLQ(kv: Deno.Kv): Promise<void> {
  const dlq = kv.list<OutboxEntry>({ prefix: ["dlq"] });
  const failureReasons: Record<string, number> = {};

  for await (const entry of dlq) {
    const reason = entry.value.lastError || "unknown";
    failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
  }

  console.log("DLQ failure breakdown:", failureReasons);
}
```

### Audit Trail for Compliance

Query audit events for any entity to build a complete timeline:

```typescript
const auditService = new AuditService(kv);
const ticketAudit = await auditService.query({
  entityId: ticketId,
  limit: 100,
});

console.log(`Ticket ${ticketId} history:`, ticketAudit);
```

---

## What's Intentionally Out of Scope

This repo does not ship:

- **Metrics exporters** (Prometheus, OpenTelemetry, Datadog, etc.) — layer these on top
- **Log aggregation pipelines** (ELK, Splunk, Loki, etc.) — integrate your preferred stack
- **Custom dashboarding** — `/metrics` and `/health` provide raw data for your monitoring platform
- **Alerting rules** — define these in your monitoring system based on counter thresholds

The right choice for all of these depends on your existing infrastructure. This system provides the **audit trail** (KV) and **structured logs** (JSON) — connect them to your observability platform.

---

## Recommended Observability Stack

1. **Logs:** Direct `logger.ts` output to your log aggregator (Datadog, Splunk, ELK)
2. **Metrics:** Scrape `/metrics` endpoint with Prometheus, Grafana, or equivalent
3. **Audit Trail:** Query `["audit", ...]` keys directly for compliance/forensics
4. **Health:** Monitor `/health` endpoint for SLO tracking
5. **Alerts:** Set thresholds on counter growth (DLQ size, failure rates) in your SIEM

---

*Observability is a layered concern. This system provides all the observability data; your operations platform decides how to collect, aggregate, and act on it.*
