import { db } from "@/db";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { fail, handle, num, ok } from "@/lib/api";
import { guestIdsFromRequest, loadOwnedImage, publicImage } from "@/lib/images";
import { readTrace } from "@/lib/storage";
import { isStaleResult, vectorizeImage } from "@/lib/vectorize-service";
import { buildSvg } from "@/lib/vector/svg";
import { mergeSettings, pickRenderSettings, type Settings } from "@/lib/vector/types";
import type { TraceResult } from "@/lib/vector/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cheap re-render from the cached trace: no image decode, no quantisation. */
export async function POST(request: Request) {
  const started = Date.now();
  return handle(async () => {
    const user = await getCurrentUser();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const imageId = num(body.imageId);
    if (!imageId) return fail("Missing imageId");
    const row = await loadOwnedImage(imageId, user, { guestIds: guestIdsFromRequest(request) });
    if (!row) return fail("Image not found", 404);
    let trace = await readTrace<TraceResult>(row.tracePath);
    if (trace && isStaleResult(row.stats)) trace = null;
    if (!trace) {
      // trace file missing or damaged (interrupted write) – rebuild it silently
      const outcome = await vectorizeImage(row, null, null, { force: true });
      trace = outcome.trace;
    }
    const settings = mergeSettings({
      ...(trace.base as unknown as Settings),
      ...((body.settings ?? null) as Partial<Settings> | null),
    });
    const render = pickRenderSettings(settings);
    const svg = buildSvg(trace, render, typeof body.version === "string" ? body.version : "1.1");
    const stats = {
      ...(row.stats as Record<string, unknown> | null),
      ...svg.stats,
      renderMs: Date.now() - started,
    };
    await db
      .update(images)
      .set({ renderSettings: render as never, svgText: svg.content, stats: stats as never })
      .where(eq(images.id, row.id));
    return ok({
      image: publicImage({ ...row, stats }),
      svg: svg.content,
      stats,
      note: svg.note,
      renderMs: Date.now() - started,
    });
  });
}
