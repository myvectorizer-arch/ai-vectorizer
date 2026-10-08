import { type Pt, bboxOf, round, shoelace, simplifyClosed } from "./geom";
import type { Raster } from "./decode";
import type { BaseSettings } from "./types";

/** Flat [x,y,x,y…] loops in trace-space coordinates. */
export type TraceLoop = number[];

export type TraceShape = {
  color: [number, number, number, number];
  hex: string;
  area: number;
  depth: number;
  level: number;
  bbox: [number, number, number, number];
  outer: TraceLoop[];
  holes: TraceLoop[];
  parent: number;
};

export type PipelineStep = { step: string; ms: number; note?: string };

export type TraceResult = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  shapes: TraceShape[];
  palette: [number, number, number][];
  background: [number, number, number] | null;
  pipeline: PipelineStep[];
  analyzedAt: string;
  warning?: string | null;
  base: BaseSettings;
};

type Centroid = [number, number, number];

type Channels = {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  a: Uint8Array;
  w: number;
  h: number;
  n: number;
};

export const hexOf = (c: number[]) =>
  "#" +
  c
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

const distance = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
  Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

function extractChannels(raster: Raster): Channels {
  const { width: w, height: h, data } = raster;
  const n = w * h;
  const r = new Uint8Array(n);
  const g = new Uint8Array(n);
  const b = new Uint8Array(n);
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4];
    g[i] = data[i * 4 + 1];
    b[i] = data[i * 4 + 2];
    a[i] = data[i * 4 + 3];
  }
  return { r, g, b, a, w, h, n };
}

/** Dominant colour along the image border – the paper of the artwork. */
function detectBackground(ch: Channels): { color: Centroid; coverage: number } | null {
  const { r, g, b, a, w, h } = ch;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let total = 0;
  const sample = (x: number, y: number) => {
    const i = y * w + x;
    if (a[i] < 128) return;
    const key = ((r[i] >> 4) << 8) | ((g[i] >> 4) << 4) | (b[i] >> 4);
    const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cur.count += 1;
    cur.r += r[i];
    cur.g += g[i];
    cur.b += b[i];
    buckets.set(key, cur);
    total += 1;
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }
  if (!total) return null;
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!best || v.count > best.count) best = v;
  if (!best) return null;
  return {
    color: [best.r / best.count, best.g / best.count, best.b / best.count],
    coverage: best.count / total,
  };
}

/** Flood fill from the border: removes the connected background region. */
function floodRemoveBackground(ch: Channels, bg: Centroid, thresh: number): number {
  const { r, g, b, a, w, h, n } = ch;
  const stack = new Int32Array(n);
  let sp = 0;
  const similar = (i: number) => a[i] > 0 && distance(r[i], g[i], b[i], bg[0], bg[1], bg[2]) < thresh;
  const push = (i: number) => {
    if (similar(i)) {
      stack[sp++] = i;
      a[i] = 0;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  let removed = 0;
  while (sp > 0) {
    const i = stack[--sp];
    removed += 1;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return removed;
}

/**
 * The background flood fill also removes the anti-aliased rim, which shrinks every
 * shape by ~1px. Growing the kept region back restores the 50 % coverage edge.
 */
function reclaimEdge(alpha: Uint8Array, w: number, h: number, iterations = 1): void {
  for (let pass = 0; pass < iterations; pass++) {
    const grow: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha[i] !== 0) continue;
        if (
          (x > 0 && alpha[i - 1] === 255) ||
          (x < w - 1 && alpha[i + 1] === 255) ||
          (y > 0 && alpha[i - w] === 255) ||
          (y < h - 1 && alpha[i + w] === 255)
        ) {
          grow.push(i);
        }
      }
    }
    if (!grow.length) break;
    for (const i of grow) alpha[i] = 255;
  }
}

/** Edge-preserving 3x3 smoothing – removes compression grain, keeps edges. */
function smoothColors(ch: Channels, thresh: number): void {
  const { r, g, b, a, w, h } = ch;
  const nr = Uint8Array.from(r);
  const ng = Uint8Array.from(g);
  const nb = Uint8Array.from(b);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (a[i] === 0) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (a[j] === 0) continue;
          if (distance(r[i], g[i], b[i], r[j], g[j], b[j]) > thresh) continue;
          sr += r[j];
          sg += g[j];
          sb += b[j];
          count += 1;
        }
      }
      if (count > 1) {
        nr[i] = sr / count;
        ng[i] = sg / count;
        nb[i] = sb / count;
      }
    }
  }
  r.set(nr);
  g.set(ng);
  b.set(nb);
}

function posterizeChannel(v: Uint8Array, levels: number): void {
  const stepv = 255 / (levels - 1);
  for (let i = 0; i < v.length; i++) v[i] = Math.round(Math.round(v[i] / stepv) * stepv);
}

