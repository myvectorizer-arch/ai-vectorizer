/**
 * Shared vectorizer settings model.
 * BaseSettings  -> controls the expensive raster analysis stage (cacheable).
 * RenderSettings-> controls cheap geometry fitting + export stage (instant preview).
 */

export type BaseSettings = {
  /** 0..10 – global work resolution + feature sensitivity */
  detailLevel: number;
  /** 2..32 – palette size for colour quantisation */
  colorCount: number;
  /** 0..10 – speckle / salt&pepper removal strength */
  noise: number;
  /** degrees 20..160 – turn angle above which a corner is preserved */
  cornerThreshold: number;
  /** 0..6 – polyline easing passes (potrace style smoothness) */
  smoothness: number;
  /** 0.1..4 px – Douglas-Peucker tolerance for the traced edge */
  curvePrecision: number;
  /** posterize colour channels before quantisation */
  posterize: boolean;
  /** drop the detected background colour (transparent output) */
  ignoreBackground: boolean;
  /** keep / honour alpha transparency */
  transparent: boolean;
  /** 0..10 – erode+dilate strength used to fuse soft/gradient edges */
  edgeSoften: number;
  /** minimum shape area in px² (noise floor) */
  minShapeArea: number;
  /**
   * Smart cleanup: merge speckles, drop compression phantoms and trim hairlines.
   * OFF by default – a faithful vector keeps every small shape exactly as it is
   * in the image. Turn it on only when you want a tidied-up result.
   */
  cleanup: boolean;
  /** trace the anti-aliased 0.5 level set for smooth outlines (default on) */
  subpixel?: boolean;
};

export type CurveTypes = {
  lines: boolean;
  quadratic: boolean;
  cubic: boolean;
  circularArcs: boolean;
  ellipticalArcs: boolean;
};

export type OutputSize = {
  mode: "unchanged" | "custom" | "scaled";
  width: number;
  height: number;
  scale: number;
  unit: "px" | "in" | "cm" | "mm" | "pt";
  fit: "inside" | "crop" | "stretch";
  horizontal: number; // 0 = left, 0.5 = center, 1 = right
  vertical: number; // 0 = top, 0.5 = center, 1 = bottom
};

export type RenderSettings = {
  preset: "general" | "editing" | "cutting" | "custom";
  drawStyle: "filled" | "outlines" | "edges";
  stacking: "cutouts" | "stacked";
  groupBy: "none" | "color" | "parent" | "layer";
  simpleShapes: boolean;
  curveTypes: CurveTypes;
  lineFit: "coarse" | "medium" | "fine" | "superFine";
  gapFill: { enabled: boolean; clipBounds: boolean; constantWidth: boolean; width: number };
  strokeStyle: { constantWidth: boolean; width: number; singleColor: boolean; color: string };
  outputSize: OutputSize;
  /** export layer opacity (0..1) applied to every shape */
  opacity: number;
  /** keep background-coloured islands that are already holes of other shapes */
  ignoreBackgroundIslands?: boolean;
};

export type Settings = BaseSettings & RenderSettings;

export const BASE_DEFAULTS: BaseSettings = {
  detailLevel: 8,
  colorCount: 12,
  noise: 3,
  cornerThreshold: 68,
  smoothness: 3,
  curvePrecision: 0.4,
  posterize: false,
  // Background and small shapes are kept exactly as they are in the source.
  ignoreBackground: false,
  transparent: true,
  edgeSoften: 0,
  minShapeArea: 2,
  cleanup: false,
  subpixel: false,
};

export const RENDER_DEFAULTS: RenderSettings = {
  preset: "general",
  drawStyle: "filled",
  stacking: "cutouts",
  groupBy: "none",
  simpleShapes: true,
  curveTypes: {
    lines: true,
    quadratic: true,
    cubic: true,
    circularArcs: true,
    ellipticalArcs: true,
  },
  lineFit: "medium",
  gapFill: { enabled: false, clipBounds: false, constantWidth: true, width: 2 },
  strokeStyle: { constantWidth: true, width: 1, singleColor: false, color: "#000000" },
  outputSize: {
    mode: "unchanged",
    width: 7000,
    height: 4000,
    scale: 1,
    unit: "px",
    fit: "inside",
    horizontal: 0.5,
    vertical: 0.5,
  },
  opacity: 1,
  ignoreBackgroundIslands: false,
};

export const DEFAULT_SETTINGS: Settings = { ...BASE_DEFAULTS, ...RENDER_DEFAULTS };

export const LINE_FIT_TOLERANCE: Record<RenderSettings["lineFit"], number> = {
  coarse: 1.8,
  medium: 1.0,
  fine: 0.55,
  superFine: 0.3,
};

export type PresetKey = "faithful" | "photo" | "flatlogo" | "lineart" | "sticker" | RenderSettings["preset"];

/** Presets used by the result editor / download page. */
export const CLEANUP_PRESETS: { id: string; label: string; base: Partial<BaseSettings> }[] = [
  {
    id: "faithful",
    label: "Faithful (default)",
    base: { cleanup: false, noise: 0, edgeSoften: 0, minShapeArea: 2, posterize: false, ignoreBackground: false },
  },
  {
    id: "pixel-exact",
    label: "Pixel-exact",
    // Highest measured fidelity: no smoothing, the tightest fit tolerance, full
    // detail and straight segments only (measured IoU 97.2 % / precision 99.6 %
    // versus 97.0 % for the default on a real 15-icon sheet).
    base: {
      cleanup: false,
      detailLevel: 10,
      colorCount: 16,
      noise: 0,
      edgeSoften: 0,
      smoothness: 0,
      curvePrecision: 0.25,
      minShapeArea: 2,
      posterize: false,
      ignoreBackground: false,
    },
  },
  {
    id: "photo",
    label: "Photo",
    base: { cleanup: false, detailLevel: 10, colorCount: 24, noise: 1, edgeSoften: 0, minShapeArea: 2 },
  },
  {
    id: "flatlogo",
    label: "Flat logo (cleanup)",
    base: { cleanup: true, detailLevel: 7, colorCount: 8, noise: 4, edgeSoften: 3, minShapeArea: 20, posterize: true },
  },
  {
    id: "lineart",
    label: "Line art (cleanup)",
    base: { cleanup: true, detailLevel: 9, colorCount: 2, noise: 6, edgeSoften: 1, minShapeArea: 12, posterize: true },
  },
];

