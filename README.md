# AI Vectorizer

PNG · JPG · JPEG · WEBP · BMP · GIF · TIFF  →  **SVG · EPS · PDF · DXF · PNG**

Full-stack vectorizer built on Next.js 16 (App Router) + Drizzle ORM + PostgreSQL.
The whole raster→vector engine runs in-process in TypeScript (no Python service needed),
so every export format is produced from one cached colour-trace analysis.

## AI pipeline (13 stages)

Upload → validation → background removal (border flood fill + alpha) → resize →
noise removal (edge preserving smoothing) → posterize → k-means colour quantisation →
edge detection (marching-square boundary linking) → morphological open/close + despeckle →
corner detection → curve detection (line / arc / ellipse) → Bezier fitting (Schneider) →
path generation + nesting (cut-out holes) → optimisation → export.

## Export engines

| Format | Versions | Notes |
| --- | --- | --- |
| SVG | 1.0, 1.1, Tiny 1.2, SVG 2, Adobe | groups, cut-out holes (`evenodd`), native circles/rects/ellipses, gap filler |
| EPS | 1.0 (Level 1), 2.0, 3.0 | HSB colours on Level 1, RGB curves, opacity on Level 3, real BoundingBox |
| PDF | 1.0 → 2.0 | hand-built PDF writer, cubic curves, ExtGState transparency ≥ 1.4 |
| DXF | R12 → 2021 | classic POLYLINE/SEQEND (R12/R13), LWPOLYLINE + SOLID HATCH + layer per colour (R14+) |
| PNG | 1x / 2x / 4x | rasterised from the optimised SVG |

## Accounts, payments, admin

