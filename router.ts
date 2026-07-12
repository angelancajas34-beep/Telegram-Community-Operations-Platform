import type { AppConfig } from "../config/env.ts";
import type { Logger } from "../utils/logger.ts";
import { handleGithubWebhook } from "../github/webhook.ts";
import { handleHealth, handleMetrics } from "../health/handlers.ts";

export interface RouterDeps {
  kv: Deno.Kv;
  config: AppConfig;
  logger: Logger;
}

export function createRouter(deps: RouterDeps) {
  return async function router(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return handleHealth();
    }

    if (url.pathname === "/metrics") {
      return handleMetrics(deps.kv);
    }

    if (url.pathname === "/github/webhook" && req.method === "POST") {
      try {
        return await withTimeout(
          handleGithubWebhook(req, deps),
          deps.config.requestTimeoutMs,
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          deps.logger.warn("http", "webhook handler timed out");
          return new Response("Request Timeout", { status: 408 });
        }
        deps.logger.error("http", "unhandled webhook error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