export function presetValues(preset: RenderSettings["preset"]): Partial<RenderSettings> {
  switch (preset) {
    case "editing":
      // "Stacked" would drop the holes of every shape, which destroys line art
      // (grids, rings, letters). Cut-outs keeps the artwork intact while the
      // grouping still makes each colour a selectable group, so editing stays easy.
      return {
        preset,
        drawStyle: "filled",
        stacking: "cutouts",
        groupBy: "color",
        simpleShapes: true,
        lineFit: "fine",
        gapFill: { enabled: false, clipBounds: true, constantWidth: true, width: 1.5 },
      };
    case "cutting":
      return {
        preset,
        drawStyle: "outlines",
        stacking: "cutouts",
        groupBy: "color",
        simpleShapes: true,
        lineFit: "medium",
        strokeStyle: { constantWidth: true, width: 0.35, singleColor: true, color: "#000000" },
      };
    case "general":
      return {
        preset,
        drawStyle: "filled",
        stacking: "cutouts",
        groupBy: "none",
        simpleShapes: true,
        lineFit: "medium",
      };
    default:
      return { preset };
  }
}

export const INPUT_FORMATS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif", "avif"] as const;

export const OUTPUT_FORMATS = ["svg", "pdf", "dxf", "eps", "png"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const FORMAT_VERSIONS: Record<OutputFormat, { id: string; label: string; note?: string }[]> = {
  svg: [
    { id: "1.0", label: "SVG 1.0" },
    { id: "1.1", label: "SVG 1.1" },
    { id: "tiny1.2", label: "SVG Tiny 1.2" },
    { id: "2.0", label: "SVG 2" },
    { id: "adobe", label: "Adobe*", note: "* Only lines and cubic Beziers – safest import for Illustrator." },
  ],
  pdf: ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.0"].map((v) => ({
    id: v,
    label: `PDF ${v}`,
  })),
  dxf: ["R12", "R13", "R14", "2000", "2004", "2007", "2010", "2013", "2018", "2021"].map((v) => ({
    id: v,
    label: `DXF ${v}`,
  })),
  eps: [
    { id: "1.0", label: "EPS 1.0 (Level 1)" },
    { id: "2.0", label: "EPS 2.0 (Level 2)" },
    { id: "3.0", label: "EPS 3.0 (Level 3)" },
  ],
  png: [
    { id: "1x", label: "PNG 1x" },
    { id: "2x", label: "PNG 2x" },
    { id: "4x", label: "PNG 4x" },
  ],
};

export const FORMAT_META: Record<
  OutputFormat,
  { label: string; audience: string; accent: string; ext: string }
> = {
  svg: { label: "SVG", audience: "Web & apps", accent: "#f6a623", ext: "svg" },
  pdf: { label: "PDF", audience: "Documents", accent: "#e0574a", ext: "pdf" },
  dxf: { label: "DXF", audience: "CAD & CNC", accent: "#c0392b", ext: "dxf" },
  eps: { label: "EPS", audience: "Legacy print", accent: "#e8791f", ext: "eps" },
  png: { label: "PNG", audience: "Clean bitmap", accent: "#2f7ce0", ext: "png" },
};

export function mergeSettings(input?: Partial<Settings> | null): Settings {
  const base = input ?? {};
  return {
    ...BASE_DEFAULTS,
    ...RENDER_DEFAULTS,
    ...base,
    curveTypes: { ...RENDER_DEFAULTS.curveTypes, ...(base.curveTypes ?? {}) },
    gapFill: { ...RENDER_DEFAULTS.gapFill, ...(base.gapFill ?? {}) },
    strokeStyle: { ...RENDER_DEFAULTS.strokeStyle, ...(base.strokeStyle ?? {}) },
    outputSize: { ...RENDER_DEFAULTS.outputSize, ...(base.outputSize ?? {}) },
  };
}

export function pickBaseSettings(s: Settings): BaseSettings {
  return {
    detailLevel: s.detailLevel,
    colorCount: s.colorCount,
    noise: s.noise,
    cornerThreshold: s.cornerThreshold,
    smoothness: s.smoothness,
    curvePrecision: s.curvePrecision,
    posterize: s.posterize,
    ignoreBackground: s.ignoreBackground,
    transparent: s.transparent,
    edgeSoften: s.edgeSoften,
    minShapeArea: s.minShapeArea,
    cleanup: s.cleanup,
    subpixel: s.subpixel ?? true,
  };
}

export function pickRenderSettings(s: Settings): RenderSettings {
  return {
    preset: s.preset,
    drawStyle: s.drawStyle,
    stacking: s.stacking,
    groupBy: s.groupBy,
    simpleShapes: s.simpleShapes,
    curveTypes: s.curveTypes,
    lineFit: s.lineFit,
    gapFill: s.gapFill,
    strokeStyle: s.strokeStyle,
    outputSize: s.outputSize,
    opacity: s.opacity,
    ignoreBackgroundIslands: s.ignoreBackgroundIslands ?? false,
  };
}
