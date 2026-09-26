import { getCurrentUser } from "@/lib/auth";
import { fail, handle } from "@/lib/api";
import { guestIdsFromRequest, loadOwnedImage } from "@/lib/images";
import { readUpload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const user = await getCurrentUser();
    const row = await loadOwnedImage(Number(id), user, { guestIds: guestIdsFromRequest(request) });
    if (!row || !row.sourcePath) return fail("Image not found", 404);
    const buffer = await readUpload(row.sourcePath);
    if (!buffer) return fail("Source file is no longer available", 410);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": row.mimeType || "application/octet-stream",
        "cache-control": "private, max-age=3600",
        "content-length": String(buffer.length),
      },
    });
  });
}
