# Rendering: shapes, layout, text, SVG

Everything is predefined shapes. Nobody draws freehand; `pen.ts` only renders each shape in the slide style. Geometry is in **inches** (1 in = 96 CSS px in the SVG); text sizes are **CSS px**. Shape geometry comes from the slide skill's `reference/diagrams.py` with one conversion: wherever it uses `pt / 72` (a slide text size in inches), use `px / 96`.

## 1. Seeds and names

- Every node and edge is one named `Sketch`: `new Sketch(seedFor(`${diagram_id}:${element_id}`))`. Labels are text, not sketches.
- Names are identities: a duplicate is a bug (the parser already refuses duplicate ids). Adding a node never changes another node's wobble.
- Stacking order: boundaries, then edges, then nodes (a node's knockout hides any edge ink under it), then all text on top.

## 2. Text

| Text | Size | Weight | Role |
|---|---|---|---|
| Node label (process, action, decision, terminator, io, use case) | 22 px | 400 | ink |
| Actor role | 20 px | 400 | ink |
| Branch / edge label | 20 px | 400 | ink-2 |
| «include», «extend» | 20 px | 300 | ink-2 |
| Boundary title, note | 20 px | 300 | ink-2 |

- Font: Kalam (self-hosted woff2, 300 and 400). Await `document.fonts.load("400 22px Kalam")` and `("300 20px Kalam")` before measuring. If Kalam fails to load, show the diagram with a visible "font didn't load" note in the lint panel; never silently lay out with a fallback.
- `Measurer.measure(text, px, weight) → {adv, top, bot}` in px, where `top` is negative (ink above the baseline) and `bot` positive. Browser: canvas `measureText`, `top = -actualBoundingBoxAscent`, `bot = actualBoundingBoxDescent`. Tests: a stub (`adv = 0.55 * px * chars`, `top = -0.75 * px`, `bot = 0.25 * px`).
- Multi-line labels (`\n`): line height `1.25 * px`; centered block exactly like `figure.Figure._label_in`: measure `"Hxg"` for top/bot, first baseline `= cy*96 - (n-1)*lh/2 - (top+bot)/2`.
- `tw`, `th` below: the text block's width and height in inches (`th = lines * px * 1.25 / 96`). `s = px / 96`.

## 3. Node shapes

Every filled node starts with a knockout of its outline (page color), then the strokes.

| Kind | Size | Strokes (pen.ts) |
|---|---|---|
| process | `w = max(tw + 0.6, 1.0)`, `h = max(1.9 s, th + 0.3)` | knockout rect; `looseRect` |
| action | same as process | knockout rect; `roundedRect(r = min(0.18, h/3), step 0.16)` |
| terminator | `w = tw + 0.7`, `h = max(1.8 s, th + 0.28)` | knockout rect; `roundedRect(r = h/2 - 0.01, step 0.14)` |
| io | `w = tw + 0.6 + 2k`, `h` as process, skew `k = 0.18` | knockout parallelogram; 4 side strokes like decision's (2% overshoot, width 0.03) |
| decision | `hh = max(1.45 s, th/2 + 0.22)`, `hw = tw/2 + 0.55`; then if `(tw/2 + 0.06)/hw + (th/2 + 0.04)/hh > 1`, set `hw = (tw/2 + 0.06) / (1 - (th/2 + 0.04)/hh)` so the text corners clear the sides | knockout diamond; 4 strokes exactly as `diagrams.decision` |
| merge | `hw = hh = 0.26`, no text | as decision |
| initial | `r = 0.1` | `dot(cx, cy, r)` |
| final | `r = 0.15` | `looseCircle(r, r, color CH, width 0.028)` + `dot(r * 0.55)` |
| flow-final | `r = 0.15` | `looseCircle` + two straight strokes (`taperIn 0, taperOut 0`, width 0.026) as `diagrams.final_node(flow_final=True)` |
| fork, join | thickness `0.075`; length set after layout (§5) | `blob` outline exactly as `diagrams.fork_bar` |
| actor | `h = 0.85` | strokes exactly as `diagrams.actor`; role label centered, baseline `top + h + 1.05 s` |
| use-case | `rx = tw/2 + 0.36`, `ry = max(0.3, th/2 + 0.17)` | knockout 12-gon; `looseCircle(rx, ry, color CH, width 0.028)` |
| boundary | set after layout (§6) | `looseRect(color GR, width 0.026)`; title at `(x0 + 0.2, y0 + 1.25 s)` baseline |
| note | text only | none |

Outline points (where an edge starts or ends), ported from `figure.Figure._edge` and extended:

- box, pill, io, bar: rectangle intersection; diamond: `t = 1 / (|ux|/hw + |uy|/hh)`; ellipse (use case): `t = 1 / sqrt((ux/rx)² + (uy/ry)²)`; circle (initial, final): `r`; actor: its side anchor at `top + 0.45 h`, `x ± 0.3 h`, or top/bottom.
- Then add the gap: 0.06 in.

## 4. Edge shapes

| Kind | How (port these exactly) |
|---|---|
| arrow, solid | `Sketch.arrow(ctrl, {width: 0.03, head: 0.17})`; `ctrl = [p0, ...interior route points, p1]`, adding the midpoint when there are only two |
| arrow, dashed (`..>`) | the dashed branch of `diagrams.flow` (straight dashes 0.17 long, 0.1 gaps, two-stroke head) |
| association | `diagrams.association`: one stroke `[a, mid (y - 0.01), b]`, width 0.026, no tapers, no head |
| include, extend | `diagrams.dependency`: dashes 0.16 / gaps 0.1, width 0.022, open head at 28°, label «include» or «extend» on the upper side using its offset formula |

- **Minimum length:** an arrow under 0.5 in is a layout bug (the head crowds the shaft). Layout spacing guarantees it; assert it.
- **Branch labels** (`yes`, `[approved]`) sit beside the first segment leaving the decision, using `diagrams.flow`'s offset formula (`off = w/2·|nx| + h/2·|ny| + 0.1` along the normal). Pick the side farther from the decision's center; if the label box then hits any stroke or label (§8), flip sides; if both collide, slide it to 60% along the segment. Never on the line.
- Edges to an unknown node are skipped (the linter already reports them).

## 5. Flow layout (flowchart, activity)

dagre 3 (`@dagrejs/dagre`, ESM: `import * as D from "@dagrejs/dagre"; const dagre = D.default ?? D`), confirmed API:

```ts
const g = new dagre.graphlib.Graph({ multigraph: true });
g.setGraph({ rankdir: dir === "right" ? "LR" : "TB", nodesep: 48, ranksep: hasLabels ? 82 : 72, edgesep: 24, marginx: 0, marginy: 0 });
g.setDefaultEdgeLabel(() => ({}));
g.setNode(id, { width: wPx, height: hPx });          // sizes from §3, in px
g.setEdge(from, to, {}, edgeId);                       // named, so parallel edges survive
dagre.layout(g);
g.node(id).x / .y                                      // centers, px
g.edge({ v: from, w: to, name: edgeId }).points        // [{x, y}, ...] px, ends on bounding boxes
```

- Convert px to inches after layout (divide by 96).
- **Route ends:** replace the first and last points with real outline points (§3) aimed at the neighbouring route point, so arrows touch diamonds and ellipses, not their bounding boxes. Drop interior points within 0.15 in of either end.
- **Fork and join bars:** lay out with a provisional length of 1.2 in, then set each bar's length to the span of its neighbours' centers on the cross axis plus 0.5 (minimum 1.0), centered where dagre put it. Arrows to and from a bar run straight and perpendicular to it, meeting it at each neighbour's cross-axis coordinate.
- **Pinned nodes** (`at X Y`): after layout, move them; edges touching a pinned node become straight (two points + midpoint).
- **Phone width:** if the rendered scale would put 22 px labels under 13 px (container width / natural width < 0.59) and `direction right`, lay out again with `TB`. If it's still under, keep it and report `PHONE_LEGIBILITY` (warning) when `qa=1`.

## 6. Use-case layout

1. **Columns inside the boundary.** Column A: use cases associated with an actor, in file order. Column B: use cases reached only through «include»/«extend», each placed in the row of the first use case it connects to (pushed down if that row is taken). Any other node inside the boundary (including a misplaced actor) goes in column A in file order.
2. **Rows:** pitch = tallest ellipse + 0.45 in. Column gap 1.1 in. Each column is centered on its own widest ellipse.
3. **Boundary:** bounding box of everything inside, plus 0.4 in left, right and bottom and 0.6 in on top (title room). Empty boundary: 2 × 1.5 in.
4. **Actors:** left actors centered at `boundary.x0 - 1.2`, right actors at `boundary.x1 + 1.2`. Each is vertically centered on the mean y of the use cases it's associated with (no associations: the boundary's middle). Resolve overlaps by pushing down with 0.35 in between actor boxes (figure plus role label).
5. **Use cases outside a boundary** (the linter will flag them) go in a column 1.1 in right of the boundary. No boundary at all: columns A and B, no box.
6. **Edges:** straight. Association from the actor's side anchor to the ellipse outline; «include»/«extend» between ellipse outlines; any `->` between use cases straight with an arrowhead (the linter flags it).
7. **Pinned nodes** override all of the above for that node.

