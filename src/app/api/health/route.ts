import { eq } from "drizzle-orm";
import { db } from "@/db";
import { images } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(images)) as { count: number }[];
    return Response.json({
      status: "ok",
      service: "ai-vectorizer",
      database: "connected",
      images: count,
      engine: "potrace-style contour tracing + k-means colour quantization (TS/OpenCV-class pipeline)",
      formats: ["svg", "eps", "pdf", "dxf", "png"],
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { status: "degraded", database: "error", error: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
export const revalidate = 0;
// keeps drizzle import used even if the table lookup changes
void images;
void eq;
