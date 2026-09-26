"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, DownloadIcon, FormatBadge, InfoIcon, LogoIcon } from "@/components/Icons";
import { Label, NumberField, Segmented, Slider, Toggle } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { VectorStage } from "@/components/VectorStage";
import { api, apiRetry, cls, downloadBlob, fetchWithGuest, formatBytes, setAccessToken, shortName, sourceUrl, timeAgo, withToken } from "@/lib/client";
import {
  DEFAULT_SETTINGS,
  FORMAT_META,
  FORMAT_VERSIONS,
  mergeSettings,
  OUTPUT_FORMATS,
  presetValues,
  type OutputFormat,
  type RenderSettings,
  type Settings,
} from "@/lib/vector/types";

type ImageMeta = {
  id: number;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
  svg?: string | null;
};

const DEFAULT_VERSION: Record<OutputFormat, string> = {
  svg: "1.1",
  pdf: "1.7",
  dxf: "2000",
  eps: "3.0",
  png: "1x",
};

export function DownloadClient({
  ids,
  current,
  initialImages = [],
  missing = [],
  canBatch = false,
  accessToken = null,
}: {
  ids: number[];
  current: number;
  initialImages?: ImageMeta[];
  missing?: number[];
  canBatch?: boolean;
  accessToken?: string | null;
}) {
  const { toast, settings: publicSettings } = useApp();
  const [tokenReady, setTokenReady] = useState(!accessToken);
  const [images, setImages] = useState<ImageMeta[]>(initialImages);
  const [unavailable, setUnavailable] = useState<number[]>(missing);
  const [activeId, setActiveId] = useState<number>(current || ids[0] || 0);
  const [selected, setSelected] = useState<number[]>(ids);
  const [format, setFormat] = useState<OutputFormat>("svg");
  const [version, setVersion] = useState<string>(DEFAULT_VERSION.svg);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [preview, setPreview] = useState<string | null>(
    initialImages.find((image) => image.id === (current || initialImages[0]?.id))?.svg ?? initialImages[0]?.svg ?? null,
  );
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cache = useRef(new Map<string, string>());

  const active = images.find((image) => image.id === activeId) ?? images[0];

  useEffect(() => {
    if (accessToken) setAccessToken(accessToken);
    setTokenReady(true);
  }, [accessToken]);

  useEffect(() => {
    if (!tokenReady) return;
    const known = new Set(initialImages.map((image) => image.id));
    const pending = ids.filter((id) => !known.has(id));
    if (!pending.length) {
      if (!ids.includes(activeId) && initialImages.length) setActiveId(initialImages[0].id);
      return;
    }
    (async () => {
      const loaded: ImageMeta[] = [...initialImages];
      const gone: number[] = [];
      for (const id of pending) {
        try {
          const res = await api<{ image: ImageMeta; svg: string | null }>(`/api/images/${id}`);
          loaded.push({ ...res.image, svg: res.svg });
        } catch {
          gone.push(id);
        }
      }
      setImages(loaded);
      if (gone.length) setUnavailable(gone);
      if (!ids.includes(activeId) && loaded.length) setActiveId(loaded[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), tokenReady]);

  const renderKey = useMemo(
    () => `${activeId}|${format}|${version}|${JSON.stringify(settings)}`,
    [activeId, format, version, settings],
  );

  const optimize = useCallback(async () => {
    if (!activeId || !active) return;
    const cached = cache.current.get(renderKey);
    if (cached) {
      setPreview(cached);
      return;
    }
    setUpdating(true);
    try {
      const res = await api<{ svg: string; note: string; renderMs: number }>("/api/optimize", {
        method: "POST",
        body: JSON.stringify({ imageId: activeId, settings, version: format === "svg" ? version : "1.1" }),
      });
      cache.current.set(renderKey, res.svg);
      setPreview(res.svg);
      setNote(res.note);
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes("No analysis cached")) toast(message, "error");
    } finally {
      setUpdating(false);
    }
  }, [active, activeId, format, renderKey, settings, toast, version]);

  // Images that were uploaded but never vectorized (e.g. opened straight from
  // history) are analysed on demand so this page is never a dead end.
  useEffect(() => {
    if (!activeId || active?.svg) return;
    let cancelled = false;
    (async () => {
      setUpdating(true);
      try {
        const res = await apiRetry<{ svg: string }>("/api/vectorize", {
          method: "POST",
          body: JSON.stringify({ imageId: activeId, settings }),
        });
        if (cancelled) return;
        setPreview(res.svg);
        setImages((prev) => prev.map((image) => (image.id === activeId ? { ...image, svg: res.svg } : image)));
      } catch (error) {
        if (!cancelled) toast((error as Error).message, "error");
      } finally {
        if (!cancelled) setUpdating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.svg]);

  useEffect(() => {
    const timer = setTimeout(() => void optimize(), 320);
    return () => clearTimeout(timer);
  }, [optimize]);

  const patch = (partial: Partial<RenderSettings>) => setSettings((prev) => ({ ...prev, ...partial }));
  const patchOutput = (partial: Partial<RenderSettings["outputSize"]>) =>
    setSettings((prev) => ({ ...prev, outputSize: { ...prev.outputSize, ...partial }, preset: "custom" }));

  const applyPreset = (preset: RenderSettings["preset"]) => {
    setSettings((prev) => mergeSettings({ ...prev, ...presetValues(preset) }));
    setAdvancedOpen(preset === "custom");
  };

  const doDownload = async (targetIds: number[]) => {
    if (!targetIds.length) {
      toast("Select at least one image", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchWithGuest("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: targetIds, format, version, settings }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Download failed");
      }
      const blob = await res.blob();
      const filename =
        targetIds.length === 1
          ? `${(active?.filename ?? "vector").replace(/\.[^.]+$/, "")}.${FORMAT_META[format].ext}`
          : `vectorizer-${format}-${targetIds.length}-files.zip`;
      downloadBlob(blob, filename);
      toast(
        targetIds.length === 1 ? `${format.toUpperCase()} saved · ${formatBytes(blob.size)}` : `ZIP with ${targetIds.length} files saved`,
        "success",
      );
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const presets: { id: RenderSettings["preset"]; title: string; body: string }[] = [
    { id: "general", title: "General use (default)", body: "Solid filled shapes grouped to match the original colors. Works well in most design and editing apps." },
    { id: "editing", title: "Easy editing", body: "Shapes are stacked and grouped by color, so you can select, recolor, or delete a whole color at once." },
    { id: "cutting", title: "Cutting & engraving", body: "Outlines only, drawn as thin strokes – ready for laser cutters, vinyl cutters, and engraving tools." },
    { id: "custom", title: "Custom", body: "Your own combination of draw style, stacking, and grouping, set under Advanced settings." },
  ];

  const badgeRow = [
    settings.preset === "custom" ? "Size: Custom" : `Size: ${settings.outputSize.mode}`,
    settings.drawStyle === "filled" ? "Draw: Filled" : settings.drawStyle === "outlines" ? "Draw: Outlines" : "Draw: Edges",
    `Stack: ${settings.stacking === "cutouts" ? "Cut-outs" : "Stacked"}`,
    `Group by: ${settings.groupBy === "none" ? "None" : settings.groupBy}`,
    `Shapes: ${settings.simpleShapes ? "Native" : "Paths"}`,
    `Curves: ${settings.curveTypes.cubic ? "All" : settings.curveTypes.lines ? "Lines" : "Quads"}`,
    `Line fit: ${settings.lineFit === "superFine" ? "Super fine" : settings.lineFit}`,
    `Gap filler ${settings.gapFill.enabled ? "on" : "off"}`,
    `Stroke: ${settings.strokeStyle.width}px ${settings.strokeStyle.constantWidth ? "fixed" : ""}`,
  ];

  const summary = [
    settings.drawStyle === "filled" ? "Filled shapes" : settings.drawStyle === "outlines" ? "Stroked outlines" : "Stroked edges",
    `${settings.lineFit === "superFine" ? "Super fine" : settings.lineFit} line fit`,
    settings.gapFill.enabled ? `gap filler ${settings.gapFill.width}px` : "gap filler off",
    settings.outputSize.mode === "unchanged"
      ? `${active?.width ?? 0} x ${active?.height ?? 0} px`
      : `${settings.outputSize.width} x ${settings.outputSize.height} ${settings.outputSize.unit} (${settings.outputSize.fit})`,
  ].join(" · ");

  return (
    <div className="min-h-screen bg-[#f7f8fb] pb-28">
      <header className="flex items-center gap-3 border-b border-[#e5e7ee] bg-white px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2">
          <LogoIcon size={22} />
          <span className="text-[14px] font-bold">Vectorizer.AI</span>
        </Link>
        <Link
          href={withToken(`/result?ids=${ids.join(",")}`)}
          className="ml-auto rounded-full border border-[#e5e7ee] px-4 py-1.5 text-[12.5px] font-semibold text-[#4b5563] hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
        >
          ← Back to editor
        </Link>
      </header>

      <div className="mx-auto max-w-[1180px] px-4 py-8">
        {unavailable.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#f0d9b5] bg-[#fffaf0] px-5 py-4 text-[13px] text-[#8a5a10]">
            <span className="flex-1">
              {images.length
                ? `${unavailable.length} of these images are no longer available in this browser session.`
                : "These images are no longer available in this browser session — they may have been uploaded from a different browser, or the session expired."}{" "}
              Upload them again to download vectors.
            </span>
            <Link href="/" className="rounded-lg bg-[#3b5bfd] px-4 py-2 text-[12.5px] font-bold text-white">
              Upload images
            </Link>
          </div>
        )}

        <div className="rounded-2xl border border-[#eceef4] bg-white p-6">
          <div className="flex flex-wrap items-start gap-5">
            <div className="checkerboard grid h-[86px] w-[86px] shrink-0 place-items-center overflow-hidden rounded-xl border border-[#eceef4]">
              {preview ? (
                <span className="av-svg-stage h-full w-full p-1" dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <FormatBadge format="psd" size={30} />
              )}
            </div>
            <div className="min-w-[240px] flex-1">
              <h1 className="text-[28px] font-bold leading-tight">Download</h1>
              <p className="mt-1.5 text-[13.5px] text-[#4b5563]">
                {shortName(active?.filename ?? "vector.png", 46)}
                {active ? ` · ${active.width} x ${active.height} px (${(active.width * active.height).toLocaleString()} pixels)` : ""} ·{" "}
                {active ? timeAgo(active.createdAt) : ""}
                {updating ? " · updating preview…" : ""}
              </p>
              {note && <p className="mt-1 text-[12px] text-[#6b7280]">{note}</p>}
            </div>
            <button
              onClick={() => void doDownload(selected)}
              disabled={busy || !images.length}
              className="flex items-center gap-2 rounded-xl bg-[#3b5bfd] px-7 py-3 text-[13px] font-bold uppercase tracking-wide text-white shadow-[0_10px_26px_rgba(59,91,253,0.32)] transition hover:bg-[#2f4ae0] disabled:opacity-60"
            >
              <DownloadIcon width={17} height={17} />
              {busy ? "Preparing…" : selected.length > 1 ? `Download ${selected.length} files` : "Download"}
            </button>
          </div>

          {images.length > 1 && (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#f1f2f6] pt-4">
              <span className="text-[12.5px] font-semibold text-[#374151]">Batch:</span>
              {images.map((image) => {
                const on = selected.includes(image.id);
                return (
                  <button
                    key={image.id}
                    onClick={() => setSelected((prev) => (on ? prev.filter((v) => v !== image.id) : [...prev, image.id]))}
                    className={cls(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium",
                      on ? "border-[#3b5bfd] bg-[#eef2ff] text-[#2f4ae0]" : "border-[#e5e7ee] text-[#6b7280]",
                    )}
                  >
                    {on && <CheckIcon width={13} height={13} />}
                    {shortName(image.filename, 22)}
                  </button>
                );
              })}
              <button
                onClick={() => setSelected(selected.length === images.length ? [] : images.map((i) => i.id))}
                className="ml-auto text-[12px] font-semibold text-[#3b5bfd] underline"
              >
                {selected.length === images.length ? "clear all" : "select all"}
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <section>
              <div className="flex items-center gap-2">
                <Label text="File format" />
                <InfoIcon width={14} height={14} className="text-[#9ca3af]" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {OUTPUT_FORMATS.map((id) => {
                  const meta = FORMAT_META[id];
                  const activeFormat = format === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setFormat(id);
                        setVersion(DEFAULT_VERSION[id]);
                      }}
                      className={cls(
                        "relative flex flex-col items-center gap-2 rounded-xl border-2 bg-white px-3 py-4 transition",
                        activeFormat ? "border-[#3b5bfd] shadow-[0_6px_18px_rgba(59,91,253,0.14)]" : "border-[#e5e7ee] hover:border-[#c7d2fe]",
                      )}
                    >
                      {activeFormat && (
                        <span className="absolute -top-2.5 -right-2.5 grid h-6 w-6 place-items-center rounded-full bg-[#3b5bfd] text-white">
                          <CheckIcon width={14} height={14} />
                        </span>
                      )}
                      <FormatBadge format={id} size={34} />
                      <span className={cls("text-[14px] font-bold", activeFormat ? "text-[#3b5bfd]" : "text-[#374151]")}>
                        {meta.label}
                      </span>
                      <span className="text-[11.5px] text-[#6b7280]">{meta.audience}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-[#eceef4] bg-white p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label
                    text={`${FORMAT_META[format].label} version`}
                    info="Older versions are more compatible, newer versions support opacity, arcs and modern attributes."
                  />
                  <div className="flex flex-wrap gap-1 rounded-xl bg-[#f4f5f9] p-1">
                    {FORMAT_VERSIONS[format].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setVersion(option.id)}
                        className={cls(
                          "rounded-lg px-3 py-1.5 text-[12px] font-semibold transition",
                          version === option.id ? "bg-[#3b5bfd] text-white" : "text-[#4b5563] hover:bg-white",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Toggle
                    label="Fixed size"
                    checked={settings.outputSize.mode === "custom"}
                    onChange={(v) =>
                      patchOutput({ mode: v ? "custom" : "unchanged", width: active?.width ?? 7000, height: active?.height ?? 4000 })
                    }
                  />
                </div>
                <p className="mt-3 text-[12px] text-[#6b7280]">
                  {FORMAT_VERSIONS[format].find((v) => v.id === version)?.note ??
                    (format === "dxf"
                      ? "DXF R12–R13 use classic POLYLINE entities; R14+ get LWPOLYLINE and SOLID HATCH fills (ideal for CAD & CNC)."
                      : format === "pdf"
                        ? "PDF 1.4 and newer embed transparency; older versions flatten paths for maximum compatibility."
                        : "SVG 1.1 is the safe web standard used by every browser and editor.")}
                </p>
              </div>
            </section>

            <section>
              <Label text="Optimize for" />
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {presets.map((preset) => {
                  const activePreset = settings.preset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset.id)}
                      className={cls(
                        "relative rounded-xl border-2 bg-white p-4 text-left transition",
                        activePreset ? "border-[#3b5bfd]" : "border-[#e5e7ee] hover:border-[#c7d2fe]",
                      )}
                    >
                      {activePreset && (
                        <span className="absolute -top-2.5 -right-2.5 grid h-6 w-6 place-items-center rounded-full bg-[#3b5bfd] text-white">
                          <CheckIcon width={14} height={14} />
                        </span>
                      )}
                      <p className={cls("text-[13.5px] font-bold", activePreset ? "text-[#3b5bfd]" : "text-[#111827]")}>
                        {preset.title}
                      </p>
                      <p className="mt-1.5 text-[11.5px] leading-5 text-[#6b7280]">{preset.body}</p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-[#6b7280]">
                Presets set draw style, shape stacking, and grouping for you — tweak any of it under Advanced.
              </p>
            </section>

            <section className="rounded-2xl border border-[#eceef4] bg-white">
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <ChevronDownIcon width={16} height={16} className={cls("transition", advancedOpen ? "" : "-rotate-90")} />
                <span className="text-[15px] font-bold">Advanced</span>
                <span className="ml-2 flex flex-wrap gap-1.5">
                  {badgeRow.map((badge) => (
                    <span key={badge} className="rounded-full bg-[#f4f5f9] px-2.5 py-1 text-[11px] font-semibold text-[#4b5563]">
                      {badge}
                    </span>
                  ))}
                </span>
              </button>

              {advancedOpen && (
                <div className="space-y-7 border-t border-[#f1f2f6] px-5 py-5">
                  <div className="space-y-3">
                    <Label text="Output size" info="Documents/print units are converted exactly (96dpi for px, 72pt per inch)." />
                    <Segmented
                      value={settings.outputSize.mode}
                      options={[
                        { id: "unchanged", label: "Unchanged" },
                        { id: "custom", label: "Custom" },
                        { id: "scaled", label: "Scaled" },
                      ]}
                      onChange={(mode) => setSettings((prev) => ({ ...prev, outputSize: { ...prev.outputSize, mode } }))}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        label="Width"
                        value={settings.outputSize.width}
                        min={1}
                        onChange={(width) => patchOutput({ width })}
                      />
                      <NumberField
                        label="Height"
                        value={settings.outputSize.height}
                        min={1}
                        onChange={(height) => patchOutput({ height })}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Segmented
                        size="sm"
                        value={settings.outputSize.unit}
                        options={[
                          { id: "px", label: "px" },
                          { id: "in", label: "in" },
                          { id: "cm", label: "cm" },
                          { id: "mm", label: "mm" },
                          { id: "pt", label: "pt" },
                        ]}
                        onChange={(unit) => patchOutput({ unit })}
                      />
                      <button
                        onClick={() =>
                          patchOutput({ width: active?.width ?? 7000, height: active?.height ?? 4000, mode: "custom" })
                        }
                        className="rounded-lg border border-[#e5e7ee] px-3 py-1.5 text-[12px] font-semibold text-[#4b5563] hover:border-[#3b5bfd]"
                      >
                        Auto from source
                      </button>
                      <NumberField
                        label="Scale"
                        value={settings.outputSize.scale}
                        min={0.05}
                        max={40}
                        step={0.05}
                        suffix="x"
                        onChange={(scale) => setSettings((prev) => ({ ...prev, outputSize: { ...prev.outputSize, scale, mode: "scaled" } }))}
                      />
                    </div>
                    <p className="text-[12px] text-[#6b7280]">
                      {settings.outputSize.mode === "unchanged"
                        ? `Fits in the original ${active?.width ?? 0} x ${active?.height ?? 0} px box.`
                        : `Fits in the ${settings.outputSize.width} x ${settings.outputSize.height} ${settings.outputSize.unit} box, with padding.`}
                    </p>
                    <Label text="If the shapes differ" />
                    <Segmented
                      value={settings.outputSize.fit}
                      options={[
                        { id: "inside", label: "Fit inside" },
                        { id: "crop", label: "Crop to fill" },
                        { id: "stretch", label: "Stretch" },
                      ]}
                      onChange={(fit) => patchOutput({ fit })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        label="Horizontal"
                        value={settings.outputSize.horizontal}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(horizontal) => patchOutput({ horizontal })}
                      />
                      <NumberField
                        label="Vertical"
                        value={settings.outputSize.vertical}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(vertical) => patchOutput({ vertical })}
                      />
                    </div>
                    <p className="text-[12px] text-[#6b7280]">
                      Where to place the image when it doesn&apos;t exactly fill the box: 0 is left/top, 0.5 is centered, 1 is right/bottom.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label text="Draw style" info="Filled shapes paint solid colour, outlines/edges stroke the path only (laser + CAD friendly)." />
                    <Segmented
                      value={settings.drawStyle}
                      options={[
                        { id: "filled", label: "Filled shapes" },
                        { id: "outlines", label: "Stroked outlines" },
                        { id: "edges", label: "Stroked edges" },
                      ]}
                      onChange={(drawStyle) => setSettings((prev) => ({ ...prev, drawStyle, preset: "custom" }))}
                    />
                    <p className="text-[12px] text-[#6b7280]">
                      {settings.drawStyle === "filled"
                        ? "Each shape is filled with its solid color."
                        : "Paths are stroked with the stroke style below – ideal for cutters and pen plotters."}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label
                      text="Shape stacking"
                      info="Cut-outs keeps real holes so colours never overlap and line art stays intact (recommended). Stacked draws shapes on top of each other without holes – use it only for solid logos without enclosed details."
                    />
                    <Segmented
                      value={settings.stacking}
                      options={[
                        { id: "cutouts", label: "Cut-outs" },
                        { id: "stacked", label: "Stacked" },
                      ]}
                      onChange={(stacking) => setSettings((prev) => ({ ...prev, stacking, preset: "custom" }))}
                    />
                    <p className="text-[12px] text-[#6b7280]">
                      {settings.stacking === "cutouts"
                        ? "Shapes are placed in cut-outs in the shapes below them, so colours don't overlap."
                        : "Shapes are drawn on top of each other without holes – enclosed details (grid cells, ring centres, letter counters) are redrawn as a final layer so they stay visible."}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label text="Group by" info="Groups make editing easier in Illustrator, Inkscape and Figma." />
                    <Segmented
                      value={settings.groupBy}
                      options={[
                        { id: "none", label: "None" },
                        { id: "color", label: "Color" },
                        { id: "parent", label: "Parent" },
                        { id: "layer", label: "Layer" },
                      ]}
                      onChange={(groupBy) => setSettings((prev) => ({ ...prev, groupBy, preset: "custom" }))}
                    />
                  </div>

                  <div className="space-y-3">
                    <Toggle
                      label="Simple shapes – represent simple shapes as circles, ellipses, and rectangles"
                      checked={settings.simpleShapes}
                      onChange={(simpleShapes) => setSettings((prev) => ({ ...prev, simpleShapes, preset: "custom" }))}
                    />
                    <p className="text-[12px] text-[#6b7280]">
                      When unchecked, detected shapes are flattened to plain paths (maximum editor compatibility).
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label text="Allowed curve types" info="Restrict the segment types written into the document." />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Toggle
                        label="Lines"
                        checked={settings.curveTypes.lines}
                        onChange={(lines) => setSettings((prev) => ({ ...prev, curveTypes: { ...prev.curveTypes, lines }, preset: "custom" }))}
                      />
                      <Toggle
                        label="Quadratic Bezier curves"
                        checked={settings.curveTypes.quadratic}
                        onChange={(quadratic) =>
                          setSettings((prev) => ({ ...prev, curveTypes: { ...prev.curveTypes, quadratic }, preset: "custom" }))
                        }
                      />
                      <Toggle
                        label="Cubic Bezier curves"
                        checked={settings.curveTypes.cubic}
                        onChange={(cubic) => setSettings((prev) => ({ ...prev, curveTypes: { ...prev.curveTypes, cubic }, preset: "custom" }))}
                      />
                      <Toggle
                        label="Circular arcs"
                        checked={settings.curveTypes.circularArcs}
                        onChange={(circularArcs) =>
                          setSettings((prev) => ({ ...prev, curveTypes: { ...prev.curveTypes, circularArcs }, preset: "custom" }))
                        }
                      />
                      <Toggle
                        label="Elliptical arcs"
                        checked={settings.curveTypes.ellipticalArcs}
                        onChange={(ellipticalArcs) =>
                          setSettings((prev) => ({ ...prev, curveTypes: { ...prev.curveTypes, ellipticalArcs }, preset: "custom" }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label text="Line fit" info="How closely lines track the traced edge. Finer = more points, larger file." />
                    <Segmented
                      value={settings.lineFit}
                      options={[
                        { id: "coarse", label: "Coarse" },
                        { id: "medium", label: "Medium" },
                        { id: "fine", label: "Fine" },
                        { id: "superFine", label: "Super Fine" },
                      ]}
                      onChange={(lineFit) => setSettings((prev) => ({ ...prev, lineFit, preset: "custom" }))}
                    />
                    <p className="text-[12px] text-[#6b7280]">
                      Lines stay within 0.4px–1.8px of the original curve. Medium is the cleanest; Fine and Super Fine follow
                      the source outline more literally (including its anti-aliasing), which can add small edge pieces on
                      heavily compressed JPEGs.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label text="Gap filler" info="Draws thin strokes along shape edges to hide hairline gaps some renderers show between shapes." />
                    <Toggle
                      label="Fill gaps"
                      checked={settings.gapFill.enabled}
                      onChange={(enabled) => setSettings((prev) => ({ ...prev, gapFill: { ...prev.gapFill, enabled } }))}
                    />
                    <div className="pl-6">
                      <Toggle
                        label="Clip strokes to the image bounds"
                        checked={settings.gapFill.clipBounds}
                        disabled={!settings.gapFill.enabled}
                        onChange={(clipBounds) => setSettings((prev) => ({ ...prev, gapFill: { ...prev.gapFill, clipBounds } }))}
                      />
                    </div>
                    <div className="pl-6">
                      <Toggle
                        label="Keep stroke width constant when scaled"
                        checked={settings.gapFill.constantWidth}
                        disabled={!settings.gapFill.enabled}
                        onChange={(constantWidth) => setSettings((prev) => ({ ...prev, gapFill: { ...prev.gapFill, constantWidth } }))}
                      />
                    </div>
                    <div className="max-w-[200px] pl-6">
                      <NumberField
                        label="Stroke width (px)"
                        value={settings.gapFill.width}
                        min={0.1}
                        max={20}
                        step={0.1}
                        onChange={(width) => setSettings((prev) => ({ ...prev, gapFill: { ...prev.gapFill, width } }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label text="Stroke style" info="Applies when the draw style uses outlines or edges." />
                    <Toggle
                      label="Keep stroke width constant when scaled"
                      checked={settings.strokeStyle.constantWidth}
                      onChange={(constantWidth) => setSettings((prev) => ({ ...prev, strokeStyle: { ...prev.strokeStyle, constantWidth } }))}
                    />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <NumberField
                        label="Stroke width (px)"
                        value={settings.strokeStyle.width}
                        min={0.1}
                        max={20}
                        step={0.1}
                        onChange={(width) => setSettings((prev) => ({ ...prev, strokeStyle: { ...prev.strokeStyle, width } }))}
                      />
                      <label className="space-y-1.5">
                        <span className="block text-[13px] font-semibold text-[#374151]">Stroke color</span>
                        <input
                          type="color"
                          value={settings.strokeStyle.color}
                          onChange={(e) => setSettings((prev) => ({ ...prev, strokeStyle: { ...prev.strokeStyle, color: e.target.value, singleColor: true } }))}
                          className="h-[38px] w-full rounded-lg border border-[#dcdfe8]"
                        />
                      </label>
                      <div className="flex items-end">
                        <Toggle
                          label="Use one color for all strokes"
                          checked={settings.strokeStyle.singleColor}
                          onChange={(singleColor) => setSettings((prev) => ({ ...prev, strokeStyle: { ...prev.strokeStyle, singleColor } }))}
                        />
                      </div>
                    </div>
                  </div>

                  <Slider
                    label="Opacity"
                    value={settings.opacity}
                    min={0.1}
                    max={1}
                    step={0.05}
                    info="Applied to every shape. Requires SVG 1.1+, PDF 1.4+ or EPS 3.0."
                    onChange={(opacity) => setSettings((prev) => ({ ...prev, opacity }))}
                  />
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <div className="sticky top-4 space-y-4">
              <VectorStage
                svg={preview}
                originalUrl={active ? sourceUrl(active.id) : null}
                width={active?.width || 640}
                height={active?.height || 480}
                mode="vector"
                transparent={settings.ignoreBackground}
                label={updating ? "Re-optimizing…" : note}
                onDownload={() => void doDownload(selected)}
              />
              <div className="rounded-2xl border border-[#eceef4] bg-white p-4 text-[12.5px] text-[#4b5563]">
                <p className="font-semibold text-[#111827]">
                  You&apos;ll get{" "}
                  <span className="text-[#3b5bfd]">
                    {shortName((active?.filename ?? "vector").replace(/\.[^.]+$/, ""), 32)}.{FORMAT_META[format].ext}
                  </span>
                </p>
                <p className="mt-1.5">{summary}</p>
                <p className="mt-2 text-[11.5px] text-[#6b7280]">
                  {selected.length > 1
                    ? canBatch
                      ? `Batch export: ${selected.length} files are packed into a single .zip (up to ${
                          publicSettings?.limits?.maxBatch ?? 60
                        } images).`
                      : "Batch .zip download needs Standard Unlimited ($25) — pick a single image or upgrade on the pricing page."
                    : "Single file download. Change settings to see the SVG preview update instantly."}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[#e5e7ee] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-4 px-4 py-3">
          <div className="min-w-[220px] flex-1 text-[12.5px] text-[#4b5563]">
            <span className="font-semibold text-[#111827]">
              You&apos;ll get {shortName((active?.filename ?? "vector").replace(/\.[^.]+$/, ""), 30)}.{FORMAT_META[format].ext}
            </span>
            <span className="ml-2 text-[#6b7280]">{summary}</span>
          </div>
          <button
            onClick={() => {
              setSettings(DEFAULT_SETTINGS);
              setVersion(DEFAULT_VERSION[format]);
              cache.current.clear();
              toast("Settings reset to defaults", "info");
            }}
            className="rounded-lg border border-[#e5e7ee] px-4 py-2 text-[12.5px] font-semibold text-[#4b5563] hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
          >
            Reset
          </button>
          <button
            onClick={() => void doDownload(selected)}
            disabled={busy || !images.length}
            className="flex items-center gap-2 rounded-xl bg-[#3b5bfd] px-6 py-2.5 text-[13px] font-bold uppercase tracking-wide text-white disabled:opacity-60"
          >
            <DownloadIcon width={17} height={17} /> {busy ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
