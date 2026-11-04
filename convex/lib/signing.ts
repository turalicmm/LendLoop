// HMAC-SHA256 request signing shared by both directions of the n8n integration.
//
//   canonical = `${timestamp}.${METHOD}.${path}.${rawBody}`
//   header    = X-LendLoop-Signature: sha256=<hex>
//
// Binding method and path to the signature means a captured request can't be
// replayed against a different endpoint, and the timestamp window limits
// replays of the same one. Uses Web Crypto, so it runs in the default Convex
// runtime without "use node".

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

export function canonicalString(
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(nowSeconds);
  const hex = await hmacSha256Hex(secret, canonicalString(timestamp, method, path, body));
  return { timestamp, signature: `sha256=${hex}` };
}

/** Compares two strings without returning early on the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySignature(
  secret: string,
  input: {
    method: string;
    path: string;
    body: string;
    timestamp: string | null;
    signature: string | null;
  },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const { timestamp, signature } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "malformed timestamp" };
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }
  const expected = `sha256=${await hmacSha256Hex(
    secret,
    canonicalString(timestamp, input.method, input.path, input.body),
  )}`;
  return timingSafeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
