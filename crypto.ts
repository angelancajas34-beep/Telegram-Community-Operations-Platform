/**
 * Cryptographic utilities.
 *
 * IMPORTANT: HMAC-SHA-256 (keyed, verifyHmacSha256) authenticates the sender.
 * SHA-256 (unkeyed, sha256Hex) is an integrity fingerprint only — it carries
 * no secret and proves nothing about who sent the payload. These two must
 * never be conflated: only verifyHmacSha256's result gates request handling.
 */

/**
 * Verifies a GitHub `X-Hub-Signature-256` header against the raw request
 * body using constant-time comparison.
 *
 * @param body      Raw, unmodified request bytes (must be read before any
 *                   JSON parsing — parsing can alter byte-for-byte content
 *                   in ways that break signature verification).
 * @param secret    The GitHub App's webhook secret.
 * @param sigHeader The full `X-Hub-Signature-256` header value, e.g.
 *                  "sha256=<hex>".
 */
export async function verifyHmacSha256(
  body: ArrayBuffer,
  secret: string,
  sigHeader: string,
): Promise<boolean> {
  if (!secret || !sigHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, body);
  const hex = bytesToHex(new Uint8Array(sig));
  const expected = `sha256=${hex}`;

  return constantTimeEqual(expected, sigHeader);
}

/**
 * Computes a SHA-256 hex digest of the raw payload bytes. This is stored in
 * the delivery record purely as an integrity fingerprint (e.g. for dedupe
 * audits or forensic comparison) — it is NOT used for authentication.
 */
export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", body);
  return bytesToHex(new Uint8Array(hash));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison to avoid timing side-channels. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
