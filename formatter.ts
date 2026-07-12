import type { ParsedGithubPayload } from "../models/event.ts";

/**
 * Escapes text for Telegram's HTML parse mode. Applied to every
 * user-controlled string (repo names, branch names, titles, usernames)
 * before interpolation, since GitHub payload fields are attacker-influenced.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function repoOf(payload: ParsedGithubPayload): string {
  return escapeHtml(payload.repository?.full_name ?? "unknown");
}

function senderOf(payload: ParsedGithubPayload): string {
  return escapeHtml(payload.sender?.login ?? "unknown");
}

export function formatTelegramMessage(
  eventType: string,
  payload: ParsedGithubPayload,
): string {
  const repo = repoOf(payload);
  const sender = senderOf(payload);

  switch (eventType) {
    case "push": {
      const branch = escapeHtml(String(payload.ref ?? "").replace("refs/heads/", ""));
      const commits = Array.isArray(payload.commits) ? payload.commits.length : 0;
      return `📦 <b>${repo}</b>\n🔀 Push to <code>${branch}</code> by <b>${sender}</b>\n📝 ${commits} commit(s)`;
    }
    case "pull_request": {
      const pr = payload.pull_request;
      const action = escapeHtml(String(payload.action ?? ""));
      const number = pr?.number ?? "?";
      const title = escapeHtml(pr?.title ?? "");
      return `🔃 <b>${repo}</b>\n📋 PR #${number} <i>${action}</i>\n<b>${title}</b>\nby <b>${sender}</b>`;
    }
    case "release": {
      const tag = escapeHtml(payload.release?.tag_name ?? "unknown");
      return `🚀 <b>${repo}</b>\n🏷️ Release <b>${tag}</b> published by <b>${sender}</b>`;
    }
    case "workflow_run": {
      const run = payload.workflow_run;
      const status = run?.conclusion ?? run?.status ?? "in_progress";
      const icon = status === "success" ? "✅" : status === "failure" ? "❌" : "⏳";
      const name = escapeHtml(run?.name ?? "unknown");
      return `${icon} <b>${repo}</b>\n⚙️ Workflow <b>${name}</b> — ${escapeHtml(String(status))}`;
    }
    case "deployment": {
      const action = escapeHtml(String(payload.action ?? "created"));
      return `🚢 <b>${repo}</b>\n📤 Deployment ${action} by <b>${sender}</b>`;
    }
    default:
      return `📡 <b>${repo}</b>\n🔔 GitHub event: <code>${escapeHtml(eventType)}</code>`;
  }
}
