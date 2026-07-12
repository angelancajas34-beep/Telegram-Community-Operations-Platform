# Telegram Community & Operations Platform (STOS v2)
A **GitHub → Telegram notification relay** built on Deno Deploy. Reliability
comes from Deno KV's atomic transactions, transactional outbox, optimistic
concurrency (CAS), and native queue semantics.

## What it does
Receives GitHub App webhook events (push, pull request, release, workflow
run, deployment), persists them atomically, and delivers formatted
notifications to Telegram groups or channels — with idempotency,
operational delivery tracking, and automatic retry built in.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full request and
delivery flow diagrams, [`docs/KV.md`](docs/KV.md) for the storage schema,
and [`docs/FAILURE_MODES.md`](docs/FAILURE_MODES.md) for exactly what
happens under crashes, retries, and partial failures.

## Reliability model

| Guarantee | Mechanism |
| :--- | :--- |
| No phantom deliveries | `kv.atomic().enqueue()` — queue message only exists if the KV commit succeeds |
| No duplicate webhook ingestion | Idempotency key (`X-GitHub-Delivery`) checked before any work |
| Crash recovery for pending work | `listenQueue()` retries failed handlers; outbox scan on startup |
| No silent data corruption | CAS versionstamp check on every mutable entity; delivery updates use read-modify-write |
| No partial state | All five categories committed in one `kv.atomic()` — all or nothing |
| No unverified payloads | HMAC-SHA-256 over raw bytes before JSON parsing |
| Operational traceability | Delivery record written at commit, updated by worker on delivery |
| Exhaustion visibility | Dead-letter record written atomically; delivery record status set to `failed` |
| Commit-before-delivery | HTTP 200 returned only after a successful KV commit |

This service does not claim exactly-once delivery to Telegram — see
["Failure Modes"](docs/FAILURE_MODES.md#process-crashes-after-telegram-accepts-the-message-before-the-kv-commit-marking-delivery)
for the one unavoidable at-least-once window.

## Project structure
```text
stos-v2/
├── src/
│   ├── config/       env loading + validation
│   ├── github/       webhook handler, atomic pipeline, message formatter, rate limiter
│   ├── telegram/     Bot API client (called only from the worker)
│   ├── worker/       queue consumer, dead-letter, crash recovery
│   ├── storage/      KV singleton + key schema
│   ├── models/       shared TypeScript types
│   ├── health/       /health and /metrics handlers
│   ├── http/         request router
│   └── utils/        crypto (HMAC/SHA-256) and structured logger
├── tests/
│   ├── unit/         no KV dependency — crypto, formatter, config
│   ├── integration/  real Deno KV (in-memory), pipeline + worker logic
│   └── e2e/          full webhook → queue → delivery flow via listenQueue()
├── docs/             architecture, runtime, KV schema, security, ops, runbook,
│                     observability, failure modes
├── .github/workflows/deno.yml
├── deno.json
├── .env.example
├── main.ts
└── SECURITY.md
```

## Getting started

### 1. Telegram bot setup
1. Message `@BotFather` — create your bot, copy the token.
2. Add the bot to your Telegram group or channel and promote it to
   **administrator**.
3. Set `TELEGRAM_BOT_TOKEN` in Deno Deploy project settings (or your
   local `.env`).

### 2. GitHub App setup
1. Create a GitHub App at `github.com/settings/apps`.
2. Generate a private key; record the App ID, Webhook Secret, and
   Installation ID.
3. Subscribe to: Push, Pull Request, Release, Workflow Run, Deployment.
4. Set the webhook URL to `https://your-project.deno.dev/github/webhook`.

### 3. Store routing config
```typescript
const kv = await Deno.openKv();
await kv.set(["routing", "channels", "<installation_id>"], {
  chat_id: "@your_channel",
});
```

### 4. Run locally
```bash
cp .env.example .env
# fill in GITHUB_WEBHOOK_SECRET and TELEGRAM_BOT_TOKEN
export $(grep -v '^#' .env | xargs)
deno task dev
```

### 5. Run tests
```bash
deno task test
```

### 6. Deploy
```bash
deployctl deploy --project=stos-v2-prod main.ts
```

Full details: [`docs/RUNTIME.md`](docs/RUNTIME.md).

## Backup & DR
Deno Deploy KV provides continuous, point-in-time recovery (PITR) for
production projects. See the restore playbook in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md#disaster-recovery).

## Security
HMAC-SHA-256 is verified over raw bytes before any parsing; secrets are
never logged or persisted; GitHub-supplied strings are HTML-escaped before
being sent to Telegram. Full details, and how to report a vulnerability,
in [`SECURITY.md`](SECURITY.md) and [`docs/SECURITY.md`](docs/SECURITY.md).

## Scope
This repository implements the GitHub → Telegram relay described above —
nothing more. It does not include a workflow engine, broadcast scheduler,
support ticket system, community management, or analytics service. If you
need those, they'd be separate modules built on top of this same Deno KV
foundation, each with their own schema and spec — this repo doesn't
speculatively include any of them.
