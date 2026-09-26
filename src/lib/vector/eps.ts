import { arcToCubics, flatten, type Seg } from "./geom";
import { renderDoc, boundsOf } from "./render";
import type { TraceResult } from "./analyze";
import type { RenderSettings } from "./types";

const n = (v: number, d = 3) => Number(v.toFixed(d));

/** RGB -> HSB (PostScript Level 1 has no setrgbcolor). */
function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = ((gg - bb) / delta) % 6;
    else if (max === gg) h = (bb - rr) / delta + 2;
    else h = (rr - gg) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : delta / max;
  return [h, s, max];
}

export function buildEps(
  trace: TraceResult,
  render: RenderSettings,
  version = "3.0",
  filename = "vector",
): { content: string; stats: { bytes: number; shapes: number; points: number }; note: string } {
  const doc = renderDoc(trace, render);
  const pt = 0.75; // 1 px (96dpi) = 0.75 pt
  const wPt = doc.layout.boxW * pt;
  const hPt = doc.layout.boxH * pt;
  const level = version === "1.0" ? 1 : version === "2.0" ? 2 : 3;
  const allowArcs = level >= 3;
  const [minX, minY, maxX, maxY] = boundsOf(doc);
  let points = 0;

  const lines: string[] = [];
  const date = new Date().toISOString();
  lines.push("%!PS-Adobe-3.0 EPSF-3.0");
  lines.push(`%%Creator: AI Vectorizer (EPS ${version})`);
  lines.push(`%%Title: ${filename}.eps`);
  lines.push(`%%CreationDate: ${date}`);
  lines.push(
    `%%BoundingBox: ${Math.floor(minX * pt)} ${Math.floor((hPt - maxY * pt))} ${Math.ceil(maxX * pt)} ${Math.ceil(hPt - minY * pt)}`,
  );
  lines.push(
    `%%HiResBoundingBox: ${n(minX * pt)} ${n(hPt - maxY * pt)} ${n(maxX * pt)} ${n(hPt - minY * pt)}`,
  );
  lines.push(`%%LanguageLevel: ${level}`);
  lines.push("%%Pages: 1");
  lines.push("%%EndComments");
  lines.push("%%BeginProlog");
  lines.push("/V { moveto } bind def");
  lines.push("/L { lineto } bind def");
  lines.push("/B { curveto } bind def");
  lines.push("/F { eofill } bind def");
  lines.push("%%EndProlog");
  lines.push("%%Page: 1 1");
  lines.push("gsave");

  const emitSubpath = (segs: Seg[]) => {
    let cur = { x: 0, y: 0 };
    const out: string[] = ["newpath"];
    const push = (x: number, y: number) => `${n(x * pt)} ${n(hPt - y * pt)}`;
    const flat = level === 1;
    for (const s of segs) {
      switch (s.t) {
        case "M":
          cur = { x: s.x, y: s.y };
          out.push(`${push(s.x, s.y)} V`);
          break;
        case "L":
          cur = { x: s.x, y: s.y };
          out.push(`${push(s.x, s.y)} L`);
          break;
        case "Q":
          if (flat) {
            const p0 = cur;
            const p2 = { x: s.x, y: s.y };
            for (let i = 1; i <= 8; i++) {
              const t = i / 8;
              const mt = 1 - t;
              const x = mt * mt * p0.x + 2 * mt * t * s.cx + t * t * p2.x;
              const y = mt * mt * p0.y + 2 * mt * t * s.cy + t * t * p2.y;
              out.push(`${push(x, y)} L`);
            }
          } else {
            const p0 = cur;
            const p2 = { x: s.x, y: s.y };
            out.push(
              `${push(p0.x + (2 / 3) * (s.cx - p0.x), p0.y + (2 / 3) * (s.cy - p0.y))} ` +
                `${push(p2.x + (2 / 3) * (s.cx - p2.x), p2.y + (2 / 3) * (s.cy - p2.y))} ` +
                `${push(p2.x, p2.y)} B`,
            );
          }
          cur = { x: s.x, y: s.y };
          break;
        case "C":
          out.push(
            `${push(s.c1x, s.c1y)} ${push(s.c2x, s.c2y)} ${push(s.x, s.y)} B`,
          );
          cur = { x: s.x, y: s.y };
          break;
        case "A": {
          if (allowArcs) {
            const cubics = arcToCubics(cur, s);
            for (const c of cubics) {
              out.push(`${push(c.c1.x, c.c1.y)} ${push(c.c2.x, c.c2.y)} ${push(c.end.x, c.end.y)} B`);
            }
            cur = { x: s.x, y: s.y };
          } else {
            for (const p of flatten([{ t: "M", x: cur.x, y: cur.y }, s], 0.4).slice(1)) {
              out.push(`${push(p.x, p.y)} L`);
            }
            cur = { x: s.x, y: s.y };
          }
          break;
        }
        case "Z":
          out.push("closepath");
          break;
      }
    }
    points += out.length;
    return out.join("\n");
  };

  const setColor = (rgb: [number, number, number]) => {
    if (level === 1) {
      const [h, s, b] = rgbToHsb(rgb[0], rgb[1], rgb[2]);
      return `${n(h)} ${n(s)} ${n(b)} sethsbcolor`;
    }
    return `${n(rgb[0] / 255)} ${n(rgb[1] / 255)} ${n(rgb[2] / 255)} setrgbcolor`;
  };

  const isFilled = render.drawStyle === "filled";
  for (const shape of doc.shapes) {
    lines.push(`% shape ${shape.index} ${shape.hex}`);
    for (const segs of shape.subpaths) {
      if (level >= 3 && render.opacity < 1) lines.push(`${n(render.opacity)} .setopacityalpha`);
      lines.push(setColor(shape.color));
      lines.push(emitSubpath(segs));
      if (isFilled) {
        if (render.gapFill.enabled) {
          lines.push(`${n((render.gapFill.width || 1) * pt)} setlinewidth`);
          lines.push("gsave F grestore stroke");
        } else {
          lines.push("F");
        }
      } else {
        lines.push(`${n((render.strokeStyle.width || 1) * pt)} setlinewidth`);
        lines.push(`1 setlinejoin`);
        if (render.strokeStyle.singleColor && render.strokeStyle.color) {
          const hex = render.strokeStyle.color.replace("#", "");
          lines.push(
            setColor([
              parseInt(hex.slice(0, 2), 16) || 0,
              parseInt(hex.slice(2, 4), 16) || 0,
              parseInt(hex.slice(4, 6), 16) || 0,
            ]),
          );
        }
        lines.push("stroke");
      }
    }
  }

  lines.push("grestore");
  if (level >= 3 && render.opacity < 1) lines.push(`${n(render.opacity)} .setopacityalpha`);
  lines.push("showpage");
  lines.push("%%EOF");
  const content = lines.join("\n");
  return {
    content,
    stats: { bytes: Buffer.byteLength(content, "utf8"), shapes: doc.shapes.length, points },
    note:
      level === 1
        ? "EPS 1.0 / Language Level 1 – HSB colours, flattened curves (universally importable)"
        : level === 2
          ? "EPS 2.0 / Language Level 2 – RGB colours, curves preserved"
          : "EPS 3.0 / Language Level 3 – RGB colours, opacity + full Bezier support",
  };
}
