# Rendering: geometry, routing, two looks, SVG (v2)

Everything is predefined shapes. Nobody draws freehand. Geometry is in **inches** (1 in = 96 CSS px, `PX` in `src/core/measure.ts`); text sizes are **CSS px**. Shape geometry comes from the slide skill's `reference/diagrams.py` with one conversion: wherever it uses `pt / 72` (a slide text size in inches), this code uses `px / 96`.

In v1 one module laid out and painted at once. In v2 the work is split in two, and every surface uses both halves:

```
ChalkDoc -- resolve() --> Geometry -- buildScene() --> Scene --> SVG, PDF, canvas
            src/core/geom             src/core/render
```

- **Geometry** says where everything is: each node's box and outline, each line's path, each label's position. One answer, whatever the look.
- **Scene** says what it looks like: a display list of paints and text, in one of two looks.

`test/render.test.ts` covers this file: layout of every fixture, lanes, classes, shapes, both looks, both SVG writers.

## 1. Seeds, names, stacking

- In the sketch look every node and line is one named `Sketch`: `new Sketch(seedFor("<diagram id>:<element id>"))`. Labels are text, not sketches.
- Names are identities. The parser refuses duplicate ids. Adding a node never changes another node's wobble.
- Stacking order: containers (boundaries, partitions), then lines, then shapes, then all text on top. A shape's fill hides any line ink under it.

## 2. Text

| Text | Size | Weight | Role |
|---|---|---|---|
| node label (process, action, decision, terminator, io, use case) | 22 px | 400 | ink |
| class name | 22 px | 400 (700 in the precision look) | ink |
| class member | 20 px | 400 | ink |
| class stereotype, `{abstract}` | 20 px | 300 | ink-2 |
| actor role | 20 px | 400 | ink |
| partition title | 20 px | 400 | ink |
| line label, multiplicity, role name | 20 px | 400 | ink-2, or the line's own color |
| «include», «extend» | 20 px | 300 | ink-2 |
| boundary title, note | 20 px | 300 | ink-2 |

- `Measurer.measure(text, px, weight, family?)` returns `{adv, top, bot}` in px. `top` is negative (ink above the baseline), `bot` positive. In the browser it is canvas `measureText` (`src/embed/measure-dom.ts`). In tests it is a stub: `adv = 0.55 * px * chars`, `top = -0.75 * px`, `bot = 0.25 * px`.
- **Geometry is always measured in the handwriting font**, in both looks. That is why a diagram's shapes, positions and routes are identical in sketch and precision.
- Fonts are Kalam (300, 400) and Atkinson Hyperlegible Next (400, 700), self-hosted. `loadFonts()` waits for them before the first measure. If a font fails to load, the lint panel says "font didn't load"; the figure is never silently laid out with a fallback.
- Multi-line labels (`\n`): line height `1.25 * px`. The block is centered as `figure.Figure._label_in` does: measure `"Hxg"` for top and bottom, first baseline `= cy*96 - (n-1)*lh/2 - (top+bot)/2`.
- A static class member is underlined.
- Below, `tw` and `th` are the text block's width and height in inches (`th = lines * px * 1.25 / 96`), and `s = 22 / 96`.

## 3. Node shapes

Sizes are in `nodeSize()` (`src/core/geom/shape.ts`). The strokes column is the sketch look (`src/core/render/sketch.ts`); the precision look draws the same outline with real strokes (section 9).

| Kind | Size | Sketch strokes (`pen.ts`) |
|---|---|---|
| process | `w = max(tw + 0.6, 1.0)`, `h = max(1.9 s, th + 0.3)` | `looseRect`, width 0.032 |
| action | same as process | `roundedRect(r = min(0.18, h/3), step 0.16)` |
| terminator | `w = tw + 0.7`, `h = max(1.8 s, th + 0.28)` | `roundedRect(r = h/2 - 0.01, step 0.14)` |
| io | `w = tw + 0.6 + 2k`, `h` as process, skew `k = 0.18` | four side strokes like the decision's (2% overshoot, width 0.03) |
| decision | `hh = max(1.45 s, th/2 + 0.22)`, `hw = tw/2 + 0.55`, widened when needed so the text's corners clear the sides | four strokes as `diagrams.decision` |
| merge | 0.52 square, no text | as decision |
| initial | diameter 0.2 | `dot` |
| final | diameter 0.3 | `looseCircle` (width 0.028) and a `dot` at 0.55 of the radius |
| flow-final | diameter 0.3 | `looseCircle` and two straight strokes (no tapers, width 0.026) |
| fork, join | thickness 0.075; length set after layout (section 5) | `blob` outline as `diagrams.fork_bar` |
| actor | figure 0.85 tall, role label below | strokes as `diagrams.actor` |
| use-case | `rx = tw/2 + 0.36`, `ry = max(0.3, th/2 + 0.17)` | `looseCircle(rx, ry, width 0.028)` over a 12-sided fill |
| class, interface | rows of `20 * 1.3 / 96`; padding 0.14 sideways, 0.07 up and down; at least 1.3 wide. Rows: stereotype, name, `{abstract}`, a divider, attributes, a divider, operations | `looseRect` (width 0.03) and divider strokes (width 0.022) |
| boundary | set after layout (section 6); empty: 2 x 1.5 | `looseRect` in graphite, width 0.026; title at the top left |
| partition | set after layout (section 5); header 0.46 | lane lines, width 0.026 |
| note | text only | none |

