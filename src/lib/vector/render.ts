import {
  type Pt,
  type Seg,
  bboxOf,
  dedupe,
  detectCorners,
  fitClosedCircle,
  fitPolyline,
  splitAtCorners,
  round,
  shoelace,
  simplify,
  simplifyClosed,
  smooth,
} from "./geom";
import type { TraceLoop, TraceResult, TraceShape } from "./analyze";
import { LINE_FIT_TOLERANCE, type OutputSize, type RenderSettings } from "./types";

export const PX_PER_UNIT: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
};

export type Layout = {
  /** document box in px-space */
  boxW: number;
  boxH: number;
  /** document size expressed in the requested unit */
  outW: number;
  outH: number;
  unit: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  clip: boolean;
};

export function computeLayout(os: OutputSize, srcW: number, srcH: number): Layout {
  const unit = os.unit;
  let boxW = srcW;
  let boxH = srcH;
  let outUnit = "px";
  if (os.mode === "custom") {
    boxW = Math.max(1, (os.width || srcW) * PX_PER_UNIT[unit]);
    boxH = Math.max(1, (os.height || srcH) * PX_PER_UNIT[unit]);
    outUnit = unit;
  } else if (os.mode === "scaled") {
    boxW = srcW * (os.scale || 1);
    boxH = srcH * (os.scale || 1);
    outUnit = "px";
  }
  let sx: number;
  let sy: number;
  if (os.fit === "stretch") {
    sx = boxW / srcW;
    sy = boxH / srcH;
  } else {
    const s = os.fit === "crop" ? Math.max(boxW / srcW, boxH / srcH) : Math.min(boxW / srcW, boxH / srcH);
    sx = s;
    sy = s;
  }
  const tx = (boxW - srcW * sx) * os.horizontal;
  const ty = (boxH - srcH * sy) * os.vertical;
  return {
    boxW,
    boxH,
    outW: boxW / PX_PER_UNIT[outUnit],
    outH: boxH / PX_PER_UNIT[outUnit],
    unit: outUnit,
    sx,
    sy,
    tx,
    ty,
    clip: os.fit === "crop",
  };
}

export type SimpleShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

export type RenderedShape = {
  index: number;
  hex: string;
  color: [number, number, number];
  area: number;
  level: number;
  depth: number;
  parent: number;
  group: string;
  bbox: [number, number, number, number];
  subpaths: Seg[][];
  simple?: SimpleShape;
};

export type RenderedDoc = {
  srcW: number;
  srcH: number;
  layout: Layout;
  shapes: RenderedShape[];
  stats: { shapes: number; subpaths: number; points: number; tracePoints: number };
};

/** The traced loops repeat their first point at the end – remove it so the
 *  moving-average smoothing does not double-weight that vertex. */
function dropClosingDuplicate(points: Pt[]): Pt[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) return points.slice(0, -1);
  return points;
}

/**
 * Moving-average smoothing shrinks convex shapes: every pass multiplies the radius
 * by cos(2*pi/n), so a simplified 60-point circle lost ~2 % (4 px on a 130 px
 * radius) and thin rings came out visibly thinner. The smoothing is therefore
 * followed by an exact rescale about the bbox centre that restores the original
 * bounding box, so the outline gets smoother without changing the shape's size.
 */
