import { getSession } from "@/lib/auth";
import { handle, log, ok, str } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const session = await getSession();
    await log({
      userId: session?.uid ?? null,
      kind: str(body.kind, "log"),
      level: str(body.level, "info"),
      message: str(body.message, "client event").slice(0, 400),
      endpoint: str(body.endpoint, ""),
      meta: body.meta ?? null,
    });
    return ok({ ok: true });
  });
}
