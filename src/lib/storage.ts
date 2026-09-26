import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fileBlobs } from "@/db/schema";

/**
 * Storage backend: Postgres instead of the local filesystem.
 *
 * Free hosting (Render free web service, most serverless platforms) gives no
 * persistent disk — anything written to disk vanishes on the next restart or
 * redeploy. Every caller in this codebase only ever talks to the four
 * functions below (saveUpload / readUpload / saveTrace / readTrace), so the
 * storage location can change here without touching upload/vectorize/export
 * logic or the vectorizer's output.
 */

async function putBlob(path: string, base64: string): Promise<void> {
  await db
    .insert(fileBlobs)
    .values({ path, data: base64 })
    .onConflictDoUpdate({ target: fileBlobs.path, set: { data: base64 } });
}

async function getBlob(path: string): Promise<string | null> {
  const rows = await db.select().from(fileBlobs).where(eq(fileBlobs.path, path)).limit(1);
  return rows[0]?.data ?? null;
}

export async function saveUpload(filename: string, buffer: Buffer): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const rel = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  await putBlob(rel, buffer.toString("base64"));
  return rel;
}

export async function readUpload(rel: string): Promise<Buffer | null> {
  if (!rel) return null;
  const b64 = await getBlob(rel);
  return b64 ? Buffer.from(b64, "base64") : null;
}

/** Writes the trace as one Postgres row — a single UPDATE is already atomic,
 * so two concurrent analyses of the same image can never leave a half-written
 * or corrupted trace behind. */
export async function saveTrace(id: number, trace: unknown): Promise<string> {
  const rel = `traces/trace-${id}.json`;
  await putBlob(rel, Buffer.from(JSON.stringify(trace), "utf8").toString("base64"));
  return rel;
}

export async function readTrace<T>(rel: string | null): Promise<T | null> {
  if (!rel) return null;
  const b64 = await getBlob(rel);
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}
