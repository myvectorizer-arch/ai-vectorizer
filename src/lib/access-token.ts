import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless access tokens.
 *
 * Guest ownership used to rely on a cookie plus a localStorage fallback. Both can
 * be unavailable (private mode, embedded preview iframes, storage partitioning),
 * which made freshly uploaded images look "not found" on the result page.
 *
 * A signed token travels in the URL instead, so the browser that just uploaded a
 * file can always read it back – no storage of any kind required.
 */

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET is not set. Refusing to start in production with a guessable access-token secret."
  );
}
const secret = Buffer.from(
  process.env.JWT_SECRET ?? "ai-vectorizer-dev-secret-change-me-please-1234567890",
  "utf8",
);

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (input: string) => Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signAccessToken(ids: number[], ttlSeconds = 60 * 60 * 24 * 30): string {
  const payload = b64url(JSON.stringify({ ids: [...new Set(ids)].sort((a, b) => a - b), exp: Date.now() + ttlSeconds * 1000 }));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyAccessToken(token: string | null | undefined): number[] {
  if (!token || !token.includes(".")) return [];
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return [];
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [];
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8")) as { ids?: unknown; exp?: unknown };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return [];
    if (!Array.isArray(data.ids)) return [];
    return data.ids.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  } catch {
    return [];
  }
}
