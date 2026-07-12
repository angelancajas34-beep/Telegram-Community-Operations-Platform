import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml, formatTelegramMessage } from "../../src/github/formatter.ts";

Deno.test("escapeHtml escapes angle brackets and ampersands", () => {
  assertEquals(escapeHtml("<script>&"), "&lt;script&gt;&amp;");
});

Deno.test("formatTelegramMessage: push event", () => {
  const msg = formatTelegramMessage("push", {
    repository: { full_name: "acme/widgets" },
    sender: { login: "octocat" },
    ref: "refs/heads/main",
    commits: [{}, {}, {}],
  });
  assertStringIncludes(msg, "acme/widgets");
  assertStringIncludes(msg, "main");
  assertStringIncludes(msg, "octocat");
  assertStringIncludes(msg, "3 commit(s)");
});

Deno.test("formatTelegramMessage: pull_request event", () => {
  const msg = formatTelegramMessage("pull_request", {
    repository: { full_name: "acme/widgets" },
    sender: { login: "octocat" },
    action: "opened",
    pull_request: { number: 42, title: "Fix the thing" },
  });
  assertStringIncludes(msg, "PR #42");
  assertStringIncludes(msg, "opened");
  assertStringIncludes(msg, "Fix the thing");
});

Deno.test("formatTelegramMessage: release event", () => {
  const msg = formatTelegramMessage("release", {
    repository: { full_name: "acme/widgets" },
    sender: { login: "octocat" },
    release: { tag_name: "v1.2.3" },
  });
  assertStringIncludes(msg, "v1.2.3");
});

Deno.test("formatTelegramMessage: workflow_run success uses check mark", () => {
  const msg = formatTelegramMessage("workflow_run", {
    repository: { full_name: "acme/widgets" },
    workflow_run: { name: "CI", conclusion: "success" },
  });
  assertStringIncludes(msg, "✅");
  assertStringIncludes(msg, "CI");
});

Deno.test("formatTelegramMessage: workflow_run failure uses cross mark", () => {
  const msg = formatTelegramMessage("workflow_run", {
    repository: { full_name: "acme/widgets" },
    workflow_run: { name: "CI", conclusion: "failure" },
  });
  assertStringIncludes(msg, "❌");
});

Deno.test("formatTelegramMessage: unknown event type falls back gracefully", () => {
  const msg = formatTelegramMessage("star", {
    repository: { full_name: "acme/widgets" },
  });
  assertStringIncludes(msg, "star");
  assertStringIncludes(msg, "acme/widgets");
});

Deno.test("formatTelegramMessage: escapes malicious branch name to prevent HTML injection", () => {
  const msg = formatTelegramMessage("push", {
    repository: { full_name: "acme/widgets" },
    ref: "refs/heads/<b>pwn</b>",
    commits: [],
  });
  assertStringIncludes(msg, "&lt;b&gt;pwn&lt;/b&gt;");
});