function guardSmoothing(points: Pt[], passes: number): Pt[] {
  if (passes <= 0 || points.length < 8) return points;
  const easedRaw = smooth(points, passes, true);
  // Feature-preserving clamp: a moving average rounds off narrow channels and sharp
  // tips (the gaps between fingers, spokes, letter counters). A smoothed vertex is
  // therefore only accepted while it stays within 0.75px of the traced contour;
  // otherwise the exact vertex is kept. Gentle staircases are still smoothed.
  const eased = easedRaw.map((p, i) => {
    const dx = p.x - points[i].x;
    const dy = p.y - points[i].y;
    return dx * dx + dy * dy <= 0.75 * 0.75 ? p : points[i];
  });
  const before = bboxOf(points);
  const after = bboxOf(eased);
  const wBefore = before[2] - before[0];
  const hBefore = before[3] - before[1];
  const wAfter = after[2] - after[0];
  const hAfter = after[3] - after[1];
  if (wBefore <= 0 || hBefore <= 0 || wAfter <= 0 || hAfter <= 0) return points;
  const sx = wBefore / wAfter;
  const sy = hBefore / hAfter;
  const cxBefore = (before[0] + before[2]) / 2;
  const cyBefore = (before[1] + before[3]) / 2;
  const cxAfter = (after[0] + after[2]) / 2;
  const cyAfter = (after[1] + after[3]) / 2;
  return eased.map((p) => ({
    x: cxBefore + (p.x - cxAfter) * sx,
    y: cyBefore + (p.y - cyAfter) * sy,
  }));
}

function loopToPoints(loop: TraceLoop, sx: number, sy: number, tx: number, ty: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < loop.length; i += 2) {
    pts.push({ x: tx + loop[i] * sx, y: ty + loop[i + 1] * sy });
  }
  return pts;
}

