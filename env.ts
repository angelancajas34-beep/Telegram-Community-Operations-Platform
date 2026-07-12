/**
 * Central environment configuration.
 * Fails fast at startup if required secrets are missing — better to crash
 * on boot than to silently accept unverifiable webhooks.
 */

export interface AppConfig {
  githubWebhookSecret: string;
  telegramBotToken: string;
  maxPayloadBytes: number;
  requestTimeoutMs: number;
  maxAttempts: number;
  allowedInstallationIds: Set<string> | null; // null = allow all
  rateLimitPerMinute: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim() === "") {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `See .env.example for the full list of required settings.`,
    );
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`[config] ${name} must be a positive integer, got: "${raw}"`);
  }
  return parsed;
}

function loadLogLevel(): AppConfig["logLevel"] {
  const raw = (Deno.env.get("LOG_LEVEL") ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

let cached: AppConfig | null = null;

/** Loads and validates configuration once, caching the result. */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const allowedRaw = Deno.env.get("ALLOWED_INSTALLATION_IDS")?.trim() ?? "";
  const allowedInstallationIds = allowedRaw.length > 0
    ? new Set(allowedRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  cached = {
    githubWebhookSecret: requireEnv("GITHUB_WEBHOOK_SECRET"),
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    maxPayloadBytes: optionalInt("MAX_PAYLOAD_BYTES", 5 * 1024 * 1024),
    requestTimeoutMs: optionalInt("REQUEST_TIMEOUT_MS", 10_000),
    maxAttempts: optionalInt("MAX_ATTEMPTS", 5),
    allowedInstallationIds,
    rateLimitPerMinute: optionalInt("RATE_LIMIT_PER_MINUTE", 120),
    logLevel: loadLogLevel(),
  };

  return cached;
}

/** Test-only escape hatch to force a config reload after mutating env vars. */
export function _resetConfigCacheForTests(): void {
  cached = null;
}
