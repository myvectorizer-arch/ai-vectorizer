import JSZip from "jszip";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { fail, handle, log, num, rateLimit, clientIp } from "@/lib/api";
import { guestIdsFromRequest, loadOwnedImage } from "@/lib/images";
import { readTrace } from "@/lib/storage";
import { vectorizeImage } from "@/lib/vectorize-service";
import { exportTrace } from "@/lib/vector";
import { mergeSettings, OUTPUT_FORMATS, FORMAT_VERSIONS, type OutputFormat, type Settings } from "@/lib/vector/types";
import type { TraceResult } from "@/lib/vector/analyze";

/** HTTP headers must be ISO-8859-1: strip anything outside printable ASCII. */
function asciiHeader(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "-");
}

function disposition(filename: string): string {
  const ascii = asciiHeader(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function safeName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "vector";
}

/** Shared by /api/export and the /api/export/[format] compatibility aliases. */
export async function handleExport(request: Request, formatOverride?: string) {
  return handle(async () => {
    const user = await getCurrentUser();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const format = (formatOverride ?? (typeof body.format === "string" ? body.format : "svg")) as OutputFormat;
    if (!OUTPUT_FORMATS.includes(format)) return fail(`Unsupported format "${format}"`);
    const version =
      typeof body.version === "string" && FORMAT_VERSIONS[format].some((v) => v.id === body.version)
        ? body.version
        : FORMAT_VERSIONS[format][1]?.id ?? FORMAT_VERSIONS[format][0].id;
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => num(v)).filter(Boolean) : [num(body.ids)];
    if (!ids.length) return fail("No image selected");
    if (ids.length > 60) return fail("Too many files in one export (max 60)");
    if (!rateLimit(`export:${user?.id ?? clientIp(request)}`, 240, 60_000)) {
      return fail("Too many exports – slow down a little", 429, "rate_limit");
    }
    if (ids.length > 1) {
      if (!user) return fail("Log in to download a whole batch at once", 401);
      if (!user.folderAccess && user.role !== "admin") {
        return fail("Batch / folder download (.zip) is included from Standard Unlimited ($25)", 402);
      }
    }

    const settings = mergeSettings((body.settings ?? null) as Partial<Settings> | null);
    const items: { filename: string; buffer: Buffer }[] = [];
    let totalBytes = 0;
    let shapes = 0;
    const notes = new Set<string>();

    for (const id of ids) {
      const row = await loadOwnedImage(id, user, { guestIds: guestIdsFromRequest(request) });
      if (!row) continue;
      let trace = await readTrace<TraceResult>(row.tracePath);
      if (!trace) trace = (await vectorizeImage(row, null, null, { force: true })).trace;
      const exported = await exportTrace(
        trace,
        format,
        version,
        settings,
        safeName(row.filename),
      );
      const base = safeName(row.filename);
      let filename = `${base}.${exported.ext}`;
      let suffix = 2;
      const taken = new Set(items.map((item) => item.filename));
      while (taken.has(filename)) filename = `${base}-${suffix++}.${exported.ext}`;
      items.push({ filename, buffer: exported.buffer });
      totalBytes += exported.buffer.length;
      shapes += exported.stats.shapes;
      notes.add(exported.note);
      await db.insert(downloads).values({
        imageId: row.id,
        userId: user?.id ?? null,
        format,
        version,
        bytes: exported.buffer.length,
      });
    }

    if (!items.length) return fail("Nothing to export – vectorize an image first", 409);

    if (items.length === 1) {
      const single = items[0];
      await log({
        userId: user?.id ?? null,
        kind: "api",
        message: `Downloaded ${single.filename} (${format} ${version})`,
        endpoint: "/api/export",
        meta: { bytes: single.buffer.length, shapes },
      });
      return new Response(new Uint8Array(single.buffer), {
        headers: {
          "content-type": format === "svg" ? "image/svg+xml" : format === "pdf" ? "application/pdf" : format === "png" ? "image/png" : "application/octet-stream",
          "content-disposition": disposition(single.filename),
          "content-length": String(single.buffer.length),
          "x-vectorizer-note": asciiHeader([...notes].join(" | ").slice(0, 280)),
        },
      });
    }

    const zip = new JSZip();
    const folder = zip.folder("vectorized") ?? zip;
    for (const item of items) folder.file(item.filename, item.buffer);
    folder.file(
      "settings.json",
      JSON.stringify({ format, version, settings, exportedAt: new Date().toISOString(), files: items.length }, null, 2),
    );
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const batchName = `vectorizer-${format}-${items.length}-files.zip`;
    await log({
      userId: user?.id ?? null,
      kind: "api",
      message: `Batch download: ${items.length} ${format.toUpperCase()} files (zip)`,
      endpoint: "/api/export",
      meta: { bytes: zipBuffer.length, sourceBytes: totalBytes, shapes, format, version },
    });
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": disposition(batchName),
        "content-length": String(zipBuffer.length),
      },
    });
  });
}

