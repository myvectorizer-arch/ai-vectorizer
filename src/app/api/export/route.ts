import { handleExport } from "@/lib/export-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleExport(request);
}