/** k-means++ style seeding with Lloyd refinement. */
function kmeans(
  samples: Float64Array,
  count: number,
  k: number,
  iterations = 16,
): { centers: Centroid[]; sizes: number[] } {
  const centers: Centroid[] = [[samples[0], samples[1], samples[2]]];
  const dists = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  while (centers.length < k) {
    let bestIdx = 0;
    let bestD = -1;
    for (let i = 0; i < count; i++) {
      const r = samples[i * 3];
      const g = samples[i * 3 + 1];
      const b = samples[i * 3 + 2];
      let minD = Number.POSITIVE_INFINITY;
      for (const c of centers) {
        const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < minD) minD = d;
      }
      dists[i] = minD;
      if (minD > bestD) {
        bestD = minD;
        bestIdx = i;
      }
    }
    if (bestD <= 0) break;
    centers.push([samples[bestIdx * 3], samples[bestIdx * 3 + 1], samples[bestIdx * 3 + 2]]);
  }
  const sizes = new Array<number>(centers.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    const sums: number[][] = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < sizes.length; i++) sizes[i] = 0;
    for (let i = 0; i < count; i++) {
      const r = samples[i * 3];
      const g = samples[i * 3 + 1];
      const b = samples[i * 3 + 2];
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centers.length; c++) {
        const d = (r - centers[c][0]) ** 2 + (g - centers[c][1]) ** 2 + (b - centers[c][2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      sums[best][0] += r;
      sums[best][1] += g;
      sums[best][2] += b;
      sums[best][3] += 1;
      sizes[best] += 1;
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] === 0) continue;
      const nr = sums[c][0] / sums[c][3];
      const ng = sums[c][1] / sums[c][3];
      const nb = sums[c][2] / sums[c][3];
      moved = Math.max(
        moved,
        Math.abs(nr - centers[c][0]) + Math.abs(ng - centers[c][1]) + Math.abs(nb - centers[c][2]),
      );
      centers[c] = [nr, ng, nb];
    }
    if (moved < 0.4) break;
  }
  return { centers, sizes };
}

/**
 * Count the *real* flat colours in the artwork.
 *
 * The share of each colour is measured against the non-dominant pixels: a
 * full-page paper would otherwise drown a real accent colour (a teal accent over
 * 5 % of the artwork only reaches ~1 % of the canvas) and the palette dropped it.
 */
function estimateNaturalColors(
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
  alpha: Uint8Array,
  n: number,
): number {
  const bins = new Map<number, number>();
  let opaque = 0;
  const step = Math.max(1, Math.floor(n / 220_000));
  for (let i = 0; i < n; i += step) {
    if (alpha[i] === 0) continue;
    const key = ((r[i] >> 4) << 8) | ((g[i] >> 4) << 4) | (b[i] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
    opaque += 1;
  }
  if (!opaque) return 0;
  let dominant = 0;
  for (const count of bins.values()) if (count > dominant) dominant = count;
  const nonDominant = Math.max(1, opaque - dominant);
  const threshold = nonDominant * 0.008;
  let strong = 0;
  for (const count of bins.values()) {
    if (count === dominant) continue;
    if (count >= threshold) strong += 1;
  }
  return strong + 1;
}

/**
 * Is this palette colour a *real* flat colour rather than an anti-aliasing fringe?
 *
 * Measured on real artwork: a genuine colour (paper, black, red) survives a 2px
 * erosion with 70–94 % of its pixels, because it forms thick regions. An
 * anti-aliasing fringe – including a dark red that only exists between black and
 * bright red – is 2 px wide and loses everything (0.1–1 % survival, thickness
 * ≈ 2 px). Comparing colours against each other is *not* enough: a dark red does
 * lie between black and red, yet only this thickness test tells artwork from halo.
 */
function isRealColour(
  labels: Int16Array,
  colour: number,
  w: number,
  h: number,
  minSurvivors: number,
): boolean {
  const mask = new Uint8Array(labels.length);
  let total = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === colour) {
      mask[i] = 1;
      total += 1;
    }
  }
  if (total < 12) return false;
  let survivors = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (mask[i - 2] && mask[i + 2] && mask[i - 2 * w] && mask[i + 2 * w]) survivors += 1;
    }
  }
  return survivors >= minSurvivors && survivors >= total * 0.2;
}

/** Average thickness of a colour's mask (2·area/perimeter) – fringes are ~2px. */
function maskThickness(mask: Uint8Array, w: number, h: number): number {
  let area = 0;
  let perimeter = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      area += 1;
      if (
        x === 0 ||
        x === w - 1 ||
        y === 0 ||
        y === h - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - w] ||
        !mask[i + w]
      ) {
        perimeter += 1;
      }
    }
  }
  return perimeter > 0 ? (2 * area) / perimeter : area;
}

/** Morphology helpers (erode / dilate / opening / closing). */
function erodeMask(mask: Uint8Array, w: number, h: number, r: number, scratch: Uint8Array): void {
  let src = mask;
  let dst = scratch;
  for (let axis = 0; axis < 2; axis++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let keep = 1;
        for (let d = -r; d <= r && keep; d++) {
          const xx = axis === 0 ? x + d : x;
          const yy = axis === 1 ? y + d : y;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !src[yy * w + xx]) keep = 0;
        }
        dst[i] = keep;
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  if (src !== mask) mask.set(src);
}

