import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

const COOKIE = "av_session";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET is not set. Refusing to start in production with a guessable session secret."
  );
}
const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "ai-vectorizer-dev-secret-change-me-please-1234567890",
);

export type SessionPayload = { uid: number; email: string; role: string };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function readSessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.uid !== "number") return null;
    return { uid: payload.uid, email: String(payload.email ?? ""), role: String(payload.role ?? "user") };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(COOKIE)?.value);
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  const rows = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  const user = rows[0];
  if (!user || user.isBlocked) return null;
  return syncUserPlan(user);
}

/** Auto-deactivate premium once the paid period runs out (manual-payment model). */
export async function syncUserPlan(user: User): Promise<User> {
  if (user.role === "admin") return user;
  if (!user.planExpiresAt) return user;
  if (user.plan !== "free" && user.planExpiresAt.getTime() < Date.now()) {
    const [updated] = await db
      .update(users)
      .set({ plan: "free", planPeriod: "expired", unlimited: false, folderAccess: false })
      .where(eq(users.id, user.id))
      .returning();
    return updated ?? user;
  }
  return user;
}

export async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export function apiKey(): string {
  return `av_${randomBytes(20).toString("hex")}`;
}

export function hasFolderAccess(user: User | null): boolean {
  return Boolean(user && (user.role === "admin" || user.folderAccess));
}

export function isUnlimited(user: User | null): boolean {
  return Boolean(user && (user.role === "admin" || user.unlimited));
}
