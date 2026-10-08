/** Geometry toolkit: simplification, smoothing, corner detection, curve fitting. */

export type Pt = { x: number; y: number };

export type Seg =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "Q"; cx: number; cy: number; x: number; y: number }
  | { t: "C"; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | {
      t: "A";
      rx: number;
      ry: number;
      rot: number;
      large: 0 | 1;
      sweep: 0 | 1;
      x: number;
      y: number;
    }
  | { t: "Z" };

export type Loop = { segs: Seg[]; bbox: [number, number, number, number]; area: number };

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export function shoelace(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function bboxOf(points: Pt[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

export function dedupe(points: Pt[], eps = 0.001): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) out.push(p);
  }
  return out;
}

/** Ramer–Douglas–Peucker for open polylines (endpoints always kept). */
export function simplify(points: Pt[], tol: number): Pt[] {
  const n = points.length;
  if (n < 3 || tol <= 0) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = tol2;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      let d2: number;
      if (len2 === 0) {
        d2 = (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      } else {
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        const tc = Math.max(0, Math.min(1, t));
        d2 = (p.x - (a.x + tc * dx)) ** 2 + (p.y - (a.y + tc * dy)) ** 2;
      }
      if (d2 > worstDist) {
        worstDist = d2;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplify a closed loop by splitting it at the two farthest-apart points. */
export function simplifyClosed(points: Pt[], tol: number): Pt[] {
  const pts = dedupe(points);
  const n = pts.length;
  if (n < 4) return pts;
  if (tol <= 0) return pts;
  let best = 0;
  let bestD = -1;
  const c = pts[0];
  for (let i = 1; i < n; i++) {
    const d = (pts[i].x - c.x) ** 2 + (pts[i].y - c.y) ** 2;
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  const head = pts.slice(0, best + 1);
  const tail = pts.slice(best);
  const sHead = simplify(head, tol);
  const sTail = simplify(tail, tol);
  const out = sHead.slice(0, -1).concat(sTail);
  return dedupe(out);
}

/** Weighted moving-average easing – turns pixel staircases into flowing edges. */
export function smooth(points: Pt[], passes: number, closed = true): Pt[] {
  if (passes <= 0 || points.length < 4) return points;
  let cur = points.slice();
  const n = cur.length;
  for (let p = 0; p < passes; p++) {
    const next: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n];
      const self = cur[i];
      const nxt = cur[(i + 1) % n];
      next[i] = {
        x: (prev.x + 2 * self.x + nxt.x) / 4,
        y: (prev.y + 2 * self.y + nxt.y) / 4,
      };
    }
    if (!closed) {
      next[0] = cur[0];
      next[n - 1] = cur[n - 1];
    }
    cur = next;
  }
  return cur;
}

/**
 * Corner detection over a local window so pixel staircases do not register
 * as thousands of false corners.
 */
export function detectCorners(
  points: Pt[],
  thresholdDeg: number,
  window: number,
  closed: boolean,
): boolean[] {
  const n = points.length;
  const flags = new Array<boolean>(n).fill(false);
  if (n < 5) return flags;
  const w = Math.max(1, Math.min(window, Math.floor(n / 3)));
  const th = Math.cos((thresholdDeg * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    if (!closed && (i - w < 0 || i + w > n - 1)) continue;
    const a = points[(i - w + n) % n];
    const b = points[i];
    const c = points[(i + w) % n];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 0.4 || l2 < 0.4) continue;
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    if (cos < th) flags[i] = true;
  }
  return flags;
}

/** Order + de-duplicate detected corners and split the loop into open runs. */
export function splitAtCorners(points: Pt[], flags: boolean[]): Pt[][] {
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) if (flags[i]) idx.push(i);
  if (idx.length === 0) return [];
  const runs: Pt[][] = [];
  for (let k = 0; k < idx.length; k++) {
    const start = idx[k];
    const end = idx[(k + 1) % idx.length];
    const run: Pt[] = [];
    let i = start;
    while (true) {
      run.push(points[i]);
      if (i === end) break;
      i = (i + 1) % points.length;
      if (run.length > points.length) break;
    }
    if (run.length >= 2) runs.push(run);
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* Bezier fitting (Schneider, Graphics Gems)                           */
/* ------------------------------------------------------------------ */

type Cubic = { p0: Pt; c1: Pt; c2: Pt; p3: Pt };

function chordLengthParameterize(pts: Pt[]): number[] {
  const u: number[] = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function bezierPoint(b: Cubic, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const c = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * b.p0.x + c * b.c1.x + d * b.c2.x + e * b.p3.x,
    y: a * b.p0.y + c * b.c1.y + d * b.c2.y + e * b.p3.y,
  };
}

function bezierDeriv(b: Cubic, t: number): Pt {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const c = 6 * mt * t;
  const d = 3 * t * t;
  return {
    x: a * (b.c1.x - b.p0.x) + c * (b.c2.x - b.c1.x) + d * (b.p3.x - b.c2.x),
    y: a * (b.c1.y - b.p0.y) + c * (b.c2.y - b.c1.y) + d * (b.p3.y - b.c2.y),
  };
}

function generateBezier(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a0x = t1.x * b1;
    const a0y = t1.y * b1;
    const a1x = t2.x * b2;
    const a1y = t2.y * b2;
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    const tmpx = pts[i].x - (p0.x * b0 + p0.x * b1 + p3.x * b2 + p3.x * b3);
    const tmpy = pts[i].y - (p0.y * b0 + p0.y * b1 + p3.y * b2 + p3.y * b3);
    x0 += a0x * tmpx + a0y * tmpy;
    x1 += a1x * tmpx + a1y * tmpy;
  }
  const det = c00 * c11 - c01 * c01;
  const det0 = x0 * c11 - c01 * x1;
  const det1 = c00 * x1 - x0 * c01;
  let alphaL = det === 0 ? 0 : det0 / det;
  let alphaR = det === 0 ? 0 : det1 / det;
  const segLen = dist(p0, p3);
  const eps = 1e-6 * segLen;
  // A near-singular least-squares system (nearly straight/duplicate points) can
  // produce a huge-but-finite alpha instead of Infinity/NaN, which the old check
  // didn't catch — the resulting control point lands far outside the shape and
  // renders as a thin stray spike/line. Cap alpha at a generous multiple of the
  // chord length; anything beyond that is numerically unstable, not a real fit.
  const maxAlpha = Math.max(segLen * 6, 24);
  if (
    !isFinite(alphaL) ||
    !isFinite(alphaR) ||
    alphaL < eps ||
    alphaR < eps ||
    alphaL > maxAlpha ||
    alphaR > maxAlpha
  ) {
    const d = segLen / 3 || 0.1;
    alphaL = d;
    alphaR = d;
  }
  return {
    p0,
    c1: { x: p0.x + t1.x * alphaL, y: p0.y + t1.y * alphaL },
    c2: { x: p3.x + t2.x * alphaR, y: p3.y + t2.y * alphaR },
    p3,
  };
}

function maxErrorPoint(pts: Pt[], b: Cubic, u: number[]) {
  let maxD = 0;
  let split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = bezierPoint(b, u[i]);
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2;
    if (d >= maxD) {
      maxD = d;
      split = i;
    }
  }
  return { maxD, split };
}

function reparameterize(pts: Pt[], u: number[], b: Cubic): number[] {
  return u.map((t, i) => {
    const d = bezierDeriv(b, t);
    const p = bezierPoint(b, t);
    const q = pts[i];
    const num = (p.x - q.x) * d.x + (p.y - q.y) * d.y;
    const den = d.x * d.x + d.y * d.y;
    if (den === 0) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}

const norm = (dx: number, dy: number): Pt => {
  const l = Math.hypot(dx, dy);
  return l === 0 ? { x: 0, y: 0 } : { x: dx / l, y: dy / l };
};

/** Fit a polyline with cubic Beziers within `tol` px. */
export function fitCubics(pts: Pt[], tol: number): Cubic[] {
  const out: Cubic[] = [];
  const done: Cubic[][] = [];
  const tHat1 = norm(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const tHat2 = norm(prev.x - last.x, prev.y - last.y);
  fitCubicRec(pts, tHat1, tHat2, tol * tol, done, 0);
  for (const group of done) out.push(...group);
  return out;
}

function fitCubicRec(
  pts: Pt[],
  tHat1: Pt,
  tHat2: Pt,
  error: number,
  out: Cubic[][],
  depth: number,
): void {
  if (depth > 16) {
    if (pts.length > 1) out.push([lineAsCubic(pts)]);
    return;
  }
  if (pts.length === 2) {
    out.push([tangentCubic(pts, tHat1, tHat2)]);
    return;
  }
  const clean = dedupe(pts);
  if (clean.length < 2) return;
  if (clean.length === 2) {
    out.push([tangentCubic(clean, tHat1, tHat2)]);
    return;
  }
  let u = chordLengthParameterize(clean);
  let bez = generateBezier(clean, u, tHat1, tHat2);
  let { maxD, split } = maxErrorPoint(clean, bez, u);

  if (maxD < error && (clean.length < 5 || curveHugsPoints(clean, bez, Math.sqrt(error) * 1.5))) {
    out.push([bez]);
    return;
  }
  // try reparameterisation a few times (classic Schneider refinement)
  let bestD = maxD;
  let bestBez = bez;
  let bestU = u;
  let bestSplit = split;
    for (let i = 0; i < 4 && (bestD >= error || !curveHugsPoints(clean, bestBez, Math.sqrt(error) * 1.5)); i++) {
    u = reparameterize(clean, u, bez);
    bez = generateBezier(clean, u, tHat1, tHat2);
    const r = maxErrorPoint(clean, bez, u);
    if (r.maxD < bestD) {
      bestD = r.maxD;
      bestBez = bez;
      bestU = u;
      bestSplit = r.split;
    }
  }
  if (bestD < error && (clean.length < 5 || curveHugsPoints(clean, bestBez, Math.sqrt(error) * 1.5))) {
    out.push([bestBez]);
    return;
  }
  // Never accept a fit that is out of tolerance just because the worst point sits at an
  // end of the piece (the tangent-constrained curve then overshoots by several px).
  // Cut the piece in the middle instead and fit each half.
  if (bestSplit <= 0 || bestSplit >= clean.length - 1) {
    if (clean.length < 5) {
      out.push([bestBez]);
      return;
    }
    bestSplit = Math.floor(clean.length / 2);
  }
  // Split tangent from a wider neighbourhood: a +-1 point tangent on a dense, slightly
  // noisy contour points in a random direction, and that is a visible kink at the join.
  let span = 1;
  {
    // ~3 px of arc length each side: long enough to ignore pixel noise, short enough
    // to follow real curvature
    let acc = 0;
    const maxSpan = Math.min(bestSplit, clean.length - 1 - bestSplit, 6);
    while (span < maxSpan) {
      acc += dist(clean[bestSplit - span], clean[bestSplit - span + 1]);
      if (acc >= 3) break;
      span++;
    }
  }
  const center = norm(
    clean[bestSplit - span].x - clean[bestSplit + span].x,
    clean[bestSplit - span].y - clean[bestSplit + span].y,
  );
  void bestU;
  const left: Cubic[][] = [];
  const right: Cubic[][] = [];
  fitCubicRec(clean.slice(0, bestSplit + 1), tHat1, center, error, left, depth + 1);
  fitCubicRec(
    clean.slice(bestSplit),
    { x: -center.x, y: -center.y },
    tHat2,
    error,
    right,
    depth + 1,
  );
  out.push(...left, ...right);
}

/** Two points joined with the incoming/outgoing tangents so the join stays smooth. Only
 *  used when the tangents roughly agree with the chord; otherwise it is a plain line. */
function tangentCubic(pts: Pt[], t1: Pt, t2: Pt): Cubic {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  const chord = dist(p0, p3);
  const c = norm(p3.x - p0.x, p3.y - p0.y);
  const ok1 = t1.x * c.x + t1.y * c.y > 0.5;
  const ok2 = -(t2.x * c.x + t2.y * c.y) > 0.5;
  if (!ok1 || !ok2) return lineAsCubic(pts);
  const d = chord / 3;
  return {
    p0,
    c1: { x: p0.x + t1.x * d, y: p0.y + t1.y * d },
    c2: { x: p3.x + t2.x * d, y: p3.y + t2.y * d },
    p3,
  };
}

/** True geometric check of a fitted cubic: the curve itself (sampled between the data
 *  points too) must stay near the traced polyline. Parameter-based errors can look fine
 *  while the curve overshoots between samples. */
function curveHugsPoints(pts: Pt[], b: Cubic, limit: number): boolean {
  const steps = Math.max(8, Math.min(40, pts.length * 2));
  const lim2 = limit * limit;
  for (let k = 1; k < steps; k++) {
    const q = bezierPoint(b, k / steps);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const ex = q.x - (a.x + t * dx);
      const ey = q.y - (a.y + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
      if (best <= lim2) break;
    }
    if (best > lim2) return false;
  }
  return true;
}

function lineAsCubic(pts: Pt[]): Cubic {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  return {
    p0,
    c1: { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
    c2: { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 },
    p3,
  };
}

/** Fit a polyline with quadratic Beziers within `tol` px (exact least squares). */
export function fitQuadratics(pts: Pt[]): Seg[] {
  const clean = dedupe(pts);
  const segs: Seg[] = [];
  if (clean.length < 2) return segs;
  const fitOne = (part: Pt[]) => {
    if (part.length === 2) {
      segs.push({ t: "L", x: part[1].x, y: part[1].y });
      return;
    }
    const p0 = part[0];
    const p2 = part[part.length - 1];
    const u = chordLengthParameterize(part);
    let wsum = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 1; i < part.length - 1; i++) {
      const t = u[i];
      const mt = 1 - t;
      const w = 2 * mt * t;
      const w2 = w * w + 1e-9;
      const tx = (part[i].x - (mt * mt * p0.x + t * t * p2.x)) / w;
      const ty = (part[i].y - (mt * mt * p0.y + t * t * p2.y)) / w;
      cx += tx * w2;
      cy += ty * w2;
      wsum += w2;
    }
    const c = wsum === 0 ? { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 } : { x: cx / wsum, y: cy / wsum };
    segs.push({ t: "Q", cx: c.x, cy: c.y, x: p2.x, y: p2.y });
  };

  const rec = (part: Pt[], depth: number) => {
    if (part.length <= 2 || depth > 8) {
      fitOne(part);
      return;
    }
    // evaluate residuals of the least squares fit
    const p0 = part[0];
    const p2 = part[part.length - 1];
    const mid = part[Math.floor(part.length / 2)];
    const quad = (t: number) => {
      const mt = 1 - t;
      return { x: mt * mt * p0.x + 2 * mt * t * mid.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * mid.y + t * t * p2.y };
    };
    const u = chordLengthParameterize(part);
    let maxD = 0;
    let split = Math.floor(part.length / 2);
    for (let i = 1; i < part.length - 1; i++) {
      const q = quad(u[i]);
      const d = (q.x - part[i].x) ** 2 + (q.y - part[i].y) ** 2;
      if (d > maxD) {
        maxD = d;
        split = i;
      }
    }
    if (maxD < 0.35) {
      fitOne(part);
      return;
    }
    rec(part.slice(0, split + 1), depth + 1);
    rec(part.slice(split), depth + 1);
  };
  rec(clean, 0);
  return segs;
}

/* ------------------------------------------------------------------ */
/* Circular / elliptical arc fitting                                   */
/* ------------------------------------------------------------------ */

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export type ArcFit = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  start: Pt;
  end: Pt;
  large: 0 | 1;
  sweep: 0 | 1;
  rms: number;
};

/**
 * Fits a *complete* circle to a closed contour (Kasa least squares) and returns
 * it when the contour really is round. This keeps heads, rings and dots perfectly
 * circular instead of turning them into polygons during curve fitting.
 */
export function fitClosedCircle(
  pts: Pt[],
  tol: number,
): { cx: number; cy: number; r: number; start: number; sweep: 0 | 1; rms: number } | null {
  const pts2 = dedupe(pts);
  if (pts2.length < 10) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of pts2) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y;
    sxy += p.x * p.y; sxz += p.x * z; syz += p.y * z; sz += z;
  }
  const n = pts2.length;
  const sol = solveLinear(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  // Small icons packed into a sprite sheet/grid (common for stock-icon exports)
  // can have genuinely round decorative circles only 5-8px in radius once
  // rasterized. The old floor of r>4px rejected these as "too small to be a
  // real circle" and they fell back to a faceted polygon (a hexagon/octagon).
  // 2.5px is still well above pixel-quantization noise.
  if (!(r2 > 6.25)) return null;
  const r = Math.sqrt(r2);
  let sum = 0;
  let maxErr = 0;
  for (const p of pts2) {
    const d = Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
    sum += d * d;
    if (d > maxErr) maxErr = d;
  }
  const rms = Math.sqrt(sum / n);
  // Snapping must be generous for SMALL shapes and strict for big ones:
  //   · a small circle traced from a JPEG consists of 30-80 pixel steps, so its
  //     vertices swing ~0.5-1px even when it is perfectly round. A strict test then
  //     rejects it and the fitter turns it into a hexagon (exactly what happened to
  //     a 20px stethoscope ring).
  //   · large n-gons must NOT be snapped, or an octagonal logo would lose its shape.
  // Deviation budget by shape: hexagon 0.13R, octagon 0.08R, square 0.29R,
  // triangle 0.5R. So 0.20R for small contours accepts hexagons and finer round
  // polygons while still rejecting squares and triangles.
  // Very small circles (r below ~8px) carry proportionally more pixel-quantization
  // wobble than the r<30 band already accounts for, so give them their own,
  // slightly more generous allowance instead of a single breakpoint at 30px.
  const maxTolerance = r < 8 ? Math.max(1.6, r * 0.32) : r < 30 ? Math.max(1.4, r * 0.2) : Math.max(1.1, r * 0.01);
  const rmsTolerance = r < 8 ? Math.max(0.8, r * 0.18) : r < 30 ? Math.max(0.7, r * 0.12) : Math.max(0.5, r * 0.006);
  if (rms > rmsTolerance || maxErr > maxTolerance) return null;
  // does the contour actually cover the whole circle (not just an arc)?
  const angles = pts2.map((p) => Math.atan2(p.y - cy, p.x - cx)).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
    maxGap = Math.max(maxGap, next - angles[i]);
  }
  if (maxGap > Math.PI * 0.5) return null; // more than a quarter missing → not a circle
  const area = shoelace(pts2);
  return {
    cx,
    cy,
    r,
    start: Math.atan2(pts2[0].y - cy, pts2[0].x - cx),
    sweep: area > 0 ? 1 : 0,
    rms,
  };
}

/** Kasa circle fit + sweep analysis. Returns null when the run is not arc-like. */
export function fitArc(pts: Pt[], tol: number): ArcFit | null {
  const pts2 = dedupe(pts);
  if (pts2.length < 4) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const p of pts2) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  const n = pts2.length;
  const sol = solveLinear(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (r2 <= 1) return null;
  const r = Math.sqrt(r2);
  let sum = 0;
  for (const p of pts2) sum += (Math.hypot(p.x - cx, p.y - cy) - r) ** 2;
  const rms = Math.sqrt(sum / n);
  if (!isFinite(rms) || rms > tol) return null;
  // A near-straight run of points can still satisfy the rms tolerance above with
  // a huge fitted radius (the Kasa fit is ill-conditioned near-collinear points
  // and can "explain" a small local wiggle with a circle whose centre is far
  // away). That huge-radius arc still passes through the real start/end points,
  // but bulges way outside the shape when rendered – exactly the stray
  // crescent/bulge seen on nearly-straight edges. A genuine round feature has a
  // radius comparable to its own span, so reject anything wildly larger than the
  // point spread and let it fall back to a straight/Bezier fit instead.
  const [bx0, by0, bx1, by1] = bboxOf(pts2);
  const spread = Math.max(bx1 - bx0, by1 - by0, dist(pts2[0], pts2[pts2.length - 1]));
  if (r > Math.max(spread * 8, 40)) return null;
  if (!isFinite(cx) || !isFinite(cy)) return null;

  // unwrap sweep angle
  let prev = Math.atan2(pts2[0].y - cy, pts2[0].x - cx);
  let total = 0;
  for (let i = 1; i < pts2.length; i++) {
    const ang = Math.atan2(pts2[i].y - cy, pts2[i].x - cx);
    let d = ang - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = ang;
  }
  const absSweep = Math.abs((total * 180) / Math.PI);
  if (absSweep < 25 || absSweep > 330) return null;
  const start = pts2[0];
  const end = pts2[pts2.length - 1];
  return {
    cx,
    cy,
    rx: r,
    ry: r,
    rot: 0,
    start,
    end,
    large: absSweep > 180 ? 1 : 0,
    sweep: total >= 0 ? 1 : 0,
    rms,
  };
}

/** Axis aligned ellipse fit (used when circular arcs are disabled). */
export function fitEllipse(pts: Pt[], tol: number): ArcFit | null {
  const pts2 = dedupe(pts);
  if (pts2.length < 6) return null;
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const p of pts2) {
    rows.push([p.x * p.x, p.y * p.y, p.x, p.y, 1]);
    rhs.push(-1);
  }
  const A: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
  const b: number[] = new Array(5).fill(0);
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < 5; i++) {
      b[i] += rows[r][i] * rhs[r];
      for (let j = 0; j < 5; j++) A[i][j] += rows[r][i] * rows[r][j];
    }
  }
  const sol = solveLinear(A, b);
  if (!sol) return null;
  const [a, c, d, e, f] = sol;
  if (a === 0 || c === 0) return null;
  const cx = -d / (2 * a);
  const cy = -e / (2 * c);
  const k = f - a * cx * cx - c * cy * cy;
  if (k === 0 || a * c <= 0) return null;
  const rx = Math.sqrt(-k / a);
  const ry = Math.sqrt(-k / c);
  if (!isFinite(rx) || !isFinite(ry) || rx < 2 || ry < 2) return null;
  const ratio = rx / ry;
  if (ratio < 0.25 || ratio > 4) return null;
  // Same ill-conditioned-fit guard as fitArc: reject an ellipse whose axes are
  // wildly larger than the point set it was fit from (a near-degenerate normal
  // system can still satisfy the error tolerance below with a huge ellipse).
  const [ebx0, eby0, ebx1, eby1] = bboxOf(pts2);
  const espread = Math.max(ebx1 - ebx0, eby1 - eby0, 20);
  if (rx > espread * 8 || ry > espread * 8) return null;
  const value = (p: Pt) => a * p.x * p.x + c * p.y * p.y + d * p.x + e * p.y + f;
  let worst = 0;
  for (const p of pts2) worst = Math.max(worst, Math.abs(value(p)));
  const scale = Math.max(Math.abs(a) * rx * rx, 1e-6);
  if (worst / scale > tol * 2) return null;
  const start = pts2[0];
  const end = pts2[pts2.length - 1];
  const sweepFlag: 0 | 1 = shoelace([pts2[0], pts2[Math.floor(pts2.length / 2)], end]) >= 0 ? 1 : 0;
  return {
    cx,
    cy,
    rx,
    ry,
    rot: 0,
    start,
    end,
    large: 0,
    sweep: sweepFlag,
    rms: worst / scale,
  };
}

