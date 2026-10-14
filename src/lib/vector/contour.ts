import type { Pt } from "./geom";

/**
 * Smooth sub-pixel contour tracing.
 *
 * The old tracer walked the pixel staircase of the mask and then slid every vertex on its own
 * along the (JPEG-noisy) coverage gradient. Each vertex got its own small error, so straight
 * edges came out wavy and blobs came out lumpy, and the later smoothing could not remove such
 * slow waves.
 *
 * Here the contour is the 0.5 iso-line of the coverage field itself (marching squares with
 * linear interpolation). It is one continuous curve, with sub-pixel position taken directly
 * from the anti-aliased edge ramp, so there is no per-vertex noise. The field is first made
 * consistent with the cleaned-up mask (despeckle / open / close / hairline trimming) and then
 * blurred very slightly so scanner/JPEG noise does not leave ripples.
 */

function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src;
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) {
        const xx = x + t < 0 ? 0 : x + t >= w ? w - 1 : x + t;
        acc += src[row + xx] * k[t + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) {
        const yy = y + t < 0 ? 0 : y + t >= h ? h - 1 : y + t;
        acc += tmp[yy * w + x] * k[t + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/**
 * Closed loops (first point not repeated) around every region of `field >= 0.5`.
 * Outer boundaries have a positive shoelace sum and holes a negative one, the same
 * convention as the pixel tracer, so the rest of the pipeline is unchanged.
 */
export function traceField(
  field: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  sigma = 0.6,
): Pt[][] {
  const n = w * h;
  // 1. field consistent with the cleaned mask
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = field[i];
    if (mask[i]) g[i] = f >= 0.5 ? f : 0.55;
    else g[i] = f < 0.5 ? f : 0.45;
  }
  const b = gaussianBlur(g, w, h, sigma);

  // 2. padded grid: the ring outside the image is chosen so the 0.5 crossing lands exactly on
  //    the image border for ink touching the border, which closes those shapes cleanly.
  const W = w + 2;
  const H = h + 2;
  const P = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    const row = (y + 1) * W + 1;
    for (let x = 0; x < w; x++) P[row + x] = b[y * w + x];
  }
  const pad = (v: number) => (v >= 0.5 ? Math.min(0.49, 1 - v) : 0);
  for (let x = 0; x < w; x++) {
    P[x + 1] = pad(b[x]);
    P[(H - 1) * W + x + 1] = pad(b[(h - 1) * w + x]);
  }
  for (let y = 0; y < h; y++) {
    P[(y + 1) * W] = pad(b[y * w]);
    P[(y + 1) * W + W - 1] = pad(b[y * w + w - 1]);
  }
  P[0] = pad(b[0]);
  P[W - 1] = pad(b[w - 1]);
  P[(H - 1) * W] = pad(b[(h - 1) * w]);
  P[(H - 1) * W + W - 1] = pad(b[(h - 1) * w + w - 1]);

  // 3. directed segments between edge crossings, inside always on the right (screen coords)
  //    edge id: 2*(j*W+i) = horizontal edge starting at (i,j); +1 = vertical edge starting at (i,j)
  const next = new Int32Array(2 * W * H).fill(-1);
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const base = j * W + i;
      const a = P[base];
      const bb = P[base + 1];
      const c = P[base + W + 1];
      const d = P[base + W];
      const idx = (a >= 0.5 ? 1 : 0) | (bb >= 0.5 ? 2 : 0) | (c >= 0.5 ? 4 : 0) | (d >= 0.5 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = 2 * base;
      const B = 2 * (base + W);
      const L = 2 * base + 1;
      const R = 2 * (base + 1) + 1;
      // inside corner: from the clockwise-next edge to the clockwise-previous edge
      // outside corner (inside is the remainder): the reverse
      const cutTL = (inside: boolean) => (inside ? (next[T] = L) : (next[L] = T));
      const cutTR = (inside: boolean) => (inside ? (next[R] = T) : (next[T] = R));
      const cutBR = (inside: boolean) => (inside ? (next[B] = R) : (next[R] = B));
      const cutBL = (inside: boolean) => (inside ? (next[L] = B) : (next[B] = L));
      switch (idx) {
        case 1: cutTL(true); break;
        case 2: cutTR(true); break;
        case 4: cutBR(true); break;
        case 8: cutBL(true); break;
        case 14: cutTL(false); break;
        case 13: cutTR(false); break;
        case 11: cutBR(false); break;
        case 7: cutBL(false); break;
        case 3: next[R] = L; break;
        case 6: next[B] = T; break;
        case 12: next[L] = R; break;
        case 9: next[T] = B; break;
        case 5: {
          const centreIn = (a + bb + c + d) / 4 >= 0.5;
          if (centreIn) {
            cutTR(false);
            cutBL(false);
          } else {
            cutTL(true);
            cutBR(true);
          }
          break;
        }
        case 10: {
          const centreIn = (a + bb + c + d) / 4 >= 0.5;
          if (centreIn) {
            cutTL(false);
            cutBR(false);
          } else {
            cutTR(true);
            cutBL(true);
          }
          break;
        }
      }
    }
  }

  // 4. link segments into closed loops
  const point = (id: number): Pt => {
    const e = id >> 1;
    const i = e % W;
    const j = (e - i) / W;
    if ((id & 1) === 0) {
      const v0 = P[e];
      const v1 = P[e + 1];
      const t = (0.5 - v0) / (v1 - v0);
      return { x: i + t - 0.5, y: j - 0.5 };
    }
    const v0 = P[e];
    const v1 = P[e + W];
    const t = (0.5 - v0) / (v1 - v0);
    return { x: i - 0.5, y: j + t - 0.5 };
  };
  const seen = new Uint8Array(next.length);
  const loops: Pt[][] = [];
  for (let id = 0; id < next.length; id++) {
    if (next[id] < 0 || seen[id]) continue;
    const pts: Pt[] = [];
    let cur = id;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1;
      pts.push(point(cur));
      cur = next[cur];
    }
    if (pts.length >= 4) loops.push(pts);
  }
  return loops;
}

