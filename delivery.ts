import type { DeliveryStatus } from "../storage/schemas.ts";

/**
 * Mutable operational record stored at delivery_record/{timestamp}_{uuid}.
 *
 * Fields are split conceptually into an immutable block (written once at
 * commit time) and a mutable block (updated by the worker via
 * read-modify-write). Both live in the same KV entry — see docs/KV.md.
 */
export interface DeliveryRecord {
  // ── Immutable, written at webhook commit ──────────────────────────────
  delivery_id: string;
  event_type: string;
  repository: string | null;
  installation_id: string;
  payload_hash: string; // SHA-256 of the original raw webhook body
  received_at: number;

  // ── Mutable, updated by the queue worker ──────────────────────────────
  processed_at: number | null;
  telegram_chat: string | null; // routing snapshot captured at commit time
  telegram_message_id: number | null;
  status: DeliveryStatus;
}

export function buildInitialDeliveryRecord(input: {
  delivery_id: string;
  event_type: string;
  repository: string | null;
  installation_id: string;
  payload_hash: string;
  telegram_chat: string | null;
}): DeliveryRecord {
  return {
    delivery_id: input.delivery_id,
    event_type: input.event_type,
    repository: input.repository,
    installation_id: input.installation_id,
    payload_hash: input.payload_hash,
    received_at: Date.now(),
    processed_at: null,
    telegram_chat: input.telegram_chat,
    telegram_message_id: null,
    status: "pending",
  };
}
