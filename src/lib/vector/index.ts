import sharp from "sharp";
import type { TraceResult } from "./analyze";
import { buildSvg } from "./svg";
import { buildEps } from "./eps";
import { buildPdf } from "./pdf";
import { buildDxf } from "./dxf";
import type { OutputFormat, RenderSettings } from "./types";

export type ExportResult = {
  buffer: Buffer;
  contentType: string;
  ext: string;
  bytes: number;
  stats: { shapes: number; subpaths: number; points: number; bytes: number; colors: number };
  note: string;
  layoutNote: string;
};

const CONTENT_TYPES: Record<OutputFormat, string> = {
  svg: "image/svg+xml",
  eps: "application/postscript",
  pdf: "application/pdf",
  dxf: "image/vnd.dxf",
  png: "image/png",
};

/* small LRU-ish cache so re-exporting the same settings is instant */
const cache = new Map<string, { buffer: Buffer; contentType: string; ext: string; stats: ExportResult["stats"]; note: string; layoutNote: string }>();
const CACHE_MAX = 80;

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: ReturnType<typeof buildSvg> extends never ? never : NonNullable<ReturnType<typeof cacheGet>>) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

export function settingsKey(s: RenderSettings, format: string, version: string): string {
  return JSON.stringify([format, version, s]);
}

export function svgFor(
  trace: TraceResult,
  settings: RenderSettings,
  version = "1.1",
): { content: string; stats: { bytes: number; shapes: number; subpaths: number; points: number; colors: number }; note: string } {
  const key = `svg|${version}|${settingsKey(settings, "svg", version)}|${trace.analyzedAt}`;
  const hit = cacheGet(key);
  if (hit) {
    return {
      content: hit.buffer.toString("utf8"),
      stats: hit.stats,
      note: hit.note,
    };
  }
  const result = buildSvg(trace, settings, version);
  cacheSet(key, {
    buffer: Buffer.from(result.content, "utf8"),
    contentType: "image/svg+xml",
    ext: "svg",
    stats: result.stats,
    note: result.note,
    layoutNote: layoutNote(result.layout.outW, result.layout.outH, result.layout.unit),
  });
  return { content: result.content, stats: result.stats, note: result.note };
}

function layoutNote(outW: number, outH: number, unit: string) {
  const digits = unit === "px" ? 0 : 2;
  return `${outW.toFixed(digits)} x ${outH.toFixed(digits)} ${unit}`;
}

export async function exportTrace(
  trace: TraceResult,
  format: OutputFormat,
  version: string,
  settings: RenderSettings,
  filename = "vector",
): Promise<ExportResult> {
  const key = `${trace.analyzedAt}|${settingsKey(settings, format, version)}|${filename}`;
  const hit = cacheGet(key);
  if (hit) {
    return { ...hit, bytes: hit.buffer.length };
  }

  if (format === "svg") {
    const svg = buildSvg(trace, settings, version);
    const value = {
      buffer: Buffer.from(svg.content, "utf8"),
      contentType: CONTENT_TYPES.svg,
      ext: "svg",
      stats: svg.stats,
      note: svg.note,
      layoutNote: layoutNote(svg.layout.outW, svg.layout.outH, svg.layout.unit),
    };
    cacheSet(key, value);
    return { ...value, bytes: value.buffer.length };
  }

  if (format === "eps") {
    const eps = buildEps(trace, settings, version, filename);
    const value = {
      buffer: Buffer.from(eps.content, "utf8"),
      contentType: CONTENT_TYPES.eps,
      ext: "eps",
      stats: { ...eps.stats, subpaths: 0, colors: trace.palette.length },
      note: eps.note,
      layoutNote: layoutNote(0, 0, "pt"),
    };
    cacheSet(key, value);
    return { ...value, bytes: value.buffer.length };
  }

  if (format === "pdf") {
    const pdf = buildPdf(trace, settings, version, filename);
    const value = {
      buffer: pdf.content,
      contentType: CONTENT_TYPES.pdf,
      ext: "pdf",
      stats: { ...pdf.stats, subpaths: 0, colors: trace.palette.length },
      note: pdf.note,
      layoutNote: layoutNote(0, 0, "pt"),
    };
    cacheSet(key, value);
    return { ...value, bytes: value.buffer.length };
  }

  if (format === "dxf") {
    const dxf = buildDxf(trace, settings, version, filename);
    const value = {
      buffer: Buffer.from(dxf.content, "utf8"),
      contentType: CONTENT_TYPES.dxf,
      ext: "dxf",
      stats: { ...dxf.stats, subpaths: 0, colors: trace.palette.length },
      note: dxf.note,
      layoutNote: layoutNote(0, 0, "unit"),
    };
    cacheSet(key, value);
    return { ...value, bytes: value.buffer.length };
  }

  // PNG – rasterise the optimized SVG ("clean bitmap" option)
  const svg = buildSvg(trace, settings, "1.1");
  const mult = version === "4x" ? 4 : version === "2x" ? 2 : 1;
  const width = Math.min(8000, Math.round(svg.layout.boxW * mult));
  const buffer = await sharp(Buffer.from(svg.content), { density: 96 })
    .resize({ width, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  const value = {
    buffer,
    contentType: CONTENT_TYPES.png,
    ext: "png",
    stats: { ...svg.stats, bytes: buffer.length },
    note: `PNG rasterised from the optimized SVG at ${mult}x`,
    layoutNote: `${width} px wide`,
  };
  cacheSet(key, value);
  return { ...value, bytes: value.buffer.length };
}

export { analyzeImage, traceStats } from "./analyze";
export type { TraceResult, TraceShape } from "./analyze";
export { renderDoc, computeLayout } from "./render";
