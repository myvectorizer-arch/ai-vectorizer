import { arcToCubics, type Seg } from "./geom";
import { renderDoc } from "./render";
import type { TraceResult } from "./analyze";
import type { RenderSettings } from "./types";

const fmt = (v: number, decimals: number) => {
  const rounded = Number(v.toFixed(decimals));
  if (Math.abs(rounded) < 1e-9) return "0";
  return String(rounded);
};

/** Convert quadratic / arc segments into cubics (needed for legacy SVG targets). */
function normaliseSegs(segs: Seg[], allowQ: boolean, allowA: boolean): Seg[] {
  const out: Seg[] = [];
  let cur = { x: 0, y: 0 };
  for (const s of segs) {
    switch (s.t) {
      case "M":
      case "L":
        cur = { x: s.x, y: s.y };
        out.push(s);
        break;
      case "Q":
        if (allowQ) {
          cur = { x: s.x, y: s.y };
          out.push(s);
        } else {
          const p0 = cur;
          const p2 = { x: s.x, y: s.y };
          out.push({
            t: "C",
            c1x: p0.x + (2 / 3) * (s.cx - p0.x),
            c1y: p0.y + (2 / 3) * (s.cy - p0.y),
            c2x: p2.x + (2 / 3) * (s.cx - p2.x),
            c2y: p2.y + (2 / 3) * (s.cy - p2.y),
            x: p2.x,
            y: p2.y,
          });
          cur = p2;
        }
        break;
      case "C":
        cur = { x: s.x, y: s.y };
        out.push(s);
        break;
      case "A":
        if (allowA) {
          cur = { x: s.x, y: s.y };
          out.push(s);
          break;
        }
        for (const c of arcToCubics(cur, s)) {
          out.push({ t: "C", c1x: c.c1.x, c1y: c.c1.y, c2x: c.c2.x, c2y: c.c2.y, x: c.end.x, y: c.end.y });
        }
        cur = { x: s.x, y: s.y };
        break;
      case "Z":
        out.push(s);
        break;
    }
  }
  return out;
}

export function segsToPathD(segs: Seg[], decimals: number, relative = true): string {
  const f = (v: number) => fmt(v, decimals);
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  // Every segment writes its own command letter. Implicit repetition (e.g.
  // "c1 2 3 4 5 6 7 8") is legal but a missing separator between two numbers
  // makes the whole path invalid and renderers silently drop the shape.
  for (const s of segs) {
    switch (s.t) {
      case "M":
        out.push(`M${f(s.x)} ${f(s.y)}`);
        cx = s.x;
        cy = s.y;
        break;
      case "L":
        if (relative) out.push(`l${f(s.x - cx)} ${f(s.y - cy)}`);
        else out.push(`L${f(s.x)} ${f(s.y)}`);
        cx = s.x;
        cy = s.y;
        break;
      case "Q":
        out.push(
          relative
            ? `q${f(s.cx - cx)} ${f(s.cy - cy)} ${f(s.x - cx)} ${f(s.y - cy)}`
            : `Q${f(s.cx)} ${f(s.cy)} ${f(s.x)} ${f(s.y)}`,
        );
        cx = s.x;
        cy = s.y;
        break;
      case "C":
        out.push(
          relative
            ? `c${f(s.c1x - cx)} ${f(s.c1y - cy)} ${f(s.c2x - cx)} ${f(s.c2y - cy)} ${f(s.x - cx)} ${f(s.y - cy)}`
            : `C${f(s.c1x)} ${f(s.c1y)} ${f(s.c2x)} ${f(s.c2y)} ${f(s.x)} ${f(s.y)}`,
        );
        cx = s.x;
        cy = s.y;
        break;
      case "A":
        out.push(
          `a${f(s.rx)} ${f(s.ry)} ${f(s.rot)} ${s.large} ${s.sweep} ${f(relative ? s.x - cx : s.x)} ${f(
            relative ? s.y - cy : s.y,
          )}`,
        );
        cx = s.x;
        cy = s.y;
        break;
      case "Z":
        out.push("z");
        break;
    }
  }
  return out.join("");
}