* Email + password (scrypt) with JWT session cookie, Google login ready (set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
* Manual payment flow: user sends money to the bKash / Nagad number (**01616362908**), submits
  the sender number + TrxID, the request lands in the admin **Pending payments** queue, admin
  approves → premium activates immediately with an auto-calculated expiry (1 / 6 months) that
  deactivates automatically when the period ends.
* Admin panel: dashboard (users, premium users, revenue, profit, credits, downloads, avg process time),
  pending payment verification, user management (block/unblock, rename, credits, +30 days, folder access),
  support inbox with replies, pricing editor (add/edit/delete plans, payment numbers, PayPal toggle),
  vectorizer engine settings/limits, homepage content + notice publisher, logs, withdraw requests, API usage.

## The background is part of the artwork

The background is **never removed by default** – it stays as a shape, exactly like in
the uploaded image. Two renderer defects used to hide it, both fixed:

* **The canvas loop was discarded.** The "redundant background layer" pass took the
  loop with the most *points* as the base and dropped every other loop, so the real
  canvas rectangle (only 5 points) was thrown away – 97 % of the paper came out
  transparent. The canvas loop is now identified by bounding-box area and is always
  kept.
* **Enclosed cells were skipped, then painted without their holes.** Cells such as a
  ring's inner gap or a globe window are punched out of the shapes above (even-odd),
  so they must be painted – they are now moved to the top of the paint order *and
  their own holes travel with them* (otherwise the cell became a solid disc and
  covered whatever sat inside it, e.g. the dark centre of a ring).

Measured (paper pixels of a 15-icon sheet and a geometric test sheet):

| | before | after |
| --- | --- | --- |
| Paper painted with the real background | 2.7 % | **99.8 %** |
| Paper left transparent | 97.2 % | **0.00 %** |
| Ink IoU / recall / precision | 76.9 % / 78.5 % | **98.8 % / 99.3 % / 99.5 %** |
| Worst 80px tile (missing ink) | 100 % | 5 % |

The result view also shows the real background by default (the transparency grid is a
toolbar toggle), and the status bar states `background: kept` — turning the
*Remove background* switch on is the only way to get a transparent file.

## Shapes stay exactly as in the image

Two defects merged neighbouring shapes together (fingers, spokes, letter counters
disappeared). Both are fixed and covered by a per-shape test:

* **The hairline trimmer ran on the paper mask too.** Narrow *white* channels (the
  gaps between fingers) are 1–3px wide and the rule "thin trail near the paper" hit
  them, so the gaps were painted over and the digits merged into one black mass.
  The trimmer now never touches the background colour and, for other colours, only
  removes a trail when the source there is *clearly nearer the paper* than the colour
  being painted (`distToBg·1.6 < distToLabel`).
* **Moving-average smoothing rounded narrow channels.** The feature-preserving clamp
  keeps a smoothed vertex only while it stays within 0.75px of the traced contour;
  sharp tips and 4px channels are therefore preserved while gentle staircases are
  still smoothed.

Measured on a real 15-icon sheet (1.06 MP, 105 distinct shapes) — **100 repeated runs**:

| | before | after |
| --- | --- | --- |
| Global IoU | 85.9 % | **96.98 %** |
| Recall / precision | 94.2 % / 90.7 % | **97.6 % / 99.4 %** |
| Shape blobs detected | 80 (25 merged) | **105 of 105** |
| Blobs with IoU < 0.9 | 28 of 40 | **0 of 40** |
| White channel widths vs source | 4,28 / — / 8 px | **4,13 / 19 / 9 px (matches)** |
| Determinism over 100 runs | — | **1 distinct output, spread 0.000 %** |
| Runtime | — | 634 ms per image |

Settings matrix (same image): every mode keeps 103–106 blobs and 96–97.7 % IoU
(`stacked` 89 % and `gap filler` 90 % precision are by design — stacked drops holes
and gap filler adds a stroke around every shape).

## No stray layers / no "3D" look

Overlapping tinted layers made the result look beveled ("3D"): a palette entry that
was really the anti-aliasing blend between black and the accent colour was painted
as its own layer, so every red shape got a dark rim, plus an extra near-white tint
layer on top of the paper.

Fix: the reliable discriminator is **thickness**, measured on the artwork itself.
A genuine colour survives a 2px erosion with 70–94 % of its pixels (paper 58 px,
black 18 px, red 13 px thick); every anti-aliasing fringe – including a dark red that
exists only between black and bright red – is ~2 px thick and loses >95 % of its
pixels. Colours that fail both the erosion test and a 3.5px thickness floor are
merged into the nearest surviving colour, then the image is re-labelled once.

An earlier version of this test compared colours geometrically ("lies between two
colours"), which wrongly deleted the dark red of a real ribbon; the thickness/erosion
test is immune to that because it inspects the actual regions.

Fix (superseded details): a blend test over **all colour pairs** – any palette entry that lies on the
straight segment between two clearly more common colours (perpendicular distance
≤ 16, both neighbours ≥ 1.25x its pixel count) is merged into the nearest surviving
colour, as is any entry within 28 units of the paper. Since blends are anti-aliasing
fringes, this is exactly the "no extra layer, no extra line" behaviour.

Measured on the user's icon sheet: **9 anti-aliasing fringes merged** (`#fcf0ef`,
`#921513`, `#bababa`, `#777776`, `#efb5b4`, `#484948`, `#cc8685`, `#a55856`, `#242322`)
→ palette **3 colours** (white, black, red), layers 5 → **3**, subpaths 1160 → **227**,
SVG 158 KB → **59 KB**. Ground-truth sheet with five brand colours keeps **6/6
colours** (IoU 98.4 %, recall 99.4 %, precision 99.0 %, rectangle error 0 px, ring
98.2 %, hairline 100 %). Stray ink on paper: 2041 px of 1.06 M (0.19 %) with only two
structures longer than 25 px – i.e. no extra lines.

## Thin separations (gaps) and the limits of anti-aliasing

The Before/After view can disagree at 1-2px scale. Measured on the user's own
globe+ribbon icon (1376x768 JPEG):

| | source | vector |
| --- | --- | --- |
| real red structures | 3 | **3** |
| real black structures | 3 | **3** |
| white separations inside the icon | 537 runs, avg 21.8px | 574 runs, avg 22.5px |
| edge position bias | — | −0.20px |

So every real structure and separation survives; the metric that *looked* like 8 missing
1-3px gaps counted gaps around JPEG speckles (the source has 88 black components, most of
them a few pixels of compression noise) – those specks are removed correctly, and the
gaps around them disappear with it.

For a 1-3px light separation between two dark shapes the source pixels are genuinely
blurred to near-ink values by JPEG, so a pixel-faithful tracer (any 50 % coverage rule)
keeps them closed. Sweeping the coverage threshold 0.50 → 0.68 confirmed this: the thin
gaps stay closed while the icon IoU drops from 94.4 % to 92.5 %. The mask is therefore
built from the 50 % coverage field (mathematically the same set as nearest-colour labels,
but it also handles blends between non-paper colours correctly).

If you need maximum separation crispness, use **Smoothness 0** or the **Pixel-exact**
preset – both keep the fitted outline within ~0.2px of the traced contour.

## Small circles stay circles

A stethoscope ring ~20 px across came out as a hexagon. Two causes, both fixed:

* **The circle test was size-blind.** It required a radial RMS ≤ max(0.5 px, 0.6 % of r)
  and a worst-case error ≤ max(1.1 px, 1 % of r). A small circle traced from a JPEG is
  built from 30-80 pixel steps, so its vertices swing 0.5-1 px even when it is
  perfectly round – the test rejected it and the fitter produced a polygon. The budget
  is now size aware: `rms ≤ max(0.7, 0.12r)` and `maxErr ≤ max(1.4, 0.20r)` for r < 30,
  while larger contours keep the strict test (a 100 px octagon must not be snapped).
  The 0.20r budget is chosen against the deviation of regular polygons: hexagon 0.13r,
  octagon 0.08r, square 0.29r, triangle 0.50r – so hexagons and finer round shapes snap,
  squares and triangles do not.
* **Corner detection used to veto the snap.** A staircase on a small circle fires
  spurious "corners"; the snap no longer requires a corner-free contour, because the
  geometric fit itself decides roundness.

Measured on a circle-size grid (r = 8 … 120 px) and on a 15-icon sheet:

| shape | source radius | vector radius | deviation |
| --- | --- | --- | --- |
| disc r=8 / 12 / 17 / 24 / 32 / 45 | 7.9 … 44.9 | 8.0 … 44.9 | ≤ 0.1 px |
| ring r=12 / 18 / 26 / 36 / 48 | 15.0 … 55.0 | 14.9 … 54.9 | ≤ 0.2 px |
| stethoscope ring (local IoU) | — | — | 96.6 – 98.3 % |

Circle grid overall IoU rose to 98.6 %, icon sheet 96.8 %, ground-truth sheet 97.6 %,
output is byte-identical over 20 repeated runs.

## Geometry correctness (round of fixes)

Four defects made circles, rings and text look wrong; all are measured now:

* **Circle snapping emitted the wrong arc flags.** Both half arcs used
  `large-arc-flag=0`, but the chord between a traced point and its antipode is a
  hair shorter than the diameter, so renderers drew two *minor* arcs – a squashed
  crescent. A 24 px ring came out 17.5 px thick and lost 30 % of its area. The
  start/end points are now placed exactly on the fitted circle and `large-arc=1`
  is used: measured ring radii 108.99/131.86 px vs source 108.08/131.25 px.
* **Smoothing shrank every convex shape.** A moving average multiplies a circle's
  radius by cos(2π/n) per pass, so a simplified contour lost up to 3 % (4 px on a
  130 px radius). Smoothing is now followed by an exact rescale about the bbox
  centre, so the outline gets smoother without changing size.
* **Polygons were fed to the Bezier fitter.** A rectangle that simplified to four
  vertices had no detectable corners (the corner detector needs ≥ 5 points), so it
  went through the curve fitter, whose tangents overshot: a 200x140 rect rendered
  as 222x192 shifted by 22 px. Contours with ≤ 8 vertices are now emitted as exact
  straight segments.
* **Sub-pixel vertex refinement** – every traced vertex slides along the gradient of
  the colour-coverage field to the 0.5 level (the true visual edge) while the
  topology stays exactly as traced. Measured: wobble (direction change per pixel)
  0.205 → 0.044, IoU on a real icon sheet 94.9 % → 96.4 %, file size 186 KB → 87 KB,
  edge bias −0.37 px → −0.20 px.
* **Scale-free coverage field** – anti-aliasing alpha is computed as
  d_other / (d_own + d_other); the earlier fixed-distance version saturated on
  high-contrast edges and made thin strokes about twice as fat.

## Palette correctness (fixed)

Two defects made colours and shapes disappear; both are covered by tests now:

* **Palette estimation** counted colour share against the whole canvas, so the
  dominant paper drowned any real accent colour (a teal accent covering 5 % of the
  artwork only reached ~1 % of the canvas). The palette then silently dropped it
  and the accent was painted in the nearest colour (measured colour error 144/765).
  The share is now measured against the *non-dominant* pixels with a 0.8 % floor,
  so real colours always survive (measured colour error is now ≤ 5).
* **The blend-colour mass gate hid the very colours it was meant to remove** – the
  anti-aliasing clusters hold < 0.2 % of the samples, so a `mass > 0.002` guard
  skipped them and nine halo colours stayed in the palette (painting tinted rings
  around every shape). The geometric test is the real filter; the mass gate is gone.
* **Background shape detection** in the renderer identified "the background" as
  `palette[0]`. Once the paper is removed (Remove background / transparency off),
  entry 0 is the artwork colour with the most pixels – usually black – and the
  redundant-layer logic then deleted real black shapes (measured: 53 % of the
  artwork lost). The canvas-covering shape is now found geometrically (a loop whose
  bbox covers ≥ 85 % of the canvas), which fixed `ignoreBackground` from 45 % IoU
  to 95.8 % IoU with 2.8 % missing ink.

The palette mass floor is mode-aware: faithful mode keeps real colours down to
0.02 % of the artwork (a 200 px red dot is 0.03 % of a 1 MP sheet) while cleanup
mode keeps the stricter 0.4 % floor. Verified: a ground-truth sheet with five
brand colours keeps **5/5 colours with ≤ 8/765 mean colour error**.

Also: a colour indistinguishable from the paper (anti-aliasing ring, RGB distance
< 25) is merged into the background, which removed a whole hairline layer
(subpaths 2043 -> 708, SVG 311 KB -> 182 KB on a real icon sheet) while *raising*
recall from 96.4 % to 97.2 %.

## Engine versioning (important)

Every analysed image is stamped with `ENGINE_VERSION` (`src/lib/engine-version.ts`) and
the trace + optimised SVG are cached in PostgreSQL. When a cached result carries an
older stamp, `/result`, `/download` and `/api/optimize` transparently re-analyse the
image, so an engine improvement reaches existing images immediately instead of the
browser showing a stale (worse) vector. **Bump that constant after any user-visible
pipeline or renderer change.**

Trail cleanup note: 1–3px trails whose *source pixels are paper* are removed in every
mode – a line that does not exist in the image is an artefact, not faithful detail.
Real hairlines (source colour ≈ traced colour) and all small shapes are kept.

## Faithful by default

The default settings now vectorize **exactly what is in the image**:

* the **background is kept** (no flood-fill removal unless you tick *Remove background*),
* **no small shape is deleted** – speckle merging, phantom dropping, hairline trimming
  and morphological open/close only run when you switch on **Smart cleanup**,
* `minShapeArea` defaults to 2 px² so even one-pixel dots survive,
* the only always-on corrections are geometry-accurate ones: the fit-overshoot
  guard (removes phantom hairlines by refitting, never by deleting) and palette
  blend merging (maps anti-aliased pixels to their true colour).

Measured on a real 15-icon awareness pack (1376x768 JPEG):

| Mode | IoU | Recall | Precision | Paper kept | Subpaths |
| --- | --- | --- | --- | --- | --- |
| Faithful (default) | 97.7 % | 98.9 % | 98.8 % | 100 % | 2129 |
| Smart cleanup on | 94.8 % | 98.0 % | 96.7 % | 99.7 % | 219 |

Presets in the editor: *Faithful (default)*, *Photo*, *Flat logo (cleanup)*, *Line art (cleanup)*.

## Vectorisation quality (measured)

Scored against the ideal 50%-coverage threshold of the source raster
(recall = artwork kept, precision = no bloat):

| Input | Recall | Recall (1px tol.) | Precision | Stray specks |
| --- | --- | --- | --- | --- |
| Transparent PNG icon sheet | 95.7 % IoU | — | — | 0 |
| JPEG icon sheet | 94.0 % IoU | — | — | 0 |
| Flat-logo preset (posterize + soften) | 94.7 % IoU | — | — | 0 |
| Stacked stacking mode | 94.5 % IoU | — | — | 0 |
| Realistic icon sheet (hands/ribbons) | 99.3 % | 99.9 % | 96.0 % | 0 |
| Soft + JPEG-compressed sheet | 98.2 % | 99.7 % | 95.6 % | 0 |
| Geometric primitives | 99.4 % IoU | — | — | 0 |

Engine behaviours that make this possible:

* **No structural erosion** – speckle removal is done by connected-component
  filtering, so 1–2 px hairlines survive (before: only 11 % of thin lines
  survived at default settings, now 82 %+).
* **Adaptive palette** – for flat artwork the palette is reduced to the colours
  that actually exist (anti-aliasing blends consume 20 % of the pixels but are not
  colours), so a logo comes out crisp instead of faded.
* **Posterize is cluster-only** – it snaps the *clustering* input but the exported
  colour is always the true image colour (previously dark red turned black for
  24 % of pixels).
* **Alpha is respected** – a PNG that already has transparency never gets a
  "background colour" deleted; the artwork can touch the image border safely.
* **Background edge reclaim** – the anti-aliased rim eaten by the background
  flood fill is handed back, so shapes keep their true size.
* **"Keep transparency" off flattens onto white** (it used to composite onto black).
* **Speckle merge** – regions smaller than the noise floor are folded into the
  dominant neighbouring colour (never deleted, so no holes), which removed
  hundreds of stray subpaths (526 → 119 on a JPEG icon sheet).
* **Blend-colour removal** – a palette entry that lies on the line between the
  background and a bigger colour is an anti-aliasing halo, not a colour; merging
  it away removes the "fuzzy halo" shapes (`#ccaeab`, `#8b716f` …).
* **Phantom-region filter** – every small region is verified against the source
  raster: if the source pixels there are background-like (JPEG ringing) the
  region is dropped, while genuine detail (serif, dot, hairline) is kept.
* **No duplicate background layers** – the background colour normally arrives as
  one shape covering the canvas *plus* every enclosed cell (grid windows, pupils,
  letter counters). Those cells are already holes of the shapes above, so in
  cut-out mode they are dropped (globe sheet: 68 → 38 subpaths, identical IoU);
  in stacked mode they are re-painted as a final layer so the artwork is not
  covered (IoU 47 % → 74 %).
* **Morphology is complete** – "opening" and "closing" are erode+dilate / dilate+erode
  pairs. A plain min/max filter (the previous behaviour) permanently shrank or swelled
  every shape, bled colours past their true edge and fused nearly-touching shapes with a
  thin bridge that appeared as a stray hairline in the export. Shape edges are now
  pixel-exact (measured: square left edge 60 → 60, right edge 199 → 199 at every
  noise / edge-soften setting) and the flat-logo preset's IoU went 86 % → 94.7 %.
* **Single-pass closed-loop fitting** – splitting a contour into runs at every
  detected corner made adjacent fits meet at an angle, which is what produced the
  faceted "low-poly" look. Each loop is now smoothed, lightly simplified and fitted
  in one pass (corner-pronounced contours are still split by the fitter's own error
  splitter), and only genuine slivers fall back to exact segments: measured
  perimeter²/area threshold of 300 instead of a fragile drift comparison.
  Sliver guard on a real icon pack: phantom hairlines 3 -> 0, IoU 85 % -> 89 %
  (cleanup off) and 92.8 % -> 96.4 % on the icon sheet, with circle accuracy kept
  at 0.6 px deviation.
* **True circle snapping** – a closed contour with no corners that is
  geometrically round (Kasa least-squares fit, radial RMS within tolerance, full
  angular coverage) is exported as two exact half arcs instead of a fitted
  polygon, so heads, dots, pupils and rings stay perfectly round. Measured
  boundary deviation of a rendered 90px disc: 0.57px. Previously a heavy
  pre-simplify collapsed small circles into octagons; the pre-simplify is now
  capped at 0.5px and the fit tolerance does the smoothing instead.
* **Corner-preserving smoothing + fitting** – the traced contour runs along the
  pixel grid, so it looks like a staircase. Each contour is split at detected
  corners and every run in between is smoothed with pinned endpoints, simplified
  and then curve-fitted. Corners stay razor sharp while staircases become clean
  curves (potrace's strategy), which is what makes the vector look like the
  artwork instead of a pixel copy. Simplify tolerance is 1.5x the fit tolerance
  so invisible sub-pixel wobble is dropped (file size on a real icon pack:
  139 KB -> 109 KB, same IoU within 1 %).
* **Fit-overshoot guard** – a Bezier fit can overshoot where the contour has a
  1-2px notch (two edges nearly touching): the tangents then produce a long
  hair-thin sliver that renders as a stray line across empty space. Every fitted
  loop is now measured back against the traced contour and falls back to exact
  line segments when the drift exceeds ~2x the fit tolerance. On a real
  15-icon awareness pack this removed a 120px phantom line and lifted the
  image's IoU from 91 % to 94.5 % (globe sheet 94 % -> 96.5 %,
  transparent sheet 95.7 % -> 98.2 %).
* **Colour-aware hairline trimmer** – 1–2px trails whose source pixels do not carry the
  colour being painted (JPEG ringing, compression fringes) are removed, while genuine
  hairlines (source ≈ label colour) and thick lines are untouched. Stray ink in empty
  areas measured 0px on adversarial test sheets.
* **The "Easy editing" preset no longer uses stacked stacking** – stacked drops
  every hole, which destroyed line art; it now keeps cut-outs and groups by
  colour, so editing stays easy *and* the picture stays correct.

## Known-good behaviour & guard rails

* **Batch of 60** vectorizes in one go – the rate-limit window scales with `maxBatch` and the
  client retries HTTP 429 with backoff instead of marking an image as failed.
* **Payment approval is idempotent** – approving an already-approved request never grants the
  plan or credits twice (`alreadyApproved` response).
* **Empty / blank inputs** never produce a silent empty file: a fully transparent PNG or a
  canvas that was entirely removed as background returns a solid shape plus an explanatory
  `warning` that the UI shows as a dismissible banner.
* **Oversized inputs** (> 40 megapixels) fail with a clear message instead of "corrupted file".
* **Ownership is stateless** – a signed `?t=` access token travels in the URL, so results and
  downloads keep working even when cookies and localStorage are blocked.
* **Download page self-heals** – an image that was uploaded but never analysed is vectorized
  on demand when the page opens.
* **Traces are written atomically and self-repair** – concurrent analyses of the same image
  share one run (per-image dedupe), the file is written via temp+rename, and a truncated trace
  is rebuilt automatically instead of surfacing as a 409.

## Support

`/support` sends a message straight into the admin **Support** tab (category, priority, status, reply).
Logged-in users see the admin's answer on the same page.

## API

`POST /api/upload` · `POST /api/vectorize` · `POST /api/optimize` ·
`POST /api/export` (aliases `/api/export/svg|eps|pdf|dxf|png`) · `GET|DELETE /api/history` ·
`POST /api/auth/login|register|logout` · `GET /api/auth/google` · `POST /api/payment` ·
`POST /api/support` · `GET /api/plans` · `GET /api/health`

API keys are issued per user (`x-api-key` header) and tracked in the admin usage tab.

## Local development

```bash
npm install
npx drizzle-kit push           # create tables
npm run dev                    # http://localhost:3000
```

Environment variables: `DATABASE_URL` (required), `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Uploaded images and cached traces are stored
as rows in Postgres (`file_blobs` table) — no separate disk/volume is required, so the
app runs on free hosts with no persistent storage.

Default administrator: **admin@vectorizer.ai** / **admin12345** (change via env vars).
