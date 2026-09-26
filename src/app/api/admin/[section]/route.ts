import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, apiKeys, downloads, images, payments, plans, supportTickets, users, withdrawals } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { fail, handle, log, num, ok, str } from "@/lib/api";
import { ensureSeed, getAppSettings, planDurationDays, setAppSetting } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { section } = await ctx.params;
  return handle(async () => {
    await ensureSeed();
    const admin = await requireAdmin();
    if (!admin) return fail("Admin access required", 403);
    const url = new URL(request.url);

    if (section === "stats") {
      const [userCount] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
      const [premiumCount] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.unlimited, true));
      const [pendingCount] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(payments)
        .where(eq(payments.status, "pending"));
      const [revenueRow] = await db
        .select({ total: sql<number>`coalesce(sum(amount), 0)::float` })
        .from(payments)
        .where(eq(payments.status, "approved"));
      const [creditRow] = await db.select({ total: sql<number>`coalesce(sum(credits), 0)::int` }).from(users);
      const [imageCount] = await db.select({ n: sql<number>`count(*)::int` }).from(images);
      const [doneCount] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(images)
        .where(eq(images.status, "done"));
      const [downloadCount] = await db.select({ n: sql<number>`count(*)::int` }).from(downloads);
      const [avgRow] = await db
        .select({ ms: sql<number>`coalesce(avg(duration_ms), 0)::float` })
        .from(activityLogs)
        .where(eq(activityLogs.endpoint, "/api/vectorize"));

      const premiumUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          plan: users.plan,
          planStartedAt: users.planStartedAt,
          planExpiresAt: users.planExpiresAt,
          unlimited: users.unlimited,
          folderAccess: users.folderAccess,
          totalSpent: users.totalSpent,
        })
        .from(users)
        .where(eq(users.unlimited, true))
        .orderBy(desc(users.planStartedAt))
        .limit(50);

      const paymentRows = await db
        .select({
          id: payments.id,
          userId: payments.userId,
          email: users.email,
          name: users.name,
          planName: payments.planName,
          planSlug: payments.planSlug,
          amount: payments.amount,
          currency: payments.currency,
          method: payments.method,
          senderNumber: payments.senderNumber,
          transactionId: payments.transactionId,
          status: payments.status,
          adminNote: payments.adminNote,
          reviewedAt: payments.reviewedAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(users, eq(payments.userId, users.id))
        .orderBy(desc(payments.createdAt))
        .limit(200);

      const formatStats = await db
        .select({ format: downloads.format, n: sql<number>`count(*)::int` })
        .from(downloads)
        .groupBy(downloads.format);

      const revenueByMethod = await db
        .select({
          method: payments.method,
          total: sql<number>`coalesce(sum(amount),0)::float`,
          n: sql<number>`count(*)::int`,
        })
        .from(payments)
        .where(eq(payments.status, "approved"))
        .groupBy(payments.method);

      const daily = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
          n: sql<number>`count(*)::int`,
        })
        .from(images)
        .where(gte(images.createdAt, new Date(Date.now() - 13 * 86_400_000)))
        .groupBy(sql`date_trunc('day', created_at)`)
        .orderBy(sql`date_trunc('day', created_at)`);

      const recentUsers = await db
        .select({ id: users.id, name: users.name, email: users.email, plan: users.plan, createdAt: users.createdAt })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(8);

      const recentLogs = await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(12);

      const [withdrawTotal] = await db
        .select({ total: sql<number>`coalesce(sum(amount),0)::float` })
        .from(withdrawals)
        .where(eq(withdrawals.status, "paid"));

      const [monthlyRevenue] = await db
        .select({ total: sql<number>`coalesce(sum(amount),0)::float` })
        .from(payments)
        .where(and(eq(payments.status, "approved"), gte(payments.createdAt, new Date(Date.now() - 30 * 86_400_000))));

      const [openTickets] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(eq(supportTickets.status, "open"));
      const ticketRows = await db
        .select()
        .from(supportTickets)
        .orderBy(desc(supportTickets.createdAt))
        .limit(100);

      return ok({
        totals: {
          openTickets: openTickets?.n ?? 0,
          users: userCount?.n ?? 0,
          premiumUsers: premiumCount?.n ?? 0,
          pendingPayments: pendingCount?.n ?? 0,
          revenue: revenueRow?.total ?? 0,
          monthlyRevenue: monthlyRevenue?.total ?? 0,
          credits: creditRow?.total ?? 0,
          images: imageCount?.n ?? 0,
          processed: doneCount?.n ?? 0,
          downloads: downloadCount?.n ?? 0,
          avgProcessMs: Math.round(avgRow?.ms ?? 0),
          withdrawn: withdrawTotal?.total ?? 0,
          profit: Math.round(((revenueRow?.total ?? 0) - (withdrawTotal?.total ?? 0)) * 100) / 100,
        },
        premiumUsers,
        tickets: ticketRows,
        pendingPayments: paymentRows.filter((p) => p.status === "pending"),
        payments: paymentRows,
        formatStats,
        revenueByMethod,
        daily,
        recentUsers,
        recentLogs,
      });
    }

    if (section === "users") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(500);
      const counts = await db
        .select({ userId: images.userId, n: sql<number>`count(*)::int` })
        .from(images)
        .groupBy(images.userId);
      const map = new Map(counts.map((c) => [c.userId, c.n]));
      const list = rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        provider: u.provider,
        credits: u.credits,
        plan: u.plan,
        planPeriod: u.planPeriod,
        planStartedAt: u.planStartedAt,
        planExpiresAt: u.planExpiresAt,
        unlimited: u.unlimited,
        folderAccess: u.folderAccess,
        isBlocked: u.isBlocked,
        totalSpent: u.totalSpent,
        createdAt: u.createdAt,
        apiKey: u.apiKey,
        images: map.get(u.id) ?? 0,
      }));
      return ok({
        users: q ? list.filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) : list,
      });
    }

    if (section === "payments") {
      const rows = await db
        .select({
          id: payments.id,
          userId: payments.userId,
          email: users.email,
          name: users.name,
          planName: payments.planName,
          planSlug: payments.planSlug,
          amount: payments.amount,
          currency: payments.currency,
          method: payments.method,
          senderNumber: payments.senderNumber,
          transactionId: payments.transactionId,
          status: payments.status,
          adminNote: payments.adminNote,
          reviewedAt: payments.reviewedAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(users, eq(payments.userId, users.id))
        .orderBy(desc(payments.createdAt))
        .limit(400);
      return ok({ payments: rows });
    }

    if (section === "plans") {
      const rows = await db.select().from(plans).orderBy(plans.sortOrder);
      return ok({ plans: rows });
    }

    if (section === "support") {
      const status = url.searchParams.get("status");
      const rows = status
        ? await db.select().from(supportTickets).where(eq(supportTickets.status, status)).orderBy(desc(supportTickets.createdAt)).limit(300)
        : await db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(300);
      return ok({ tickets: rows });
    }

    if (section === "settings") {
      return ok({ settings: await getAppSettings() });
    }

    if (section === "logs") {
      const kind = url.searchParams.get("kind");
      const rows = kind
        ? await db
            .select()
            .from(activityLogs)
            .where(eq(activityLogs.kind, kind))
            .orderBy(desc(activityLogs.createdAt))
            .limit(300)
        : await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(300);
      return ok({ logs: rows });
    }

    if (section === "withdrawals") {
      const rows = await db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)).limit(200);
      const [paid] = await db
        .select({ total: sql<number>`coalesce(sum(amount),0)::float` })
        .from(withdrawals)
        .where(eq(withdrawals.status, "paid"));
      const [pending] = await db
        .select({ total: sql<number>`coalesce(sum(amount),0)::float` })
        .from(withdrawals)
        .where(eq(withdrawals.status, "pending"));
      return ok({ withdrawals: rows, paid: paid?.total ?? 0, pending: pending?.total ?? 0 });
    }

    if (section === "usage") {
      const byEndpoint = await db
        .select({
          endpoint: activityLogs.endpoint,
          n: sql<number>`count(*)::int`,
          avgMs: sql<number>`coalesce(avg(duration_ms),0)::float`,
        })
        .from(activityLogs)
        .groupBy(activityLogs.endpoint)
        .limit(30);
      const byUser = await db
        .select({ userId: activityLogs.userId, n: sql<number>`count(*)::int` })
        .from(activityLogs)
        .where(eq(activityLogs.kind, "api"))
        .groupBy(activityLogs.userId)
        .orderBy(desc(sql`count(*)`))
        .limit(10);
      const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.requestCount)).limit(20);
      const recent = await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(40);
      return ok({ byEndpoint, byUser, keys, recent });
    }

    return fail("Unknown admin section", 404);
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { section } = await ctx.params;
  return handle(async () => {
    const admin = await requireAdmin();
    if (!admin) return fail("Admin access required", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (section === "users") {
      const id = num(body.id);
      if (!id) return fail("Missing user id");
      const patch: Record<string, unknown> = {};
      if (typeof body.isBlocked === "boolean") patch.isBlocked = body.isBlocked;
      if (body.credits !== undefined) patch.credits = Math.max(0, Math.round(num(body.credits)));
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
      if (typeof body.unlimited === "boolean") patch.unlimited = body.unlimited;
      if (typeof body.folderAccess === "boolean") patch.folderAccess = body.folderAccess;
      if (typeof body.plan === "string") patch.plan = body.plan;
      if (typeof body.planExpiresAt === "string" && body.planExpiresAt) {
        patch.planExpiresAt = new Date(body.planExpiresAt);
        patch.planStartedAt = new Date();
      }
      if (body.extendDays !== undefined) {
        const days = Math.round(num(body.extendDays));
        const target = await db.select().from(users).where(eq(users.id, id)).limit(1);
        const base =
          target[0]?.planExpiresAt && target[0].planExpiresAt.getTime() > Date.now()
            ? target[0].planExpiresAt.getTime()
            : Date.now();
        patch.planExpiresAt = new Date(base + days * 86_400_000);
        patch.planStartedAt = target[0]?.planStartedAt ?? new Date();
      }
      if (!Object.keys(patch).length) return fail("Nothing to update");
      const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
      await log({ userId: admin.id, kind: "log", message: `Admin updated user ${updated.email}`, meta: patch });
      return ok({ user: { ...updated, passwordHash: undefined } });
    }

    if (section === "payments") {
      const id = num(body.id);
      const status = str(body.status);
      if (!id || !["approved", "rejected", "pending"].includes(status)) return fail("Missing id/status");
      const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
      const payment = rows[0];
      if (!payment) return fail("Payment not found", 404);
      // Idempotency guard: credits/plans must only be granted on the first
      // transition into "approved", otherwise a double click (or two admins)
      // would hand out the plan twice.
      const alreadyApproved = payment.status === "approved";
      if (status === "approved" && alreadyApproved) {
        return ok({ payment, alreadyApproved: true, message: "This payment was already approved – nothing was granted again." });
      }
      const [updated] = await db
        .update(payments)
        .set({ status, adminNote: str(body.note, payment.adminNote ?? "") || null, reviewedAt: new Date() })
        .where(eq(payments.id, id))
        .returning();

      if (status === "approved" && !alreadyApproved) {
        const planRows = await db.select().from(plans).where(eq(plans.slug, payment.planSlug)).limit(1);
        const plan = planRows[0];
        const userRows = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
        const target = userRows[0];
        if (target) {
          const days = plan ? planDurationDays(plan.period) : 0;
          const patch: Record<string, unknown> = { totalSpent: (target.totalSpent ?? 0) + payment.amount };
          if (plan?.unlimited) {
            const base =
              target.planExpiresAt && target.planExpiresAt.getTime() > Date.now()
                ? target.planExpiresAt.getTime()
                : Date.now();
            patch.plan = plan.slug;
            patch.planPeriod = plan.period;
            patch.planStartedAt = new Date();
            patch.planExpiresAt = days ? new Date(base + days * 86_400_000) : null;
            patch.unlimited = true;
            patch.folderAccess = plan.folderAccess;
          } else if (plan) {
            patch.credits = (target.credits ?? 0) + plan.credits;
          }
          await db.update(users).set(patch).where(eq(users.id, target.id));
        }
      }
      await log({
        userId: admin.id,
        kind: "payment",
        message: `Payment #${id} ${status} for ${payment.planName}`,
        meta: { amount: payment.amount, userId: payment.userId },
      });
      return ok({ payment: updated });
    }

    if (section === "plans") {
      const id = num(body.id);
      if (!id) return fail("Missing plan id");
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "slug", "period", "currency"]) {
        if (typeof body[key] === "string") patch[key] = body[key];
      }
      for (const key of ["price", "priceBdt", "credits", "sortOrder"]) {
        if (body[key] !== undefined) patch[key] = num(body[key]);
      }
      for (const key of ["unlimited", "folderAccess", "highlight", "isActive"]) {
        if (typeof body[key] === "boolean") patch[key] = body[key];
      }
      if (Array.isArray(body.features)) patch.features = (body.features as unknown[]).filter((f): f is string => typeof f === "string");
      const [updated] = await db.update(plans).set(patch).where(eq(plans.id, id)).returning();
      await log({ userId: admin.id, kind: "log", message: `Pricing updated: ${updated.name}`, meta: patch });
      return ok({ plan: updated });
    }

    if (section === "settings") {
      const key = str(body.key);
      if (!key) return fail("Missing settings key");
      const current = (await getAppSettings())[key];
      const merged =
        current && typeof current === "object" && !Array.isArray(current) && body.value && typeof body.value === "object"
          ? { ...(current as Record<string, unknown>), ...(body.value as Record<string, unknown>) }
          : body.value;
      await setAppSetting(key, merged);
      await log({ userId: admin.id, kind: "log", message: `Settings updated: ${key}` });
      return ok({ key, value: merged });
    }

    if (section === "support") {
      const id = num(body.id);
      if (!id) return fail("Missing ticket id");
      const patch: Record<string, unknown> = {};
      if (typeof body.status === "string") patch.status = body.status;
      if (typeof body.priority === "string") patch.priority = body.priority;
      if (typeof body.adminReply === "string") {
        patch.adminReply = body.adminReply;
        patch.repliedAt = new Date();
        patch.status = typeof body.status === "string" ? body.status : "closed";
      }
      if (!Object.keys(patch).length) return fail("Nothing to update");
      const [updated] = await db.update(supportTickets).set(patch).where(eq(supportTickets.id, id)).returning();
      await log({ userId: admin.id, kind: "support", message: `Ticket #${id} updated`, meta: patch });
      return ok({ ticket: updated });
    }

    if (section === "withdrawals") {
      const id = num(body.id);
      if (!id) return fail("Missing withdrawal id");
      const [updated] = await db
        .update(withdrawals)
        .set({ status: str(body.status, "paid"), note: str(body.note, "") || null })
        .where(eq(withdrawals.id, id))
        .returning();
      return ok({ withdrawal: updated });
    }

    return fail("Unknown admin section", 404);
  });
}

