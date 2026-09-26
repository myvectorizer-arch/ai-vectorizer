"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FitIcon,
  GridIcon,
  HeartIcon,
  ImagesIcon,
  LogoIcon,
  RotateIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  TransparentIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/components/Icons";
import { Label, SectionTitle, Segmented, Slider, Toggle } from "@/components/Controls";
import { ProcessModal } from "@/components/ProcessModal";
import { useApp } from "@/components/Providers";
import { api, apiRetry, cls, fetchWithGuest, formatBytes, logEvent, setAccessToken, shortName, sourceUrl, withToken } from "@/lib/client";
import { CLEANUP_PRESETS, DEFAULT_SETTINGS, type Settings } from "@/lib/vector/types";

type Item = {
  id: number;
  missing?: boolean;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: "queued" | "processing" | "ready" | "error";
  svg: string | null;
  stats: Record<string, unknown> | null;
  error?: string;
  favorite?: boolean;
};

type ServerItem = {
  id: number;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: string;
  svg: string | null;
  favorite: boolean;
  stats: Record<string, unknown> | null;
};

type VectorizeResponse = {
  image: { id: number; favorite: boolean };
  svg: string;
  stats: Record<string, unknown>;
  remainingCredits: number;
  unlimited: boolean;
  durationMs: number;
};

