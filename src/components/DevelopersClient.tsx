"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyIcon } from "@/components/Icons";
import { Card, SectionTitle } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { api, formatDate } from "@/lib/client";

type KeyRow = { id: number; key: string; label: string; isActive: boolean; requestCount: number; createdAt: string };

const ENDPOINTS = [
  { method: "POST", path: "/api/upload", body: "multipart: files[], folder=0|1", desc: "Validates + stores images (PNG/JPG/JPEG/WEBP/BMP/GIF/TIFF) and returns image ids." },
  { method: "POST", path: "/api/vectorize", body: '{ imageId, settings }', desc: "Runs the full AI pipeline and caches the trace for instant re-rendering." },
  { method: "POST", path: "/api/optimize", body: '{ imageId, settings }', desc: "Re-renders the SVG from the cached trace (no decode, no k-means) – used for live preview." },
  { method: "POST", path: "/api/export", body: '{ ids[], format, version, settings }', desc: "SVG · EPS · PDF · DXF · PNG. Multiple ids are returned as a .zip." },
  { method: "POST", path: "/api/export/svg", body: "{ ids, version, settings }", desc: "Alias for SVG export (also /eps, /pdf, /dxf, /png)." },
  { method: "GET", path: "/api/history", body: "?favorites=1&limit=60", desc: "History + favorite flags for the signed-in user (guests get their cookie session)." },
  { method: "DELETE", path: "/api/history", body: "?id=12 | ?all=1", desc: "Delete one entry or clear the whole history." },
  { method: "POST", path: "/api/auth/login", body: "{ email, password }", desc: "JWT session cookie (30 days)." },
  { method: "POST", path: "/api/auth/register", body: "{ name, email, password }", desc: "Creates the account with free credits and an API key." },
  { method: "GET", path: "/api/auth/google", body: "—", desc: "Google OAuth redirect (needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." },
  { method: "POST", path: "/api/payment", body: "{ planSlug, method, senderNumber, transactionId }", desc: "Manual bKash / Nagad payment request → admin approval queue." },
  { method: "POST", path: "/api/support", body: "{ name, email, subject, message, category }", desc: "Creates a support ticket that appears in the admin panel." },
  { method: "GET", path: "/api/plans", body: "—", desc: "Public pricing plans (admin editable)." },
  { method: "GET", path: "/api/health", body: "—", desc: "Health + database + engine status." },
];

