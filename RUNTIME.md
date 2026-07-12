# Runtime

## Requirements
- Deno 2.x (Deno Deploy's current runtime)
- `--unstable-kv` flag (or the `unstable: ["kv"]` entry in `deno.json`,
  already configured) until Deno KV is fully stabilized
- Environment variables from `.env.example` set in Deno Deploy project
  settings (or a local `.env` for `deno task dev`, loaded via your shell
  or a tool like `dotenvx` — this repo does not commit a `.env` loader
  to avoid an extra dependency; add one if you prefer not to export vars
  manually)

## Local development
```bash
cp .env.example .env
# fill in GITHUB_WEBHOOK_SECRET and TELEGRAM_BOT_TOKEN
export $(grep -v '^#' .env | xargs)   # or use your preferred env loader
deno task dev
```

The dev task runs with `--watch` and opens a local Deno KV database file
in the working directory (no path given to `Deno.openKv()` in
`src/storage/kv.ts` defaults to a local SQLite-backed file when not
running on Deno Deploy).

## Production (Deno Deploy)
```bash
deployctl deploy --project=<your-project> main.ts
```
Deno Deploy automatically provisions the production Deno KV database —
no separate provisioning step is required. Set the required environment
variables under **Project → Settings → Environment Variables**.

## Tasks
| Task | Command | Purpose |
| :--- | :--- | :--- |
| `dev` | `deno task dev` | Local dev server with file watching |
| `start` | `deno task start` | Production-style run, no watcher |
| `test` | `deno task test` | Full test suite (unit + integration + e2e) |
| `test:unit` | `deno task test:unit` | Fast, no-KV-dependency tests only |
| `test:integration` | `deno task test:integration` | KV-backed tests |
| `fmt` | `deno task fmt` | Format all source files |
| `lint` | `deno task lint` | Lint all source files |
| `check` | `deno task check` | Type-check `main.ts` and its full import graph |

## Permissions
Production run needs: `--allow-net` (Telegram API + serving HTTP),
`--allow-env` (config), `--allow-read` (local KV file, if not on Deploy).
No `--allow-write` is needed on Deno Deploy itself; it's only needed
locally so Deno KV can create its SQLite file.
