# Security

## Webhook authentication
- `X-Hub-Signature-256` is verified with HMAC-SHA-256 over the **raw,
  unparsed request body** (`src/utils/crypto.ts::verifyHmacSha256`).
  Comparison is constant-time.
- Verification happens strictly before `JSON.parse` is ever called on the
  body. Parsing first and verifying second would let a malformed-but-
  differently-serialized payload slip past signature checks in some
  edge cases — the ordering in `src/github/webhook.ts` is deliberate and
  should not be reordered.
- Requests without a valid signature receive `401` and are never
  persisted.

## Secrets
- `GITHUB_WEBHOOK_SECRET` and `TELEGRAM_BOT_TOKEN` are read once, at
  startup, via `src/config/env.ts`. Neither is logged — `src/utils/logger.ts`
  only ever receives fields explicitly passed by call sites, and no call
  site passes a secret.
- The webhook secret and bot token are never embedded in KV records,
  queue messages, or delivery records.

## payload_hash vs. HMAC — do not conflate these
`payload_hash` (stored on `delivery_record`) is an **unkeyed** SHA-256
digest of the raw webhook body. It is an integrity fingerprint useful
for forensic comparison (e.g. "was this the exact same payload as another
delivery ID"), and proves nothing about who sent the request.

Only the **keyed** HMAC-SHA-256 verification
(`X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET`) authenticates the
sender. `sha256Hex()` and `verifyHmacSha256()` are separate functions in
`src/utils/crypto.ts` specifically so these two concepts can't be
accidentally merged into one code path.

## Idempotency and replay protection
- `idempotency/{delivery_id}` is written inside the same atomic
  transaction as everything else, with a 7-day TTL.
- A replayed delivery (same `X-GitHub-Delivery`) is detected before any
  parsing or KV writes occur and short-circuits to `200 OK` with no
  side effects.

## Telegram message construction
- All GitHub-supplied strings (repo names, branch names, PR titles,
  usernames, workflow names) are HTML-escaped
  (`src/github/formatter.ts::escapeHtml`) before being interpolated into
  a Telegram HTML-mode message. GitHub payload fields are attacker-
  influenced (anyone can name a branch or PR title), so this is not
  optional.

## Rate limiting
- A coarse, fixed-window, per-installation limiter
  (`src/github/rate_limit.ts`) rejects excess requests with `429` before
  any KV writes beyond the counter itself. It fails open on KV errors —
  a rate-limiter bookkeeping failure should never block legitimate
  webhook delivery.

## Payload size limits
- Requests are rejected with `413` if `Content-Length` (or the actual
  body size, as a fallback) exceeds `MAX_PAYLOAD_BYTES`, before the full
  body is read into memory in the size-unknown case.

## Installation allowlisting (optional)
- If `ALLOWED_INSTALLATION_IDS` is set, requests from any other
  installation are rejected with `403` after signature verification
  (an attacker without the webhook secret can't reach this check at all).

## What this repo does not do
- It does not manage GitHub App private keys, OAuth flows, or
  installation lifecycle — `github/installations/{installation_id}` is
  documented as "external write" because provisioning that data is out
  of scope for the relay itself.
- It does not implement its own TLS termination, WAF, or DDoS protection
  — that's Deno Deploy's platform layer.
