import Link from "next/link";
import { ResultClient } from "@/components/ResultClient";
import { getCurrentUser } from "@/lib/auth";
import { loadOwnedImage } from "@/lib/images";
import { resolveGuestIds } from "@/lib/images";
import { readTrace } from "@/lib/storage";
import { signAccessToken } from "@/lib/access-token";
import { isStaleResult, vectorizeImage } from "@/lib/vectorize-service";
import { getAppSettings } from "@/lib/seed";
import type { TraceResult } from "@/lib/vector/analyze";

export const dynamic = "force-dynamic";

export type InitialItem = {
  id: number;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: "queued" | "processing" | "ready" | "error";
  svg: string | null;
  favorite: boolean;
  stats: Record<string, unknown> | null;
};

/**
 * The result page resolves everything on the server:
 *  1. ownership (session cookie, guest cookie or signed token in the URL)
 *  2. the analysis – an image that was never vectorized is processed right here
 *  3. a *fresh* signed token that is handed to the client, so its own requests
 *     keep working even when cookies/localStorage are blocked (cross-site
 *     iframes strip SameSite cookies from client fetches).
 */
export default async function ResultPage({
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

  const user = await getCurrentUser();
  const guestIds = await resolveGuestIds(params.t ?? null);
  const defaults = (await getAppSettings()).vectorizer as Record<string, unknown> | undefined;
  const initial: InitialItem[] = [];

  for (const id of ids) {
    const row = await loadOwnedImage(id, user, { guestIds });
    if (!row) continue;

    let svg = row.svgText;
    let stats = (row.stats as Record<string, unknown> | null) ?? null;

    // Re-run when there is no cached SVG *or* the cache came from an older engine,
    // otherwise a quality fix would never reach images that were analysed before.
    if (!svg || isStaleResult(row.stats)) {
      // First open after upload: finish the job here so the vector is already in
      // the HTML (and the client does not need credentials to fetch it).
      try {
        const outcome = await vectorizeImage(row, null, { base: defaults });
        svg = outcome.svg;
        stats = outcome.stats;
      } catch (error) {
        initial.push({
          id: row.id,
          filename: row.filename,
          width: row.width,
          height: row.height,
          sizeBytes: row.sizeBytes,
          status: "error",
          svg: null,
          favorite: row.favorite,
          stats: { error: error instanceof Error ? error.message : "Vectorizing failed" },
        });
        continue;
      }
    }

    const trace = await readTrace<TraceResult>(row.tracePath);
    initial.push({
      id: row.id,
      filename: row.filename,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      status: row.status === "error" ? "error" : "ready",
      svg,
      favorite: row.favorite,
      stats: {
        ...(stats ?? {}),
        palette: trace?.palette ?? (stats?.palette as unknown) ?? [],
        pipeline: trace?.pipeline ?? (stats?.pipeline as unknown) ?? [],
      },
    });
  }

  // hand the browser a token that covers exactly the images it can already see
  const accessToken = initial.length ? signAccessToken(initial.map((item) => item.id)) : null;

  if (ids.length > 0 && initial.length === 0) {
    return (
      <div className="mx-auto grid min-h-[70vh] max-w-[620px] place-items-center px-4 text-center">
        <div>
          <h1 className="text-[24px] font-bold">These images are no longer available</h1>
          <p className="mt-3 text-[14px] leading-7 text-[#4b5563]">
            A result link only works for the browser session that uploaded the file. Cookies, private browsing and cleared
            storage all break that link — re-uploading the image takes a couple of seconds and gives you a fresh result.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/" className="rounded-xl bg-[#3b5bfd] px-6 py-3 text-[13px] font-bold text-white">
              Upload images
            </Link>
            <Link href="/dashboard" className="rounded-xl border border-[#e5e7ee] px-6 py-3 text-[13px] font-bold text-[#374151]">
              Open history
            </Link>
            <Link href="/support" className="text-[13px] font-semibold text-[#3b5bfd] underline">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ResultClient
      initialIds={ids}
      initialItems={initial}
      missing={ids.filter((id) => !initial.some((item) => item.id === id))}
      accessToken={accessToken}
    />
  );
}