/* ------------------------------------------------------------------ */
/* Segment helpers                                                     */
/* ------------------------------------------------------------------ */

export function segsFromCubics(start: Pt, cubics: Cubic[], close: boolean): Seg[] {
  const segs: Seg[] = [{ t: "M", x: start.x, y: start.y }];
  for (const c of cubics) {
    const straight =
      Math.abs(c.c1.x - c.p0.x - (c.p3.x - c.p0.x) / 3) < 1e-6 &&
      Math.abs(c.c1.y - c.p0.y - (c.p3.y - c.p0.y) / 3) < 1e-6;
    if (straight && dist(c.p0, c.p3) > 0.001) {
      segs.push({ t: "L", x: c.p3.x, y: c.p3.y });
    } else {
      segs.push({ t: "C", c1x: c.c1.x, c1y: c.c1.y, c2x: c.c2.x, c2y: c.c2.y, x: c.p3.x, y: c.p3.y });
    }
  }
  if (close) segs.push({ t: "Z" });
  return segs;
}

export function lineSegs(points: Pt[], close: boolean): Seg[] {
  if (points.length === 0) return [];
  const segs: Seg[] = [{ t: "M", x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) segs.push({ t: "L", x: points[i].x, y: points[i].y });
  if (close) segs.push({ t: "Z" });
  return segs;
}

const cubicAt = (p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt => {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y,
  };
};

/** Flatten any segment list to a polyline (DXF / PDF fallbacks). */
export function flatten(segs: Seg[], tol = 0.35): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  const push = (p: Pt) => {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  };
  for (const s of segs) {
    switch (s.t) {
      case "M":
        cur = { x: s.x, y: s.y };
        push(cur);
        break;
      case "L":
        cur = { x: s.x, y: s.y };
        push(cur);
        break;
      case "Q": {
        const p0 = cur;
        const p2 = { x: s.x, y: s.y };
        const c = { x: s.cx, y: s.cy };
        const steps = Math.max(4, Math.min(32, Math.ceil(dist(p0, p2) / Math.max(tol, 0.3))));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          push({
            x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p2.x,
            y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p2.y,
          });
        }
        cur = p2;
        break;
      }
      case "C": {
        const p0 = cur;
        const p3 = { x: s.x, y: s.y };
        const c1 = { x: s.c1x, y: s.c1y };
        const c2 = { x: s.c2x, y: s.c2y };
        const steps = Math.max(4, Math.min(48, Math.ceil((dist(p0, c1) + dist(c1, c2) + dist(c2, p3)) / Math.max(tol, 0.3))));
        for (let i = 1; i <= steps; i++) push(cubicAt(p0, c1, c2, p3, i / steps));
        cur = p3;
        break;
      }
      case "A": {
        for (const c of arcToCubics(cur, s)) push(c.end);
        cur = { x: s.x, y: s.y };
        break;
      }
      case "Z":
        break;
    }
  }
  return out;
}

