import { eq } from "drizzle-orm";
import { db } from "@/db";
import { images, type ImageRow } from "@/db/schema";
import { readUpload, saveTrace } from "@/lib/storage";
import { ENGINE_VERSION } from "@/lib/engine-version";
import { analyzeImage, traceStats, type TraceResult } from "@/lib/vector/analyze";
import { decodeImage } from "@/lib/vector/decode";
import { buildSvg } from "@/lib/vector/svg";
import {
  BASE_DEFAULTS,
  mergeSettings,
  pickBaseSettings,
  pickRenderSettings,
  type Settings,
} from "@/lib/vector/types";

/** In-process dedupe: two callers asking for the same image share one run. */
const inFlight = new Map<number, Promise<VectorizeOutcome>>();

/** Is a cached result from an older engine build? */
export function isStaleResult(stats: unknown): boolean {
  const version = (stats as { engineVersion?: string } | null)?.engineVersion;
  return version !== ENGINE_VERSION;
}

export type VectorizeOutcome = {
  svg: string;
  trace: TraceResult;
  stats: Record<string, unknown>;
  durationMs: number;
};

/**
 * Runs the full pipeline for one stored image and caches the trace + SVG.
 * Shared by POST /api/vectorize and by the server components that render the
 * result / download pages, so a page can deliver a finished vector on the first
 * paint without depending on client-side credentials.
 */
export function vectorizeImage(
  row: ImageRow,
  baseInput: Partial<Settings> | null | undefined,
  defaults?: { base?: Record<string, unknown>; render?: Record<string, unknown> } | null,
  opts: { force?: boolean } = {},
): Promise<VectorizeOutcome> {
  // A page render and the editing client often ask for the same image at the same
  // moment; run it once and let both callers await the same result.
  if (!opts.force && inFlight.has(row.id)) return inFlight.get(row.id)!;
  const job = runVectorize(row, baseInput, defaults).finally(() => {
    if (inFlight.get(row.id) === job) inFlight.delete(row.id);
  });
  inFlight.set(row.id, job);
  return job;
}

async function runVectorize(
  row: ImageRow,
  baseInput: Partial<Settings> | null | undefined,
  defaults?: { base?: Record<string, unknown>; render?: Record<string, unknown> } | null,
): Promise<VectorizeOutcome> {
  const started = Date.now();
  const buffer = await readUpload(row.sourcePath ?? "");
  if (!buffer) throw new Error("Source image was not found on this server");

  const adminDefaults = (defaults?.base ?? {}) as Partial<Settings>;
  const settings = mergeSettings({ ...adminDefaults, ...(baseInput ?? null) } as Partial<Settings>);
  const base = pickBaseSettings({ ...BASE_DEFAULTS, ...settings });
  const maxDim = 700 + Math.round(base.detailLevel * 90);

  const raster = await decodeImage(buffer, maxDim, row.filename);
  const trace = analyzeImage(raster, base, row.width || raster.width, row.height || raster.height);
  const tracePath = await saveTrace(row.id, trace);
  const stats = traceStats(trace);
  const svg = buildSvg(trace, pickRenderSettings(settings), "1.1");

  const rowStats = {
    ...stats,
    width: row.width || raster.width,
    height: row.height || raster.height,
    traceWidth: trace.width,
    traceHeight: trace.height,
    bytes: svg.stats.bytes,
    pipeline: trace.pipeline,
    palette: trace.palette,
    background: trace.background,
    warning: trace.warning ?? null,
    durationMs: Date.now() - started,
    analyzedAt: trace.analyzedAt,
    note: svg.note,
    engineVersion: ENGINE_VERSION,
    svg,
    settings,
  };

  await db
    .update(images)
    .set({
      status: "done",
      error: null,
      tracePath,
      svgText: svg.content,
      coreSettings: base as never,
      renderSettings: pickRenderSettings(settings) as never,
      stats: rowStats as never,
    })
    .where(eq(images.id, row.id));

  return {
    svg: svg.content,
    trace,
    stats: rowStats,
    durationMs: Date.now() - started,
  };
}
