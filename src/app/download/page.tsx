import { DownloadClient } from "@/components/DownloadClient";
import { getCurrentUser } from "@/lib/auth";
import { loadOwnedImage, resolveGuestIds } from "@/lib/images";
import { signAccessToken } from "@/lib/access-token";
import { isStaleResult, vectorizeImage } from "@/lib/vectorize-service";
import { getAppSettings } from "@/lib/seed";

export const dynamic = "force-dynamic";

export type InitialDownloadImage = {
  id: number;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
  svg: string | null;
};

/** The download page resolves its images on the server so the preview and the
 *  format buttons always work, even before any client-side request. */
export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; current?: string; t?: string }>;
}) {
  const params = await searchParams;
  const ids = (params.ids ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 60);
  const current = Number(params.current ?? ids[0] ?? 0);

  const user = await getCurrentUser();
  const guestIds = await resolveGuestIds(params.t ?? null);
  const defaults = (await getAppSettings()).vectorizer as Record<string, unknown> | undefined;
  const initial: InitialDownloadImage[] = [];
  const missing: number[] = [];

  for (const id of ids) {
    const row = await loadOwnedImage(id, user, { guestIds });
    if (!row) {
      missing.push(id);
      continue;
    }
    let svg = row.svgText;
    if (!svg || isStaleResult(row.stats)) {
      try {
        svg = (await vectorizeImage(row, null, { base: defaults })).svg;
      } catch (error) {
        console.error("[download] analysis failed", error);
        svg = null;
      }
    }
    initial.push({
      id: row.id,
      filename: row.filename,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      svg,
    });
  }

  const accessToken = initial.length ? signAccessToken(initial.map((image) => image.id)) : null;

  return (
    <DownloadClient
      ids={ids}
      current={current}
      initialImages={initial}
      missing={missing}
      canBatch={Boolean(user && (user.folderAccess || user.role === "admin"))}
      accessToken={accessToken}
    />
  );
}
