import { flatten } from "./geom";
import { PX_PER_UNIT, renderDoc } from "./render";
import type { TraceResult } from "./analyze";
import type { RenderSettings } from "./types";

const ACADVER: Record<string, string> = {
  R12: "AC1009",
  R13: "AC1012",
  R14: "AC1014",
  "2000": "AC1015",
  "2004": "AC1016",
  "2007": "AC1021",
  "2010": "AC1024",
  "2013": "AC1027",
  "2018": "AC1032",
  "2021": "AC1032",
};

// AutoCAD Color Index reference RGB values (subset).
const ACI: [number, number, number][] = [
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
];

const n = (v: number, d = 3) => Number(v.toFixed(d));

export function buildDxf(
  trace: TraceResult,
  render: RenderSettings,
  version = "R12",
  filename = "vector",
): { content: string; stats: { bytes: number; shapes: number; points: number }; note: string } {
  const doc = renderDoc(trace, render);
  const acadver = ACADVER[version] ?? "AC1009";
  const supportsLw = Number(acadver.slice(2)) >= 1014; // LWPOLYLINE (R14+)
  const supportsTrueColor = Number(acadver.slice(2)) >= 1016; // 420 group (2004+)
  const supportsHatch = supportsLw;
  const scale = 1 / PX_PER_UNIT[doc.layout.unit];
  const outH = doc.layout.outH;

  const toX = (x: number) => n(x * scale);
  const toY = (y: number) => n(outH - y * scale);

  let handle = 0x30;
  const nextHandle = () => (handle++).toString(16).toUpperCase();

  const emit = (pairs: [number, string | number][]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n");

  const aciOf = (rgb: [number, number, number]) => {
    let best = 7;
    let bestD = Number.POSITIVE_INFINITY;
    ACI.forEach((c, i) => {
      const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    });
    return best;
  };

  const polylineEntities: string[] = [];
  const hatchEntities: string[] = [];
  const layerNames = new Set<string>();
  let points = 0;

  const filled = render.drawStyle === "filled";

  for (const shape of doc.shapes) {
    const layer = `VEC_${shape.hex.replace("#", "").toUpperCase()}`;
    layerNames.add(layer);
    const aci = aciOf(shape.color);
    const rings: { x: number; y: number }[][] = [];
    for (const segs of shape.subpaths) {
      const pts = flatten(segs, Math.max(0.25, render.strokeStyle.width || 0.25));
      if (pts.length < 3) continue;
      points += pts.length;
      const cadPts = pts.map((p) => ({ x: toX(p.x), y: toY(p.y) }));
      const first = cadPts[0];
      const last = cadPts[cadPts.length - 1];
      if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) cadPts.pop();
      if (cadPts.length < 3) continue;
      rings.push(cadPts);
      if (supportsLw) {
        polylineEntities.push(
          emit([
            [0, "LWPOLYLINE"],
            [5, nextHandle()],
            [100, "AcDbEntity"],
            [8, layer],
            [62, aci],
            ...(supportsTrueColor ? ([[420, shape.color[0] * 65536 + shape.color[1] * 256 + shape.color[2]]] as [number, number][]) : []),
            [100, "AcDbPolyline"],
            [90, cadPts.length],
            [70, 1],
            [43, 0],
            ...cadPts.flatMap((p) => [
              [10, p.x],
              [20, p.y],
            ] as [number, number][]),
          ]),
        );
      } else {
        const verts = cadPts
          .map((p) => emit([[0, "VERTEX"], [8, layer], [10, p.x], [20, p.y], [30, 0]]))
          .join("\n");
        polylineEntities.push(
          emit([
            [0, "POLYLINE"],
            [8, layer],
            [66, 1],
            [70, 1],
            [10, 0],
            [20, 0],
            [30, 0],
          ]) +
            "\n" +
            verts +
            "\n" +
            emit([[0, "SEQEND"], [8, layer]]),
        );
      }
    }
    if (filled && supportsHatch && rings.length) {
      const paths = rings
        .map((ring) =>
          emit([
            [92, 7],
            [72, 0],
            [73, 1],
            [93, ring.length],
            ...ring.flatMap((p) => [
              [10, p.x],
              [20, p.y],
            ] as [number, number][]),
            [97, 0],
          ]),
        )
        .join("\n");
      hatchEntities.push(
        emit([
          [0, "HATCH"],
          [5, nextHandle()],
          [100, "AcDbEntity"],
          [8, layer],
          [62, aci],
          ...(supportsTrueColor ? ([[420, shape.color[0] * 65536 + shape.color[1] * 256 + shape.color[2]]] as [number, number][]) : []),
          [100, "AcDbHatch"],
          [10, 0],
          [20, 0],
          [30, 0],
          [210, 0],
          [220, 0],
          [230, 1],
          [2, "SOLID"],
          [70, 1],
          [71, 0],
          [91, rings.length],
        ]) +
          "\n" +
          paths +
          "\n" +
          emit([
            [75, 1],
            [76, 1],
          ]),
      );
    }
  }

  const allMinX = doc.shapes.reduce((m, s) => Math.min(m, toX(s.bbox[0])), toX(0));
  const allMaxX = doc.shapes.reduce((m, s) => Math.max(m, toX(s.bbox[2])), toX(doc.layout.boxW));
  const allMinY = doc.shapes.reduce((m, s) => Math.min(m, toY(s.bbox[3])), 0);
  const allMaxY = doc.shapes.reduce((m, s) => Math.max(m, toY(s.bbox[1])), doc.layout.outH);

  const header = emit([
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, acadver],
    [9, "$INSUNITS"],
    [70, doc.layout.unit === "mm" ? 4 : doc.layout.unit === "in" ? 1 : doc.layout.unit === "cm" ? 5 : 0],
    [9, "$MEASUREMENT"],
    [70, doc.layout.unit === "in" ? 0 : 1],
    [9, "$LUNITS"],
    [70, 2],
    [9, "$EXTMIN"],
    [10, allMinX],
    [20, allMinY],
    [30, 0],
    [9, "$EXTMAX"],
    [10, allMaxX],
    [20, allMaxY],
    [30, 0],
    ...(supportsLw ? ([[9, "$HANDSEED"], [5, "FFFF"]] as [number, string][]) : []),
    [0, "ENDSEC"],
  ]);

  const layerTable =
    emit([
      [0, "SECTION"],
      [2, "TABLES"],
      [0, "TABLE"],
      [2, "LTYPE"],
      [70, 1],
    ]) +
    "\n" +
    emit([
      [0, "LTYPE"],
      [2, "CONTINUOUS"],
      [70, 0],
      [3, "Solid line"],
      [72, 65],
      [73, 0],
      [40, 0],
    ]) +
    "\n" +
    emit([
      [0, "ENDTAB"],
      [0, "TABLE"],
      [2, "LAYER"],
      [70, layerNames.size],
    ]) +
    "\n" +
    [...layerNames]
      .map((name) =>
        emit([
          [0, "LAYER"],
          [2, name],
          [70, 0],
          [62, 7],
          [6, "CONTINUOUS"],
        ]),
      )
      .join("\n") +
    "\n" +
    emit([[0, "ENDTAB"], [0, "ENDSEC"]]);

  const entities =
    emit([
      [0, "SECTION"],
      [2, "ENTITIES"],
    ]) +
    "\n" +
    [...hatchEntities, ...polylineEntities].join("\n") +
    "\n" +
    emit([[0, "ENDSEC"], [0, "EOF"]]);

  const content = [header, layerTable, entities].join("\n") + "\n";
  return {
    content,
    stats: { bytes: Buffer.byteLength(content, "utf8"), shapes: doc.shapes.length, points },
    note: supportsLw
      ? `DXF ${version} (${acadver}) – LWPOLYLINE${supportsHatch && filled ? " + SOLID HATCH fills" : ""}${supportsTrueColor ? ", true color layers" : ""}`
      : `DXF ${version} (${acadver}) – classic POLYLINE/SEQEND entities, outlines only (CAD & CNC safe)`,
  };
}
