import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { downloads, images } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { clientIp, fail, handle, ok, rateLimit } from "@/lib/api";
import { readGuestIds, writeGuestIds, guestCookieName } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const favoritesOnly = url.searchParams.get("favorites") === "1";
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 60));
    const user = await getCurrentUser();
    if (!user) {
      const guestIds = await readGuestIds();
      if (!guestIds.length) return ok({ images: [], guest: true });
      const rows = await db.select().from(images).orderBy(desc(images.createdAt)).limit(200);
      const mine = rows.filter((r) => guestIds.includes(r.id));
      return ok({ images: mine.map(strip), guest: true });
    }
    const rows = await db
      .select()
      .from(images)
      .where(favoritesOnly ? and(eq(images.userId, user.id), eq(images.favorite, true)) : eq(images.userId, user.id))
      .orderBy(desc(images.createdAt))
      .limit(limit);
    return ok({ images: rows.map(strip), guest: false });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") ?? 0);
    const all = url.searchParams.get("all") === "1";
    const user = await getCurrentUser();
    if (!user) {
      if (!rateLimit(`hist:${clientIp(request)}`, 40, 60_000)) return fail("Too many requests", 429);
      const guestIds = await readGuestIds();
      let remaining = guestIds;
      if (all) {
        for (const gid of guestIds) await db.delete(images).where(eq(images.id, gid));
        remaining = [];
      } else if (id && guestIds.includes(id)) {
        await db.delete(images).where(eq(images.id, id));
        remaining = guestIds.filter((g: number) => g !== id);
      }
      await writeGuestIds(remaining);
      void guestCookieName;
      void downloads;
      return ok({ ok: true, cleared: all, remaining: remaining.length });
    }
    if (all) {
      await db.delete(images).where(eq(images.userId, user.id));
      return ok({ ok: true, cleared: true });
    }
    if (!id) return fail("Missing id");
    await db.delete(images).where(and(eq(images.id, id), eq(images.userId, user.id)));
    return ok({ ok: true });
  });
}

function strip(row: typeof images.$inferSelect) {
  const { svgText, coreSettings, renderSettings, tracePath, sourcePath, ...rest } = row;
  void svgText;
  void coreSettings;
  void renderSettings;
  void tracePath;
  void sourcePath;
  return rest;
}
