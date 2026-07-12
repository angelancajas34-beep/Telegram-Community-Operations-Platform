import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex, verifyHmacSha256 } from "./src/utils/crypto.ts";

async function hmacSha256Hex(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, body);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("verifyHmacSha256 accepts a correctly signed body", async () => {
  const secret = "test-secret";
  const body = new TextEncoder().encode(JSON.stringify({ hello: "world" })).buffer;
  const hex = await hmacSha256Hex(secret, body);

  const ok = await verifyHmacSha256(body, secret, `sha256=${hex}`);
  assert(ok);
});

Deno.test("verifyHmacSha256 rejects a tampered body", async () => {
  const secret = "test-secret";
  const original = new TextEncoder().encode(JSON.stringify({ hello: "world" })).buffer;
  const hex = await hmacSha256Hex(secret, original);

  const tampered = new TextEncoder().encode(JSON.stringify({ hello: "world!" })).buffer;
  const ok = await verifyHmacSha256(tampered, secret, `sha256=${hex}`);
  assertFalse(ok);
});

Deno.test("verifyHmacSha256 rejects a wrong secret", async () => {
  const body = new TextEncoder().encode("payload").buffer;
  const hex = await hmacSha256Hex("secret-a", body);
  const ok = await verifyHmacSha256(body, "secret-b", `sha256=${hex}`);
  assertFalse(ok);
});

Deno.test("verifyHmacSha256 rejects missing signature header", async () => {
  const body = new TextEncoder().encode("payload").buffer;
  const ok = await verifyHmacSha256(body, "secret", "");
  assertFalse(ok);
});

Deno.test("verifyHmacSha256 rejects missing secret", async () => {
  const body = new TextEncoder().encode("payload").buffer;
  const ok = await verifyHmacSha256(body, "", "sha256=deadbeef");
  assertFalse(ok);
});

Deno.test("sha256Hex is deterministic and matches known vector", async () => {
  const body = new TextEncoder().encode("").buffer; // empty string SHA-256
  const hex = await sha256Hex(body);
  assertEquals(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