/** SVG-style arc -> cubic bezier chain. */
export function arcToCubics(
  from: Pt,
  arc: Extract<Seg, { t: "A" }>,
): { c1: Pt; c2: Pt; end: Pt }[] {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  const x1 = from.x;
  const y1 = from.y;
  const x2 = arc.x;
  const y2 = arc.y;
  const phi = ((arc.rot ?? 0) * Math.PI) / 180;
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  if (rx === 0 || ry === 0) return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x: x2, y: y2 } }];
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = arc.large === arc.sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!arc.sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (arc.sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / count;
  const t = ((4 / 3) * Math.tan(delta / 4));
  const out: { c1: Pt; c2: Pt; end: Pt }[] = [];
  let th = theta1;
  let sx = x1;
  let sy = y1;
  for (let i = 0; i < count; i++) {
    const th2 = th + delta;
    const e = {
      x: cosP * rx * Math.cos(th2) - sinP * ry * Math.sin(th2) + cx,
      y: sinP * rx * Math.cos(th2) + cosP * ry * Math.sin(th2) + cy,
    };
    const d1 = {
      x: -rx * Math.sin(th),
      y: ry * Math.cos(th),
    };
    const d2 = {
      x: -rx * Math.sin(th2),
      y: ry * Math.cos(th2),
    };
    const c1 = {
      x: sx + t * (cosP * d1.x - sinP * d1.y),
      y: sy + t * (sinP * d1.x + cosP * d1.y),
    };
    const c2 = {
      x: e.x - t * (cosP * d2.x - sinP * d2.y),
      y: e.y - t * (sinP * d2.x + cosP * d2.y),
    };
    out.push({ c1, c2, end: e });
    th = th2;
    sx = e.x;
    sy = e.y;
  }
  return out;
}


