# Observability

## Structured logs
Every log line is a single JSON object via `src/utils/logger.ts`:
```json
{"ts":"2026-07-12T00:00:00.000Z","level":"info","scope":"webhook","message":"committed","deliveryId":"...","eventType":"push","taskId":"..."}
```
`scope` identifies the module (`webhook`, `pipeline`, `worker`,
`recovery`, `http`, `main`) so logs can be filtered without regex on the
message text. `LOG_LEVEL` controls the minimum level emitted
(`debug | info | warn | error`, default `info`).

No secret values are ever passed as log fields — see `docs/SECURITY.md`.

## Fields recorded per webhook (at commit)
| Field | Source |
| :--- | :--- |
| `delivery_id` | `X-GitHub-Delivery` header |
| `event_type` | `X-GitHub-Event` header |
| `repository` | `payload.repository.full_name` |
| `installation_id` | `payload.installation.id` |
| `payload_hash` | `sha256Hex(rawBody)` |
| `received_at` | Timestamp at handler entry |

## Fields recorded per delivery attempt (by the worker)
| Field | Source |
| :--- | :--- |
| `processed_at` | Timestamp at successful delivery |
| `telegram_chat` | Routing snapshot captured at webhook commit |
| `telegram_message_id` | Telegram Bot API response |
| `status` | `pending → delivered / failed` |
| `attempt_count` | Incremented in the outbox record on each failure |

## Fields recorded on dead-letter
| Field | Source |
| :--- | :--- |
| `failed_at` | Timestamp at exhaustion |
| `attempt_count` | Final attempt number |
| `last_error` | Stringified Telegram API error response |

## Aggregates
`aggregates/{installation_id}/total_delivered` and `total_failed` are
`Deno.KvU64` counters, incremented atomically alongside the same
transaction that marks a delivery as delivered or failed. They're cheap
to read (`kv.get`) for a per-installation dashboard without scanning
the full `delivery_record` history.

## What's intentionally out of scope
This repo does not ship a metrics exporter (Prometheus, OpenTelemetry,
etc.) or a log aggregation pipeline. `/metrics` gives a minimal sampled
snapshot (see `docs/OPERATIONS.md`); anything more should be layered on
top rather than baked in, since the right choice depends on where you're
already sending logs/metrics from other services.