function detectSimple(points: Pt[]): SimpleShape | undefined {
  const bb = bboxOf(points);
  const bw = bb[2] - bb[0];
  const bh = bb[3] - bb[1];
  if (bw < 6 || bh < 6) return undefined;
  const area = Math.abs(shoelace(points));
  const bbArea = bw * bh;
  const fill = area / bbArea;
  // rectangle: area matches bbox and every point sits on the box border
  if (fill > 0.94) {
    let onBox = true;
    for (const p of points) {
      const d = Math.min(
        Math.abs(p.x - bb[0]),
        Math.abs(p.x - bb[2]),
        Math.abs(p.y - bb[1]),
        Math.abs(p.y - bb[3]),
      );
      if (d > 1.2) {
        onBox = false;
        break;
      }
    }
    if (onBox) return { kind: "rect", x: bb[0], y: bb[1], w: bw, h: bh };
  }
  // ellipse / circle
  if (fill > 0.68 && fill < 0.87) {
    const cx = (bb[0] + bb[2]) / 2;
    const cy = (bb[1] + bb[3]) / 2;
    const rx = bw / 2;
    const ry = bh / 2;
    let ok = true;
    for (const p of points) {
      const v = ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;
      if (Math.abs(v - 1) > 0.12) {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (Math.abs(rx - ry) <= Math.max(1.5, rx * 0.04)) return { kind: "circle", cx, cy, r: (rx + ry) / 2 };
      return { kind: "ellipse", cx, cy, rx, ry };
    }
  }
  return undefined;
}

/** Is (x,y) inside the flat [x,y,…] loop? */
function pointInLoop(x: number, y: number, loop: number[]): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2];
    const yi = loop[i * 2 + 1];
    const xj = loop[j * 2];
    const yj = loop[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Record a render-time decision on the trace so the UI can show what happened. */
function pipelineNote(trace: TraceResult, note: string) {
  const steps = trace.pipeline ?? (trace.pipeline = []);
  const last = steps[steps.length - 1];
  if (last && last.step === "Redundant Layers") {
    last.note = `${last.note ? last.note + ", " : ""}${note}`;
    return;
  }
  steps.push({ step: "Redundant Layers", ms: 0, note });
}

export function renderDoc(trace: TraceResult, render: RenderSettings): RenderedDoc {
  const srcW = trace.sourceWidth || trace.width;
  const srcH = trace.sourceHeight || trace.height;
  const layout = computeLayout(render.outputSize, srcW, srcH);
  const sx = (srcW / trace.width) * layout.sx;
  const sy = (srcH / trace.height) * layout.sy;
  const { tx, ty } = layout;

  // Floor the tolerance at ~0.4px: below that the fit starts chasing the
  // anti-aliased boundary pixels of the source, which produces dozens of tiny
  // stray contours without adding any real detail.
  const tol = Math.max(
    0.4,
    LINE_FIT_TOLERANCE[render.lineFit] * Math.max(0.35, Math.min(2.5, trace.base.curvePrecision)),
  );
  const passes = Math.max(0, Math.min(4, Math.round(trace.base.smoothness / 1.7)));
  const cornerWindow = Math.max(2, Math.round(2 + trace.base.detailLevel / 3));
  const keepHoles = render.stacking === "cutouts";

  const shapes: RenderedShape[] = [];
  const lateShapes: RenderedShape[] = [];
  const maxLevel = trace.shapes.reduce((m, s) => Math.max(m, s.level), 0);
  let subpaths = 0;
  let points = 0;

  // A background-coloured island that already sits inside a hole of a shape painted
  // on top of it is pure duplication: it adds an extra white layer per enclosed
  // cell (grids, eyes, letter counters) without changing the picture. Those are
  // skipped so the exported file has no redundant layers.
  const protectedRegions: { loop: TraceLoop }[] = [];
  // The hole list comes from the trace and is valid for every stacking mode, so a
  // background island is recognised no matter how the shapes are painted.
  for (const shape of trace.shapes) {
    for (const hole of shape.holes) protectedRegions.push({ loop: hole });
  }
  // The "background" is the colour that covers the canvas, *not* whatever happens
  // to be palette entry 0: once the paper is removed, the first entry is the
  // artwork colour with the most pixels (often black). Treating that as background
  // dropped real shapes, so the canvas-covering shape is detected geometrically.
  const canvasArea = trace.width * trace.height;
  const backgroundHex = (() => {
    let best: string | null = null;
    let bestCoverage = 0;
    for (const shape of trace.shapes) {
      for (const loop of shape.outer) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < loop.length; i += 2) {
          if (loop[i] < minX) minX = loop[i];
          if (loop[i] > maxX) maxX = loop[i];
          if (loop[i + 1] < minY) minY = loop[i + 1];
          if (loop[i + 1] > maxY) maxY = loop[i + 1];
        }
        const coverage = ((maxX - minX) * (maxY - minY)) / Math.max(1, canvasArea);
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          best = shape.hex;
        }
      }
    }
    // only a shape that really spans the canvas can act as background
    return bestCoverage >= 0.85 ? best : null;
  })();

  /** Is this loop a background island (point inside a hole of another shape)? */
  const isRedundantIsland = (loop: TraceLoop) =>
    loop.length >= 6 &&
    protectedRegions.some((region) => region.loop.length >= 6 && pointInLoop(loop[0], loop[1], region.loop));

  /** Rough area of a flat loop's bounding box – used to find the canvas loop. */
  const loopBoxArea = (loop: TraceLoop) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < loop.length; i += 2) {
      if (loop[i] < minX) minX = loop[i];
      if (loop[i] > maxX) maxX = loop[i];
      if (loop[i + 1] < minY) minY = loop[i + 1];
      if (loop[i + 1] > maxY) maxY = loop[i + 1];
    }
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  };

  trace.shapes.forEach((shape: TraceShape, index: number) => {
    // The background colour is usually one shape covering the canvas *and* every
    // enclosed cell (grid windows, pupils, letter counters). Those cells are
    // normally provided by the holes of the shapes above, so:
    //   cut-outs → they are pure duplicates, drop them
    //   stacked  → nothing punches the holes, so they must be painted LAST
    let outerLoops = shape.outer;
    let lateIslands: TraceLoop[] = [];
    let lateIslandHoles: TraceLoop[] = [];
    let skippedIslands = 0;
    const isBackground = shape.hex === backgroundHex;
    if (isBackground && !render.ignoreBackgroundIslands && protectedRegions.length && shape.outer.length > 1) {
      // Separate the canvas-covering loop (largest bounding box) from the enclosed
      // cells. Only cells that are *already holes* of the shapes above are dropped;
      // every other loop of the background must stay, otherwise the paper itself
      // would disappear (the canvas loop was silently discarded before, which left
      // 97 % of the image transparent).
      const sorted = [...shape.outer].sort((a, b) => loopBoxArea(b) - loopBoxArea(a));
      const islands = sorted.slice(1).filter(isRedundantIsland);
      if (islands.length) {
        // The enclosed cells are painted on top at the end, and each of them may
        // itself contain a hole (the gap ring around a circle, a letter counter…).
        // Those holes have to travel with the cell, otherwise the cell is painted
        // as a solid disc and covers whatever sits inside it.
        lateIslandHoles = shape.holes.filter((hole) =>
          islands.some((island) => pointInLoop(hole[0], hole[1], island)),
        );
        // These enclosed background cells must still be PAINTED: the shape above
        // punches them out as a hole (even-odd), so skipping them left the cell
        // transparent (measured: the inside of a ring and 11 % of the paper came
        // out empty). They are simply moved to the very top of the paint order.
        lateIslands = islands;
        skippedIslands = 0;
      }
    }

    const loopSets: { loops: TraceLoop[]; hole: boolean }[] = [{ loops: outerLoops, hole: false }];
    if (keepHoles && shape.holes.length) loopSets.push({ loops: shape.holes, hole: true });
    if (skippedIslands) {
      pipelineNote(trace, `${skippedIslands} redundant background layer(s) skipped (already holes above)`);
    }

    /**
     * Fit one traced contour.
     *
     * The whole loop is smoothed (endpoints pinned by construction, since it is
     * closed), lightly simplified and then curve-fitted in one pass. Splitting the
     * loop into runs at every detected corner made adjacent fits meet at an angle,
     * which is what produced the faceted "low-poly" look; a single fit keeps the
     * tangents continuous. Real corners survive because the fitter's own error
     * splitter breaks the curve where the contour actually turns.
     */
    const fitLoop = (loop: TraceLoop): Seg[] => {
      if (loop.length < 6) return [];
      const raw = dropClosingDuplicate(loopToPoints(loop, sx, sy, tx, ty));
      if (raw.length < 3) return [];

      // A round closed contour becomes two exact half arcs so circles stay circular.
      // The geometric Kasa test below is what decides roundness – corner detection is
      // deliberately *not* required to be empty, because a staircase on a small
      // circle fires spurious corners and used to block the snap (hexagons).
      {
        const circle = fitClosedCircle(raw, Math.max(0.9, tol * 1.2));
        if (circle) {
          // Start/end points are placed exactly ON the fitted circle, so the two
          // half arcs are true semicircles. Using a traced point instead (which can
          // sit up to ~2 % off the circle) made the chord shorter than the
          // diameter, and the renderer then drew minor arcs – a crescent that lost
          // ~30 % of the ring. With exact antipodal points both flags agree and the
          // result is a mathematically perfect circle.
          const first = {
            x: circle.cx + circle.r * Math.cos(circle.start),
            y: circle.cy + circle.r * Math.sin(circle.start),
          };
          const mid = {
            x: circle.cx - circle.r * Math.cos(circle.start),
            y: circle.cy - circle.r * Math.sin(circle.start),
          };
          // Both arcs must use the *major* arc flag: the chord between a traced
          // point and its antipode is a hair shorter than the diameter, so
          // large-arc=0 would draw two minor arcs and the renderer produced a
          // squashed crescent instead of a circle (measured: radius 122-131 px
          // instead of 131.6 px; only ~70 % of the ring area survived).
          return [
            { t: "M", x: first.x, y: first.y },
            { t: "A", rx: circle.r, ry: circle.r, rot: 0, large: 1, sweep: circle.sweep, x: mid.x, y: mid.y },
            { t: "A", rx: circle.r, ry: circle.r, rot: 0, large: 1, sweep: circle.sweep, x: first.x, y: first.y },
            { t: "Z" },
          ];
        }
      }

      const eased = raw.length >= 16 ? guardSmoothing(raw, passes + 1) : raw;
      const simplified = simplifyClosed(eased, Math.max(0.3, tol * 0.55));
      if (simplified.length < 3) return [];
      const whole = fitPolyline(simplified, {
        closed: true,
        cornerThreshold: trace.base.cornerThreshold,
        cornerWindow,
        tol,
        curveTypes: render.curveTypes,
      });
      return whole.length >= 3 ? whole : [];
    };

    const fitted: Seg[][] = [];
    for (const set of loopSets) {
      for (const loop of set.loops) {
        const segs = fitLoop(loop);
        if (!segs.length) continue;
        fitted.push(segs);
        points += segs.length;
      }
    }

    // stacked mode: the enclosed background cells are restored on top, so the
    // artwork (grid, pupil, counters) stays visible instead of being covered
    if (lateIslands.length) {
      const islandSegs: Seg[][] = [...lateIslands, ...lateIslandHoles]
        .map(fitLoop)
        .filter((segs) => segs.length > 0);
      for (const segs of islandSegs) points += segs.length;
      if (islandSegs.length) {
        subpaths += islandSegs.length;
        lateShapes.push({
          index,
          hex: shape.hex,
          color: [Math.round(shape.color[0]), Math.round(shape.color[1]), Math.round(shape.color[2])],
          area: shape.area,
          level: maxLevel + 1,
          depth: shape.depth + 1,
          parent: index,
          group: "",
          bbox: shape.bbox,
          subpaths: islandSegs,
          simple: undefined,
        });
      }
    }

    if (!fitted.length) return;
    subpaths += fitted.length;
    const flat: Pt[] = [];
    for (const segs of fitted) {
      for (const seg of segs) {
        if (seg.t === "Z") continue;
        flat.push({ x: seg.x, y: seg.y });
      }
    }
    const bb = bboxOf(flat);
    const single = fitted.length === 1 && shape.holes.length === 0 && render.simpleShapes;
    const simple = single ? detectSimple(flat) : undefined;
    shapes.push({
      index,
      hex: shape.hex,
      color: [Math.round(shape.color[0]), Math.round(shape.color[1]), Math.round(shape.color[2])],
      area: shape.area,
      level: shape.level,
      depth: shape.depth,
      parent: shape.parent,
      group: "",
      bbox: bb,
      subpaths: fitted,
      simple,
    });
  });

  if (lateShapes.length) shapes.push(...lateShapes);

  // grouping labels
  const groupKey = (s: RenderedShape) => {
    switch (render.groupBy) {
      case "color":
        return `color-${s.hex.replace("#", "")}`;
      case "layer":
        return `layer-${s.index + 1}`;
      case "parent":
        return s.parent >= 0 ? `parent-${s.parent}` : "parent-root";
      default:
        return "";
    }
  };
  for (const s of shapes) s.group = groupKey(s);

  return {
    srcW,
    srcH,
    layout,
    shapes,
    stats: {
      shapes: shapes.length,
      subpaths,
      points,
      tracePoints: trace.shapes.reduce(
        (acc, s) => acc + s.outer.length / 2 + s.holes.length / 2,
        0,
      ),
    },
  };
}

export function num(v: number, decimals = 2): number {
  return round(v, decimals);
}

export function boundsOf(doc: RenderedDoc): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of doc.shapes) {
    minX = Math.min(minX, s.bbox[0]);
    minY = Math.min(minY, s.bbox[1]);
    maxX = Math.max(maxX, s.bbox[2]);
    maxY = Math.max(maxY, s.bbox[3]);
  }
  if (!isFinite(minX)) return [0, 0, doc.layout.boxW, doc.layout.boxH];
  return [minX, minY, maxX, maxY];
}