- **Fill.** A shape is filled with the page color by default, so lines under it do not show through. `style ... fill wash` uses the wash color; `fill none` leaves it open.
- **Author sizes.** `size W H` (or a resize in the draw view) wraps the label to the new width and cannot go under what the text needs. The initial dot, the final nodes, the merge diamond and the actor have fixed sizes. A partition has a thickness instead.

**Outline points** (where a line starts or ends), from `figure.Figure._edge` and extended, in `edgePoint()` and `sideAnchor()`:

- box, pill, io, bar: rectangle intersection. Diamond: `t = 1 / (|ux|/hw + |uy|/hh)`. Ellipse: `t = 1 / sqrt((ux/rx)² + (uy/ry)²)`. Circle: the radius. Actor: its side anchor at `top + 0.45 h`, `x ± 0.3 h`, or the top, or below the role label.
- Then a gap, by line kind (`gaps()` in `resolve.ts`), start and end: arrow 0.06 and 0.06; association 0 and 0.02; include, extend, dependency 0.02 and 0.05; generalization, realization 0 and 0.03; aggregation, composition 0.03 and 0.

## 4. Who decides where a shape goes

Every node takes part in the automatic layout, including the ones the author placed. A placed node keeps its slot and is then moved to its `place`. So the result is a pure function of the document: a saved file reopens exactly as it looked, and placing one shape does not re-flow the others.

How the draw view uses this (hold still, tidy up) is decision 6 in `docs/revamp/ARCHITECTURE_DECISIONS.md`.

## 5. Flow layout (flowchart, activity, class)

`layoutFlow()` in `src/core/geom/layout.ts`, with dagre 3 (`@dagrejs/dagre`).

```ts
const g = new dagre.graphlib.Graph({ multigraph: true });
g.setGraph({ rankdir: "TB" | "LR", nodesep: 48, ranksep, edgesep: 24, marginx: 0, marginy: 0 });
g.setNode(id, { width: wPx, height: hPx });
g.setEdge(from, to, {}, edgeUid);        // named, so parallel lines survive
dagre.layout(g);
```

- `ranksep` is 104 px when any line has end text (multiplicities, role names), 82 when any line has a label, else 72.
- Edges are inserted last to first, which keeps the author's file order left to right.
- A generalization or realization is inserted child-under-parent, so a parent ranks above its children whichever way the line was written.
- Only dagre's node centers are used. Its edge points are not: the router (section 7) draws every line.
- **The ranking is remembered.** It depends only on sizes and links, so a drag in the draw view (which resolves on every frame) does not run dagre again.
- **Room for a decision's answers** (`answerRoom()`). A decision's answers leave from its corners. When two or more answers on the next rank stand closer together than the diamond's width plus 0.3 on each side, the flow is ranked a second time with extra width on those nodes, so they stand past the corners and each line turns once. Skipped when the diagram has partitions, which set their own spacing.
- **Fork and join bars** are laid out at a provisional length, then span their neighbours' centers plus 0.5 (at least 1.0), unless the author sized them.
- **Direction.** `direction right` ranks left to right. With partitions, the lanes decide instead.

### Partitions

- Lanes run along the flow. They are columns when the flow runs down and rows when it runs right. `lanes vertical` or `lanes horizontal` in the header overrides the direction.
- Each node keeps its rank along the flow and is pulled across into its lane.
- A lane is as thick as its `thickness` says. Without one it is as thick as its contents need, and at least 1.8. Padding inside a lane is 0.35, and shapes side by side in one lane stand 0.4 apart. A decision's guards get room.
- Lanes share their dividers. The first lane draws the near side.
- `pool` gives the block of lanes an origin and a minimum length.
- A node outside every partition stands before the block.
- Lane order is file order.

## 6. Use-case layout

`layoutUseCase()` in `src/core/geom/layout.ts`.

