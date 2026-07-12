import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { _resetConfigCacheForTests, loadConfig } from "../../src/config/env.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    _resetConfigCacheForTests();
    fn();
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    _resetConfigCacheForTests();
  }
}

Deno.test("loadConfig throws when GITHUB_WEBHOOK_SECRET is missing", () => {
  withEnv({ GITHUB_WEBHOOK_SECRET: undefined, TELEGRAM_BOT_TOKEN: "token" }, () => {
    assertThrows(() => loadConfig(), Error, "GITHUB_WEBHOOK_SECRET");
  });
});

Deno.test("loadConfig throws when TELEGRAM_BOT_TOKEN is missing", () => {
  withEnv({ GITHUB_WEBHOOK_SECRET: "secret", TELEGRAM_BOT_TOKEN: undefined }, () => {
    assertThrows(() => loadConfig(), Error, "TELEGRAM_BOT_TOKEN");
  });
});

Deno.test("loadConfig applies sensible defaults", () => {
  withEnv({
    GITHUB_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "token",
    MAX_PAYLOAD_BYTES: undefined,
    MAX_ATTEMPTS: undefined,
  }, () => {
    const config = loadConfig();
    assertEquals(config.maxPayloadBytes, 5 * 1024 * 1024);
    assertEquals(config.maxAttempts, 5);
    assertEquals(config.allowedInstallationIds, null);
  });
});

Deno.test("loadConfig parses ALLOWED_INSTALLATION_IDS into a Set", () => {
  withEnv({
    GITHUB_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "token",
    ALLOWED_INSTALLATION_IDS: "123, 456,789",
  }, () => {
    const config = loadConfig();
    assertEquals(config.allowedInstallationIds?.has("123"), true);
    assertEquals(config.allowedInstallationIds?.has("456"), true);
    assertEquals(config.allowedInstallationIds?.has("789"), true);
    assertEquals(config.allowedInstallationIds?.size, 3);
  });
});
