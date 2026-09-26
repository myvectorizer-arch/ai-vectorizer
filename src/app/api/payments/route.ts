import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { clientIp, fail, handle, log, num, ok, rateLimit, str } from "@/lib/api";
import { ensureSeed, getPlanBySlug } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Please log in first", 401);
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, user.id))
      .orderBy(desc(payments.createdAt))
      .limit(50);
    return ok({ payments: rows });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await ensureSeed();
    const user = await getCurrentUser();
    if (!user) return fail("Please log in to buy a plan", 401);
    if (!rateLimit(`pay:${user.id}:${clientIp(request)}`, 8, 300_000)) {
      return fail("Too many payment submissions – please wait a few minutes", 429);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const planSlug = str(body.planSlug);
    const method = str(body.method, "bkash").toLowerCase();
    const senderNumber = str(body.senderNumber).trim();
    const transactionId = str(body.transactionId).trim().toUpperCase();
    const note = str(body.note).trim();

    const plan = await getPlanBySlug(planSlug);
    if (!plan || !plan.isActive) return fail("Unknown plan");
    if (!senderNumber || senderNumber.replace(/\D/g, "").length < 6) {
      return fail("Enter the bKash/Nagad number you sent the money from");
    }
    if (transactionId.length < 4) return fail("Enter a valid Transaction ID (TrxID)");
    if (method === "paypal") return fail("PayPal is temporarily disabled – please use bKash or Nagad");

    const amount = num(body.amount, plan.price);
    const [row] = await db
      .insert(payments)
      .values({
        userId: user.id,
        planSlug: plan.slug,
        planName: plan.name,
        amount: amount || plan.price,
        currency: str(body.currency, plan.currency),
        method,
        senderNumber,
        transactionId,
        status: "pending",
        adminNote: note || null,
      })
      .returning();

    await log({
      userId: user.id,
      kind: "payment",
      message: `Pending ${method} payment submitted for ${plan.name} (${transactionId})`,
      meta: { paymentId: row.id },
    });
    return ok({ payment: row }, { status: 201 });
  });
}