1. **Columns inside the boundary.** Column A: use cases linked to an actor, in file order. Column B: use cases reached only through «include» or «extend», each in the row of the first use case it connects to. **The far column:** a use case that only right-hand actors use stands in the last column, beside them, as long as something stays in the near column.
2. **Rows.** Pitch is the tallest ellipse plus 0.45, or plus 0.65 when a connector runs between two rows of one column. Column gap 1.1, wider when an «include» label has to fit between columns.
3. **Boundary.** The bounding box of what is inside, plus 0.4 at the sides and bottom and 0.6 on top for the title.
4. **Actors.** Left actors stand 1.0 outside the boundary's left edge, right actors 1.0 outside the right. Each is centered on the use cases it is linked to. Overlapping actors are pushed apart with 0.35 between them.
5. **Use cases outside a boundary** (the notation check flags them) go in a column 1.1 right of the boundary.
6. **Lines** are straight. A line that would pass through a shape it does not join bends around it and is drawn as a smooth curve.
7. **Placed nodes** override all of the above for that node.

## 7. Routing

`src/core/geom/route.ts`, called from `routeAll()` in `resolve.ts`. One router for automatic layout, for routes bent by hand, and for the live preview during a drag. Everything is deterministic.

- **Which kind.** Use-case lines are straight. All other lines are elbows. A `route` line in the layout block overrides either.
- **Straight** lines are clipped to the two outlines. Several straight lines between the same two shapes are spread 0.17 apart.
- **Elbow** lines are orthogonal. For every pair of sides the router tries the short patterns: direct, one corner (both ways), and a step through the middle (both ways), each leaving its shape on a stub of 0.22. It scores each and keeps the cheapest:

| Cost | Amount |
|---|---|
| path length | 1 per inch |
| reach | in a flow, half of each shape's extent, so length is in effect measured center to center (`reach()`); 0 in class and use-case diagrams |
| each corner | 0.35 |
| the side used | preferences for the flow direction, for a decision's exits, and against a side that already takes lines going the other way |
| short jogs | `jogs()` |
| sharing a channel | 5, plus twice the overlap, for a run parallel to an earlier line's run and within 0.1 of it (`sharing()`). Two lines that end at the same shape may share the last stub |
| a crossing | 0.25 |
| running through a shape | 1000 each, with 0.07 clearance |

- **Order.** Lines are routed in file order. Each finished elbow is handed to the next ones as `taken`, so a later line keeps out of the channels earlier lines use and crosses them as little as it can.
- **Fallback.** When every pattern is blocked, an A* search on a sparse grid around the obstacles finds a way.
- **Decisions.** `decisionSides()` gives a decision's exits different corners: the answer to one side leaves that side, the one ahead leaves the far point.
- **Classes.** A generalization or realization prefers to leave the top of the child and arrive at the bottom of the parent.
- **Hand-bent routes.** `route ... via` points are the corners of the elbow; `from` and `to` pin the sides.
- **During a drag.** `resolve()` with `partial` routes only the lines that touch the moved shapes, and takes the rest as they were. The draw view does this above 60 nodes.
- **A line from a shape to itself** leaves one side, goes round the corner 0.4 out, and comes back in the next side (`loopRoute()`). These lines are routed after all the others, so each can take a corner whose two sides are free. On a box whose corners are busy, the line stands as a bracket on one free side instead. A shape with such a line gets 0.5 more room in the ranking (`LOOP_ROOM` in `layout.ts`). Its end texts stand outside the loop. Tests: "a line from a shape to itself" in `test/render.test.ts`.
- A line to an undeclared node, or to a container, is not drawn.

## 8. Labels on lines

`placeEdgeTexts()` in `resolve.ts`. A label is text beside its line, never on it.

- **«include», «extend»:** above the middle of the longest run; outside the bend of a curved line.
- **A guard** (the label of a line leaving a decision or merge, and any label on a straight line) sits near the start, on the side farther from the decision.
- **Any other label** sits beside the middle of the longest run.
- **Multiplicities and role names** sit at their end of the line, the multiplicity on one side and the role on the other, a little farther out when a diamond or arrowhead is there.
- Each label tries several spots on both sides and takes the clearest: clear of shapes, other lines, other text and arrowheads, and softly clear of container outlines and lane headers.
- A `label` line in the layout block overrides the choice.

## 9. The two looks

`buildScene(doc, measurer, { look })` in `src/core/render/scene.ts`. The look is, in order: the caller's option (the embed's `look` parameter, the export dialog), the file's `look` line, `sketch`.

### Sketch (`src/core/render/sketch.ts`)

Filled polygons from the pen engine (`src/core/pen.ts`, a port of `reference/pen.py`). Text in Kalam. Node recipes are in section 3. Lines:

| Kind | How |
|---|---|
| arrow, solid | `Sketch.arrow(ctrl, {width: 0.03, head: 0.17})`. For an elbow, `ctrl` follows the path with rounded corners (radius up to 0.09) |
| arrow, dashed (`..>` in a flow) | dashes 0.17 long, gaps 0.1, width 0.028, open head 0.17 at 27 degrees |
| association | one stroke, width 0.026, no head; an open head when it is navigable |
| include, extend, dependency | dashes 0.16, gaps 0.1, width 0.022, open head 0.2 at 28 degrees |
| generalization | solid shaft, hollow triangle (0.19 long, 0.1 half-width) |
| realization | dashed shaft, the same triangle |
| aggregation, composition | a diamond (0.26 long, 0.075 half-width) at the `from` end, hollow or filled |