/**
 * Sanity check the produced path data the way a strict renderer would.
 * Returns a list of problems – used by the export route to self-heal instead
 * of shipping an SVG that silently loses shapes.
 */
export function validatePathD(d: string): string[] {
  const problems: string[] = [];
  const arity: Record<string, number> = { m: 2, l: 2, c: 6, q: 4, a: 7, z: 0 };
  for (const match of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const cmd = match[1].toLowerCase();
    if (!(cmd in arity)) {
      problems.push(`unknown command "${match[1]}"`);
      continue;
    }
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean);
    if (arity[cmd] && args.length % arity[cmd] !== 0) {
      problems.push(`"${match[1]}" expects multiples of ${arity[cmd]} numbers, got ${args.length}`);
    }
    for (const a of args) {
      if (!/^-?(\d+\.?\d*|\.\d+)([eE]-?\d+)?$/.test(a)) problems.push(`bad number "${a}"`);
    }
  }
  return problems;
}

function versionAttrs(version: string): { attrs: string; allowQ: boolean; allowA: boolean; note: string } {
  switch (version) {
    case "1.0":
      return {
        attrs: `version="1.0" baseProfile="full" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
        allowQ: true,
        allowA: true,
        note: "SVG 1.0 profile",
      };
    case "tiny1.2":
      return {
        attrs: `version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"`,
        allowQ: true,
        allowA: true,
        note: "SVG Tiny 1.2 – mobile profile, no filters or masks",
      };
    case "2.0":
      return {
        attrs: `xmlns="http://www.w3.org/2000/svg"`,
        allowQ: true,
        allowA: true,
        note: "SVG 2 – modern browsers, full curve support",
      };
    case "adobe":
      return {
        attrs: `version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
        allowQ: false,
        allowA: false,
        note: "Lines + cubic Beziers only so Illustrator can re-import reliably",
      };
    default:
      return {
        attrs: `version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
        allowQ: true,
        allowA: true,
        note: "SVG 1.1 – the safe web standard",
      };
  }
}

export type SvgResult = {
  content: string;
  stats: { bytes: number; shapes: number; subpaths: number; points: number; colors: number };
  note: string;
  layout: ReturnType<typeof renderDoc>["layout"];
};

