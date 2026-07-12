/**
 * Minimal structured logger. Never logs secrets (tokens, private keys, HMAC
 * secrets) — callers must pass only non-sensitive fields.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(configured: Level, level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

export function createLogger(configuredLevel: Level) {
  function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>) {
    if (!shouldLog(configuredLevel, level)) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...fields,
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug: (scope: string, message: string, fields?: Record<string, unknown>) =>
      emit("debug", scope, message, fields),
    info: (scope: string, message: string, fields?: Record<string, unknown>) =>
      emit("info", scope, message, fields),
    warn: (scope: string, message: string, fields?: Record<string, unknown>) =>
      emit("warn", scope, message, fields),
    error: (scope: string, message: string, fields?: Record<string, unknown>) =>
      emit("error", scope, message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