### Precision (`src/core/render/precision.ts`)

Real SVG strokes on the same geometry. Text in Atkinson Hyperlegible Next at 0.86 of the size, class names bold.

- Shapes 0.021 wide, lines 0.018, dashes 0.09 with gaps of 0.065.
- Exact corners: an action's radius is `min(0.14, h/3)`, a terminator's is `h/2`. Line corners are rounded at 0.05.
- Line ends: open heads 0.15 long at 26 degrees, triangle 0.18 long, diamond 0.25 long.

### Style

`style` lines change color (a theme role), weight (thin 0.68, normal 1, bold 1.6 of the stroke width) and fill. Both looks honor them.

## 10. Scene and SVG

- **Frame:** the bounding box of all ink and text, plus a margin (0.2 by default), moved so it starts at (0, 0). Natural size is the frame times 96 px.
- **Paints** are one of three: a filled polygon, a stroked line (optional fill, dash, corner radius), an ellipse.
- **Escape every string** that enters SVG or HTML (`& < > " '`). `esc()` in `src/core/render/svg.ts`.

Two writers over the same scene:

| | `sceneToSvg()`: the page | `portableSvg()`: a file |
|---|---|---|
| used by | the embed, the write preview, the draw canvas (per element) | the SVG export, and the PNG made from it |
| colors | role classes: `k-<role>` fills, `ks-<role>` strokes. The page's CSS maps them to theme tokens, so dark mode is a chalkboard by itself | plain `fill` and `stroke` attributes for the theme the author chose |
| background | none; the page shows through | an explicit `<rect>`, unless transparent |
| fonts | the page's | embedded woff2 with `unicode-range`, a fallback stack, and `textLength` on every text; or no text at all, the letters as outlines |
| structure | `<svg role="img" aria-labelledby class="ksyt-fig ksyt-<look>">`, `<title>`, `<desc>`, one `<g data-name data-kind [data-step]>` per element, then `<text class="k-hand\|k-body k-<role>" data-name>` | XML header, `<title>`, `<desc>`, one `<g id="<prefix>-<name>">` per element, then the text |

Coordinates are printed with one decimal. Colors in a file must match `reference/ksyt.css`; the two tables are `LIGHT` and `DARK` in `svg.ts`.

Export (options, PNG, PDF, text as shapes) is section 11 of `ARCHITECTURE.md` and decision 9.

## 11. The layout check

`checkScene()` in `src/core/qa.ts`, a port of `figure.Figure.check`. It rasterizes the scene's real geometry with a scanline fill at scale 2, with fills applied in stacking order. It needs no canvas, so it runs in Node.

- errors: `LINE_THROUGH_TEXT` (ink inside a label's clearance zone: its box plus `0.03 in + 6% of its size`), `TEXT_OVERLAP`, `CLIP`;
- warnings: `SMALL_KALAM` (handwritten text under 18 px; the precision look is let off), `PHONE_LEGIBILITY` (text that would show under 13 px at the narrowest display width, 328 px by default).

Label placement (section 8) uses a cheaper vector test so it can try many spots. The write view and `qa=1` in the embed show the raster findings in the lint panel. Every export is checked too, on the scene built for the file.

## 12. Narrow screens

`sceneFor()` in `src/embed/figure.ts`.

- A right-running flow is laid out top-down when the container is so narrow that its smallest text would show under 13 px.
- If the text would still be too small, the SVG keeps a minimum width and scrolls sideways, with a note that says so.

## 13. Build-up steps

- Every element and label carries `data-step`. The embed shows step 0 first, with controls: `back`, `next step`, `show all`, and an `aria-live` "step 1 of 3". Keyboard: Left and Right arrows when the figure has focus.
- Hidden parts get `.is-hidden` and `aria-hidden="true"`. Nothing ever advances by itself.
- Each step change posts `step` to the host.

## 14. Text alternative

`src/core/describe.ts`. Always rendered under the figure as `<details><summary>describe this figure</summary>...</details>` (the `ksyt-web-design` pattern), from the structure, in reading order.

- **Flow:** an ordered list walking from the start node. A decision becomes one item listing each labeled exit and where it goes. A fork: "at the same time: ...". A join: "when both are done: ...".
- **Use case:** the system's name, then one item per actor with its use cases, then one per «include» and «extend».
- **Class:** its own branch in `describeItems()`.
- The SVG `<desc>` is the `desc` header line when given, else the same text joined into sentences.

The structured `describe` block of a use case is not part of this text yet.