function dilateMask(mask: Uint8Array, w: number, h: number, r: number, scratch: Uint8Array): void {
  let src = mask;
  let dst = scratch;
  for (let axis = 0; axis < 2; axis++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let keep = 0;
        for (let d = -r; d <= r && !keep; d++) {
          const xx = axis === 0 ? x + d : x;
          const yy = axis === 1 ? y + d : y;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (src[yy * w + xx]) keep = 1;
        }
        dst[i] = keep;
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  if (src !== mask) mask.set(src);
}

/** Opening = erode then dilate; it keeps the shape's size (a plain min filter does not). */
function openMask(mask: Uint8Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const scratch = new Uint8Array(mask.length);
  erodeMask(mask, w, h, r, scratch);
  dilateMask(mask, w, h, r, scratch);
}

/** Closing = dilate then erode; heals gaps without growing the shape. */
function closeMask(mask: Uint8Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const scratch = new Uint8Array(mask.length);
  dilateMask(mask, w, h, r, scratch);
  erodeMask(mask, w, h, r, scratch);
}

/** Remove connected components smaller than `minArea`. */
function despeckle(mask: Uint8Array, w: number, h: number, minArea: number): void {
  const n = mask.length;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp = new Int32Array(n);
  let compId = 0;
  const sizes: number[] = [0];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    compId += 1;
    let size = 0;
    while (sp > 0) {
      const i = stack[--sp];
      comp[i] = compId;
      size += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[sp++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[sp++] = i + 1;
      }
      if (y > 0 && mask[i - w] && !seen[i - w]) {
        seen[i - w] = 1;
        stack[sp++] = i - w;
      }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) {
        seen[i + w] = 1;
        stack[sp++] = i + w;
      }
    }
    sizes[compId] = size;
  }
  const drop = new Set<number>();
  for (let c = 1; c <= compId; c++) if ((sizes[c] ?? 0) < minArea) drop.add(c);
  if (!drop.size) return;
  for (let i = 0; i < n; i++) if (mask[i] && drop.has(comp[i])) mask[i] = 0;
}

/**
 * Remove 1-3px wide trails whose *source pixels do not carry the traced colour*.
 * Such a trail (a JPEG ghost or a fit artefact) does not exist in the artwork, so
 * removing it is not "deleting detail" – it runs in faithful mode too, while real
 * hairlines (source colour ≈ traced colour) and thick lines are untouched.
 */
function trimHairlines(
  mask: Uint8Array,
  w: number,
  h: number,
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
  bgRef: Centroid,
  labelColor: Centroid,
  isBackgroundColour: boolean,
): number {
  // Never trim the paper itself: the narrow white channels between fingers, spokes
  // or letter strokes *are* artwork. Removing them merged whole shapes together.
  if (isBackgroundColour) return 0;
  const remove: number[] = [];
  const maxWidth = 3;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (mask[i + dy * w + dx]) neighbours += 1;
        }
      }
      if (neighbours > maxWidth) continue;
      const distToBg = Math.sqrt(
        (r[i] - bgRef[0]) ** 2 + (g[i] - bgRef[1]) ** 2 + (b[i] - bgRef[2]) ** 2,
      );
      const distToLabel = Math.sqrt(
        (r[i] - labelColor[0]) ** 2 + (g[i] - labelColor[1]) ** 2 + (b[i] - labelColor[2]) ** 2,
      );
      // Only drop a thin trail when the source there is clearly *nearer the paper*
      // than the colour we are painting (a ghost), or plainly the wrong colour.
      if (distToBg * 1.6 < distToLabel || distToLabel > 110) remove.push(i);
    }
  }
  for (const i of remove) mask[i] = 0;
  return remove.length;
}

/**
 * Phantom-region filter (cleanup mode): a region whose source pixels are basically
 * background was painted from ringing / anti-aliasing, not from artwork.
 */
function dropPhantomComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
  bgRef: Centroid,
  labelColor: Centroid,
): number {
  const n = mask.length;
  const colourDist = (i: number, ref: Centroid) =>
    Math.sqrt((r[i] - ref[0]) ** 2 + (g[i] - ref[1]) ** 2 + (b[i] - ref[2]) ** 2);
  const labelDist = Math.sqrt(
    (labelColor[0] - bgRef[0]) ** 2 + (labelColor[1] - bgRef[1]) ** 2 + (labelColor[2] - bgRef[2]) ** 2,
  );
  if (labelDist < 30) return 0;
  const maxPhantomArea = Math.round(n * 0.02);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let dropped = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let count = 0;
    let sum = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    const members: number[] = [];
    while (sp > 0) {
      const i = stack[--sp];
      count += 1;
      if (members.length < 400_000) members.push(i);
      sum += colourDist(i, bgRef);
      sr += r[i];
      sg += g[i];
      sb += b[i];
      const x = i % w;
      const y = (i - x) / w;
      const push = (j: number) => {
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          stack[sp++] = j;
        }
      };
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    if (count === 0) continue;
    const meanBgDistance = sum / count;
    const meanLabelDistance = Math.hypot(
      sr / count - labelColor[0],
      sg / count - labelColor[1],
      sb / count - labelColor[2],
    );
    const phantom =
      count <= maxPhantomArea && (meanBgDistance < 30 || meanBgDistance * 1.7 < meanLabelDistance);
    if (phantom) {
      for (const i of members) mask[i] = 0;
      dropped += count;
    }
  }
  return dropped;
}

/**
 * Speckle cleanup on the label map: tiny regions are merged into the dominant
 * neighbouring colour instead of being deleted, so no holes appear.
 */