/** Cubics whose control points hug their chord are straight lines in disguise (they
 *  appear when a straight edge is cut into several runs). Emit them as lines, then merge
 *  neighbouring collinear lines, so straight edges stay perfectly straight and never wobble. */
function straightenSegs(segs: Seg[], tol: number): Seg[] {
  // strict: a gentle curve must never be flattened into a polygon (that is the very
  // faceting we are removing), so only pieces that really are straight qualify
  const lim = Math.max(0.12, tol * 0.3);
  const out: Seg[] = [];
  // for every emitted line: the start point and all intermediate vertices it swallowed
  const lineStart: (Pt | null)[] = [];
  const lineVerts: Pt[][] = [];
  let cx = 0;
  let cy = 0;
  const offChord = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) return Math.hypot(px - ax, py - ay);
    return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
  };
  for (const g of segs) {
    if (g.t === "M" || g.t === "Z") {
      out.push(g);
      lineStart.push(null);
      lineVerts.push([]);
      if (g.t === "M") {
        cx = g.x;
        cy = g.y;
      }
      continue;
    }
    let seg: Seg = g;
    if (g.t === "C") {
      if (offChord(g.c1x, g.c1y, cx, cy, g.x, g.y) <= lim && offChord(g.c2x, g.c2y, cx, cy, g.x, g.y) <= lim) {
        seg = { t: "L", x: g.x, y: g.y };
      }
    } else if (g.t === "Q") {
      if (offChord(g.cx, g.cy, cx, cy, g.x, g.y) <= lim) seg = { t: "L", x: g.x, y: g.y };
    }
    const k = out.length - 1;
    if (seg.t === "L" && k >= 0 && out[k].t === "L" && lineStart[k]) {
      const st = lineStart[k] as Pt;
      const mid = lineVerts[k].concat([{ x: (out[k] as { x: number }).x, y: (out[k] as { y: number }).y }]);
      // merge only if EVERY swallowed vertex still sits on the merged line
      if (mid.every((m) => offChord(m.x, m.y, st.x, st.y, seg.x, seg.y) <= lim)) {
        out[k] = { t: "L", x: seg.x, y: seg.y };
        lineVerts[k] = mid;
        cx = seg.x;
        cy = seg.y;
        continue;
      }
    }
    out.push(seg);
    lineStart.push(seg.t === "L" ? { x: cx, y: cy } : null);
    lineVerts.push([]);
    cx = (seg as { x: number }).x;
    cy = (seg as { y: number }).y;
  }
  return out;
}

