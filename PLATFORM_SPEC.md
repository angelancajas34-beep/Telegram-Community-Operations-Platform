# Telegram Community & Operations Platform — Extended Specification

> **Document Status:** v2.0 specification for platform evolution  
> **Scope:** GitHub notification relay → integrated ops platform  
> **Authority:** Single KV schema, unified execution model, immutable audit log

---

## Table of Contents

1. [Unified KV Schema](#1-unified-kv-schema)
2. [Single Execution Model](#2-single-execution-model)
3. [Immutable Audit Log](#3-immutable-audit-log)
4. [Broadcast Pipeline](#4-broadcast-pipeline)
5. [Support Ticket Lifecycle](#5-support-ticket-lifecycle)
6. [Community Management](#6-community-management)
7. [Finite State Machines](#7-finite-state-machines)
8. [Secondary Indexes](#8-secondary-indexes)
9. [Runtime Architecture](#9-runtime-architecture)
10. [Operational Readiness](#10-operational-readiness)

---

## 1. Unified KV Schema

All domains share one key hierarchy. Keys are arrays of string segments matching Deno KV's native format.

### 1.1 Complete Key Hierarchy

```
Users & Profiles
["users",           {userId}                                ]  → UserProfile
["users",           {userId},    "session"                  ]  → UserSession (TTL)
["users",           {userId},    "onboarding"               ]  → OnboardingState
["users",           {userId},    "roles"                    ]  → RoleAssignment

GitHub Integration
["github",          "deliveries",     {deliveryId}          ]  → GitHubDelivery
["github",          "repos",          {repoId}              ]  → RepoConfig
["github",          "installations",  {installationId}      ]  → InstallationConfig

Telegram Groups & Channels
["telegram",        "groups",         {chatId}              ]  → GroupConfig
["telegram",        "groups",         {chatId}, "features"  ]  → FeatureFlags
["telegram",        "groups",         {chatId}, "settings"  ]  → GroupSettings

Broadcasts
["broadcasts",      {broadcastId}                           ]  → Broadcast
["broadcasts",      {broadcastId},    "recipients"          ]  → RecipientList
["broadcasts",      {broadcastId},    "deliveries",{chatId}]  → DeliveryStatus

Support System
["support",         "tickets",        {ticketId}            ]  → SupportTicket
["support",         "tickets",        {ticketId}, "messages", {seq}] → TicketMessage
["support",         "queue",          "open"                ]  → OpenTicketsQueue

Community
["community",       "members",        {userId}              ]  → MemberRecord
["community",       "roles",          {roleId}              ]  → RoleDefinition
["community",       "announcements",  {announcementId}      ]  → Announcement

Transient State
["outbox",          {outboxId}                              ]  → OutboxEntry
["routing",         "rules",          {ruleId}              ]  → RoutingRule
["routing",         "broadcast_groups"                      ]  → BroadcastGroupConfig

Audit & Analytics
["audit",           {isoTimestamp},   {eventId}             ]  → AuditEvent
["analytics",       "counters",       {metricKey}           ]  → AtomicCounter (bigint)
["analytics",       "snapshots",      {timestamp}           ]  → AnalyticsSnapshot

Secondary Indexes
["idx",             "tickets_open_by_user",     {userId}, {ticketId}]  → ""
["idx",             "tickets_by_status",        {status}, {ticketId}]  → ""
["idx",             "broadcasts_by_time",       {isoTime}, {broadcastId}] → ""
["idx",             "broadcasts_by_status",     {status}, {broadcastId}] → ""
["idx",             "broadcasts_by_author",     {authorId}, {broadcastId}] → ""
["idx",             "groups_by_feature",        {feature}, {chatId}] → ""
["idx",             "deliveries_by_status",     {status}, {deliveryId}] → ""
["idx",             "deliveries_by_installation", {installationId}, {deliveryId}] → ""
```

### 1.2 Core Type Definitions

```typescript
// ── Users ────────────────────────────────────────────────────────────────
interface UserProfile {
  userId: string;
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  role: "admin" | "moderator" | "member" | "guest";
  joinedAt: string;          // ISO-8601
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

interface OnboardingState {
  userId: string;
  step: "start" | "language" | "terms" | "profile" | "complete";
  language?: "en" | "es" | "fr" | "de";
  termsAccepted?: boolean;
  profileComplete?: boolean;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string;          // TTL: 7 days
}

// ── GitHub Delivery ──────────────────────────────────────────────────────
type GitHubDeliveryStatus = "pending" | "processing" | "delivered" | "failed" | "dead";

interface GitHubDelivery {
  deliveryId: string;
  installationId: string;
  repoId: string;
  eventType: string;           // e.g. "push", "pull_request"
  payload: Record<string, unknown>;
  status: GitHubDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Broadcasts ───────────────────────────────────────────────────────────
type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "sending"
  | "published"
  | "failed"
  | "archived";

type BroadcastTarget = "all" | "groups" | "members" | "custom";

interface Broadcast {
  broadcastId: string;
  authorId: string;
  title: string;
  content: string;
  mediaUrl?: string;
  targetType: BroadcastTarget;
  targetGroups?: string[];     // chatIds
  targetMembers?: string[];    // userIds
  status: BroadcastStatus;
  priority: "low" | "normal" | "high";
  
  scheduledAt?: string;
  queuedAt?: string;
  sentAt?: string;
  publishedAt?: string;
  failedAt?: string;
  failureReason?: string;
  
  requiresConfirmation?: boolean;
  confirmationCount?: number;
  
  createdAt: string;
  updatedAt: string;
}

interface DeliveryStatus {
  chatId: string;
  broadcastId: string;
  messageId?: number;
  status: "pending" | "sent" | "failed";
  failureReason?: string;
  deliveredAt?: string;
}

// ── Support Tickets ──────────────────────────────────────────────────────
type TicketStatus = "open" | "pending_reply" | "in_progress" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

interface SupportTicket {
  ticketId: string;
  userId: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  
  assigneeId?: string;
  categoryId?: string;
  
  openedAt: string;
  lastReplyAt: string;
  resolvedAt?: string;
  closedAt?: string;
  updatedAt: string;
  
  messageCount: number;
  attachmentUrls?: string[];
}

interface TicketMessage {
  ticketId: string;
  sequence: number;            // Order within ticket
  senderId: string;
  senderRole: "user" | "agent" | "admin";
  content: string;
  attachmentUrls?: string[];
  createdAt: string;
}

// ── Community ────────────────────────────────────────────────────────────
interface MemberRecord {
  userId: string;
  role: "admin" | "moderator" | "member";
  status: "active" | "suspended" | "banned";
  joinedAt: string;
  suspendedAt?: string;
  suspensionReason?: string;
  updatedAt: string;
}

interface RoleDefinition {
  roleId: string;
  name: string;
  permissions: string[];       // e.g. ["create_broadcast", "manage_tickets"]
  createdAt: string;
}

// ── Outbox ───────────────────────────────────────────────────────────────
type OutboxStatus = "pending" | "processing" | "done" | "failed";
type OutboxCorrelationType = "broadcast" | "ticket" | "github" | "notification" | "announcement";

interface OutboxEntry {
  outboxId: string;
  correlationId: string;       // References originating entity
  correlationType: OutboxCorrelationType;
  payload: TelegramMessage;    // See adapters
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  
  createdAt: string;
  processedAt?: string;
  failureReason?: string;
}

// ── Audit ────────────────────────────────────────────────────────────────
type AuditEventType =
  | "ticket.created" | "ticket.reopened" | "ticket.resolved" | "ticket.closed" | "ticket.assigned"
  | "broadcast.scheduled" | "broadcast.queued" | "broadcast.published" | "broadcast.failed" | "broadcast.archived"
  | "group.configured" | "group.feature_enabled" | "group.feature_disabled"
  | "user.role_changed" | "user.created" | "user.suspended"
  | "member.joined" | "member.left"
  | "admin.action";

interface AuditEvent {
  eventId: string;
  type: AuditEventType;
  actorId: string;             // User who initiated the action
  entityId: string;            // Primary entity affected
  entityType: string;          // "ticket", "broadcast", "user", etc.
  
  before?: unknown;            // State before action
  after?: unknown;             // State after action
  metadata?: Record<string, unknown>;
  
  timestamp: string;           // ISO-8601, immutable
}
```

---

## 2. Single Execution Model

Every workflow — regardless of domain — follows one canonical async flow:

```
User Intent
    │
    ▼
┌─────────────────────────────────────┐
│  Validate & Enforce FSM             │
│                                     │
│  - Check current state              │
│  - Verify transition is allowed     │
│  - Validate inputs                  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Atomic Transaction                 │
│                                     │
│  kv.atomic()                        │
│    .check(currentVersionstamp)      │  ← Optimistic concurrency
│    .set(entityKey, newEntity)       │
│    .set(indexKeys...)               │
│    .set(outboxKey, outboxEntry)     │
│    .enqueue(queueMessage)           │
│  .commit()                          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Audit Event Append                 │
│                                     │
│  kv.set(auditKey, auditEvent)       │  ← Always succeeds
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Queue Worker (Async)               │
│                                     │
│  kv.listenQueue(handler)            │
│    - Load entity & outbox           │
│    - Call adapter (Telegram)        │
│    - Finalize state                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  External Delivery                  │
│  (Telegram Bot API)                 │
└─────────────────────────────────────┘
```

### 2.1 Transaction Helper (Canonical Implementation)

```typescript
/**
 * Performs the canonical atomic write across all domains.
 *
 * Returns: true if committed, false if conflict.
 * Caller must handle conflicts via retry (backoff + jitter).
 */
async function commitWorkflow(opts: {
  kv: Deno.Kv;
  entityKey: Deno.KvKey;
  entity: unknown;
  versionstamp: string | null;
  indexUpdates?: Array<{ key: Deno.KvKey; action: "set" | "delete" }>;
  outboxEntry: OutboxEntry;
  queueMessage: unknown;
  auditEvent: Omit<AuditEvent, "eventId" | "timestamp">;
}): Promise<boolean> {
  const { kv, entityKey, entity, versionstamp, indexUpdates = [], outboxEntry, queueMessage, auditEvent } = opts;

  const outboxKey: Deno.KvKey = ["outbox", outboxEntry.outboxId];

  let atomic = kv
    .atomic()
    .check({ key: entityKey, versionstamp })
    .set(entityKey, entity)
    .set(outboxKey, outboxEntry)
    .enqueue(queueMessage, { backoffSchedule: [1000, 2000, 4000, 8000, 16000] });

  // Apply index updates
  for (const update of indexUpdates) {
    if (update.action === "set") {
      atomic = atomic.set(update.key, "");
    } else {
      atomic = atomic.delete(update.key);
    }
  }

  const result = await atomic.commit();

  if (!result.ok) {
    return false; // Caller retries
  }

  // Audit is a fire-and-forget append after the main transaction succeeds
  const auditKey: Deno.KvKey = [
    "audit",
    new Date().toISOString(),
    crypto.randomUUID(),
  ];

  const auditWithMeta: AuditEvent = {
    ...auditEvent,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  await kv.set(auditKey, auditWithMeta).catch((err) => {
    console.error("[audit] failed to append audit event:", err);
    // Audit failures do not block the main transaction
  });

  return true;
}
```

### 2.2 Retry Helper with Exponential Backoff

```typescript
/**
 * Wraps commitWorkflow with automatic retry logic.
 * Throws only if all retries exhausted.
 */
async function commitWithRetry(
  opts: Parameters<typeof commitWorkflow>[0],
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const success = await commitWorkflow(opts);
    if (success) return;

    const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
    const jitter = Math.random() * backoffMs * 0.1;
    await new Promise((resolve) => setTimeout(resolve, backoffMs + jitter));
  }

  throw new Error(
    `Failed to commit workflow after ${maxRetries} attempts: ${JSON.stringify(opts.entityKey)}`
  );
}
```

---

## 3. Immutable Audit Log

All significant state transitions are recorded append-only. Keys include the timestamp as the first segment,
ensuring natural chronological ordering.

### 3.1 Audit Service

```typescript
class AuditService {
  constructor(private readonly kv: Deno.Kv) {}

  /**
   * Appends an audit event. Unconditional write — no versionstamp required.
   */
  async record(event: Omit<AuditEvent, "eventId" | "timestamp">): Promise<void> {
    const auditEvent: AuditEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const key: Deno.KvKey = ["audit", auditEvent.timestamp, auditEvent.eventId];
    await this.kv.set(key, auditEvent);
  }

  /**
   * Query audit events by range and optional filters.
   */
  async query(opts: {
    since?: string;              // ISO-8601
    until?: string;              // ISO-8601
    type?: AuditEventType;
    entityId?: string;
    actorId?: string;
    limit?: number;
  }): Promise<AuditEvent[]> {
    const start: Deno.KvKey = ["audit", opts.since ?? ""];
    const end: Deno.KvKey = ["audit", opts.until ?? "\uffff"];

    const iter = this.kv.list<AuditEvent>({ start, end }, {
      limit: opts.limit ?? 100,
      reverse: true,
    });

    const results: AuditEvent[] = [];
    for await (const entry of iter) {
      const event = entry.value;
      if (opts.type && event.type !== opts.type) continue;
      if (opts.entityId && event.entityId !== opts.entityId) continue;
      if (opts.actorId && event.actorId !== opts.actorId) continue;
      results.push(event);
    }
    return results;
  }

  /**
   * Export audit trail for a specific entity (e.g., ticket lifecycle).
   */
  async getEntityHistory(entityId: string): Promise<AuditEvent[]> {
    return this.query({ entityId, limit: 1000 });
  }
}
```

### 3.2 Mandatory Audit Points

| Domain       | Events                                                 | User?  |
|--------------|--------------------------------------------------------|--------|
| Support      | ticket.created, ticket.assigned, ticket.resolved       | User/Admin |
| Broadcasts   | broadcast.scheduled, broadcast.published, broadcast.failed | Admin |
| Groups       | group.configured, group.feature_enabled                | Admin  |
| Users        | user.role_changed, user.created, user.suspended        | Admin  |
| Community    | member.joined, member.left                            | System |

---

## 4. Broadcast Pipeline

### 4.1 Status Lifecycle

```
        ┌─────────────────────────────────┐
        │            BROADCAST             │
        │            LIFECYCLE             │
        │                                 │
        ▼                                 │
    ┌─────────┐                          │
    │  draft  │◄──────────────────────────┼─────────────────┐
    └────┬────┘                          │                 │
         │ schedule()                    │ (admin unschedules)
         ▼                               │
    ┌──────────────┐                    │
    │  scheduled   │                    │ (reschedule)
    └────┬─────────┘                    │
         │ scheduler picks up at time   │
         ▼                              │
    ┌──────────────┐                   │
    │   queued     │                   │
    └────┬─────────┘                   │
         │ worker dequeues             │
         ▼                             │
    ┌──────────────┐                  │
    │   sending    │                  │
    └────┬─────────┘                  │
         │                            │
    ┌────┴─────┐                     │
    │           │                    │
    ▼           ▼                    │
┌────────────────────┐              │
│  published    failed│◄─────────────┘
├────────────────────┤ (retry as draft)
│   (terminal)       │
└────────────────────┘
    │       │
    │       └─► admin archives
    │
    ▼
┌──────────────┐
│  archived    │
└──────────────┘
```

### 4.2 Broadcast FSM

```typescript
const BROADCAST_TRANSITIONS: Record<BroadcastStatus, BroadcastStatus[]> = {
  draft:     ["scheduled", "archived"],
  scheduled: ["queued", "draft", "archived"],
  queued:    ["sending"],                        // worker-only
  sending:   ["published", "failed"],            // worker-only
  published: ["archived"],
  failed:    ["draft", "scheduled", "archived"],
  archived:  [],                                 // terminal
};

function assertBroadcastTransition(from: BroadcastStatus, to: BroadcastStatus): void {
  if (!BROADCAST_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(
      `Broadcast: cannot transition ${from} → ${to}`
    );
  }
}
```

### 4.3 Broadcast Scheduler

```typescript
class BroadcastScheduler {
  constructor(
    private readonly kv: Deno.Kv,
    private readonly audit: AuditService,
  ) {}

  /**
   * Runs periodically (e.g., every 30 seconds) to pick up due broadcasts.
   */
  async tick(): Promise<number> {
    const now = new Date().toISOString();

    // Secondary index: scheduled broadcasts ordered by scheduledAt
    const iter = this.kv.list<string>({
      start: ["idx", "broadcasts_by_time", ""],
      end: ["idx", "broadcasts_by_time", now],
    });

    let enqueued = 0;
    for await (const entry of iter) {
      const broadcastId = entry.value as unknown as string;
      const success = await this.enqueue(broadcastId);
      if (success) enqueued++;
    }

    return enqueued;
  }

  private async enqueue(broadcastId: string): Promise<boolean> {
    const key: Deno.KvKey = ["broadcasts", broadcastId];
    const result = await this.kv.get<Broadcast>(key);
    if (!result.value || result.value.status !== "scheduled") return false;

    const broadcast = result.value;
    const updated: Broadcast = {
      ...broadcast,
      status: "queued",
      queuedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const outboxEntry: OutboxEntry = {
      outboxId: crypto.randomUUID(),
      correlationId: broadcastId,
      correlationType: "broadcast",
      payload: formatBroadcastForTelegram(broadcast),
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      createdAt: new Date().toISOString(),
    };

    const success = await commitWorkflow({
      kv: this.kv,
      entityKey: key,
      entity: updated,
      versionstamp: result.versionstamp,
      indexUpdates: [
        { key: ["idx", "broadcasts_by_status", "scheduled", broadcastId], action: "delete" },
        { key: ["idx", "broadcasts_by_status", "queued", broadcastId], action: "set" },
      ],
      outboxEntry,
      queueMessage: { type: "broadcast", broadcastId },
      auditEvent: {
        type: "broadcast.queued",
        actorId: "scheduler",
        entityId: broadcastId,
        entityType: "broadcast",
        after: { status: "queued" },
      },
    });

    return success;
  }
}
```

### 4.4 Broadcast Worker

```typescript
async function handleBroadcastMessage(
  kv: Deno.Kv,
  msg: { broadcastId: string },
  telegram: TelegramAdapter,
  audit: AuditService,
): Promise<void> {
  const key: Deno.KvKey = ["broadcasts", msg.broadcastId];
  const result = await kv.get<Broadcast>(key);
  if (!result.value) return;

  const broadcast = result.value;

  // Idempotency: already finalized
  if (broadcast.status === "published" || broadcast.status === "failed") return;

  // Mark as sending
  const sending: Broadcast = {
    ...broadcast,
    status: "sending",
    updatedAt: new Date().toISOString(),
  };
  await kv.set(key, sending);

  try {
    // Send to all target groups
    const targetChats = broadcast.targetGroups || [];
    const results: DeliveryStatus[] = [];

    for (const chatId of targetChats) {
      try {
        const messageId = await telegram.sendMessage(chatId, broadcast.content, broadcast.mediaUrl);
        results.push({
          chatId,
          broadcastId: msg.broadcastId,
          messageId,
          status: "sent",
          deliveredAt: new Date().toISOString(),
        });
      } catch (err) {
        results.push({
          chatId,
          broadcastId: msg.broadcastId,
          status: "failed",
          failureReason: String(err),
        });
        // Continue to next group; log partial failure but don't re-throw yet
      }
    }

    // Check if all deliveries succeeded
    const allSucceeded = results.every((r) => r.status === "sent");

    if (allSucceeded) {
      const published: Broadcast = {
        ...sending,
        status: "published",
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const indexUpdates = [
        { key: ["idx", "broadcasts_by_status", "sending", msg.broadcastId], action: "delete" },
        { key: ["idx", "broadcasts_by_status", "published", msg.broadcastId], action: "set" },
      ];

      await commitWithRetry({
        kv,
        entityKey: key,
        entity: published,
        versionstamp: result.versionstamp,
        indexUpdates,
        outboxEntry: { status: "done" } as unknown as OutboxEntry,
        queueMessage: {},
        auditEvent: {
          type: "broadcast.published",
          actorId: "system",
          entityId: msg.broadcastId,
          entityType: "broadcast",
          metadata: { deliveredTo: results.length },
        },
      });

      await kv.sum(["analytics", "counters", "broadcasts_published"], 1n);
    } else {
      // Partial or complete failure
      const failed: Broadcast = {
        ...sending,
        status: "failed",
        failedAt: new Date().toISOString(),
        failureReason: `Partial send: ${results.filter((r) => r.status === "failed").length}/${results.length} failed`,
        updatedAt: new Date().toISOString(),
      };

      await kv.set(key, failed);
      await kv.sum(["analytics", "counters", "broadcasts_failed"], 1n);
      await audit.record({
        type: "broadcast.failed",
        actorId: "system",
        entityId: msg.broadcastId,
        entityType: "broadcast",
        metadata: { deliveryResults: results },
      });

      throw new Error("Broadcast delivery partially failed; re-queue for retry");
    }
  } catch (err) {
    // On error, the queue will retry; mark as processing
    const processing: Broadcast = {
      ...broadcast,
      status: "sending",
      updatedAt: new Date().toISOString(),
    };
    await kv.set(key, processing);
    throw err;
  }
}
```

---

## 5. Support Ticket Lifecycle

### 5.1 Ticket FSM

```
         ┌─────────────────────────────────────┐
         │        TICKET LIFECYCLE             │
         │                                     │
         ▼                                     │
    ┌──────────┐                              │
    │   open   │◄─────────────────────────────┼─────────┐
    └────┬─────┘                              │         │
         │ → pending_reply (agent replies)   │ (reopen)│
         ▼                                   │         │
  ┌──────────────┐                          │         │
  │pending_reply │────► open (user replies) │         │
  └──────┬───────┘                          │         │
         │ → resolved (agent marks done)    │         │
         ▼                                  │         │
    ┌──────────┐                           │         │
    │resolved  │─────────► open (reopen) ──┘         │
    └────┬─────┘                                     │
         │ → closed (admin closes)                   │
         │                                          │
    ┌────▼──────┐◄──────────────────────────────────┘
    │   closed  │
    │ (terminal)│
    └───────────┘
```

### 5.2 Support Ticket Commands

```typescript
class SupportService {
  constructor(
    private readonly kv: Deno.Kv,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a new support ticket.
   */
  async createTicket(input: {
    userId: string;
    subject: string;
    description: string;
    priority?: TicketPriority;
  }): Promise<string> {
    const ticketId = crypto.randomUUID();
    const now = new Date().toISOString();

    const ticket: SupportTicket = {
      ticketId,
      userId: input.userId,
      subject: input.subject,
      description: input.description,
      status: "open",
      priority: input.priority || "normal",
      openedAt: now,
      lastReplyAt: now,
      updatedAt: now,
      messageCount: 1,
    };

    const key: Deno.KvKey = ["support", "tickets", ticketId];
    const message: TicketMessage = {
      ticketId,
      sequence: 0,
      senderId: input.userId,
      senderRole: "user",
      content: input.description,
      createdAt: now,
    };

    await commitWithRetry({
      kv: this.kv,
      entityKey: key,
      entity: ticket,
      versionstamp: null,
      indexUpdates: [
        { key: ["idx", "tickets_open_by_user", input.userId, ticketId], action: "set" },
        { key: ["idx", "tickets_by_status", "open", ticketId], action: "set" },
      ],
      outboxEntry: {
        outboxId: crypto.randomUUID(),
        correlationId: ticketId,
        correlationType: "ticket",
        payload: formatTicketNotification(ticket, "created"),
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        createdAt: now,
      },
      queueMessage: { type: "ticket_notification", ticketId, event: "created" },
      auditEvent: {
        type: "ticket.created",
        actorId: input.userId,
        entityId: ticketId,
        entityType: "ticket",
        after: { status: "open" },
      },
    });

    await this.kv.set(["support", "tickets", ticketId, "messages", "0"], message);

    return ticketId;
  }

  /**
   * Add a reply to a ticket.
   */
  async replyToTicket(input: {
    ticketId: string;
    userId: string;
    content: string;
    role: "user" | "agent" | "admin";
  }): Promise<void> {
    const key: Deno.KvKey = ["support", "tickets", input.ticketId];
    const result = await this.kv.get<SupportTicket>(key);

    if (!result.value) throw new Error("Ticket not found");

    const ticket = result.value;
    const now = new Date().toISOString();

    // Determine new status
    let newStatus = ticket.status;
    if (input.role !== "user" && ticket.status === "pending_reply") {
      newStatus = "in_progress";
    } else if (input.role === "user" && ticket.status === "pending_reply") {
      newStatus = "open";
    }

    const updated: SupportTicket = {
      ...ticket,
      status: newStatus,
      lastReplyAt: now,
      messageCount: ticket.messageCount + 1,
      updatedAt: now,
    };

    const message: TicketMessage = {
      ticketId: input.ticketId,
      sequence: ticket.messageCount,
      senderId: input.userId,
      senderRole: input.role,
      content: input.content,
      createdAt: now,
    };

    const indexUpdates = [];
    if (ticket.status !== newStatus) {
      indexUpdates.push(
        { key: ["idx", "tickets_by_status", ticket.status, input.ticketId], action: "delete" },
        { key: ["idx", "tickets_by_status", newStatus, input.ticketId], action: "set" },
      );
    }

    await commitWithRetry({
      kv: this.kv,
      entityKey: key,
      entity: updated,
      versionstamp: result.versionstamp,
      indexUpdates,
      outboxEntry: {
        outboxId: crypto.randomUUID(),
        correlationId: input.ticketId,
        correlationType: "ticket",
        payload: formatTicketNotification(updated, "reply", input.content),
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        createdAt: now,
      },
      queueMessage: { type: "ticket_notification", ticketId: input.ticketId, event: "reply" },
      auditEvent: {
        type: "ticket.updated",
        actorId: input.userId,
        entityId: input.ticketId,
        entityType: "ticket",
        before: { status: ticket.status },
        after: { status: newStatus },
      },
    });

    const messageKey: Deno.KvKey = [
      "support",
      "tickets",
      input.ticketId,
      "messages",
      String(message.sequence),
    ];
    await this.kv.set(messageKey, message);
  }

  /**
   * Resolve a ticket (mark as resolved by agent).
   */
  async resolveTicket(input: {
    ticketId: string;
    agentId: string;
    summary: string;
  }): Promise<void> {
    const key: Deno.KvKey = ["support", "tickets", input.ticketId];
    const result = await this.kv.get<SupportTicket>(key);

    if (!result.value) throw new Error("Ticket not found");

    const ticket = result.value;
    const now = new Date().toISOString();

    if (!["open", "pending_reply", "in_progress"].includes(ticket.status)) {
      throw new InvalidStateTransitionError(
        `Cannot resolve ticket in status ${ticket.status}`
      );
    }

    const updated: SupportTicket = {
      ...ticket,
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    };

    await commitWithRetry({
      kv: this.kv,
      entityKey: key,
      entity: updated,
      versionstamp: result.versionstamp,
      indexUpdates: [
        { key: ["idx", "tickets_by_status", ticket.status, input.ticketId], action: "delete" },
        { key: ["idx", "tickets_by_status", "resolved", input.ticketId], action: "set" },
        { key: ["idx", "tickets_open_by_user", ticket.userId, input.ticketId], action: "delete" },
      ],
      outboxEntry: {
        outboxId: crypto.randomUUID(),
        correlationId: input.ticketId,
        correlationType: "ticket",
        payload: formatTicketNotification(updated, "resolved", input.summary),
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        createdAt: now,
      },
      queueMessage: { type: "ticket_notification", ticketId: input.ticketId, event: "resolved" },
      auditEvent: {
        type: "ticket.resolved",
        actorId: input.agentId,
        entityId: input.ticketId,
        entityType: "ticket",
        before: { status: ticket.status },
        after: { status: "resolved" },
        metadata: { summary: input.summary },
      },
    });

    await kv.sum(["analytics", "counters", "tickets_closed"], 1n);
  }
}
```

---

## 6. Community Management

### 6.1 Member Roles & Permissions

```typescript
type Permission =
  | "create_broadcast"
  | "manage_broadcasts"
  | "view_analytics"
  | "manage_groups"
  | "manage_support"
  | "manage_users"
  | "view_audit"
  | "respond_support";

const ROLE_PERMISSIONS: Record<UserProfile["role"], Permission[]> = {
  admin: [
    "create_broadcast",
    "manage_broadcasts",
    "view_analytics",
    "manage_groups",
    "manage_support",
    "manage_users",
    "view_audit",
  ],
  moderator: [
    "create_broadcast",
    "view_analytics",
    "manage_support",
    "respond_support",
  ],
  member: ["create_broadcast"],
  guest: [],
};

function hasPermission(role: UserProfile["role"], permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
```

### 6.2 User Onboarding

```typescript
class OnboardingService {
  async startOnboarding(userId: string, telegramId: number): Promise<void> {
    const onboarding: OnboardingState = {
      userId,
      step: "language",
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const key: Deno.KvKey = ["users", userId, "onboarding"];
    await this.kv.set(key, onboarding, { expireIn: 7 * 24 * 60 * 60 * 1000 });

    // Send first onboarding message (language selection)
    await this.telegram.showLanguageSelection(telegramId);
  }

  async completeOnboarding(userId: string): Promise<void> {
    const key: Deno.KvKey = ["users", userId, "onboarding"];
    const result = await this.kv.get<OnboardingState>(key);
    if (!result.value) return;

    const onboarding = result.value;
    onboarding.step = "complete";
    onboarding.lastActivityAt = new Date().toISOString();

    await this.kv.set(key, onboarding, { expireIn: 7 * 24 * 60 * 60 * 1000 });

    // Create user profile
    const profile: UserProfile = {
      userId,
      telegramId: 0, // Set from context
      role: "member",
      joinedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.kv.set(["users", userId], profile);
  }
}
```

---

## 7. Finite State Machines

### 7.1 FSM Transition Validation

```typescript
type FSMState = BroadcastStatus | TicketStatus | GitHubDeliveryStatus;

const FSM_RULES: Record<string, Record<FSMState, FSMState[]>> = {
  broadcast: {
    draft: ["scheduled", "archived"],
    scheduled: ["queued", "draft", "archived"],
    queued: ["sending"],
    sending: ["published", "failed"],
    published: ["archived"],
    failed: ["draft", "scheduled", "archived"],
    archived: [],
  },
  ticket: {
    open: ["pending_reply", "resolved", "closed"],
    pending_reply: ["open", "resolved", "closed"],
    in_progress: ["resolved", "open", "closed"],
    resolved: ["open", "closed"],
    closed: [],
  },
  github_delivery: {
    pending: ["processing"],
    processing: ["delivered", "failed"],
    delivered: [],
    failed: ["pending"],
    dead: [],
  },
};

function validateTransition(domain: string, from: FSMState, to: FSMState): void {
  const rules = FSM_RULES[domain];
  if (!rules) throw new Error(`Unknown domain: ${domain}`);

  const allowed = rules[from] as FSMState[] | undefined;
  if (!allowed) throw new Error(`Unknown state: ${from}`);
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(
      `${domain}: ${from} → ${to} not allowed`
    );
  }
}
```

---

## 8. Secondary Indexes

Indexes are presence maps written atomically with their entities. They enable
efficient range queries without full table scans.

### 8.1 Index Patterns

```typescript
// When writing a broadcast
const indexUpdates = [
  {
    key: ["idx", "broadcasts_by_time", broadcast.scheduledAt || "", broadcast.broadcastId],
    action: "set" as const,
  },
  {
    key: ["idx", "broadcasts_by_author", broadcast.authorId, broadcast.broadcastId],
    action: "set" as const,
  },
  {
    key: ["idx", "broadcasts_by_status", broadcast.status, broadcast.broadcastId],
    action: "set" as const,
  },
];

// On status change: remove old index, add new
const indexUpdates = [
  { key: ["idx", "broadcasts_by_status", oldStatus, broadcastId], action: "delete" },
  { key: ["idx", "broadcasts_by_status", newStatus, broadcastId], action: "set" },
];

// Query: broadcasts due before time T
async function queryBroadcastsDueBefore(kv: Deno.Kv, beforeTime: string): Promise<string[]> {
  const iter = kv.list<string>({
    start: ["idx", "broadcasts_by_time", ""],
    end: ["idx", "broadcasts_by_time", beforeTime],
  });

  const ids: string[] = [];
  for await (const entry of iter) {
    ids.push(entry.value);
  }
  return ids;
}
```

---

## 9. Runtime Architecture

### 9.1 Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT LAYER                             │
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ HTTP Webhook │     │ Telegram Bot │     │  Admin API   │   │
│  │   Handler    │     │   Handler    │     │   Handler    │   │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘   │
└─────────┼─────────────────────┼─────────────────────┼───────────┘
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WORKFLOW LAYER                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Workflow Engine                               │  │
│  │  - Route to domain handler (broadcast, ticket, github)   │  │
│  │  - Enforce FSM transitions                              │  │
│  │  - Delegate to TransactionService                       │  │
│  └────────────────────┬─────────────────────────────────────┘  │
└───────────────────────┼────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              TRANSACTION SERVICE                                │
│                                                                 │
│  - Atomic KV writes (entity + outbox + indexes)                 │
│  - Optimistic concurrency (versionstamp check)                  │
│  - Automatic retry (exponential backoff)                        │
│  - Audit event append (fire-and-forget)                         │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ASYNC LAYER                                    │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Scheduler   │  │ Queue Worker │  │  Outbox      │         │
│  │              │  │              │  │  Sweeper     │         │
│  │ - Poll       │  │ - Dequeue    │  │  (startup)   │         │
│  │   indexes    │  │ - Call       │  │              │         │
│  │ - Enqueue    │  │   adapters   │  │ - Re-enqueue │         │
│  └──────────────┘  │ - Finalize   │  └──────────────┘         │
│                    └──────────────┘                             │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ADAPTER LAYER                                │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐           │
│  │  Telegram Adapter    │  │  GitHub Adapter      │           │
│  │                      │  │                      │           │
│  │ - sendMessage()      │  │ - parseWebhook()     │           │
│  │ - editMessage()      │  │ - verifySignature()  │           │
│  │ - Rate limiting      │  │                      │           │
│  │ - Retry w/ backoff   │  │                      │           │
│  └──────────────────────┘  └──────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Responsibility Matrix

| Component | Role | Telegram API? | KV Access |
|-----------|------|---------------|-----------|
| HTTP Handlers | Parse & route requests | No | Read |
| Workflow Engine | FSM enforcement, delegation | No | Read |
| TransactionService | Atomic commits | No | Write |
| Scheduler | Poll & enqueue due work | No | Read/Write |
| Queue Workers | Execute async tasks | **Yes** | Read/Write |
| Telegram Adapter | All Telegram calls | **Yes** | None |
| GitHub Adapter | Webhook parsing | No | None |
| Audit Service | Append-only logging | No | Write |
| Analytics Service | Counter reads | No | Read |

---

## 10. Operational Readiness

### 10.1 Startup Recovery

```typescript
/**
 * On every cold start, scan the outbox for orphaned entries
 * (e.g., after a crash mid-flight) and re-enqueue them.
 */
async function recoverPendingOutbox(kv: Deno.Kv): Promise<number> {
  console.log("[startup] scanning for orphaned outbox entries...");

  const iter = kv.list<OutboxEntry>({ prefix: ["outbox"] });
  let recovered = 0;

  for await (const entry of iter) {
    const outbox = entry.value;

    // Skip already-finalized entries
    if (outbox.status === "done" || outbox.status === "failed") continue;

    // Reset processing → pending (crashed mid-flight)
    if (outbox.status === "processing") {
      outbox.status = "pending";
      await kv.set(entry.key, outbox);
    }

    // Re-enqueue
    await kv.enqueue(
      { outboxId: outbox.outboxId, type: outbox.correlationType },
      { backoffSchedule: [1000, 2000, 4000, 8000, 16000] }
    );

    recovered++;
  }

  console.log(`[startup] recovered ${recovered} outbox entries`);
  return recovered;
}
```

### 10.2 Dead-Letter Queue Management

```typescript
async function handleWithRetry(
  kv: Deno.Kv,
  outboxId: string,
  handler: () => Promise<void>,
  maxAttempts = 5,
): Promise<void> {
  const key: Deno.KvKey = ["outbox", outboxId];
  const result = await kv.get<OutboxEntry>(key);
  if (!result.value) return;

  const outbox = result.value;

  if (outbox.attempts >= maxAttempts) {
    // Move to DLQ
    await kv.atomic()
      .set(key, { ...outbox, status: "failed" })
      .set(["dlq", outboxId], outbox)
      .commit();

    console.error(`[dlq] ${outboxId} moved to dead-letter after ${outbox.attempts} attempts`);
    return;
  }

  // Attempt delivery
  outbox.status = "processing";
  outbox.attempts += 1;
  await kv.set(key, outbox);

  try {
    await handler();
    await kv.set(key, { ...outbox, status: "done", processedAt: new Date().toISOString() });
  } catch (err) {
    // Reset to pending; queue will retry
    outbox.status = "pending";
    await kv.set(key, outbox);
    throw err;
  }
}

// Manual replay
async function replayFromDeadLetter(kv: Deno.Kv, outboxId: string): Promise<void> {
  const dlqEntry = await kv.get<OutboxEntry>(["dlq", outboxId]);
  if (!dlqEntry.value) throw new Error(`DLQ entry not found: ${outboxId}`);

  const reset: OutboxEntry = {
    ...dlqEntry.value,
    status: "pending",
    attempts: 0,
  };

  await kv.atomic()
    .set(["outbox", outboxId], reset)
    .delete(["dlq", outboxId])
    .enqueue({ outboxId, type: reset.correlationType })
    .commit();

  console.log(`[dlq] replayed ${outboxId}`);
}
```

### 10.3 Health & Metrics Endpoints

```typescript
async function handleHealth(kv: Deno.Kv): Promise<Response> {
  const checks: Record<string, "ok" | "error"> = {};

  // KV liveness
  try {
    await kv.get(["health"]);
    checks.kv = "ok";
  } catch {
    checks.kv = "error";
  }

  // Pending outbox
  let pendingCount = 0;
  const iter = kv.list<OutboxEntry>({ prefix: ["outbox"] });
  for await (const entry of iter) {
    if (entry.value.status === "pending") pendingCount++;
  }

  // DLQ size
  let dlqCount = 0;
  const dlqIter = kv.list({ prefix: ["dlq"] });
  for await (const _ of dlqIter) dlqCount++;

  const counters = await readCounters(kv);
  const healthy = checks.kv === "ok" && dlqCount < 100;

  return Response.json({
    status: healthy ? "healthy" : "degraded",
    checks,
    metrics: { pendingOutbox: pendingCount, dlqSize: dlqCount, ...counters },
    timestamp: new Date().toISOString(),
  }, { status: healthy ? 200 : 503 });
}

async function handleMetrics(kv: Deno.Kv): Promise<Response> {
  const counters = await readCounters(kv);

  const lines = Object.entries(counters)
    .map(([key, value]) => `telegram_ops_platform_${key} ${value}`)
    .join("\n");

  return new Response(lines + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
}

async function readCounters(kv: Deno.Kv): Promise<Record<string, number>> {
  const keys = [
    ["analytics", "counters", "broadcasts_published"],
    ["analytics", "counters", "broadcasts_failed"],
    ["analytics", "counters", "tickets_open"],
    ["analytics", "counters", "tickets_closed"],
    ["analytics", "counters", "deliveries_success"],
    ["analytics", "counters", "deliveries_failed"],
  ] as const;

  const entries = await kv.getMany(keys);

  return {
    broadcasts_published: Number((entries[0].value as bigint) ?? 0n),
    broadcasts_failed: Number((entries[1].value as bigint) ?? 0n),
    tickets_open: Number((entries[2].value as bigint) ?? 0n),
    tickets_closed: Number((entries[3].value as bigint) ?? 0n),
    deliveries_success: Number((entries[4].value as bigint) ?? 0n),
    deliveries_failed: Number((entries[5].value as bigint) ?? 0n),
  };
}
```

### 10.4 Runbooks

#### **Broadcast Stuck in `sending`**

1. Identify: `kv.get(["broadcasts", broadcastId])`
2. Check outbox: `kv.get(["outbox", broadcastId])`
3. Inspect failure reason in outbox entry
4. If Telegram API recovers: reset to `failed`, then `scheduled`, re-enqueue
5. If partial send: verify Telegram history, decide safe to retry

#### **DLQ Growing**

1. Check size: `GET /health` → metrics.dlqSize
2. Inspect entries: `kv.list({ prefix: ["dlq"] })`
3. Identify root cause (network, API error, bad config)
4. Fix root cause
5. Replay: call `replayFromDeadLetter(kv, outboxId)` for each
6. Monitor until DLQ returns to zero

#### **Outbox Processing Stuck**

1. Check pending count: `GET /health` → metrics.pendingOutbox
2. If > 100 and not decreasing: queue worker may have crashed
3. Trigger manual recovery: restart process (calls `recoverPendingOutbox`)
4. Monitor `/health` until pending drains

#### **Versionstamp Conflicts (Transient)**

1. Normal under high concurrency
2. Caller should retry with exponential backoff (already built into `commitWithRetry`)
3. If persistent: check for competing writes to same entity
4. Workflow Engine should wrap all `commitWorkflow` calls in `commitWithRetry`

---

## Appendix: Implementation Checklist

### Phase 1: Core Platform (GitHub Relay + Audit)
- [x] Unified KV schema & type definitions
- [x] Transactional service (commitWorkflow helper)
- [x] GitHub webhook handler
- [x] Audit service (append-only log)
- [x] Queue worker & outbox recovery
- [x] Health & metrics endpoints

### Phase 2: Broadcasts
- [ ] Broadcast FSM & commands
- [ ] Broadcast scheduler
- [ ] Broadcast worker
- [ ] Secondary indexes (time, status, author)
- [ ] Broadcast API endpoints

### Phase 3: Support Tickets
- [ ] Ticket FSM & commands
- [ ] Support service (create, reply, resolve)
- [ ] Ticket notification worker
- [ ] Secondary indexes (open by user, by status)
- [ ] Support API endpoints & Telegram handlers

### Phase 4: Community Management
- [ ] User profile service
- [ ] Onboarding flow
- [ ] Role-based permissions
- [ ] Member lifecycle events
- [ ] Community announcements

### Phase 5: Admin & Analytics
- [ ] Audit query UI
- [ ] Analytics dashboard
- [ ] Admin command handlers
- [ ] Backup & restore

---

*Last updated: 2026-07-12*  
*Authority: Single source of truth for platform architecture, execution, and operations.*