## 7. Scene and SVG

- **Frame:** bounding box of all ink and text boxes, plus 0.2 in on every side; translate so it starts at (0, 0). Natural size = frame × 96 px.
- **SVG** is a port of `figure.Figure.svg` (non-standalone): `<svg viewBox width height role="img" aria-labelledby="<id>-t <id>-d" class="ksyt-fig">`, `<title>` = diagram title, `<desc>` = desc or generated text, one `<g data-name="<element id>" data-step="n">` per element with one `<path class="k-<role>">` per color role in first-seen order, then `<text class="k-hand k-<role>" data-name data-step x y font-size [font-weight] [text-anchor]>`. Coordinates printed with one decimal.
- **Colors are roles, never hex:** `242B27 → ink`, `69736C → ink-2`, `256B4A → accent`, `184C36 → accent-strong`, `DCEBDF → wash`, `C77859 → terra`, `FAFAF6 → page`. The page's CSS maps roles to the theme tokens (`.ksyt-fig .k-ink { fill: var(--ink) }`, already in `ksyt.css`), so dark mode is a chalkboard automatically, knockouts included.
- **Escape every string** that enters the SVG or HTML (`& < > " '`).
- **Download SVG** (playground and embed footer): standalone variant with the light and dark role colors inlined in a `<style>` (port of `Figure._style`, `@media (prefers-color-scheme: dark)`), Kalam 400/300 woff2 embedded as base64 (SIL OFL permits embedding), filename `<diagram_id>.svg`. The embed's CSP blocks `fetch`, so get the font data with a lazy `import("@fontsource/kalam/files/kalam-latin-400-normal.woff2?inline")` (and the 300 file) on the first download click: Vite turns that into a data-URL chunk loaded as a script.