export function fitPolyline(
  points: Pt[],
  opts: {
    closed: boolean;
    cornerThreshold: number;
    cornerWindow: number;
    tol: number;
    curveTypes: {
      lines: boolean;
      quadratic: boolean;
      cubic: boolean;
      circularArcs: boolean;
      ellipticalArcs: boolean;
    };
  },
): Seg[] {
  const pts = dedupe(points);
  if (pts.length < 2) return [];
  if (pts.length === 2) return lineSegs(pts, opts.closed);
  // A contour that simplified down to a handful of vertices is a polygon
  // (rectangle, triangle, arrow…). Feeding that into the Bezier fitter made the
  // tangents overshoot and inflated the shape badly (measured: a 200x140 rect
  // rendered as 222x192, shifted 22 px). Straight segments are exact.
  if (pts.length <= 8) return lineSegs(pts, opts.closed);
  const flags = detectCorners(pts, opts.cornerThreshold, opts.cornerWindow, opts.closed);
  const runs = splitAtCorners(pts, flags);
  const segs: Seg[] = [];
  const parts: Pt[][] = runs.length ? runs : [pts.slice().concat(opts.closed ? [pts[0]] : [])];
  for (const run of parts) {
    appendRun(segs, run, opts);
  }
  if (segs.length === 0) return lineSegs(pts, opts.closed);
  if (opts.closed) segs.push({ t: "Z" });
  {
    const straight = straightenSegs(segs, opts.tol);
    segs.length = 0;
    segs.push(...straight);
  }
  // Sliver guard: a fitted closed contour whose shape is a hair-thin sliver has an
  // enormous perimeter²/area ratio and renders as a stray hairline across the
  // artwork. Such a loop falls back to its exact traced segments, while normal
  // contours (ratio near 16-40) keep their smooth curves.
  if (opts.closed) {
    const flat = flatten(segs, 0.7);
    if (flat.length > 4) {
      let area = 0;
      let perim = 0;
      for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) {
        area += flat[j].x * flat[i].y - flat[i].x * flat[j].y;
      }
      area = Math.abs(area / 2);
      for (let i = 0; i < flat.length; i++) {
        const a = flat[i];
        const b = flat[(i + 1) % flat.length];
        perim += Math.hypot(b.x - a.x, b.y - a.y);
      }
      const thinness = area > 0 ? (perim * perim) / area : Number.POSITIVE_INFINITY;
      if (area < 4 || thinness > 300) {
        const fallback = lineSegs(pts, true);
        if (fallback.length) return fallback;
      }
    }
  }
  return segs;
}

