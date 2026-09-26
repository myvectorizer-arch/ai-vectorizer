import { arcToCubics, type Seg } from "./geom";
import { renderDoc } from "./render";
import type { TraceResult } from "./analyze";
import type { RenderSettings } from "./types";

const n = (v: number, d = 3) => Number(v.toFixed(d));

export function buildPdf(
  trace: TraceResult,
  render: RenderSettings,
  version = "1.7",
  filename = "vector",
): { content: Buffer; stats: { bytes: number; shapes: number; points: number }; note: string } {
  const doc = renderDoc(trace, render);
  const pt = 0.75; // px (96dpi) -> pt
  const wPt = doc.layout.boxW * pt;
  const hPt = doc.layout.boxH * pt;
  const allowArcs = Number(version) >= 1.3; // PDF 1.3 knows arc-ish cubics; earlier -> flatten
  const ops: string[] = [];
  let points = 0;

  const cx = (x: number) => n(x * pt);
  const cy = (y: number) => n(hPt - y * pt);

  const emit = (segs: Seg[]) => {
    const out: string[] = [];
    let cur = { x: 0, y: 0 };
    for (const s of segs) {
      switch (s.t) {
        case "M":
          cur = { x: s.x, y: s.y };
          out.push(`${cx(s.x)} ${cy(s.y)} m`);
          break;
        case "L":
          cur = { x: s.x, y: s.y };
          out.push(`${cx(s.x)} ${cy(s.y)} l`);
          break;
        case "Q": {
          const p0 = cur;
          const p2 = { x: s.x, y: s.y };
          out.push(
            `${cx(p0.x + (2 / 3) * (s.cx - p0.x))} ${cy(p0.y + (2 / 3) * (s.cy - p0.y))} ` +
              `${cx(p2.x + (2 / 3) * (s.cx - p2.x))} ${cy(p2.y + (2 / 3) * (s.cy - p2.y))} ` +
              `${cx(p2.x)} ${cy(p2.y)} c`,
          );
          cur = p2;
          break;
        }
        case "C":
          out.push(
            `${cx(s.c1x)} ${cy(s.c1y)} ${cx(s.c2x)} ${cy(s.c2y)} ${cx(s.x)} ${cy(s.y)} c`,
          );
          cur = { x: s.x, y: s.y };
          break;
        case "A": {
          const cubics = allowArcs
            ? arcToCubics(cur, s)
            : arcToCubics(cur, s);
          for (const c of cubics) {
            out.push(`${cx(c.c1.x)} ${cy(c.c1.y)} ${cx(c.c2.x)} ${cy(c.c2.y)} ${cx(c.end.x)} ${cy(c.end.y)} c`);
          }
          cur = { x: s.x, y: s.y };
          break;
        }
        case "Z":
          out.push("h");
          break;
      }
    }
    points += out.length;
    return out.join("\n");
  };

  const rgb = (c: [number, number, number]) => `${n(c[0] / 255)} ${n(c[1] / 255)} ${n(c[2] / 255)}`;

  const filled = render.drawStyle === "filled";
  for (const shape of doc.shapes) {
    if (render.opacity < 1 && Number(version) >= 1.4) ops.push("/GS1 gs");
    for (const segs of shape.subpaths) {
      if (filled) {
        ops.push(rgb(shape.color) + " rg");
        ops.push(emit(segs));
        if (render.gapFill.enabled) {
          ops.push(`${n((render.gapFill.width || 1) * pt)} w`);
          ops.push("B*");
        } else {
          ops.push("f*");
        }
      } else {
        const color: [number, number, number] = render.strokeStyle.singleColor
          ? hexToRgb(render.strokeStyle.color)
          : shape.color;
        ops.push(rgb(color) + " RG");
        ops.push(`${n((render.strokeStyle.width || 1) * pt)} w`);
        ops.push("1 J 1 j");
        ops.push(emit(segs));
        ops.push("S");
      }
    }
  }

  const contentStream = ops.join("\n");
  const objects: string[] = [];
  const push = (body: string) => {
    objects.push(body);
  };
  const extg = render.opacity < 1 && Number(version) >= 1.4;
  const resources = extg ? `<< /ExtGState << /GS1 << /ca ${n(render.opacity)} >> >> /ProcSet [/PDF] >>` : `<< /ProcSet [/PDF] >>`;

  push(`<< /Type /Catalog /Pages 2 0 R >>`);
  push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(wPt)} ${n(hPt)}] /Resources ${resources} /Contents 4 0 R >>`,
  );
  push(`<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`);

  const info = `<< /Title (${filename}.pdf) /Creator (AI Vectorizer) /Producer (AI Vectorizer PDF engine ${version}) /CreationDate (D:${stamp()}) >>`;

  let pdf = `%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const infoOffset = Buffer.byteLength(pdf, "binary");
  pdf += `${objects.length + 1} 0 obj\n${info}\nendobj\n`;
  const xrefStart = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 2}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `${String(infoOffset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 2} /Root 1 0 R /Info ${objects.length + 1} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const buffer = Buffer.from(pdf, "binary");
  return {
    content: buffer,
    stats: { bytes: buffer.length, shapes: doc.shapes.length, points },
    note:
      Number(version) >= 1.4
        ? `PDF ${version} – transparency + ExtGState opacity supported`
        : `PDF ${version} – flattened paths, no transparency extensions (maximum compatibility)`,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function stamp(): string {
  const d = new Date();
  const p = (v: number, l = 2) => String(v).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