export function DevelopersClient() {
  const { user, refresh, toast } = useApp();
  const [keys, setKeys] = useState<KeyRow[]>([]);

  useEffect(() => {
    if (!user) return;
    api<{ keys: KeyRow[] }>("/api/api-keys")
      .then((res) => setKeys(res.keys ?? []))
      .catch(() => undefined);
  }, [user]);

  const key = keys.find((k) => k.isActive)?.key ?? user?.apiKey ?? "av_your_api_key";

  const curl = `curl -X POST http://localhost:3000/api/vectorize \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${key}" \\
  -d '{"imageId": 12, "settings": {"detailLevel": 8, "colorCount": 10}}'`;

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10">
      <header className="max-w-[760px]">
        <h1 className="text-[clamp(1.8rem,4.2vw,2.6rem)] font-bold tracking-tight">Developers & API</h1>
        <p className="mt-4 text-[15.5px] leading-7 text-[#4b5563]">
          Every feature in the UI is a plain JSON endpoint. Authenticate with your session cookie or an <code className="rounded bg-[#f4f5f9] px-1.5 py-0.5 text-[13px]">x-api-key</code> header
          to run the vectorizer from your own automation, print shop or CNC workflow.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>Endpoints</SectionTitle>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">Method</th>
                    <th className="py-2">Path</th>
                    <th className="py-2">Body / query</th>
                    <th className="py-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((endpoint) => (
                    <tr key={endpoint.path + endpoint.method} className="border-t border-[#f1f2f6]">
                      <td className="py-2">
                        <span className="rounded-md bg-[#eef2ff] px-2 py-0.5 text-[10.5px] font-bold text-[#2f4ae0]">
                          {endpoint.method}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-[11.5px] font-semibold">{endpoint.path}</td>
                      <td className="py-2 font-mono text-[11px] text-[#6b7280]">{endpoint.body}</td>
                      <td className="py-2 text-[#4b5563]">{endpoint.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle>AI settings you can send</SectionTitle>
            <div className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
              {[
                "detailLevel 0-10 · working resolution + sensitivity",
                "colorCount 2-32 · k-means palette size",
                "noise 0-10 · speckle & grain removal",
                "cornerThreshold 20-160° · corner preservation",
                "smoothness 0-6 · contour easing passes",
                "curvePrecision 0.2-3px · fit tolerance",
                "posterize / ignoreBackground / transparent booleans",
                "edgeSoften 0-8 · morphological closing strength",
                "minShapeArea 2-400 px² · noise floor",
                "curveTypes { lines, quadratic, cubic, circularArcs, ellipticalArcs }",
                "lineFit coarse | medium | fine | superFine",
                "drawStyle filled | outlines | edges, stacking cutouts | stacked",
              ].map((item) => (
                <span key={item} className="rounded-lg bg-[#fafbfd] px-3 py-2 font-mono text-[11.5px] text-[#374151]">
                  {item}
                </span>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionTitle>Your API key</SectionTitle>
            {user ? (
              <>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#eceef4] px-3 py-2">
                  <code className="flex-1 truncate text-[12px]">{key}</code>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(key);
                      toast("API key copied", "success");
                    }}
                    className="rounded-lg border border-[#e5e7ee] p-1.5 text-[#4b5563]"
                  >
                    <CopyIcon width={14} height={14} />
                  </button>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await api<{ key: KeyRow }>("/api/api-keys", { method: "POST" });
                      setKeys((prev) => [{ ...res.key, requestCount: 0 }, ...prev]);
                      await refresh();
                      toast("New API key generated", "success");
                    } catch (error) {
                      toast((error as Error).message, "error");
                    }
                  }}
                  className="mt-3 w-full rounded-xl bg-[#111827] px-4 py-2.5 text-[12.5px] font-bold text-white"
                >
                  Rotate key
                </button>
                <div className="mt-3 space-y-2 text-[12px]">
                  {keys.map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-lg bg-[#fafbfd] px-3 py-2">
                      <span className="truncate font-mono text-[11px]">{row.key.slice(0, 18)}…</span>
                      <span className="text-[#6b7280]">{row.requestCount} calls · {formatDate(row.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3 text-[13px] text-[#4b5563]">
                <p>Log in to generate an API key and track usage per key.</p>
                <Link href="/login" className="inline-block rounded-xl bg-[#3b5bfd] px-5 py-2.5 text-[12.5px] font-bold text-white">
                  Log in
                </Link>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Quick start</SectionTitle>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-[11.5px] leading-5 text-[#d6e4ff]">{curl}</pre>
            <p className="mt-3 text-[12px] leading-6 text-[#6b7280]">
              SVG, EPS, PDF, DXF and PNG are all produced from the same cached trace, so exporting five formats costs one
              analysis. Multi-image exports return a zipped package with a settings.json manifest.
            </p>
          </Card>

          <Card>
            <SectionTitle>Pipeline (13 stages)</SectionTitle>
            <ol className="mt-3 space-y-1.5 text-[12px] text-[#4b5563]">
              {[
                "Upload & validation (signature + virus-pattern scan)",
                "Background removal (border flood fill + alpha)",
                "Resize to the work resolution from detail level",
                "Noise removal (edge-preserving smoothing)",
                "Posterize (optional)",
                "K-means colour quantisation",
                "Edge detection (marching-square boundary linking)",
                "Morphological open/close + despeckle components",
                "Corner detection with local windows",
                "Curve detection (line / arc / ellipse tests)",
                "Bezier fitting (Schneider, per-corner runs)",
                "Path generation + nesting for cut-out holes",
                "Optimisation + export (SVG/EPS/PDF/DXF/PNG)",
              ].map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="font-bold text-[#3b5bfd]">{index + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