/** An edge between two simplified vertices longer than this is emitted as an exact
 *  straight line. The simplifier guarantees every edge stays within a fraction of
 *  a pixel of the real contour, so a long edge IS a straight stretch of the shape.
 *  Handing it to the arc / Bezier fitters together with only a few neighbouring
 *  vertices is what produced wavy vent lines and huge bulging arcs: with 3-6
 *  points, any circle or curve "fits" with zero error. */
const LONG_EDGE_PX = Number.POSITIVE_INFINITY;

type FitOpts = {
  tol: number;
  curveTypes: {
    lines: boolean;
    quadratic: boolean;
    cubic: boolean;
    circularArcs: boolean;
    ellipticalArcs: boolean;
  };
};

function appendRun(segs: Seg[], runRaw: Pt[], opts: FitOpts): void {
  const run = dedupe(runRaw);
  if (run.length < 2) return;
  if (segs.length === 0) segs.push({ t: "M", x: run[0].x, y: run[0].y });

  let hasLong = false;
  for (let i = 1; i < run.length; i++) {
    if (dist(run[i - 1], run[i]) > LONG_EDGE_PX) {
      hasLong = true;
      break;
    }
  }
  if (!hasLong) {
    appendFittedRun(segs, run, opts);
    return;
  }
  let start = 0;
  for (let i = 1; i < run.length; i++) {
    if (dist(run[i - 1], run[i]) > LONG_EDGE_PX) {
      if (i - 1 > start) appendFittedRun(segs, run.slice(start, i), opts);
      segs.push({ t: "L", x: run[i].x, y: run[i].y });
      start = i;
    }
  }
  if (run.length - 1 > start) appendFittedRun(segs, run.slice(start), opts);
}

