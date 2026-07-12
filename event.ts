/** Immutable archive record stored at github/events/{delivery_id}. */
export interface GithubEventRecord {
  payload: Record<string, unknown>;
  headers: {
    event: string;
    delivery: string;
  };
  received_at: number;
  verified: true;
}

/** Narrow, defensive view over a GitHub webhook payload's common fields. */
export interface ParsedGithubPayload {
  repository?: { full_name?: string };
  sender?: { login?: string };
  installation?: { id?: number | string };
  action?: string;
  ref?: string;
  commits?: unknown[];
  pull_request?: { number?: number; title?: string };
  release?: { tag_name?: string };
  workflow_run?: { name?: string; status?: string; conclusion?: string };
}

export const SUPPORTED_EVENT_TYPES = [
  "push",
  "pull_request",
  "release",
  "workflow_run",
  "deployment",
] as const;

export type SupportedEventType = typeof SUPPORTED_EVENT_TYPES[number];