function mergeSpeckles(
  labels: Int16Array,
  w: number,
  h: number,
  mergeMinArea: number,
): { merged: number; components: number } {
  const n = labels.length;
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const areas: number[] = [];
  const compLabel: number[] = [];
  const perLabelMax = new Map<number, number>();
  let count = 0;

  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1 || labels[start] < 0) continue;
    const label = labels[start];
    let sp = 0;
    stack[sp++] = start;
    comp[start] = count;
    let area = 0;
    while (sp > 0) {
      const i = stack[--sp];
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && comp[i - 1] === -1 && labels[i - 1] === label) {
        comp[i - 1] = count;
        stack[sp++] = i - 1;
      }
      if (x < w - 1 && comp[i + 1] === -1 && labels[i + 1] === label) {
        comp[i + 1] = count;
        stack[sp++] = i + 1;
      }
      if (y > 0 && comp[i - w] === -1 && labels[i - w] === label) {
        comp[i - w] = count;
        stack[sp++] = i - w;
      }
      if (y < h - 1 && comp[i + w] === -1 && labels[i + w] === label) {
        comp[i + w] = count;
        stack[sp++] = i + w;
      }
    }
    areas.push(area);
    compLabel.push(label);
    perLabelMax.set(label, Math.max(perLabelMax.get(label) ?? 0, area));
    count += 1;
  }

  const rings: Map<number, number>[] = Array.from({ length: count }, () => new Map<number, number>());
  for (let i = 0; i < n; i++) {
    const c = comp[i];
    if (c < 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    const vote = (j: number) => {
      const nc = comp[j];
      if (nc === c || nc < 0) return;
      const map = rings[c];
      const target = compLabel[nc];
      map.set(target, (map.get(target) ?? 0) + 1);
    };
    if (x > 0) vote(i - 1);
    if (x < w - 1) vote(i + 1);
    if (y > 0) vote(i - w);
    if (y < h - 1) vote(i + w);
  }

  const reassign = new Map<number, number>();
  for (let c = 0; c < count; c++) {
    if (areas[c] >= mergeMinArea) continue;
    let bigLabel = -1;
    let bigVotes = 0;
    let anyLabel = -1;
    let anyVotes = 0;
    for (const [label, votes] of rings[c]) {
      if (votes > anyVotes) {
        anyVotes = votes;
        anyLabel = label;
      }
      if (votes > bigVotes && (perLabelMax.get(label) ?? 0) >= mergeMinArea * 2) {
        bigVotes = votes;
        bigLabel = label;
      }
    }
    const target = bigLabel >= 0 ? bigLabel : anyLabel;
    if (target >= 0) reassign.set(c, target);
  }

  if (reassign.size) {
    for (let i = 0; i < n; i++) {
      const c = comp[i];
      if (c < 0) continue;
      const next = reassign.get(c);
      if (next !== undefined) labels[i] = next;
    }
  }
  return { merged: reassign.size, components: count };
}

/** Shared minimum-area rule (user slider scaled by detail level and canvas size). */
function minShapeAreaAt(base: BaseSettings, pixels: number): number {
  const scale = 1 + Math.max(0, 10 - base.detailLevel) * 0.5;
  return Math.max(2, Math.min(Math.round(base.minShapeArea * scale), Math.round(pixels * 0.00004)));
}

/**
 * Boundary tracing: connects the boundary edges between a colour and its
 * neighbours into closed loops. Handles multiple islands and holes and resolves
 * pinch points, which an 8-connected walk cannot do.
 */
export function traceMask(mask: Uint8Array, w: number, h: number): Pt[][] {
  const segStart: number[] = [];
  const segEnd: number[] = [];
  const startMap = new Map<number, number[]>();
  const add = (sx: number, sy: number, ex: number, ey: number) => {
    const id = segStart.length;
    const s = sy * (w + 1) + sx;
    segStart.push(s);
    segEnd.push(ey * (w + 1) + ex);
    const list = startMap.get(s);
    if (list) list.push(id);
    else startMap.set(s, [id]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (y === 0 || !mask[(y - 1) * w + x]) add(x, y, x + 1, y);
      if (x === w - 1 || !mask[y * w + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === h - 1 || !mask[(y + 1) * w + x]) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[y * w + x - 1]) add(x, y + 1, x, y);
    }
  }
  const used = new Uint8Array(segStart.length);
  const loops: Pt[][] = [];
  const px = (id: number) => id % (w + 1);
  const py = (id: number) => Math.floor(id / (w + 1));
  for (let i = 0; i < segStart.length; i++) {
    if (used[i]) continue;
    const pts: Pt[] = [];
    let cur = i;
    const first = segStart[i];
    let guard = 0;
    while (cur !== -1 && !used[cur] && guard < 5_000_000) {
      used[cur] = 1;
      pts.push({ x: px(segStart[cur]), y: py(segStart[cur]) });
      const endId = segEnd[cur];
      if (endId === first) break;
      const candidates = startMap.get(endId);
      let next = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used[c]) {
            next = c;
            break;
          }
        }
      }
      cur = next;
      guard += 1;
    }
    if (pts.length >= 4) loops.push(pts);
  }
  return loops;
}

