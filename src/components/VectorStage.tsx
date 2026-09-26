"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, FitIcon, RotateIcon, TransparentIcon, ZoomInIcon, ZoomOutIcon } from "@/components/Icons";
import { cls } from "@/lib/client";

export type StageMode = "vector" | "original" | "compare";

export function VectorStage({
  svg,
  originalUrl,
  width,
  height,
  mode,
  transparent,
  label,
  onDownload,
}: {
  svg: string | null;
  originalUrl?: string | null;
  width: number;
  height: number;
  mode: StageMode;
  transparent: boolean;
  label?: string;
  onDownload?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [split, setSplit] = useState(50);
  const [hover, setHover] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const fitScale = useMemo(() => {
    const boxW = 980;
    const boxH = 620;
    const scale = Math.min(boxW / (width || 1), boxH / (height || 1), 1.6);
    return Math.max(0.05, scale);
  }, [width, height]);

  const scale = fitScale * zoom;

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    setZoom((z) => Math.min(24, Math.max(0.2, z * (event.deltaY < 0 ? 1.12 : 0.9))));
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  const area = Math.max(width, height, 1) * 1.12;

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-[#eceef4] bg-[#fbfbfd]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#eceef4] bg-white/80 px-2 py-2 text-[#374151] backdrop-blur sm:px-3">
        {[
          { icon: <ZoomInIcon width={17} height={17} />, title: "Zoom in", onClick: () => setZoom((z) => Math.min(24, z * 1.25)) },
          { icon: <ZoomOutIcon width={17} height={17} />, title: "Zoom out", onClick: () => setZoom((z) => Math.max(0.2, z / 1.25)) },
          {
            icon: <FitIcon width={17} height={17} />,
            title: "Fit to screen",
            onClick: () => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            },
          },
          { icon: <span className="text-[12px] font-bold">1:1</span>, title: "Actual pixels", onClick: () => setZoom(1 / fitScale) },
          {
            icon: <RotateIcon width={17} height={17} />,
            title: "Rotate 90°",
            onClick: () => setRotation((r) => (r + 90) % 360),
          },
          {
            icon: <TransparentIcon width={17} height={17} />,
            title: "Transparency background",
            onClick: () => onDownload?.(),
          },
        ].map((btn, index) => (
          <button
            key={index}
            title={btn.title}
            onClick={btn.onClick}
            className="grid h-8 w-9 place-items-center rounded-lg text-[#4b5563] transition hover:bg-[#f1f2f6] hover:text-[#111827]"
          >
            {btn.icon}
          </button>
        ))}
        <span className="ml-2 text-[12.5px] font-semibold text-[#6b7280]">
          {Math.round(zoom * 100)}% {transparent ? "· transparent" : ""}
        </span>
      </div>

      <div
        ref={stage}
        onMouseDown={(e) => {
          dragging.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          setIsDragging(true);
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return;
          setOffset({
            x: dragging.current.ox + (e.clientX - dragging.current.x),
            y: dragging.current.oy + (e.clientY - dragging.current.y),
          });
        }}
        onMouseUp={() => {
          dragging.current = null;
          setIsDragging(false);
        }}
        onMouseLeave={() => {
          dragging.current = null;
          setIsDragging(false);
          setHover(false);
        }}
        onMouseEnter={() => setHover(true)}
        onWheel={onWheel}
        className={cls(
          "relative grid h-[min(64vh,660px)] place-items-center overflow-hidden",
          zoom > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
          transparent && mode !== "original" ? "checkerboard" : "bg-white",
        )}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            width: width || 1,
            height: height || 1,
            transition: isDragging ? "none" : "transform 120ms ease-out",
          }}
          className="relative shadow-[0_0_0_1px_rgba(15,23,42,0.06)]"
        >
          {mode !== "original" && svg && (
            <div
              className="av-svg-stage absolute inset-0"
              dangerouslySetInnerHTML={{ __html: svg }}
              style={{ width, height }}
            />
          )}
          {mode !== "vector" && originalUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={originalUrl}
              alt="Original"
              className="absolute inset-0 h-full w-full"
              style={{
                width,
                height,
                clipPath: mode === "compare" ? `inset(0 0 0 ${split}%)` : undefined,
                imageRendering: zoom > 3 ? "pixelated" : "auto",
              }}
            />
          )}
          {mode === "compare" && (
            <>
              <div
                className="absolute top-0 h-full w-[2px] bg-[#3b5bfd]"
                style={{ left: `${split}%`, transform: `scale(${1 / scale})` }}
              />
              <input
                type="range"
                min={0}
                max={100}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
                className="absolute bottom-[-34px] left-0 w-full cursor-ew-resize"
                style={{ transform: `scale(${1 / scale})` }}
              />
            </>
          )}
        </div>

        {label && (
          <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/85 px-3 py-1 text-[12px] font-semibold text-[#374151] shadow-sm">
            {label}
          </p>
        )}

        {hover && onDownload && (
          <button
            onClick={onDownload}
            className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#3b5bfd] px-6 py-2.5 text-[12.5px] font-bold uppercase tracking-wider text-white shadow-[0_10px_26px_rgba(59,91,253,0.4)] transition hover:bg-[#2f4ae0]"
          >
            <DownloadIcon width={16} height={16} /> DOWNLOAD
          </button>
        )}

        <p className="pointer-events-none absolute bottom-3 right-4 text-[12px] font-medium text-[#6b7280]">
          {width} x {height} px · {(width * height).toLocaleString()} pixels
        </p>
        <p className="pointer-events-none absolute bottom-3 left-4 text-[12px] font-medium text-[#9ca3af]">
          area {Math.round(area)} · scroll to zoom · drag to pan
        </p>
      </div>
    </div>
  );
}
