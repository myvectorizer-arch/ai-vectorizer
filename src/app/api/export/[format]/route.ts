import { handleExport } from "@/lib/export-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Compatibility aliases: POST /api/export/svg | eps | pdf | dxf | png */
export async function POST(request: Request, ctx: { params: Promise<{ format: string }> }) {
  const { format } = await ctx.params;
  return handleExport(request, format);
}
