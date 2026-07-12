/** Outbox record stored at outbox/pending/{task_id} while awaiting delivery. */
export interface OutboxRecord {
  delivery_id: string;
  event_type: string;
  event_ref: readonly [string, string, string]; // ["github","events",delivery_id]
  record_key: string;
  target: "telegram";
  target_chat: string | null;
  created_at: number;
  attempt_count: number;
}

/** Terminal record stored at outbox/delivered/{task_id}. */
export interface DeliveredOutboxRecord {
  delivery_id: string;
  delivered_at: number;
  telegram_message_id: number | null;
}

/** Terminal record stored at outbox/failed/{task_id} — the dead letter. */
export interface FailedOutboxRecord {
  delivery_id: string;
  failed_at: number;
  attempt_count: number;
  last_error: string;
}

/** Payload passed through kv.enqueue() / kv.listenQueue(). */
export interface QueueMessage {
  task_id: string;
  delivery_id: string;
  event_type: string;
  record_key: string;
}

export function isQueueMessage(msg: unknown): msg is QueueMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.task_id === "string" &&
    typeof m.delivery_id === "string" &&
    typeof m.event_type === "string" &&
    typeof m.record_key === "string"
  );
}
