import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { supportTickets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { clientIp, fail, handle, log, ok, rateLimit, str } from "@/lib/api";
import { ensureSeed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ tickets: [] });
    const rows = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, user.id))
      .orderBy(desc(supportTickets.createdAt))
      .limit(50);
    return ok({ tickets: rows });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await ensureSeed();
    const ip = clientIp(request);
    if (!rateLimit(`support:${ip}`, 6, 600_000)) {
      return fail("You already sent several messages – please wait a few minutes", 429);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const user = await getCurrentUser();
    const name = str(body.name, user?.name ?? "").trim();
    const email = str(body.email, user?.email ?? "").trim().toLowerCase();
    const subject = str(body.subject).trim();
    const message = str(body.message).trim();
    const category = str(body.category, "general");

    if (!name) return fail("Please enter your name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Please enter a valid email address");
    if (subject.length < 3) return fail("Please add a short subject");
    if (message.length < 10) return fail("Please describe your issue in a little more detail");

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: user?.id ?? null,
        name,
        email,
        subject: subject.slice(0, 160),
        category,
        message: message.slice(0, 4000),
        imageId: typeof body.imageId === "number" ? body.imageId : null,
      })
      .returning();

    await log({
      userId: user?.id ?? null,
      kind: "support",
      message: `Support ticket #${ticket.id}: ${ticket.subject}`,
      meta: { category, email },
    });

    return ok({ ticket }, { status: 201 });
  });
}