## 8. QA (labels and lines)

Port `figure.Figure.check` (raster at scale 2 with an `OffscreenCanvas`, knockouts applied):

- errors: `LINE_THROUGH_TEXT` (a stroke inside a label's clearance zone: its box plus `0.03 in + 6% of its size`, excluding its own node's outline when the label sits inside it), `TEXT_OVERLAP`, `CLIP`;
- warnings: `SMALL_KALAM` (< 18 px), `PHONE_LEGIBILITY` (< 13 px at the current container width).

Label placement (§4) uses a cheaper vector test (label rect against stroke polygons, sampled every 0.02 in) so it can try sides. `qa=1` and the playground show the raster findings in the lint panel. All fixture diagrams must render with zero QA errors at desktop width.

## 9. Build-up steps

- Every element and label carries `data-step`. The embed shows step 0 first and adds controls copied from `ksyt.js`: `back`, `next step`, `show all`, and an `aria-live` "step 1 of 3". Keyboard: Left/Right arrows when the diagram has focus.
- Hidden parts get `.is-hidden` (opacity 0, 0.4 s transition, instant under `prefers-reduced-motion`) and `aria-hidden="true"`. Never auto-advance.
- Each step change posts `step` to the host.

## 10. Text alternative (`describe.ts`)

Always rendered under the diagram as `<details><summary>describe this figure</summary>...</details>` (the `ksyt-web-design` pattern), from the structure, in reading order:

- **Flow:** an ordered list walking from the start node in file order of edges. A decision becomes one item listing each labeled exit and where it goes ("approved? yes: schedule the work (step 5). no: notify requester (step 6)"). A fork: "at the same time: order laptop; print badge". A join: "when both are done: first day".
- **Use case:** "Use-case diagram for Permit portal." Then one item per actor with its use cases, then one per «include» ("apply for permit always includes pay fee") and «extend» ("request fee waiver sometimes extends pay fee").
- The SVG `<desc>` is the `desc` header line when given, else the same text joined into sentences.