/**
 * Coverage (alpha) field of one palette colour: the fraction of each pixel the
 * colour covers. For a pixel blended between two colours the alpha is
 * a = d_other / (d_own + d_other) – exact and scale free. Dividing by a fixed
 * colour-distance constant instead saturated on high-contrast edges and made thin
 * strokes about twice as fat.
 */
function coverageField(
  bestDist: Float32Array,
  secondDist: Float32Array,
  labels: Int16Array,
  secondLabel: Int16Array,
  colour: number,
  out: Float32Array,
): Float32Array {
  for (let i = 0; i < labels.length; i++) {
    const total = bestDist[i] + secondDist[i];
    if (total <= 0) {
      out[i] = labels[i] === colour ? 1 : 0;
      continue;
    }
    if (labels[i] === colour) out[i] = secondDist[i] / total;
    else if (secondLabel[i] === colour) out[i] = bestDist[i] / total;
    else out[i] = 0;
  }
  return out;
}

/**
 * Refine traced contour vertices to sub-pixel accuracy: each vertex slides along
 * the gradient of the coverage field until the coverage is 0.5 – the true visual
 * edge. The topology stays exactly as traced, so no shape is invented or lost.
 */
function refineSubpixel(loop: Pt[], field: Float32Array, w: number, h: number): Pt[] {
  const sample = (x: number, y: number) => {
    const cx = Math.min(w - 1, Math.max(0, x - 0.5));
    const cy = Math.min(h - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const v00 = field[y0 * w + x0];
    const v10 = field[y0 * w + x1];
    const v01 = field[y1 * w + x0];
    const v11 = field[y1 * w + x1];
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  };
  const out: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const vx = loop[i].x;
    const vy = loop[i].y;
    const gx = sample(vx + 0.6, vy) - sample(vx - 0.6, vy);
    const gy = sample(vx, vy + 0.6) - sample(vx, vy - 0.6);
    const g = Math.hypot(gx, gy);
    if (g < 0.05) {
      out.push({ x: vx, y: vy });
      continue;
    }
    const value = sample(vx, vy);
    let offset = (0.5 - value) / g;
    if (!Number.isFinite(offset)) offset = 0;
    offset = Math.max(-0.75, Math.min(0.75, offset));
    out.push({ x: vx + (gx / g) * offset, y: vy + (gy / g) * offset });
  }
  return out;
}

function pointInLoop(pt: Pt, loop: TraceLoop): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2];
    const yi = loop[i * 2 + 1];
    const xj = loop[j * 2];
    const yj = loop[j * 2 + 1];
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const flattenLoop = (pts: Pt[]): TraceLoop => {
  const out: TraceLoop = [];
  for (const p of pts) out.push(round(p.x, 2), round(p.y, 2));
  return out;
};

export type { Channels };

