/**
 * Deno KV singleton. Every module that needs KV access imports `getKv()`
 * rather than calling `Deno.openKv()` directly, so tests can swap in a
 * scoped local database path.
 */

let kvInstance: Deno.Kv | null = null;

export async function getKv(): Promise<Deno.Kv> {
  if (!kvInstance) {
    kvInstance = await Deno.openKv();
  }
  return kvInstance;
}

/** Test-only: force a fresh KV handle against a given local path. */
export async function _openTestKv(path: string): Promise<Deno.Kv> {
  kvInstance = await Deno.openKv(path);
  return kvInstance;
}

export function _closeKv(): void {
  kvInstance?.close();
  kvInstance = null;
}
