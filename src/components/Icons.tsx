"use client";

import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export function LogoIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#3B5BFD" />
      <path
        d="M10 24c0-5 3-9 6-9s6 4 6 9c-3-1.4-4-3.5-6-3.5S13 22.6 10 24Z"
        fill="#fff"
        opacity="0.92"
      />
      <path d="M17 6c3 1.6 5 4.6 5 8.2 0 1-.2 2-.5 2.9-1.4-2.2-3-3.6-4.8-4.2C17.6 11.4 18 8.6 17 6Z" fill="#fff" />
    </svg>
  );
}

export function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
      <path d="M4 21h16" />
    </svg>
  );
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function ImagesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M7 18l3-3 3 3" />
      <path d="M18 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

export function ZoomInIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3M11 8v6M8 11h6" />
    </svg>
  );
}

export function ZoomOutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3M8 11h6" />
    </svg>
  );
}

export function FitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 9V5h4M20 15v4h-4M4 15v4h4M20 9V5h-4" />
    </svg>
  );
}

export function RotateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

export function GridIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

export function ThumbUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 3 1.8V10h4.2a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17 20H7" />
    </svg>
  );
}

export function ThumbDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M17 13V4h3v9h-3Zm0 0-4 7a2 2 0 0 1-3-1.8V14H5.8a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7 4h10" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function TransparentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h18M12 3v18" />
    </svg>
  );
}

export function GlobeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18-2.5-3-2.5-15.5 0-18Z" />
    </svg>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function HeartIcon({ filled, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg {...base(props)} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20s-7-4.4-7-9a3.8 3.8 0 0 1 7-2.1A3.8 3.8 0 0 1 19 11c0 4.6-7 9-7 9Z" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5H6a1 1 0 0 0-1 1v9" />
    </svg>
  );
}

export function SparkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

export function FormatBadge({ format, size = 34 }: { format: string; size?: number }) {
  const meta: Record<string, { bg: string; fg: string; label: string }> = {
    svg: { bg: "#fff4e0", fg: "#f6a623", label: "SVG" },
    pdf: { bg: "#fdecea", fg: "#e0574a", label: "PDF" },
    dxf: { bg: "#fdeceb", fg: "#c0392b", label: "DXF" },
    eps: { bg: "#fff0e2", fg: "#e8791f", label: "EPS" },
    png: { bg: "#e9f1fd", fg: "#2f7ce0", label: "PNG" },
    psd: { bg: "#eef2ff", fg: "#3b5bfd", label: "PSD" },
  };
  const m = meta[format] ?? meta.svg;
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-bold"
      style={{ background: m.bg, color: m.fg, width: size, height: size, fontSize: size / 3.2 }}
    >
      {m.label}
    </span>
  );
}