/** Full analysis: raster → palette → masks → sub-pixel contours. */
export function analyzeImage(
  raster: Raster,
  base: BaseSettings,
  sourceWidth: number,
  sourceHeight: number,
): TraceResult {
  const pipeline: PipelineStep[] = [];
  const time = <T>(step: string, fn: () => T, note?: string): T => {
    const t0 = Date.now();
    const out = fn();
    pipeline.push({ step, ms: Date.now() - t0, note });
    return out;
  };

  const ch = extractChannels(raster);
  const { r, g, b, a, w, h } = ch;

  // 1. transparency / background
  let background: Centroid | null = null;
  time("Background Remove", () => {
    const detected = detectBackground(ch);
    let transparentPixels = 0;
    for (let i = 0; i < ch.n; i++) if (a[i] < 128) transparentPixels += 1;
    const alreadyTransparent = raster.hadAlpha && transparentPixels / ch.n > 0.02;

    if (base.transparent && raster.hadAlpha) {
      for (let i = 0; i < ch.n; i++) a[i] = a[i] < 128 ? 0 : 255;
    } else {
      for (let i = 0; i < ch.n; i++) {
        if (a[i] < 128) {
          r[i] = 255;
          g[i] = 255;
          b[i] = 255;
        }
        a[i] = 255;
      }
    }

    if (!detected || alreadyTransparent) return;
    const wantsRemoval = base.ignoreBackground
      ? detected.coverage > 0.15
      : !base.transparent && detected.coverage > 0.5;
    if (!wantsRemoval) return;
    background = detected.color;
    const thresh = 34 + base.noise * 5 + base.edgeSoften * 3;
    const removed = floodRemoveBackground(ch, detected.color, thresh);
    reclaimEdge(a, w, h, 1);
    pipeline.push({ step: "Background Mask", ms: 0, note: `${removed} px removed, edge reclaimed` });
  });

  // 2. noise removal
  time("Noise Remove", () => {
    if (base.noise > 0) smoothColors(ch, 34 + base.noise * 11);
  });

  // 3. posterize (feeds the clustering only – output colours stay true)
  let clusterR: Uint8Array = r;
  let clusterG: Uint8Array = g;
  let clusterB: Uint8Array = b;
  time("Posterize", () => {
    if (!base.posterize) return;
    const levels = Math.max(6, Math.min(20, Math.round((base.colorCount || 8) * 1.75)));
    clusterR = Uint8Array.from(r);
    clusterG = Uint8Array.from(g);
    clusterB = Uint8Array.from(b);
    posterizeChannel(clusterR, levels);
    posterizeChannel(clusterG, levels);
    posterizeChannel(clusterB, levels);
  });

  // 4. colour detection + quantisation
  const sampleTarget = 24000;
  const samples = time("Color Detection", () => {
    let opaque = 0;
    for (let i = 0; i < ch.n; i++) if (a[i] > 0) opaque += 1;
    const stride = Math.max(1, Math.floor(opaque / sampleTarget));
    let count = 0;
    const buf = new Float64Array(Math.min(opaque, sampleTarget) * 3);
    let cursor = 0;
    for (let i = 0; i < ch.n; i++) {
      if (a[i] === 0) continue;
      if (cursor % stride !== 0) {
        cursor += 1;
        continue;
      }
      cursor += 1;
      buf[count * 3] = clusterR[i];
      buf[count * 3 + 1] = clusterG[i];
      buf[count * 3 + 2] = clusterB[i];
      count += 1;
      if (count >= sampleTarget) break;
    }
    return buf.subarray(0, count * 3);
  });

  const sampleCount = samples.length / 3;
  if (sampleCount === 0) {
    const solid: TraceShape[] = background
      ? [
          {
            color: [background[0], background[1], background[2], 255],
            hex: hexOf(background),
            area: w * h,
            depth: 0,
            level: 0,
            bbox: [0, 0, w, h],
            outer: [[0, 0, w, 0, w, h, 0, h]],
            holes: [],
            parent: -1,
          },
        ]
      : [];
    return {
      width: w,
      height: h,
      sourceWidth,
      sourceHeight,
      shapes: solid,
      palette: [],
      background,
      warning: solid.length
        ? "There was nothing left after background removal – the export contains the background colour as one solid shape."
        : "Nothing to trace: this image is fully transparent (no visible pixels).",
      pipeline,
      analyzedAt: new Date().toISOString(),
      base,
    };
  }

  // Adaptive palette: flat artwork has very few real colours and spending the whole
  // palette on anti-aliasing blends makes a faded, fuzzy result.
  const naturalK = time("Flat Colour Detection", () =>
    estimateNaturalColors(clusterR, clusterG, clusterB, a, ch.n),
  );
  const requested = Math.max(2, Math.min(32, Math.round(base.colorCount)));
  const k = naturalK > 0 && naturalK <= 24 ? Math.max(2, Math.min(requested, naturalK + 2)) : requested;
  pipeline.push({ step: "Adaptive Palette", ms: 0, note: `requested ${requested} → using ${k}` });

  const { centers, sizes } = time("Color Quantization", () =>
    kmeans(samples, sampleCount, Math.min(k, sampleCount)),
  );

  const order = centers.map((_, i) => i).sort((p, q) => (sizes[q] ?? 0) - (sizes[p] ?? 0));
  const paletteRaw: Centroid[] = order.map((i) => centers[i]);
  const sizesRaw = order.map((i) => sizes[i] ?? 0);
  let palette: Centroid[] = paletteRaw;
  let paletteSizes = sizesRaw;

  const totalOpaque = Math.max(1, sampleCount);
  // Faithful mode keeps real colours down to 0.02 % of the artwork (a 200 px red
  // dot on a 1 MP sheet); cleanup mode uses a stricter floor.
  const minMass = base.cleanup
    ? Math.max(totalOpaque * 0.004, 12)
    : Math.max(totalOpaque * 0.0002, 4);
  const keep: number[] = palette.map((_, i) => i).filter((i) => (paletteSizes[i] ?? 0) >= minMass);
  if (keep.length >= 2 && keep.length < palette.length) {
    const dropped = palette.filter((_, i) => !keep.includes(i));
    palette = keep.map((i) => palette[i]);
    paletteSizes = keep.map((i) => paletteSizes[i]);
    pipeline.push({ step: "Palette Cleanup", ms: 0, note: `${dropped.length} blend cluster(s) merged away` });
  }

  // 5. classification (nearest colour + runner-up for the coverage field)
  const bestDist = new Float32Array(ch.n);
  const secondDist = new Float32Array(ch.n);
  const secondLabel = new Int16Array(ch.n).fill(-1);
  let labels = time("Pixel Classification", () => {
    const out = new Int16Array(ch.n).fill(-1);
    for (let i = 0; i < ch.n; i++) {
      if (a[i] === 0) {
        secondDist[i] = 1e6;
        continue;
      }
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      let secondD = Number.POSITIVE_INFINITY;
      let secondBest = -1;
      for (let c = 0; c < palette.length; c++) {
        const d = Math.sqrt(
          (clusterR[i] - palette[c][0]) ** 2 +
            (clusterG[i] - palette[c][1]) ** 2 +
            (clusterB[i] - palette[c][2]) ** 2,
        );
        if (d < bestD) {
          secondD = bestD;
          secondBest = best;
          bestD = d;
          best = c;
        } else if (d < secondD) {
          secondD = d;
          secondBest = c;
        }
      }
      out[i] = best;
      bestDist[i] = bestD;
      secondDist[i] = Number.isFinite(secondD) ? secondD : bestD + 200;
      secondLabel[i] = secondBest;
    }
    return out;
  });

  // Anti-aliasing colours must not become their own layers: they paint a tinted
  // halo around every shape and the result looks beveled / "3D". The reliable test
  // is *erosion survival* – a real colour forms solid regions, an anti-aliasing
  // fringe is 1-2px wide and vanishes. (A geometric "lies between two colours" test
  // was wrong: the dark red of a ribbon does lie between black and bright red, yet
  // it is genuine artwork.)
  {
    const minSurvivors = Math.max(10, Math.round(ch.n * 0.0001));
    const keepColours: number[] = [];
    const blends: number[] = [];
    for (let c = 0; c < palette.length; c++) {
      const distToPaper = Math.hypot(
        palette[c][0] - palette[0][0],
        palette[c][1] - palette[0][1],
        palette[c][2] - palette[0][2],
      );
      if (c === 0 || distToPaper < 12) {
        keepColours.push(c);
        continue;
      }
      const mask = new Uint8Array(ch.n);
      let size = 0;
      for (let i = 0; i < ch.n; i++) {
        if (labels[i] === c) {
          mask[i] = 1;
          size += 1;
        }
      }
      const thickness = size > 0 ? maskThickness(mask, w, h) : 0;
      const solid = isRealColour(labels, c, w, h, minSurvivors);
      // Real artwork has thickness well above the ~2px of an anti-aliasing halo.
      if (solid && thickness >= 3.5) keepColours.push(c);
      else blends.push(c);
    }
    // A stroke that is itself only ~1-2px wide (common in flat line-art icons) can
    // fail the thickness test above even though it is the *only* ink colour in the
    // image – every "surviving" colour would then just be shades of the paper, and
    // the whole drawing would vanish. Never let this cleanup step erase every real
    // colour: if nothing but paper-ish tones would remain, keep the strongest ink
    // candidate(s) instead of discarding them as fringe.
    const hasInk = keepColours.some((c) => {
      const dist = Math.hypot(
        palette[c][0] - palette[0][0],
        palette[c][1] - palette[0][1],
        palette[c][2] - palette[0][2],
      );
      return dist >= 40;
    });
    if (!hasInk && blends.length) {
      blends.sort((x, y) => (paletteSizes[y] ?? 0) - (paletteSizes[x] ?? 0));
      // Merge the rescued candidates into a single ink colour (size-weighted
      // average) instead of keeping them as separate palette entries – two
      // near-identical near-black shades drawn as two overlapping shapes look
      // like a dashed/doubled outline instead of one solid line.
      const rescued = blends.splice(0, Math.min(3, blends.length));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let stotal = 0;
      for (const c of rescued) {
        const wgt = paletteSizes[c] ?? 1;
        sr += palette[c][0] * wgt;
        sg += palette[c][1] * wgt;
        sb += palette[c][2] * wgt;
        stotal += wgt;
      }
      const mergedIdx = rescued[0];
      palette[mergedIdx] = [sr / stotal, sg / stotal, sb / stotal];
      paletteSizes[mergedIdx] = stotal;
      keepColours.push(mergedIdx);
      pipeline.push({
        step: "Ink Rescue",
        ms: 0,
        note: `thin-stroke colour(s) merged and kept despite failing the fringe-thickness test (would have left no ink): ${rescued
          .map((c) => hexOf(palette[c]))
          .join(", ")}`,
      });
    }
    if (blends.length && keepColours.length >= 2) {
      const removed = blends.map((c) => palette[c]);
      palette = keepColours.map((c) => palette[c]);
      paletteSizes = keepColours.map((c) => paletteSizes[c]);
      pipeline.push({
        step: "Blend Colours Removed",
        ms: 0,
        note: `${removed.length} anti-aliasing fringe colour(s) merged: ${removed
          .map((col) => hexOf(col))
          .join(", ")}`,
      });
      // re-label against the reduced palette

      labels = time("Re-classify", () => {
        const out = new Int16Array(ch.n).fill(-1);
        for (let i = 0; i < ch.n; i++) {
          if (a[i] === 0) continue;
          let best = 0;
          let bestD = Number.POSITIVE_INFINITY;
          let secondD = Number.POSITIVE_INFINITY;
          let secondBest = -1;
          for (let c = 0; c < palette.length; c++) {
            const d = Math.sqrt(
              (clusterR[i] - palette[c][0]) ** 2 +
                (clusterG[i] - palette[c][1]) ** 2 +
                (clusterB[i] - palette[c][2]) ** 2,
            );
            if (d < bestD) {
              secondD = bestD;
              secondBest = best;
              bestD = d;
              best = c;
            } else if (d < secondD) {
              secondD = d;
              secondBest = c;
            }
          }
          out[i] = best;
          bestDist[i] = bestD;
          secondDist[i] = Number.isFinite(secondD) ? secondD : bestD + 200;
          secondLabel[i] = secondBest;
        }
        return out;
      });
    }
  }

  // 6. speckle merge (cleanup mode only – faithful keeps every region)
  const mergeMin = base.cleanup
    ? Math.max(minShapeAreaAt(base, ch.n), Math.round(ch.n * 0.00008))
    : Math.max(2, Math.round(base.minShapeArea));
  if (base.cleanup) {
    time("Speckle Cleanup", () => {
      const res = mergeSpeckles(labels, w, h, mergeMin);
      pipeline.push({
        step: "Speckle Merge",
        ms: 0,
        note: `${res.merged} of ${res.components} regions merged (min ${mergeMin}px²)`,
      });
    });
  } else {
    pipeline.push({ step: "Speckle Merge", ms: 0, note: "off – every shape kept as-is" });
  }

  // 7. per-colour masks → sub-pixel contours
  const minAreaScale = base.cleanup ? 1 + Math.max(0, 10 - base.detailLevel) * 0.5 : 1;
  const minArea = Math.max(2, Math.round(base.minShapeArea * minAreaScale));
  const openRadius = base.cleanup ? (base.noise >= 8 ? 2 : base.noise >= 6 ? 1 : 0) : 0;
  const closeRadius = base.cleanup ? (base.edgeSoften >= 6 ? 2 : base.edgeSoften >= 3 ? 1 : 0) : 0;

  const shapes: TraceShape[] = [];
  const traceStart = Date.now();
  const bgRef: Centroid = background ?? palette[0] ?? [255, 255, 255];
  let phantomPixels = 0;

  for (let c = 0; c < palette.length; c++) {
    if ((paletteSizes[c] ?? 0) < minArea) continue;
    // The mask is the 50 % *coverage* set of this colour, not the nearest-colour
    // label set. For a pixel blended between two colours the coverage alpha is
    // d_other/(d_own+d_other), so a 1-3px light channel between two dark shapes
    // (which is mostly paper) stays below 0.5 and survives as a real separation,
    // while a pixel that is mostly ink is kept. Using hard labels instead closed
    // those thin gaps – they are what makes the traced icon look glued together.
    const field = coverageField(bestDist, secondDist, labels, secondLabel, c, new Float32Array(ch.n));
    const mask = new Uint8Array(ch.n);
    let filled = 0;
    for (let i = 0; i < ch.n; i++) {
      if (field[i] >= 0.5) {
        mask[i] = 1;
        filled += 1;
      }
    }
    if (filled < minArea) continue;
    if (openRadius > 0) openMask(mask, w, h, openRadius);
    if (closeRadius > 0) closeMask(mask, w, h, closeRadius);
    despeckle(mask, w, h, minArea);
    trimHairlines(mask, w, h, r, g, b, bgRef, palette[c], c === 0);
    if (base.cleanup) phantomPixels += dropPhantomComponents(mask, w, h, r, g, b, bgRef, palette[c]);

    const rawLoops = traceMask(mask, w, h);
    if (!rawLoops.length) continue;

    const outer: { loop: TraceLoop; area: number; bbox: [number, number, number, number] }[] = [];
    const holes: { loop: TraceLoop; area: number; bbox: [number, number, number, number] }[] = [];
    for (const rawPts of rawLoops) {
      const refined = refineSubpixel(rawPts, field, w, h);
      const simplified = simplifyClosed(refined, 0.12);
      if (simplified.length < 3) continue;
      const signed = shoelace(simplified);
      const area = Math.abs(signed);
      if (area < minArea * 0.5) continue;
      const loop = flattenLoop(simplified);
      const bb = bboxOf(simplified);
      if (signed > 0) outer.push({ loop, area, bbox: bb });
      else holes.push({ loop, area, bbox: bb });
    }
    if (!outer.length) continue;
    const totalArea = outer.reduce((sum, o) => sum + o.area, 0);
    shapes.push({
      color: [palette[c][0], palette[c][1], palette[c][2], 255],
      hex: hexOf(palette[c]),
      area: totalArea,
      depth: 0,
      level: 0,
      bbox: outer[0].bbox,
      outer: outer.map((o) => o.loop),
      holes: holes.map((o) => o.loop),
      parent: -1,
    });
  }
  pipeline.push({
    step: "Edge Detection",
    ms: Date.now() - traceStart,
    note: `${shapes.length} colour masks, ${phantomPixels} phantom px dropped`,
  });

  // 8. nesting / stacking depth
  const nestingStart = Date.now();
  for (let i = 0; i < shapes.length; i++) {
    const loopI = shapes[i].outer[0];
    const probe: Pt = { x: loopI[0], y: loopI[1] };
    let depth = 0;
    let parent = -1;
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      if (shapes[j].area <= shapes[i].area) continue;
      if (pointInLoop(probe, shapes[j].outer[0])) {
        depth += 1;
        parent = j;
      }
    }
    shapes[i].depth = depth;
    shapes[i].parent = parent;
  }
  const maxArea = Math.max(...shapes.map((s) => s.area), 1);
  for (const s of shapes) {
    const coverage = s.area / maxArea;
    s.level = Math.round((1 - coverage) * 20) + s.depth;
  }
  shapes.sort((x, y) => x.level - y.level || y.area - x.area);
  pipeline.push({ step: "Shape Nesting", ms: Date.now() - nestingStart, note: "depth + stacking order" });

  return {
    width: w,
    height: h,
    sourceWidth,
    sourceHeight,
    shapes,
    palette: palette.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number]),
    background,
    pipeline,
    analyzedAt: new Date().toISOString(),
    base,
  };
}

export function traceStats(trace: TraceResult) {
  let points = 0;
  for (const s of trace.shapes) {
    for (const loop of s.outer) points += loop.length / 2;
    for (const loop of s.holes) points += loop.length / 2;
  }
  return { shapes: trace.shapes.length, colors: trace.palette.length, points: Math.round(points) };
}
