import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  apiKey,
  clearSessionCookie,
  getCurrentUser,
  getSession,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { clientIp, fail, handle, log, ok, rateLimit, str } from "@/lib/api";
import { ensureSeed, getAppSetting } from "@/lib/seed";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

function userDto(user: {
  id: number;
  name: string;
  email: string;
  role: string;
  credits: number;
  plan: string;
  planPeriod: string;
  planExpiresAt: Date | null;
  unlimited: boolean;
  folderAccess: boolean;
  apiKey: string | null;
  isBlocked: boolean;
  totalSpent: number;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    credits: user.credits,
    plan: user.plan,
    planPeriod: user.planPeriod,
    planExpiresAt: user.planExpiresAt,
    unlimited: user.unlimited,
    folderAccess: user.folderAccess,
    apiKey: user.apiKey,
    isBlocked: user.isBlocked,
    totalSpent: user.totalSpent,
    isAdmin: user.role === "admin",
  };
}

export async function GET(request: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  return handle(async () => {
    await ensureSeed();
    if (action === "me") {
      const user = await getCurrentUser();
      if (!user) return ok({ user: null });
      return ok({ user: userDto(user) });
    }
    if (action === "session") {
      const session = await getSession();
      return ok({ session });
    }
    if (action === "google") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const origin = new URL(request.url).origin;
      if (!clientId) {
        return NextResponse.redirect(`${origin}/login?error=google_not_configured`);
      }
      const state = randomBytes(12).toString("hex");
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${origin}/api/auth/google-callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      });
      const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
      response.cookies.set("av_oauth_state", state, { httpOnly: true, path: "/", maxAge: 600 });
      return response;
    }
    if (action === "google-callback") {
      const url = new URL(request.url);
      const origin = url.origin;
      const code = url.searchParams.get("code");
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!code || !clientId || !clientSecret) {
        return NextResponse.redirect(`${origin}/login?error=google_not_configured`);
      }
      const state = url.searchParams.get("state");
      const expectedState = (await cookies()).get("av_oauth_state")?.value;
      if (!state || !expectedState || state !== expectedState) {
        return NextResponse.redirect(`${origin}/login?error=google_state`);
      }
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${origin}/api/auth/google-callback`,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) return NextResponse.redirect(`${origin}/login?error=google_failed`);
      const tokens = (await tokenRes.json()) as { access_token?: string };
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      if (!infoRes.ok) return NextResponse.redirect(`${origin}/login?error=google_failed`);
      const info = (await infoRes.json()) as { email?: string; name?: string };
      if (!info.email) return NextResponse.redirect(`${origin}/login?error=google_failed`);
      const email = info.email.toLowerCase();
      const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
      let user = existing[0];
      if (!user) {
        const freeCredits = (await getAppSetting<number>("freeCredits")) ?? 5;
        const [created] = await db
          .insert(users)
          .values({
            name: info.name ?? email.split("@")[0],
            email,
            passwordHash: hashPassword(randomBytes(16).toString("hex")),
            provider: "google",
            credits: freeCredits,
            apiKey: apiKey(),
          })
          .returning();
        user = created;
      }
      if (user.isBlocked) return NextResponse.redirect(`${origin}/login?error=blocked`);
      await setSessionCookie({ uid: user.id, email: user.email, role: user.role });
      return NextResponse.redirect(`${origin}/dashboard`);
    }
    return fail("Unknown auth action", 404);
  });
}

export async function POST(request: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  return handle(async () => {
    await ensureSeed();
    const ip = clientIp(request);
    if (!rateLimit(`auth:${action}:${ip}`, 25, 60_000)) return fail("Too many attempts, slow down", 429);

    if (action === "logout") {
      await clearSessionCookie();
      return ok({ ok: true });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = str(body.email).trim().toLowerCase();
    const password = str(body.password);

    if (action === "register") {
      const name = str(body.name).trim();
      if (!name || name.length < 2) return fail("Please enter your name");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Please enter a valid Gmail/email address");
      if (password.length < 6) return fail("Password must be at least 6 characters");
      const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing.length) return fail("An account with this email already exists", 409);
      const freeCredits = (await getAppSetting<number>("freeCredits")) ?? 5;
      const [user] = await db
        .insert(users)
        .values({
          name,
          email,
          passwordHash: hashPassword(password),
          credits: freeCredits,
          apiKey: apiKey(),
        })
        .returning();
      await setSessionCookie({ uid: user.id, email: user.email, role: user.role });
      await log({ userId: user.id, kind: "auth", message: `New account: ${email}` });
      return ok({ user: userDto(user) }, { status: 201 });
    }

    if (action === "login") {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      if (!user || !verifyPassword(password, user.passwordHash)) return fail("Wrong email or password", 401);
      if (user.isBlocked) return fail("This account has been blocked by the administrator", 403);
      await setSessionCookie({ uid: user.id, email: user.email, role: user.role });
      await log({ userId: user.id, kind: "auth", message: `Login: ${email}` });
      return ok({ user: userDto(user) });
    }

    if (action === "reset-request") {
      return ok({ ok: true, message: "Password reset links are sent manually by the admin in this build." });
    }

    return fail("Unknown auth action", 404);
  });
}
