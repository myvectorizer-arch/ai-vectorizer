import { getPlans, ensureSeed } from "@/lib/seed";
import { handle, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await ensureSeed();
    const plans = await getPlans(true);
    return ok({ plans });
  });
}