/** vectorizer.ai style result view: one canvas, one compact toolbar. */
export function ResultClient({
  initialIds,
  initialItems = [],
  missing = [],
  accessToken = null,
}: {
  initialIds: number[];
  initialItems?: ServerItem[];
  missing?: number[];
  accessToken?: string | null;
}) {
  const { user, setUser, toast } = useApp();
  const [tokenReady, setTokenReady] = useState(!accessToken);
  useEffect(() => {
    if (accessToken) setAccessToken(accessToken);
    setTokenReady(true);
  }, [accessToken]);

  const [items, setItems] = useState<Item[]>(() => {
    const fromServer = new Map(initialItems.map((item) => [item.id, item]));
    return initialIds.map((id) => {
      const server = fromServer.get(id);
      if (server) {
        return {
          id: server.id,
          filename: server.filename,
          width: server.width,
          height: server.height,
          sizeBytes: server.sizeBytes,
          status: server.svg ? "ready" : server.status === "error" ? "error" : "queued",
          svg: server.svg,
          stats: server.stats,
          favorite: server.favorite,
        };
      }
      return {
        id,
        missing: true,
        filename: `Image #${id}`,
        width: 0,
        height: 0,
        sizeBytes: 0,
        status: "error" as const,
        svg: null,
        stats: null,
        error: "This image is no longer available to this browser session.",
      };
    });
  });
  const [currentId, setCurrentId] = useState<number>(initialItems[0]?.id ?? initialIds[0] ?? 0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<"vector" | "original" | "compare">("vector");
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [progress, setProgress] = useState({ upload: 100, process: 0, fetch: 0 });
  const [statusText, setStatusText] = useState("");
  const [notice, setNotice] = useState<string | null>(
    missing.length ? "These images are no longer available in this browser session." : null,
  );
  const [warning, setWarning] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thumbsOpen, setThumbsOpen] = useState(true);
  // The background stays part of the artwork, so the canvas shows the real
  // background by default. The transparency grid is only a viewer aid.
  const [transparentBg, setTransparentBg] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const cache = useRef(new Map<string, { svg: string; stats: Record<string, unknown> }>());
  const busyRef = useRef(false);
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const current = items.find((item) => item.id === currentId) ?? items[0];
  const readyCount = items.filter((i) => i.status === "ready").length;

  const updateItem = useCallback((id: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const runVectorize = useCallback(
    async (ids: number[], activeSettings: Settings) => {
      if (!ids.length || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setModalOpen(ids.length > 1);
      let done = 0;
      for (const id of ids) {
        const key = `${id}|${JSON.stringify(activeSettings)}`;
        const cached = cache.current.get(key);
        updateItem(id, { status: "processing" });
        setStatusText(`Tracing image ${done + 1} of ${ids.length}…`);
        setProgress({ upload: 100, process: Math.round((done / ids.length) * 100), fetch: Math.round((done / Math.max(1, ids.length)) * 60) });
        if (cached) {
          updateItem(id, { status: "ready", svg: cached.svg, stats: cached.stats });
          done += 1;
          continue;
        }
        try {
          const res = await apiRetry<VectorizeResponse>("/api/vectorize", {
            method: "POST",
            body: JSON.stringify({ imageId: id, settings: activeSettings }),
          });
          cache.current.set(key, { svg: res.svg, stats: res.stats });
          updateItem(id, { status: "ready", svg: res.svg, stats: res.stats, favorite: res.image.favorite });
          setWarning((res.stats.warning as string | undefined) ?? null);
          if (user) setUser({ ...user, credits: res.remainingCredits, unlimited: res.unlimited });
          logEvent(`Vectorized image #${id}`, "api", { durationMs: res.durationMs });
        } catch (error) {
          const err = error as Error & { status?: number };
          const knownToServer = (items.find((item) => item.id === id)?.width ?? 0) > 0;
          const gone = !knownToServer && err.message.toLowerCase().includes("not found");
          updateItem(id, {
            status: "error",
            error: gone ? "This image is no longer available to this browser session." : err.message,
            missing: gone,
          });
          toast(err.message, "error");
        }
        done += 1;
      }
      setProgress({ upload: 100, process: 100, fetch: 100 });
      setStatusText("Done");
      setModalOpen(false);
      setBusy(false);
      busyRef.current = false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setUser, toast, updateItem, user],
  );

  // initial load: fetch metadata + any missing SVGs
  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    (async () => {
      const need: number[] = [];
      const known = new Set(items.filter((item) => item.svg).map((item) => item.id));
      for (const id of initialIds) {
        if (known.has(id) || missing.includes(id)) continue;
        try {
          const res = await api<{
            image: { id: number; filename: string; width: number; height: number; sizeBytes: number; favorite: boolean; status: string };
            svg: string | null;
            stats: Record<string, unknown> | null;
          }>(`/api/images/${id}`);
          if (cancelled) return;
          updateItem(id, {
            filename: res.image.filename,
            width: res.image.width,
            height: res.image.height,
            sizeBytes: res.image.sizeBytes,
            favorite: res.image.favorite,
            svg: res.svg,
            stats: res.stats,
            status: res.svg ? "ready" : "queued",
          });
          if (!res.svg) need.push(id);
        } catch (error) {
          const message = (error as Error).message;
          updateItem(id, {
            status: "error",
            missing: message.toLowerCase().includes("not found"),
            error: message.toLowerCase().includes("not found") ? "This image is no longer available to this browser session." : message,
          });
        }
      }
      if (need.length && !cancelled) void runVectorize(need, settings);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIds.join(","), tokenReady]);

  // debounced re-analysis when the tracing settings change
  const baseKey = useMemo(
    () =>
      JSON.stringify([
        settings.detailLevel,
        settings.colorCount,
        settings.noise,
        settings.cornerThreshold,
        settings.smoothness,
        settings.curvePrecision,
        settings.posterize,
        settings.ignoreBackground,
        settings.transparent,
        settings.edgeSoften,
        settings.minShapeArea,
        settings.cleanup,
      ]),
    [settings],
  );
  const lastBase = useRef(baseKey);
  useEffect(() => {
    if (lastBase.current === baseKey) return;
    lastBase.current = baseKey;
    if (!currentId) return;
    const timer = setTimeout(() => void runVectorize([currentId], settings), 750);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  const patch = (partial: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...partial }));

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  const width = current?.width || 640;
  const height = current?.height || 480;
  const fitScale = useMemo(() => Math.max(0.05, Math.min(1000 / width, 620 / height, 1.6)), [width, height]);
  const scale = fitScale * zoom;

  const downloadOne = async (format: string) => {
    if (!current) return;
    try {
      const res = await fetchWithGuest("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [current.id], format, settings }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${current.filename.replace(/\.[^.]+$/, "")}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast(`${format.toUpperCase()} downloaded`, "success");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const toolBtn = (title: string, onClick: () => void, icon: React.ReactNode, active = false) => (
    <button
      key={title}
      title={title}
      onClick={onClick}
      className={cls(
        "grid h-9 w-10 place-items-center rounded-md text-[#4b5563] transition hover:bg-[#f1f2f6] hover:text-[#111827]",
        active && "bg-[#eef2ff] text-[#3b5bfd]",
      )}
    >
      {icon}
    </button>
  );

  const stats = current?.stats as { shapes?: number; colors?: number; bytes?: number } | null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ── toolbar (vectorizer.ai style) ─────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-[#e5e7ee] bg-white px-3 py-2">
        <span className="relative grid h-9 w-10 place-items-center rounded-md text-[#4b5563] hover:bg-[#f1f2f6]" title={`${items.length} image(s)`}>
          <ImagesIcon width={19} height={19} />
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#3b5bfd] px-1 text-[10px] font-bold text-white">
            {items.length}
          </span>
        </span>
        {toolBtn("New upload", () => window.location.assign("/"), <UploadIcon width={19} height={19} />)}
        {toolBtn(
          "Re-trace",
          () => void runVectorize([currentId], settings),
          <RotateIcon width={19} height={19} />,
        )}
        {toolBtn(
          "Fit to screen",
          () => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
            setRotation(0);
          },
          <FitIcon width={19} height={19} />,
        )}
        <span className="mx-1 h-6 w-px bg-[#e5e7ee]" />
        {toolBtn("Zoom in", () => setZoom((z) => Math.min(24, z * 1.25)), <ZoomInIcon width={19} height={19} />)}
        {toolBtn("Zoom out", () => setZoom((z) => Math.max(0.2, z / 1.25)), <ZoomOutIcon width={19} height={19} />)}
        {toolBtn("Actual size", () => setZoom(1 / fitScale), <span className="text-[12px] font-bold">1:1</span>)}
        {toolBtn("Rotate", () => setRotation((r) => (r + 90) % 360), <RotateIcon width={19} height={19} />)}
        {toolBtn(
          transparentBg ? "Show the real background" : "Show transparency grid",
          () => setTransparentBg((v) => !v),
          <TransparentIcon width={19} height={19} />,
          transparentBg,
        )}
        <span className="mx-1 h-6 w-px bg-[#e5e7ee]" />
        {toolBtn("Good result", () => {
          logEvent("Positive feedback on result", "log");
          toast("Thanks for the feedback!", "success");
        }, <ThumbUpIcon width={19} height={19} />)}
        {toolBtn("Poor result", () => {
          logEvent("Negative feedback on result", "log");
          toast("Thanks – we logged your feedback", "info");
        }, <ThumbDownIcon width={19} height={19} />)}
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className={cls(
            "ml-1 flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition",
            settingsOpen ? "bg-[#eef2ff] text-[#3b5bfd]" : "text-[#4b5563] hover:bg-[#f1f2f6]",
          )}
        >
          <GridIcon width={17} height={17} /> Settings
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="hidden rounded-md px-3 py-2 text-[12.5px] font-semibold text-[#4b5563] hover:bg-[#f1f2f6] sm:block"
          >
            New image
          </Link>
          <Link
            href={withToken(`/download?ids=${items.map((i) => i.id).join(",")}&current=${currentId}`)}
            className="flex items-center gap-2 rounded-md bg-[#3b5bfd] px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-wider text-white shadow-[0_6px_18px_rgba(59,91,253,0.3)] hover:bg-[#2f4ae0]"
          >
            <DownloadIcon width={16} height={16} /> Download
          </Link>
          <Link href="/dashboard" className="grid h-9 w-10 place-items-center rounded-md text-[#4b5563] hover:bg-[#f1f2f6]" title="Close">
            <CloseIcon width={19} height={19} />
          </Link>
        </div>
      </div>

      {/* ── notices ───────────────────────────────────────────────────── */}
      {(notice || warning || current?.status === "error") && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#f0d9b5] bg-[#fffaf0] px-4 py-2 text-[12.5px] text-[#8a5a10]">
          <span className="flex-1">
            {current?.status === "error"
              ? current.missing
                ? "This image is no longer available in this browser session — re-upload it to vectorize again."
                : current.error
              : warning || notice}
          </span>
          <Link href="/" className="rounded-md bg-[#3b5bfd] px-3 py-1.5 text-[11.5px] font-bold text-white">
            Upload again
          </Link>
          <button
            onClick={() => {
              setNotice(null);
              setWarning(null);
            }}
            className="text-[11.5px] font-semibold underline"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── settings drawer ────────────────────────────────────────── */}
        {settingsOpen && (
          <aside className="thin-scroll w-[290px] shrink-0 overflow-y-auto border-r border-[#e5e7ee] bg-white p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>AI settings</SectionTitle>
              <button onClick={() => setSettingsOpen(false)} className="rounded-md p-1 text-[#6b7280] hover:bg-[#f1f2f6]">
                <CloseIcon width={16} height={16} />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <Slider label="Detail level" value={settings.detailLevel} min={0} max={10}
                info="Higher values trace at a bigger working resolution and keep more fine detail."
                onChange={(v) => patch({ detailLevel: v })} />
              <Slider label="Color count" value={settings.colorCount} min={2} max={32}
                info="K-means palette size. Fewer colours = fewer shapes; more colours = richer gradients."
                onChange={(v) => patch({ colorCount: v })} />
              <Slider label="Noise" value={settings.noise} min={0} max={10}
                info="Edge-preserving smoothing that removes JPEG grain before tracing."
                onChange={(v) => patch({ noise: v })} />
              <Slider label="Corner threshold" value={settings.cornerThreshold} min={20} max={160} suffix="°"
                info="Turn angle above which a corner is preserved instead of rounded."
                onChange={(v) => patch({ cornerThreshold: v })} />
              <Slider label="Smoothness" value={settings.smoothness} min={0} max={8}
                info="Easing passes over each contour – higher is calmer, 0 is pixel-exact."
                onChange={(v) => patch({ smoothness: v })} />
              <Slider label="Curve precision" value={settings.curvePrecision} min={0.2} max={3} step={0.05} suffix="px"
                info="Maximum deviation while fitting lines and curves (smaller = more accurate)."
                onChange={(v) => patch({ curvePrecision: v })} />
              <Slider label="Edge soften" value={settings.edgeSoften} min={0} max={8}
                info="Heals soft shadows and anti-aliased gaps between colours."
                onChange={(v) => patch({ edgeSoften: v })} />
              <Slider label="Min shape area" value={settings.minShapeArea} min={2} max={400} suffix="px²"
                info="Shapes smaller than this are treated as noise."
                onChange={(v) => patch({ minShapeArea: v })} />
              <Toggle label="Posterize colours" checked={settings.posterize}
                info="Snap similar shades together before quantising – great for flat logos."
                onChange={(v) => patch({ posterize: v })} />
              <Toggle label="Smart cleanup (tidy specks)" checked={settings.cleanup}
                info="Off = faithful: every small shape and the background stay exactly as in the image."
                onChange={(v) => patch({ cleanup: v })} />
              <Toggle label="Remove background (normally not needed)" checked={settings.ignoreBackground}
                info="The background is kept exactly as in your image. Turn this on only if you specifically need a transparent background."
                onChange={(v) => patch({ ignoreBackground: v })} />
            </div>
            <div className="mt-6 space-y-2">
              <SectionTitle>Presets</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {CLEANUP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() =>
                      patch(
                        preset.id === "pixel-exact"
                          ? {
                              ...preset.base,
                              simpleShapes: false,
                              lineFit: "superFine",
                              curveTypes: { lines: true, quadratic: false, cubic: false, circularArcs: false, ellipticalArcs: false },
                            }
                          : preset.base,
                      )
                    }
                    className="rounded-lg border border-[#e5e7ee] px-3 py-2 text-[12px] font-semibold text-[#374151] hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-6 rounded-xl bg-[#fafbfd] p-3 text-[11.5px] text-[#4b5563]">
              <span className="font-semibold">Result:</span> {stats?.shapes ?? 0} shapes · {stats?.colors ?? 0} colours ·{" "}
              {stats?.bytes ? formatBytes(stats.bytes) : "—"}
              {user && <span className="mt-1 block">{user.unlimited ? "Unlimited credits" : `${user.credits} credits left`}</span>}
            </div>
          </aside>
        )}

        {/* ── canvas ─────────────────────────────────────────────────── */}
        <div className="relative min-w-0 flex-1">
          <div
            ref={stage}
            className={cls("grid h-full w-full place-items-center overflow-hidden", transparentBg ? "checkerboard" : "bg-white")}
            onMouseDown={(e) => {
              dragging.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
            }}
            onMouseMove={(e) => {
              if (!dragging.current) return;
              setOffset({ x: dragging.current.ox + (e.clientX - dragging.current.x), y: dragging.current.oy + (e.clientY - dragging.current.y) });
            }}
            onMouseUp={() => (dragging.current = null)}
            onMouseLeave={() => (dragging.current = null)}
            onWheel={(e) => setZoom((z) => Math.min(24, Math.max(0.2, z * (e.deltaY < 0 ? 1.12 : 0.9))))}
          >
            <div
              className="relative"
              style={{
                width,
                height,
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
                transition: dragging.current ? "none" : "transform 110ms ease-out",
              }}
            >
              {mode !== "original" && current?.svg && (
                <div className="av-svg-stage absolute inset-0" dangerouslySetInnerHTML={{ __html: current.svg }} />
              )}
              {mode !== "vector" && current && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceUrl(current.id)}
                  alt="Original"
                  className="absolute inset-0 h-full w-full"
                  style={{ imageRendering: zoom > 3 ? "pixelated" : "auto" }}
                />
              )}
            </div>
          </div>

          <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/85 px-3 py-1 text-[12px] font-semibold text-[#374151] shadow-sm">
            Vectorizer.AI Result{mode === "compare" ? " · Original" : ""}
          </p>
          {busy && (
            <p className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 rounded-full bg-[#3b5bfd] px-3 py-1 text-[11.5px] font-semibold text-white shadow-sm">
              tracing…
            </p>
          )}
          <p className="pointer-events-none absolute bottom-3 right-4 text-[12.5px] font-semibold text-[#374151]">
            {width} x {height} px
          </p>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2">
            <button
              onClick={() => void downloadOne("svg")}
              className="flex items-center gap-2 rounded-full bg-[#3b5bfd] px-6 py-2.5 text-[12.5px] font-bold uppercase tracking-wider text-white shadow-[0_10px_26px_rgba(59,91,253,0.4)] hover:bg-[#2f4ae0]"
            >
              <DownloadIcon width={16} height={16} /> Download
            </button>
            <div className="flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-sm">
              {(["vector", "original", "compare"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cls(
                    "rounded-full px-3 py-1.5 text-[11.5px] font-semibold capitalize",
                    mode === m ? "bg-[#eef2ff] text-[#3b5bfd]" : "text-[#4b5563] hover:bg-[#f1f2f6]",
                  )}
                >
                  {m === "compare" ? "Before / After" : m}
                </button>
              ))}
            </div>
          </div>

          {items.length > 1 && (
            <div className="absolute top-3 left-3 flex max-w-[42%] items-center gap-1.5 rounded-full bg-white/90 p-1 shadow-sm">
              <button
                onClick={() => setThumbsOpen((v) => !v)}
                className="rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold text-[#4b5563] hover:bg-[#f1f2f6]"
              >
                {thumbsOpen ? "Hide" : "Show"} {items.length} images
              </button>
              {thumbsOpen && (
                <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setCurrentId(item.id)}
                      title={item.filename}
                      className={cls(
                        "relative h-11 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-white",
                        item.id === currentId ? "border-[#3b5bfd]" : "border-[#e5e7ee]",
                      )}
                    >
                      {item.svg ? (
                        <span className="av-svg-stage absolute inset-0 p-0.5" dangerouslySetInnerHTML={{ __html: item.svg }} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sourceUrl(item.id)} alt="" className="h-full w-full object-contain p-0.5" />
                      )}
                      {item.status === "error" && <span className="absolute inset-0 bg-[#fdf4f3]/80" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {items.length > 0 && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-white/90 p-1 shadow-sm">
              <button
                onClick={() => {
                  const index = items.findIndex((i) => i.id === currentId);
                  setCurrentId(items[Math.max(0, index - 1)]?.id ?? currentId);
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-[#4b5563] hover:bg-[#f1f2f6]"
                title="Previous"
              >
                <ChevronLeftIcon width={16} height={16} />
              </button>
              <span className="text-[11.5px] font-semibold text-[#6b7280]">
                {items.findIndex((i) => i.id === currentId) + 1}/{items.length}
              </span>
              <button
                onClick={() => {
                  const index = items.findIndex((i) => i.id === currentId);
                  setCurrentId(items[Math.min(items.length - 1, index + 1)]?.id ?? currentId);
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-[#4b5563] hover:bg-[#f1f2f6]"
                title="Next"
              >
                <ChevronRightIcon width={16} height={16} />
              </button>
              <button
                onClick={async () => {
                  if (!current) return;
                  const next = !current.favorite;
                  updateItem(current.id, { favorite: next });
                  await api(`/api/images/${current.id}`, { method: "PATCH", body: JSON.stringify({ favorite: next }) }).catch(() =>
                    toast("Could not update favorite", "error"),
                  );
                }}
                className={cls(
                  "grid h-8 w-8 place-items-center rounded-full hover:bg-[#f1f2f6]",
                  current?.favorite ? "text-[#e5484d]" : "text-[#4b5563]",
                )}
                title="Favorite"
              >
                <HeartIcon width={16} height={16} filled={current?.favorite} />
              </button>
            </div>
          )}
        </div>
      </div>

      <ProcessModal
        open={modalOpen}
        title="Vectorizing batch"
        phases={[
          { label: "Upload", value: progress.upload },
          { label: "Process", value: progress.process },
          { label: "Fetch", value: progress.fetch },
        ]}
        message={statusText}
        onCancel={() => {
          setModalOpen(false);
          toast("Vectorizing continues in the background", "info");
        }}
      />

      <div className="flex items-center gap-3 border-t border-[#e5e7ee] bg-[#fafbfd] px-4 py-2 text-[12px] text-[#6b7280]">
        <LogoIcon size={16} />
        <span className="truncate font-semibold text-[#374151]">{shortName(current?.filename ?? "—", 42)}</span>
        <span className="hidden sm:inline">
          {width} x {height} px · {formatBytes(current?.sizeBytes ?? 0)} · {(width * height).toLocaleString()} pixels
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-[#12864f]">
          background: {settings.ignoreBackground ? "removed" : "kept"}
        </span>
        <span className="ml-auto">{readyCount}/{items.length} ready</span>
        <span className="hidden md:inline">
          {stats?.shapes ?? 0} shapes · {stats?.colors ?? 0} colours
          {stats?.bytes ? ` · ${formatBytes(stats.bytes)}` : ""}
        </span>
      </div>
    </div>
  );
}