function appendFittedRun(segs: Seg[], run: Pt[], opts: FitOpts): void {
  if (run.length < 2) return;
  const tol = opts.tol;
  if (run.length === 2) {
    segs.push({ t: "L", x: run[1].x, y: run[1].y });
    return;
  }

  const first = run[0];
  const last = run[run.length - 1];
  const chord = dist(first, last);
  // A closed run (start === end, e.g. a smooth contour with no detected corner)
  // has no meaningful chord: "is it a straight line / an arc?" cannot be tested
  // on it. Treat it as a curve, otherwise the whole loop collapses to a point.
  const closedRun = chord <= Math.max(2 * tol, 2);

  if (!closedRun) {
    const straight = (() => {
      const l = chord || 1;
      for (const p of run) {
        const d = Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / l;
        if (d > tol) return false;
      }
      return true;
    })();
    if (straight && opts.curveTypes.lines) {
      segs.push({ t: "L", x: last.x, y: last.y });
      return;
    }
    if (opts.curveTypes.circularArcs && run.length >= 6) {
      const arc = fitArc(run, Math.max(tol, 0.35));
      if (arc && dist(arc.start, arc.end) > 0.05) {
        segs.push({
          t: "A",
          rx: arc.rx,
          ry: arc.rx,
          rot: 0,
          large: arc.large,
          sweep: arc.sweep,
          x: last.x,
          y: last.y,
        });
        return;
      }
    }
    if (opts.curveTypes.ellipticalArcs && run.length >= 6) {
      const ell = fitEllipse(run, Math.max(tol, 0.5));
      if (ell && dist(ell.start, ell.end) > 0.05) {
        segs.push({
          t: "A",
          rx: ell.rx,
          ry: ell.ry,
          rot: ell.rot,
          large: ell.large,
          sweep: ell.sweep,
          x: last.x,
          y: last.y,
        });
        return;
      }
    }
  }

  if (opts.curveTypes.cubic) {
    const cubics = fitCubics(run, Math.max(tol, 0.25));
    let emitted = 0;
    for (const c of cubics) {
      if (dist(c.p0, c.p3) < 1e-6 && dist(c.p0, c.c1) < 1e-6 && dist(c.p0, c.c2) < 1e-6) continue;
      segs.push({ t: "C", c1x: c.c1.x, c1y: c.c1.y, c2x: c.c2.x, c2y: c.c2.y, x: c.p3.x, y: c.p3.y });
      emitted += 1;
    }
    if (emitted) return;
  }
  if (opts.curveTypes.quadratic) {
    const quads = fitQuadratics(run);
    let emitted = 0;
    for (const q of quads) {
      if (q.t === "Q" && dist({ x: q.x, y: q.y }, first) < 1e-9) continue;
      segs.push(q);
      emitted += 1;
    }
    if (emitted) return;
  }
  // last resort: straight segments so nothing can disappear
  for (let i = 1; i < run.length; i++) {
    if (dist(run[i - 1], run[i]) < 1e-9) continue;
    segs.push({ t: "L", x: run[i].x, y: run[i].y });
  }
}