/** Closed loop resampled to (roughly) even spacing. */
function resampleClosed(pts: Pt[], step: number): Pt[] {
  const n = pts.length;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n];
  const count = Math.max(8, Math.round(total / step));
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = (k / count) * total;
    while (seg < n - 1 && cum[seg + 1] < d) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const len = cum[seg + 1] - cum[seg] || 1;
    const t = (d - cum[seg]) / len;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Removes the slow ripples and tiny spurs that JPEG / anti-aliasing noise leaves in a traced
 * contour, without shrinking shapes and without rounding real corners.
 *
 * - The loop is resampled at 1 px spacing.
 * - A vertex is a real corner when the direction changes by CORNER_DEG or more measured over
 *   +-6 px. A one-pixel spur turns the direction there and back, so it does not register at that
 *   scale and gets smoothed away; a true corner does register and stays pinned.
 * - The rest is smoothed with Taubin lambda|mu filtering, a low-pass that does not shrink curves
 *   (plain averaging makes small circles and thin strokes thinner). Wavelengths longer than about
 *   `minWavelength` px pass through untouched.
 */
export function smoothContour(
  loop: Pt[],
  opts: { iterations?: number; minWavelength?: number; cornerDeg?: number } = {},
): Pt[] {
  const iterations = opts.iterations ?? 10;
  const minWavelength = opts.minWavelength ?? 12;
  const cornerDeg = opts.cornerDeg ?? 40;
  if (loop.length < 12) return loop;
  const pts = resampleClosed(loop, 1);
  const n = pts.length;
  if (n < 16) return loop;

  // Corner test at two scales. A real corner concentrates its turn right at the vertex, so the
  // direction change measured over +-2 px is already most of the change measured over +-K px.
  // A tight but smooth curve (round end of a thin stroke, small dot, small radius fillet) spreads
  // the same turn along the arc, so the short-scale turn is only about 1/3 of the long-scale one.
  // Without this check every vertex of such a curve counted as a corner, was pinned and stayed
  // as lumpy as the raw trace.
  const K = 6;
  const KS = 2;
  const turnAt = (i: number, k: number): number => {
    const p0 = pts[(i - k + n * 2) % n];
    const p1 = pts[i];
    const p2 = pts[(i + k) % n];
    const ax = p1.x - p0.x;
    const ay = p1.y - p0.y;
    const bx = p2.x - p1.x;
    const by = p2.y - p1.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) return 0;
    const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    return (Math.acos(c) * 180) / Math.PI;
  };
  const turn = new Float32Array(n);
  const turnShort = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    turn[i] = turnAt(i, K);
    turnShort[i] = turnAt(i, KS);
  }
  const pinned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (turn[i] < cornerDeg) continue;
    if (turnShort[i] < 0.7 * turn[i]) continue; // turn is spread out -> smooth curve, not a corner
    let isMax = true;
    for (let t = -K; t <= K && isMax; t++) {
      if (t === 0) continue;
      const v = turn[(i + t + n) % n];
      if (v > turn[i] || (v === turn[i] && t < 0)) isMax = false;
    }
    if (isMax) pinned[i] = 1;
  }

  const lambda = 0.5;
  const kpb = (2 * Math.PI) / minWavelength;
  const mu = 1 / (kpb * kpb - 1 / lambda);
  let cur = pts;
  const step = (src: Pt[], f: number): Pt[] => {
    const out: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (pinned[i]) {
        out[i] = src[i];
        continue;
      }
      const a = src[(i - 1 + n) % n];
      const b = src[(i + 1) % n];
      const s = src[i];
      out[i] = { x: s.x + f * ((a.x + b.x) / 2 - s.x), y: s.y + f * ((a.y + b.y) / 2 - s.y) };
    }
    return out;
  };
  for (let it = 0; it < iterations; it++) {
    cur = step(cur, lambda);
    cur = step(cur, mu);
  }
  return cur;
}
