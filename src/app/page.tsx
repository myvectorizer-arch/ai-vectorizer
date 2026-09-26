import { HeroUpload } from "@/components/HeroUpload";
import { ensureSeed, getAppSettings } from "@/lib/seed";

export const dynamic = "force-dynamic";

const PIPELINE = [
  "Upload",
  "Background Remove",
  "Resize",
  "Noise Remove",
  "Edge Detection",
  "Color Detection",
  "Color Quantization",
  "Corner Detection",
  "Curve Detection",
  "Bezier Curve",
  "Path Generation",
  "SVG Optimization",
  "Export",
];

const FEATURES = [
  {
    title: "7 input formats",
    body: "PNG, JPG, JPEG, WEBP, BMP, GIF and TIFF – transparency, palettes and ICC profiles handled automatically.",
  },
  {
    title: "5 output formats",
    body: "SVG 1.0/1.1/Tiny 1.2/2 · PDF 1.0→2.0 · EPS 1→3 · DXF R12→2021 · PNG. Every historical version selectable.",
  },
  {
    title: "Folder · Batch · Download all",
    body: "Drop an entire folder and vectorize dozens of images at once, then download them all as one .zip package.",
  },
  {
    title: "Full manual control",
    body: "Detail level, corner threshold, noise, smoothness, colour count, curve types, line fit, gap filler and more — the background and every small shape stay exactly as in your image.",
  },
];

export default async function HomePage() {
  await ensureSeed();
  const settings = await getAppSettings();
  const site = (settings.site ?? {}) as Record<string, string>;
  const vectorizer = (settings.vectorizer ?? {}) as Record<string, number>;
  const notices = Array.isArray(settings.notices)
    ? (settings.notices as { id: number; title: string; body: string }[])
    : [];

  return (
    <div className="pb-6">
      <HeroUpload
        title={site.heroTitle ?? "Convert Images to Vectors Online"}
        line1={site.heroLine1 ?? "Vectorize PNG, JPG, GIF, and WebP images to clean SVG, PDF, EPS, and DXF vectors online."}
        line2={site.heroLine2 ?? "AI-powered tracing for logos, illustrations, print, web, CAD, CNC, and design workflows."}
        maxUploadMB={vectorizer.maxUploadMB ?? 25}
        maxBatch={vectorizer.maxBatch ?? 60}
        guestFreeImages={vectorizer.guestFreeImages ?? 3}
        notices={notices}
      />

      <section className="border-y border-[#eceef4] bg-[#fafbfd] py-8">
        <div className="mx-auto max-w-[1180px] px-4">
          <p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-[#6b7280]">The AI pipeline</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {PIPELINE.map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-[#e5e7ee] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#374151]">
                  {step}
                </span>
                {index < PIPELINE.length - 1 && <span className="text-[#c7cbd8]">→</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-5 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-2xl border border-[#eceef4] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h3 className="text-[15px] font-bold text-[#111827]">{feature.title}</h3>
            <p className="mt-2 text-[13.5px] leading-6 text-[#4b5563]">{feature.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
