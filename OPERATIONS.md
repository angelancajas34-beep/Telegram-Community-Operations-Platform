# Operations

## Endpoints
| Path | Method | Purpose |
| :--- | :--- | :--- |
| `/health` | GET | Liveness check — returns `{status, version, time}` |
| `/metrics` | GET | Sampled outbox backlog size (up to 1000 entries) |
| `/github/webhook` | POST | GitHub App webhook receiver |

`/metrics` is intentionally lightweight — a sampled count, not a full
metrics pipeline. Wire it into an external uptime/monitoring tool that
polls on an interval, or replace it with a proper metrics exporter if
you need histograms, percentiles, or long-term retention.

## Day-to-day monitoring
Watch, in order of urgency:
1. **`outbox/failed` growth** — every dead-letter entry is a message a
   user never received. Check `docs/RUNBOOK.md` for replay steps.
2. **`aggregates/{installation_id}/total_failed` vs `total_delivered`
   ratio** — a rising failure rate across an installation usually means
   either a bad `chat_id` in `routing/channels/{installation_id}` or the
   bot losing admin rights in the target chat.
3. **Webhook `401` rate** — spikes usually mean a webhook secret
   mismatch after a rotation, not an attack (though it's worth checking
   both).

## Configuration changes that take effect without a redeploy
None — this is a stateless process reading env vars at startup
(`src/config/env.ts` caches on first read). Changing an environment
variable in Deno Deploy requires a redeploy (or restart) to take effect.

## Configuration changes that take effect immediately
- `routing/channels/{installation_id}` and `routing/groups/{installation_id}`
  are read fresh on every webhook commit. Updating routing via
  `kv.set()` (see README "Store Routing Config") applies to the next
  webhook received — in-flight or already-queued deliveries keep the
  routing snapshot captured at their original commit time (see
  `docs/KV.md`).

## Rotating secrets
1. Generate the new `GITHUB_WEBHOOK_SECRET` or `TELEGRAM_BOT_TOKEN`.
2. Update it in Deno Deploy project settings.
3. Redeploy.
4. For the GitHub webhook secret specifically: update it on the GitHub
   App itself at the same time — a mismatch between the two will cause
   every webhook to fail signature verification (`401`) until they're
   back in sync.

## Scaling
Deno Deploy runs this as a single logical service across its global
edge network; `kv.listenQueue()` consumers coordinate through KV itself,
so no manual sharding or leader election is required. If message volume
grows large enough that a single logical queue becomes a bottleneck,
that's a sign to reach for Deno KV's queue backlog metrics (Deploy
dashboard) before reaching for infrastructure changes.
