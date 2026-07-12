/**
 * Single source of truth for KV key shapes. Never build a KV key by hand
 * outside this file — it keeps the storage hierarchy documented in
 * docs/KV.md in sync with the actual code.
 */

export type DeliveryStatus = "pending" | "delivered" | "failed";

export const Keys = {
  githubEvent: (deliveryId: string) => ["github", "events", deliveryId] as const,
  githubInstallation: (installationId: string) =>
    ["github", "installations", installationId] as const,

  idempotency: (deliveryId: string) => ["idempotency", deliveryId] as const,

  deliveryRecord: (recordKey: string) => ["delivery_record", recordKey] as const,

  outboxPending: (taskId: string) => ["outbox", "pending", taskId] as const,
  outboxDelivered: (taskId: string) => ["outbox", "delivered", taskId] as const,
  outboxFailed: (taskId: string) => ["outbox", "failed", taskId] as const,
  outboxPendingPrefix: () => ["outbox", "pending"] as const,

  routingChannel: (installationId: string) => ["routing", "channels", installationId] as const,
  routingGroup: (installationId: string) => ["routing", "groups", installationId] as const,

  aggregateDelivered: (installationId: string) =>
    ["aggregates", installationId, "total_delivered"] as const,
  aggregateFailed: (installationId: string) =>
    ["aggregates", installationId, "total_failed"] as const,

  rateLimit: (installationId: string, windowStartMs: number) =>
    ["rate_limit", installationId, windowStartMs] as const,
} as const;

/** Builds a new delivery_record key. Format: `{timestamp}_{uuid}`. */
export function newRecordKey(): string {
  return `${Date.now()}_${crypto.randomUUID()}`;
}
