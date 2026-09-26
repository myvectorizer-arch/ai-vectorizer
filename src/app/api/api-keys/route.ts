import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { apiKey as newKey, getCurrentUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Please log in first", 401);
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(desc(apiKeys.createdAt));
    if (rows.length === 0 && user.apiKey) {
      const [created] = await db
        .insert(apiKeys)
        .values({ userId: user.id, key: user.apiKey, label: "default" })
        .returning();
      return ok({ keys: [created] });
    }
    return ok({ keys: rows });
  });
}

export async function POST() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Please log in first", 401);
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.userId, user.id));
    const key = newKey();
    const [row] = await db
      .insert(apiKeys)
      .values({ userId: user.id, key, label: "default", isActive: true })
      .returning();
    await db.update(users).set({ apiKey: key }).where(eq(users.id, user.id));
    return ok({ key: row });
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return fail("Please log in first", 401);
    const body = (await request.json().catch(() => ({}))) as { id?: number; isActive?: boolean };
    if (!body.id) return fail("Missing key id");
    await db
      .update(apiKeys)
      .set({ isActive: body.isActive ?? true })
      .where(eq(apiKeys.id, body.id));
    return ok({ ok: true });
  });
}