export async function POST(request: Request, ctx: Ctx) {
  const { section } = await ctx.params;
  return handle(async () => {
    const admin = await requireAdmin();
    if (!admin) return fail("Admin access required", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (section === "plans") {
      const name = str(body.name, "New plan");
      const slug = str(body.slug, name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 40);
      const [created] = await db
        .insert(plans)
        .values({
          name,
          slug,
          price: num(body.price, 0),
          priceBdt: num(body.priceBdt, 0),
          currency: str(body.currency, "USD"),
          period: str(body.period, "monthly"),
          credits: num(body.credits, 0),
          unlimited: Boolean(body.unlimited),
          folderAccess: Boolean(body.folderAccess),
          features: Array.isArray(body.features) ? (body.features as string[]) : [],
          highlight: Boolean(body.highlight),
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
          sortOrder: num(body.sortOrder, 99),
        })
        .returning();
      await log({ userId: admin.id, kind: "log", message: `New pricing plan created: ${created.name}` });
      return ok({ plan: created }, { status: 201 });
    }

    if (section === "withdrawals") {
      const [created] = await db
        .insert(withdrawals)
        .values({
          userId: admin.id,
          amount: num(body.amount, 0),
          method: str(body.method, "bkash"),
          accountNumber: str(body.accountNumber),
          status: "pending",
          note: str(body.note, "") || null,
        })
        .returning();
      await log({ userId: admin.id, kind: "log", message: `Withdraw request created: ${created.amount}` });
      return ok({ withdrawal: created }, { status: 201 });
    }

    if (section === "notices") {
      const notices = (await getAppSettings()).notices;
      const list = Array.isArray(notices) ? (notices as unknown[]) : [];
      const notice = {
        id: Date.now(),
        title: str(body.title, "Announcement"),
        body: str(body.body, ""),
        createdAt: new Date().toISOString(),
      };
      await setAppSetting("notices", [notice, ...list].slice(0, 20));
      await log({ userId: admin.id, kind: "log", message: `Notice published: ${notice.title}` });
      return ok({ notice }, { status: 201 });
    }

    if (section === "grant") {
      const email = str(body.email).toLowerCase();
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const target = rows[0];
      if (!target) return fail("No user with that email", 404);
      const days = Math.round(num(body.days, 0));
      const patch: Record<string, unknown> = {
        unlimited: Boolean(body.unlimited),
        folderAccess: Boolean(body.folderAccess),
        plan: str(body.plan, target.plan),
        planPeriod: days ? (days > 100 ? "semiannual" : "monthly") : target.planPeriod,
      };
      if (days) {
        const base =
          target.planExpiresAt && target.planExpiresAt.getTime() > Date.now() ? target.planExpiresAt.getTime() : Date.now();
        patch.planExpiresAt = new Date(base + days * 86_400_000);
        patch.planStartedAt = new Date();
      }
      if (body.credits !== undefined) patch.credits = Math.max(0, num(body.credits));
      const [updated] = await db.update(users).set(patch).where(eq(users.id, target.id)).returning();
      await log({ userId: admin.id, kind: "log", message: `Manual premium grant for ${email}`, meta: patch });
      return ok({ user: { ...updated, passwordHash: undefined } });
    }

    return fail("Unknown admin section", 404);
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { section } = await ctx.params;
  return handle(async () => {
    const admin = await requireAdmin();
    if (!admin) return fail("Admin access required", 403);
    const url = new URL(request.url);
    const id = num(url.searchParams.get("id"));
    if (section === "plans" && id) {
      await db.delete(plans).where(eq(plans.id, id));
      return ok({ ok: true });
    }
    if (section === "users" && id) {
      if (id === admin.id) return fail("You cannot delete your own admin account");
      await db.delete(images).where(eq(images.userId, id));
      await db.delete(users).where(eq(users.id, id));
      return ok({ ok: true });
    }
    if (section === "logs") {
      if (url.searchParams.get("all") === "1") {
        await db.delete(activityLogs);
        return ok({ ok: true, cleared: true });
      }
      if (id) {
        await db.delete(activityLogs).where(eq(activityLogs.id, id));
        return ok({ ok: true });
      }
    }
    if (section === "images" && id) {
      await db.delete(images).where(eq(images.id, id));
      return ok({ ok: true });
    }
    if (section === "support" && id) {
      await db.delete(supportTickets).where(eq(supportTickets.id, id));
      return ok({ ok: true });
    }
    if (section === "notices") {
      await setAppSetting("notices", []);
      return ok({ ok: true });
    }
    return fail("Nothing to delete", 404);
  });
}
