import { NextResponse } from "next/server";
import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { ImageError } from "@/lib/vector/decode";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ImageError) return fail(error.message, 422);
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error("[api]", error);
    await log({ kind: "error", level: "error", message }).catch(() => {});
    // Don't leak internal error text (stack details, DB errors, file paths) to
    // end users in production; the full message is still logged above.
    const clientMessage = process.env.NODE_ENV === "production" ? "Unexpected server error" : message;
    return fail(clientMessage, 500);
  }
}

export async function log(entry: {
  userId?: number | null;
  kind?: string;
  level?: string;
  message: string;
  endpoint?: string;
  meta?: unknown;
  durationMs?: number;
}) {
  try {
    await db.insert(activityLogs).values({
      userId: entry.userId ?? null,
      kind: entry.kind ?? "log",
      level: entry.level ?? "info",
      message: entry.message,
      endpoint: entry.endpoint ?? null,
      meta: (entry.meta ?? null) as never,
      durationMs: entry.durationMs ?? null,
    });
  } catch {
    /* logging must never break a request */
  }
}

/* ---------------------------------------------------------------- */
/* In-memory rate limiting (per instance)                            */
/* ---------------------------------------------------------------- */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "127.0.0.1"
  );
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
