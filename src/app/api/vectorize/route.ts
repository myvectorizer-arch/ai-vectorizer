import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, images, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { fail, handle, log, num, ok, rateLimit, clientIp } from "@/lib/api";
import { ensureSeed, getAppSetting } from "@/lib/seed";
import { guestIdsFromRequest, loadOwnedImage, publicImage } from "@/lib/images";
import { readUpload } from "@/lib/storage";
import { traceStats } from "@/lib/vector/analyze";
import { vectorizeImage } from "@/lib/vectorize-service";
import { mergeSettings, pickRenderSettings, type Settings } from "@/lib/vector/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const started = Date.now();
  return handle(async () => {
    await ensureSeed();
    const apiKeyHeader = request.headers.get("x-api-key");
    let user = await getCurrentUser();
    if (!user && apiKeyHeader) {
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.key, apiKeyHeader)).limit(1);
      const keyRow = rows[0];
      if (keyRow?.isActive) {
        const owners = await db.select().from(users).where(eq(users.id, keyRow.userId)).limit(1);
        user = owners[0] ?? null;
        await db
          .update(apiKeys)
          .set({ requestCount: keyRow.requestCount + 1, lastUsedAt: new Date() })
          .where(eq(apiKeys.id, keyRow.id));
      }
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const imageId = num(body.imageId);
    const settings = mergeSettings((body.settings ?? null) as Partial<Settings> | null);
    if (!imageId) return fail("Missing imageId");

    const row = await loadOwnedImage(imageId, user, { guestIds: guestIdsFromRequest(request) });
    if (!row) return fail("Image not found", 404);
    // A request can be interrupted (tab closed, proxy timeout). Instead of
    // dead-ending with 409 forever, just re-run the analysis – the last writer wins.
    // A single batch may legally contain maxBatch images, so the burst window has
    // to be wider than one batch (plus headroom for re-analysis while tweaking settings).
    const burst = Math.max(240, (Number((await getAppSetting<Record<string, number>>("vectorizer"))?.maxBatch ?? 60) || 60) * 4);
    if (!rateLimit(`vec:${user?.id ?? clientIp(request)}`, burst, 60_000)) {
      return fail("Too many vectorize requests – please retry in a moment", 429, "rate_limit");
    }

    const limits = ((await getAppSetting<Record<string, number>>("vectorizer")) ?? {}) as Record<string, number>;
    // credits are spent once per image – re-processing the same image with new
    // AI settings is free, which keeps the live-preview UX usable.
    const isFirstPass = row.status !== "done";
    const creditsPerImage = isFirstPass ? (limits.creditsPerImage ?? 1) : 0;
    if (user && !user.unlimited && user.credits < creditsPerImage) {
      return fail("You are out of credits – buy a plan or credit pack to continue", 402);
    }

    const buffer = await readUpload(row.sourcePath ?? "");
    if (!buffer) return fail("Source image was not found on this server", 410);

    await db.update(images).set({ status: "processing" }).where(eq(images.id, row.id));

    const outcome = await vectorizeImage(row, settings, { base: limits });
    const stats = traceStats(outcome.trace);
    const rowStats = outcome.stats;
    const svg = { content: outcome.svg };

    const [updated] = await db.select().from(images).where(eq(images.id, row.id)).limit(1);

    let remainingCredits = user?.credits ?? 0;
    if (user && !user.unlimited) {
      remainingCredits = Math.max(0, user.credits - creditsPerImage);
      await db.update(users).set({ credits: remainingCredits }).where(eq(users.id, user.id));
    } else if (user) {
      remainingCredits = user.credits;
    }

    await log({
      userId: user?.id ?? null,
      kind: "api",
      level: "info",
      message: `Vectorized "${row.filename}" → ${stats.shapes} shapes / ${stats.colors} colours`,
      endpoint: "/api/vectorize",
      durationMs: Date.now() - started,
      meta: { imageId: row.id, stats },
    });

    return ok({
      image: publicImage(updated ?? row),
      svg: svg.content,
      stats: rowStats,
      palette: outcome.trace.palette,
      pipeline: outcome.trace.pipeline,
      settings,
      remainingCredits,
      unlimited: Boolean(user?.unlimited),
      durationMs: Date.now() - started,
    });
  });
}
