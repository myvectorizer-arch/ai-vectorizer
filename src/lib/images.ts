import { eq } from "drizzle-orm";
import { db } from "@/db";
import { images, type ImageRow } from "@/db/schema";
import type { User } from "@/db/schema";
import { readGuestIds } from "@/lib/guest";
import { verifyAccessToken } from "@/lib/access-token";

/**
 * Guest images can be proven in three independent ways so that a missing cookie
 * or blocked localStorage can never lock a visitor out of their own upload:
 *   1. the x-guest-images header (localStorage mirror)
 *   2. the av_guest_ids cookie
 *   3. a signed access token (header or ?t= query parameter)
 */
export function guestIdsFromRequest(request: Request): number[] {
  const ids = new Set<number>();
  const raw = request.headers.get("x-guest-images");
  if (raw) {
    for (const value of raw.split(",")) {
      const n = Number(value.trim());
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  const token = request.headers.get("x-access-token") ?? new URL(request.url).searchParams.get("t");
  for (const id of verifyAccessToken(token)) ids.add(id);
  return [...ids];
}

/** Build the merged allow-list for a server component (cookies + optional token). */
export async function resolveGuestIds(token?: string | null): Promise<number[]> {
  const ids = new Set<number>(await readGuestIds());
  for (const id of verifyAccessToken(token)) ids.add(id);
  return [...ids];
}

export async function loadOwnedImage(
  id: number,
  user: User | null,
  opts: { allowGuest?: boolean; guestIds?: number[] } = {},
): Promise<ImageRow | null> {
  const rows = await db.select().from(images).where(eq(images.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (user && (row.userId === user.id || user.role === "admin")) return row;
  // A signed token (or guest cookie/header) is proof that this browser was
  // already granted access to exactly this image. That matters for client-side
  // fetches inside a cross-site iframe, where SameSite cookies are not sent even
  // though the server-side render could read them.
  const ids = new Set([...(opts.guestIds ?? []), ...(await readGuestIds())]);
  if (ids.has(id)) return row;
  return null;
}

export function publicImage(row: ImageRow) {
  return {
    id: row.id,
    batchId: row.batchId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    status: row.status,
    error: row.error,
    favorite: row.favorite,
    stats: row.stats,
    createdAt: row.createdAt,
  };
}
