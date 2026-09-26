import { eq } from "drizzle-orm";
import { db } from "@/db";
import { images } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
import { guestIdsFromRequest, loadOwnedImage, publicImage } from "@/lib/images";
import { readTrace } from "@/lib/storage";
import type { TraceResult } from "@/lib/vector/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const row = await loadOwnedImage(Number(id), user, { guestIds: guestIdsFromRequest(request) });
    if (!row) return fail("Image not found", 404);
    const trace = await readTrace<TraceResult>(row.tracePath);
    return ok({
      image: publicImage(row),
      svg: row.svgText,
      palette: trace?.palette ?? [],
      pipeline: trace?.pipeline ?? [],
      renderSettings: row.renderSettings ?? null,
      coreSettings: trace?.base ?? null,
    });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const row = await loadOwnedImage(Number(id), user, { guestIds: guestIdsFromRequest(request) });
    if (!row) return fail("Image not found", 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.favorite === "boolean") patch.favorite = body.favorite;
    if (typeof body.filename === "string" && body.filename.trim()) {
      patch.filename = body.filename.trim().slice(0, 160);
    }
    if (!Object.keys(patch).length) return fail("Nothing to update");
    const [updated] = await db.update(images).set(patch).where(eq(images.id, row.id)).returning();
    return ok({ image: publicImage(updated) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const row = await loadOwnedImage(Number(id), user, { guestIds: guestIdsFromRequest(request) });
    if (!row) return fail("Image not found", 404);
    await db.delete(images).where(eq(images.id, row.id));
    return ok({ ok: true });
  });
}
