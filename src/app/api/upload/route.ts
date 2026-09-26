import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { images } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { clientIp, fail, handle, log, ok, rateLimit, str } from "@/lib/api";
import { guestBrowserKey, guestQuota, readGuestIds, writeGuestIds } from "@/lib/guest";
import { ensureSeed, getAppSetting } from "@/lib/seed";
import { saveUpload } from "@/lib/storage";
import { signAccessToken } from "@/lib/access-token";
import { decodeImage, sourceDimensions, ImageError } from "@/lib/vector/decode";
import { INPUT_FORMATS } from "@/lib/vector/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SIGNATURES: { ext: string[]; test: (b: Buffer) => boolean }[] = [
  { ext: ["png"], test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: ["jpg", "jpeg"], test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ["gif"], test: (b) => b.toString("ascii", 0, 3) === "GIF" },
  { ext: ["webp"], test: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { ext: ["bmp"], test: (b) => b.toString("ascii", 0, 2) === "BM" },
  { ext: ["tif", "tiff"], test: (b) => [0x49, 0x49].every((v, i) => b[i] === v) || [0x4d, 0x4d].every((v, i) => b[i] === v) },
  { ext: ["avif"], test: (b) => b.toString("ascii", 4, 8) === "ftyp" },
];

const DANGEROUS = ["<script", "<?php", "eval(", "#!/bin/", "<svg", "javascript:"];

function validateBuffer(buffer: Buffer, ext: string): string | null {
  const entry = SIGNATURES.find((s) => s.ext.includes(ext));
  if (!entry) return `".${ext}" files are not supported (PNG, JPG, JPEG, WEBP, BMP, GIF, TIFF only)`;
  if (!entry.test(buffer)) return "File content does not match its extension – refusing to process";
  const head = buffer.subarray(0, 4096).toString("latin1").toLowerCase();
  for (const bad of DANGEROUS) {
    if (head.includes(bad)) return "Security scan rejected this file (embedded code detected)";
  }
  return null;
}

export async function POST(request: Request) {
  return handle(async () => {
    await ensureSeed();
    const started = Date.now();
    const user = await getCurrentUser();
    const form = await request.formData().catch(() => null);
    if (!form) return fail("Expected a multipart upload");
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return fail("No files were uploaded");
    const isFolder = str(form.get("folder"), "0") === "1";

    const limits = ((await getAppSetting<Record<string, number>>("vectorizer")) ?? {}) as Record<string, number>;
    const maxUploadMB = limits.maxUploadMB ?? 25;
    const maxBatch = limits.maxBatch ?? 60;
    const guestFreeImages = limits.guestFreeImages ?? 12;

    if (files.length > maxBatch) return fail(`A batch can contain at most ${maxBatch} images`);
    // only a real directory tree (nested paths) needs the premium folder option –
    // selecting/dropping many loose images always works.
    const nested = files.some((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
      return rel.includes("/");
    });
    if ((isFolder || nested) && (!user || (!user.folderAccess && user.role !== "admin"))) {
      return fail(
        "Uploading a whole folder tree is part of Standard Unlimited ($25) and above. Dropping many images at once works on every plan.",
        402,
        "folder_locked",
      );
    }
    const ip = clientIp(request);
    if (!rateLimit(`upload:${user?.id ?? ip}`, 40, 60_000)) return fail("Too many uploads – please slow down", 429);

    let guestRemaining = guestFreeImages;
    if (!user) {
      const { key } = await guestBrowserKey(ip);
      const quota = guestQuota(`g:${key}`, guestFreeImages, files.length);
      guestRemaining = quota.remaining;
      if (!quota.allowed) {
        return fail(
          quota.used >= guestFreeImages
            ? `Guest allowance used up (${guestFreeImages} images per 24h). Create a free account for 5 more credits and batch uploads.`
            : `This batch is larger than your guest allowance – ${quota.remaining} image(s) left today. Create a free account to upload the rest.`,
          402,
          "guest_limit",
        );
      }
    }

    const batchId = randomUUID();
    const created: unknown[] = [];
    const errors: { filename: string; error: string }[] = [];

    for (const file of files) {
      const filename = file.name || "image.png";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      if (!INPUT_FORMATS.includes(ext as (typeof INPUT_FORMATS)[number])) {
        errors.push({ filename, error: `Unsupported extension .${ext}` });
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > maxUploadMB * 1024 * 1024) {
        errors.push({ filename, error: `Larger than ${maxUploadMB} MB` });
        continue;
      }
      const problem = validateBuffer(buffer, ext);
      if (problem) {
        errors.push({ filename, error: problem });
        continue;
      }
      try {
        // decode once so the client immediately knows real dimensions / validity
        const dims = await sourceDimensions(buffer);
        await decodeImage(buffer, 1600, filename);
        const rel = await saveUpload(filename, buffer);
        const [row] = await db
          .insert(images)
          .values({
            userId: user?.id ?? null,
            batchId,
            filename,
            mimeType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
            sizeBytes: buffer.length,
            width: dims.width,
            height: dims.height,
            status: "uploaded",
            sourcePath: rel,
          })
          .returning();
        created.push({
          id: row.id,
          batchId: row.batchId,
          filename: row.filename,
          width: row.width,
          height: row.height,
          sizeBytes: row.sizeBytes,
          status: row.status,
        });
      } catch (error) {
        errors.push({
          filename,
          error: error instanceof ImageError ? error.message : "Could not decode this image",
        });
      }
    }

    const createdIds = (created as { id: number }[]).map((c) => c.id);
    if (!user && createdIds.length) {
      const ids = await readGuestIds();
      await writeGuestIds([...ids, ...createdIds]);
    }
    // stateless proof of ownership – works even when cookies and localStorage are blocked
    const accessToken = signAccessToken(createdIds);

    await log({
      userId: user?.id ?? null,
      kind: "api",
      message: `Uploaded ${created.length} image(s)${isFolder ? " from a folder" : ""}`,
      endpoint: "/api/upload",
      durationMs: Date.now() - started,
      meta: { batchId, files: created.length, errors: errors.length },
    });

    return ok(
      {
        batchId,
        images: created,
        errors,
        accessToken,
        guest: !user,
        guestRemaining,
        durationMs: Date.now() - started,
        limits: { maxUploadMB, maxBatch, guestFreeImages, creditsPerImage: limits.creditsPerImage ?? 1 },
      },
      { status: 201 },
    );
  });
}