export function buildSvg(trace: TraceResult, render: RenderSettings, version = "1.1"): SvgResult {
  const doc = renderDoc(trace, render);
  const v = versionAttrs(version);
  const decimals = render.preset === "cutting" ? 3 : 2;
  const { layout } = doc;
  const sizeAttrs =
    layout.unit === "px"
      ? `width="${fmt(layout.outW, 2)}" height="${fmt(layout.outH, 2)}"`
      : `width="${fmt(layout.outW, 4)}${layout.unit}" height="${fmt(layout.outH, 4)}${layout.unit}"`;

  const strokeWidth = render.strokeStyle.width || 1;
  const gapWidth = render.gapFill.width || 1;
  const strokeColor = render.strokeStyle.singleColor ? render.strokeStyle.color : null;

  const shapeNodes: { group: string; index: number; markup: string }[] = [];
  doc.shapes.forEach((shape) => {
    const subpaths = shape.subpaths.map((segs) => normaliseSegs(segs, v.allowQ, v.allowA));
    const usesFill = render.drawStyle === "filled";
    const attrs: string[] = [];
    if (shape.simple && usesFill && !render.gapFill.enabled && !layout.clip) {
      if (shape.simple.kind === "rect") {
        attrs.push(
          `x="${fmt(shape.simple.x, decimals)}" y="${fmt(shape.simple.y, decimals)}" width="${fmt(shape.simple.w, decimals)}" height="${fmt(shape.simple.h, decimals)}"`,
        );
      } else if (shape.simple.kind === "circle") {
        attrs.push(`cx="${fmt(shape.simple.cx, decimals)}" cy="${fmt(shape.simple.cy, decimals)}" r="${fmt(shape.simple.r, decimals)}"`);
      } else if (shape.simple.kind === "ellipse") {
        attrs.push(
          `cx="${fmt(shape.simple.cx, decimals)}" cy="${fmt(shape.simple.cy, decimals)}" rx="${fmt(shape.simple.rx, decimals)}" ry="${fmt(shape.simple.ry, decimals)}"`,
        );
      }
      const tag = shape.simple.kind === "rect" ? "rect" : shape.simple.kind === "circle" ? "circle" : "ellipse";
      attrs.push(`fill="${shape.hex}" data-name="${shape.hex}"`);
      if (render.opacity < 1) attrs.push(`fill-opacity="${fmt(render.opacity, 2)}"`);
      if (render.gapFill.enabled) {
        attrs.push(`stroke="${shape.hex}" stroke-width="${fmt(gapWidth, decimals)}" stroke-linejoin="round"`);
      }
      shapeNodes.push({ group: shape.group, index: shape.index, markup: `<${tag} ${attrs.join(" ")}/>` });
      return;
    }
    // Emit relative commands, then verify: if a renderer would reject the data we
    // fall back to explicit absolute commands so no shape can silently vanish.
    const d = subpaths
      .filter((segs) => segs.length >= 3)
      .map((segs) => {
        const relative = segsToPathD(segs, decimals);
        if (validatePathD(relative).length === 0) return relative;
        return segsToPathD(segs, Math.max(decimals, 3), false);
      })
      .join("");
    if (!d) return;
    if (usesFill) {
      attrs.push(`fill="${shape.hex}"`);
      if (render.opacity < 1) attrs.push(`fill-opacity="${fmt(render.opacity, 2)}"`);
      if (render.gapFill.enabled) {
        attrs.push(
          `stroke="${shape.hex}" stroke-width="${fmt(render.gapFill.constantWidth ? gapWidth : gapWidth, decimals)}" stroke-linejoin="round"`,
        );
      }
    } else {
      attrs.push(
        `fill="none" stroke="${strokeColor ?? shape.hex}" stroke-width="${fmt(strokeWidth, decimals)}" stroke-linejoin="round" stroke-linecap="round"`,
      );
    }
    if (subpaths.some((segs) => segs.some((s) => s.t === "Z")) && usesFill) {
      attrs.push(`fill-rule="evenodd"`);
    }
    shapeNodes.push({ group: shape.group, index: shape.index, markup: `<path d="${d}" ${attrs.join(" ")}/>` });
  });

  // grouping
  let body = "";
  if (render.groupBy === "none" || !render.groupBy) {
    body = shapeNodes.map((n) => n.markup).join("");
  } else {
    const groups = new Map<string, string>();
    for (const node of shapeNodes) {
      const key = node.group || "ungrouped";
      groups.set(key, (groups.get(key) ?? "") + node.markup);
    }
    body = [...groups.entries()]
      .map(([key, markup]) => `<g id="${key}" data-group="${key}">${markup}</g>`)
      .join("");
  }

  if (render.gapFill.enabled && render.gapFill.clipBounds) {
    body = `<g clip-path="url(#clipBounds)">${body}</g>`;
  }
  if (layout.clip) body = `<g clip-path="url(#clipBox)">${body}</g>`;

  const defs: string[] = [];
  if ((render.gapFill.enabled && render.gapFill.clipBounds) || layout.clip) {
    defs.push(
      `<clipPath id="clipBox"><rect width="${fmt(layout.boxW, 2)}" height="${fmt(layout.boxH, 2)}"/></clipPath>`,
    );
    defs.push(
      `<clipPath id="clipBounds"><rect width="${fmt(layout.boxW, 2)}" height="${fmt(layout.boxH, 2)}"/></clipPath>`,
    );
  }

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Generated by AI Vectorizer · ${v.note} · ${doc.shapes.length} shapes -->`,
    `<svg ${v.attrs} ${sizeAttrs} viewBox="0 0 ${fmt(layout.boxW, 2)} ${fmt(layout.boxH, 2)}">`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    body,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("");

  return {
    content: svg,
    stats: {
      bytes: Buffer.byteLength(svg, "utf8"),
      shapes: doc.stats.shapes,
      subpaths: doc.stats.subpaths,
      points: doc.stats.points,
      colors: trace.palette.length,
    },
    note: v.note,
    layout,
  };
}
