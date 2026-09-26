import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

export const guestCookieName = "av_guest_ids";
export const guestIdCookie = "av_guest_id";
const guestUsage = new Map<string, { count: number; resetAt: number }>();

export async function readGuestIds(): Promise<number[]> {
  const jar = await cookies();
  const raw = jar.get(guestCookieName)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === "number");
  } catch {
    return [];
  }
}

export async function writeGuestIds(ids: number[]): Promise<void> {
  const jar = await cookies();
  jar.set(guestCookieName, JSON.stringify(ids.slice(-80)), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Stable per-browser id so one visitor can never eat another's free quota. */
export async function guestBrowserKey(ip: string): Promise<{ key: string; created: boolean }> {
  const jar = await cookies();
  const existing = jar.get(guestIdCookie)?.value;
  if (existing) return { key: `b:${existing}`, created: false };
  const id = randomBytes(9).toString("hex");
  jar.set(guestIdCookie, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { key: `b:${id}`, created: true };
}

/**
 * Rolling 24h guest allowance, keyed per browser (IP is only a loose fallback).
 * The cost is charged per image so a 30-image drop is not one "free try".
 */
export function guestQuota(
  key: string,
  limit: number,
  cost = 1,
): { allowed: boolean; used: number; remaining: number } {
  const now = Date.now();
  const entry = guestUsage.get(key);
  if (!entry || entry.resetAt < now) {
    guestUsage.set(key, { count: cost, resetAt: now + 24 * 60 * 60 * 1000 });
    return { allowed: true, used: cost, remaining: Math.max(0, limit - cost) };
  }
  if (entry.count + cost > limit) return { allowed: false, used: entry.count, remaining: Math.max(0, limit - entry.count) };
  entry.count += cost;
  return { allowed: true, used: entry.count, remaining: Math.max(0, limit - entry.count) };
}
