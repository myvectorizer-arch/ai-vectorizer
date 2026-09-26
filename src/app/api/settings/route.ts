import { ensureSeed, getAppSetting } from "@/lib/seed";
import { handle, ok } from "@/lib/api";
import { BASE_DEFAULTS, RENDER_DEFAULTS } from "@/lib/vector/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await ensureSeed();
    const payment = await getAppSetting<Record<string, unknown>>("payment");
    const site = await getAppSetting<Record<string, unknown>>("site");
    const vectorizer = (await getAppSetting<Record<string, unknown>>("vectorizer")) ?? {};
    return ok({
      payment,
      site,
      vectorizer,
      defaults: { base: BASE_DEFAULTS, render: RENDER_DEFAULTS },
      limits: {
        maxUploadMB: Number(vectorizer.maxUploadMB ?? 25),
        maxBatch: Number(vectorizer.maxBatch ?? 60),
        guestFreeImages: Number(vectorizer.guestFreeImages ?? 3),
        creditsPerImage: Number(vectorizer.creditsPerImage ?? 1),
      },
    });
  });
}
