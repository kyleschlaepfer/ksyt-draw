# Baseline audit: Chalk before the v2 revival

What the tool was at commit `d30af12` ("beta tag beside the name"), the last commit before the
revival started. Every finding names the v1 file and function it comes from. The v1 files that were
later removed can still be read with `git show d30af12:<path>`.

How this was checked: the test results and the list of changed files come from `CONTINUE.MD`. The
code findings were re-read against `d30af12` for this document. The screenshots and export files in
`baseline/` were captured from the running v1 app by `scripts/capture-baseline.mjs` and
`scripts/capture-exports.mjs`. The v1 app was not run again while writing this, so a finding marked
"by reading the code" was not reproduced in a browser here.

## 1. Baseline test results

| Check | Result at `d30af12` |
|---|---|
| Unit tests (`npm test`) | 191 passed |
| Browser tests (`npm run test:e2e`) | 67 passed, 2 failed |
| Build | passed |

The 2 failures were not app bugs. The Windows checkout had CRLF line endings in the fixture files,
and a `<textarea>` normalizes what it holds to LF, so a test that compared the page's text with the
fixture file read from disk saw two different strings. Fixed in two places:

- `.gitattributes`: `* text=auto eol=lf`, so the checkout has LF everywhere.
- `test/e2e/helpers.ts`, `ksdOf()`: the fixture text is normalized with `.replace(/\r\n/g, "\n")`.

`CONTINUE.MD` does not name the two tests. The v1 tests that compare the link's text with a fixture
file are in `test/e2e/playground.spec.ts` (`expect(parseHash(hash).d).toBe(ksdOf("flow-approval"))`,
three places), so they are the likely ones. No test was weakened or removed to get a green baseline.

For comparison, the checkpoint (`1a1e46f`) reports 411 unit tests and 78 browser tests, all passing.
Those numbers are from `CONTINUE.MD` and were not re-run for this document.

## 2. The concerns in the brief, checked against the v1 code

The brief (section 2.2) listed thirteen suspected limitations and asked for each to be verified, not
assumed. Verdicts: **confirmed** (the code does what the brief feared), **partly** (true in one
respect, not in another), **not reproduced**. None came out as "not reproduced".

| # | Concern | Verdict | Where (v1) |
|---|---|---|---|
| 1 | Draw edits are serialized to text and the whole figure is rebuilt | confirmed | `src/play/draw.ts`: `commit()`, `render()` |
| 2 | `commit()` and `render()` do expensive work too often | partly | `src/play/draw.ts`: `commit()`, `render()`, the `pointermove` handler |
| 3 | `renderSelection()` replaces the form, so typing loses focus | confirmed, by reading the code | `src/play/draw.ts`: `renderSelection()` |
| 4 | `freeze()` pins every node when one moves | confirmed | `src/play/draw.ts`: `freeze()`, `moveNode()`, `addNode()` |
| 5 | `scenePoint()` depends on the SVG's box and viewBox | confirmed, with a different symptom than expected | `src/play/draw.ts`: `scenePoint()`, `toLayout()` |
| 6 | Tight content bounds and re-centering in the editor | confirmed | `src/core/scene.ts`: `buildScene()`; `src/play/play.css`: `.draw-canvas > svg` |
| 7 | Connecting is two clicks, no ports, no preview | confirmed | `src/play/draw.ts`: `connectBtn`, the `pointerdown` handler |
| 8 | No resize, endpoint editing, waypoints or swimlanes | confirmed | `src/core/model.ts`: `DiagramNode`, `DiagramEdge`, `NodeKind` |
| 9 | `renumberEdges()` changes edge ids by order | confirmed, and it went deeper than Draw | `src/play/draw.ts`: `renumberEdges()`; `src/core/parse.ts` |
| 10 | Undo is a snapshot stack local to Draw, no redo | confirmed | `src/play/draw.ts`: `undo`, `doUndo()` |
| 11 | `serialize()` rebuilds the text and loses comments and formatting | confirmed | `src/core/serialize.ts`: `serialize()`; `src/core/parse.ts` |
| 12 | Write is a plain `textarea` | confirmed | `src/play/main.ts`: `ta`, `render()`, `schedule()` |
| 13 | Draw's browser tests cover only basic operations | confirmed | `test/e2e/draw.spec.ts` |

### 1. Draw edits are serialized and the figure rebuilt (confirmed)

- **Code.** Every edit ends in `commit()`, which calls `serialize(d)`, hands the text to the page
  (`host.setText`), then calls `render()`. `render()` runs `buildScene()`, `sceneToSvg()`,
  `svgElementFrom()` and `canvas.replaceChildren(svg)`.
- **Symptom.** The whole SVG is thrown away and made again after every change.
- **Consequence.** No element survives an edit, so nothing can hold state across one (a drag in
  progress, a focused field, a hover). It also ties Draw to whatever `serialize()` can write: a
  property the text format could not express could not exist in Draw.

### 2. Expensive work too often (partly)

- **True for typing.** The title field, the node text field and the line label field each listen
  for `input` and call `commit()`. So every keystroke serializes the diagram, rebuilds the SVG, runs
  the notation check (`lint(d)`) and the layout check (`checkScene`), and rebuilds the palette
  (`renderPalette()`) and the selection form.
- **Not true for dragging.** The `pointermove` handler only sets a `transform` attribute on the
  dragged shape's groups. The rebuild happens once, at `endDrag()` -> `moveNode()` -> `commit()`.
- **Consequence of the cheap drag.** The lines attached to a shape do not follow it while it moves;
  they jump when the pointer is released. The arrow keys call `moveNode()` directly, so each press
  is a full rebuild and its own undo step.

### 3. The selection form is replaced while typing (confirmed, by reading the code)

- **Code.** The node text field (`#draw-node-label`) handles `input` by calling `commit()`.
  `commit()` calls `render()`, `render()` calls `renderSelection()`, and `renderSelection()` starts
  with `selSec.replaceChildren(...)` and builds a new `textarea`. The field being typed in is removed
  from the page on its own first `input` event. The line label field (`#draw-edge-label`) has the
  same path.
- **Symptom.** After one character the focus is gone, and the next keys go nowhere. The title and
  id fields escape this because `render()` skips them while they have the focus
  (`document.activeElement !== titleIn`).
- **Why the tests did not see it.** `test/e2e/draw.spec.ts` entered text with Playwright's `fill()`,
  which sets the whole value in one event. No test typed one character at a time.
- **Consequence.** Editing a label, the most common edit there is, did not work by typing. Double
  click made it worse: the `dblclick` handler only moved the focus to that same sidebar field.
- Not reproduced in a browser for this document. The brief's scenario B ("type character by
  character") is now a browser test against the new canvas.

### 4. `freeze()` pins everything (confirmed)

- **Code.** `freeze()` loops over every node that is not a boundary and has no `at`, and gives it
  one from the current scene. `moveNode()` calls it before every move (drag or arrow key), and
  `addNode()` calls it when a shape is dropped at a point.
- **Symptom.** Drag one shape and every node line in the text gains `at X Y`. The v1 test asserts
  exactly this: "every other shape got pinned where it was, so nothing else jumped".
- **Consequence.** One drag ends automatic layout for the whole diagram. The way back is one shape
  at a time ("let it find its own place"), or deleting the `at` words by hand in Write. It was done
  on purpose, to stop the picture jumping, but the cost was the feature Write depends on.

### 5. `scenePoint()` and the coordinate system (confirmed, different symptom)

- **Code.** `scenePoint()` reads `svg.getBoundingClientRect()` and `svg.viewBox.baseVal.width`,
  works out one scale, and converts the pointer to inches. `toLayout()` then subtracts
  `scene.offset`. The three drag handlers repeat the same arithmetic.
- **What is fine.** The arithmetic is correct for an SVG that is scaled uniformly by CSS, which is
  the only case v1 had.
- **What is wrong.** There is no viewport to speak of: no zoom, no pan, no origin that stays put.
  The coordinate system is the picture's own frame, and that frame is recomputed on every commit
  (see 6). A palette shape can only be dropped on the picture itself: `startPlacing()` tests the
  pointer against the SVG's rectangle, so there is no empty canvas to drop onto.
- **Consequence.** No room to work beyond the current drawing, and nothing to build zoom or pan on.

### 6. Tight bounds and re-centering (confirmed)

- **Code.** `buildScene()` in `src/core/scene.ts` frames the scene to "all ink and text boxes, plus
  the margin, translated to start at (0, 0)" (`MARGIN = 0.2` inches) and records the shift in
  `scene.offset`. The CSS is `.draw-canvas > svg { max-width: 100%; height: auto }`.
- **Symptom.** The drawing surface is the figure, cropped. A wide diagram is shrunk to fit; anything
  that changes the bounds moves everything on screen.
- **Evidence.** [`baseline/draw-light-390.png`](baseline/draw-light-390.png): at phone width the
  diagram in the draw view is scaled down until its labels cannot be read, with empty space under
  it. [`baseline/draw-light-1440.png`](baseline/draw-light-1440.png): the "canvas" is a figure
  between two dashed rules.
- **Consequence.** Right for an exported figure, wrong for a workspace.

### 7. Two-click connecting (confirmed)

- **Code.** The "connect two shapes" button sets `mode = "connect"`. The `pointerdown` handler then
  takes the first shape (`connectFrom`), then the second, and calls `addEdge()`. The line's meaning
  comes from a `select` in the sidebar chosen beforehand.
- **Symptom.** No ports, no line following the pointer, no highlight on the target, no check that
  the connection is allowed until after it is made. The status line carries the whole interaction
  ("click the first shape", "now click the second shape").

### 8. No resize, endpoint editing, waypoints or swimlanes (confirmed)

- **Code.** The v1 model in `src/core/model.ts` gives a node one geometric field, `at` (a pinned
  center), and an edge none. `NodeKind` has no partition. `EdgeKind` is `arrow`, `association`,
  `include`, `extend`.
- **Symptom.** A shape's size is whatever its text needs. A line's path is whatever the layout
  gives. An end can only be changed by "swap ends" or by deleting and reconnecting.
- **Consequence.** These were not missing features of Draw alone. The model and the text format had
  nowhere to keep a size, a route or a lane.

### 9. Edge ids renumbered by order (confirmed, and deeper than Draw)

- **Code.** `renumberEdges()` sets every edge's id to `e1`, `e2`, ... by position, after each add
  and delete. The v1 parser does the same on reading (`` id: `e${dg.edges.length + 1}` `` in
  `src/core/parse.ts`), and `serialize()` never writes an edge id.
- **Symptom.** Delete the second line and the old third line becomes `e2`.
- **Consequence.** An edge had no identity at all, only a position in the file. That is why nothing
  could be attached to an edge and survive an edit (a route, a label position, a selection across
  undo). The fix had to be in the model, not in Draw: v2 gives every node and edge a stable `uid`
  and keeps `e1`, `e2`, ... only as the derived name the notation check reports.

### 10. Undo local to Draw, no redo (confirmed)

- **Code.** `const undo: string[]` holds text snapshots, at most 50. `commit()` pushes one each
  time. `doUndo()` pops one and re-parses. There is no redo. Ctrl+Z is handled on the draw panel
  only, and only when the focus is not in a field.
- **Symptom.** Because every keystroke in a label is a `commit()`, each character is an undo step,
  and so is each arrow-key nudge. Write has only the `textarea`'s built-in undo. The two histories
  know nothing about each other, and a Draw edit replaces the textarea's value from script.
- **Consequence.** No single answer to "undo what I just did" across the two views.

### 11. `serialize()` rebuilds the text (confirmed)

- **Code.** `serialize()` in `src/core/serialize.ts` prints the header, then every node, then every
  edge, from the model. The parser drops comments and blank lines before they reach the model
  (`if (!line || line.startsWith("#")) continue;`). The file's own promise is only that
  `parse(serialize(parse(x)))` equals `parse(x)`.
- **Symptom.** Any Draw edit, even moving one shape, rewrites the whole file: comments gone, blank
  lines regrouped, lines that were interleaved moved (all edges after all nodes), spacing reset.
- **Consequence.** An author who wrote and commented a diagram in Write lost that work by touching
  Draw once. This is the "silent data loss" the brief rules out.

### 12. Write is a `textarea` (confirmed)

- **Code.** `src/play/main.ts` builds `textarea#ksd` and re-renders 150 ms after input
  (`schedule()`). The v1 parser throws a `ParseError` at the first mistake, and `render()` then
  replaces the preview with an error card.
- **Symptom.** No highlighting, line numbers, completion, bracket matching or search. One error at
  a time, shown as a line number in the status text. While the text has a mistake the figure is
  gone, and the draw view shows an empty state ("The text has a mistake, so there's nothing to draw
  yet.").
- **Evidence.** [`baseline/write-light-1440.png`](baseline/write-light-1440.png).

### 13. Draw's browser tests (confirmed)

- **Code.** `test/e2e/draw.spec.ts` at `d30af12` has 7 tests. Text goes in with `fill()`; clicks on
  shapes use `force: true`; one test drags; none zooms, types key by key, resizes, reconnects or
  looks at an exported file.
- **Consequence.** The suite passed while concern 3 was live. The tests proved that the operations
  existed, not that they could be used.

### Two things found that the brief did not list

- **The draw view's first picture can be measured before the fonts load.** In v1 the write view
  waits for `loadFonts()` before it measures; the draw view's `refresh()` does not. The two
  selection screenshots show the effect: the same diagram is slightly larger in
  [`baseline/draw-selected-node-light-1440.png`](baseline/draw-selected-node-light-1440.png) (a
  click on a node, which re-renders through `endDrag()`) than in
  [`baseline/draw-selected-edge-light-1440.png`](baseline/draw-selected-edge-light-1440.png) (a
  click on a line, which does not). The cause is inferred from the code and was not confirmed by a
  run. In v2 the page waits for the fonts before it creates the session, and re-measures if fonts
  arrive late (`session.remeasure()`).
- **Selection is shown by color alone.** `.draw-canvas .is-selected path.k-ink { fill: var(--accent) }`
  turns the selected shape green and nothing else. That breaks the house rule that state is never
  shown by color alone.

## 3. The UI at the baseline

Recorded in detail in [`UI_PRESERVATION_CONTRACT.md`](UI_PRESERVATION_CONTRACT.md). Screenshots,
all from `scripts/capture-baseline.mjs` against the v1 build:

| View | Light | Dark |
|---|---|---|
| Write, 1440 px | [`write-light-1440.png`](baseline/write-light-1440.png) | [`write-dark-1440.png`](baseline/write-dark-1440.png) |
| Write, 820 px | [`write-light-820.png`](baseline/write-light-820.png) | [`write-dark-820.png`](baseline/write-dark-820.png) |
| Write, 390 px | [`write-light-390.png`](baseline/write-light-390.png) | [`write-dark-390.png`](baseline/write-dark-390.png) |
| Draw, 1440 px | [`draw-light-1440.png`](baseline/draw-light-1440.png) | [`draw-dark-1440.png`](baseline/draw-dark-1440.png) |
| Draw, 820 px | [`draw-light-820.png`](baseline/draw-light-820.png) | [`draw-dark-820.png`](baseline/draw-dark-820.png) |
| Draw, 390 px | [`draw-light-390.png`](baseline/draw-light-390.png) | [`draw-dark-390.png`](baseline/draw-dark-390.png) |
| The syntax, 1440 px | [`syntax-light-1440.png`](baseline/syntax-light-1440.png) | [`syntax-dark-1440.png`](baseline/syntax-dark-1440.png) |
| The syntax, 820 px | [`syntax-light-820.png`](baseline/syntax-light-820.png) | [`syntax-dark-820.png`](baseline/syntax-dark-820.png) |
| The syntax, 390 px | [`syntax-light-390.png`](baseline/syntax-light-390.png) | [`syntax-dark-390.png`](baseline/syntax-dark-390.png) |
| Draw, a node selected | [`draw-selected-node-light-1440.png`](baseline/draw-selected-node-light-1440.png) | not captured |
| Draw, a line selected | [`draw-selected-edge-light-1440.png`](baseline/draw-selected-edge-light-1440.png) | not captured |

The write and draw shots are full-page; the syntax shots are the first screen only.

## 4. Exports at the baseline

v1 had one export: "download SVG". `scripts/capture-exports.mjs` loaded each of the nine v1 fixtures
in the running app, pressed the button, saved the real file, and then showed that file as an image on
a white page at 600 px (half a slide), 420 px (a report column) and 240 px (a thumbnail).

| Fixture | File | Natural size (px) | Bytes | At three sizes |
|---|---|---|---|---|
| activity-fork-either | [svg](baseline/exports/activity-fork-either.svg) | 476 x 573 | 106,907 | [sheet](baseline/exports/activity-fork-either.sizes.png) |
| activity-parallel | [svg](baseline/exports/activity-parallel.svg) | 420 x 701 | 109,493 | [sheet](baseline/exports/activity-parallel.sizes.png) |
| dangling | [svg](baseline/exports/dangling.svg) | 241 x 354 | 51,716 | [sheet](baseline/exports/dangling.sizes.png) |
| flow-approval | [svg](baseline/exports/flow-approval.svg) | 531 x 801 | 101,765 | [sheet](baseline/exports/flow-approval.sizes.png) |
| flow-unlabeled | [svg](baseline/exports/flow-unlabeled.svg) | 532 x 621 | 89,840 | [sheet](baseline/exports/flow-unlabeled.sizes.png) |
| usecase-actor-inside | [svg](baseline/exports/usecase-actor-inside.svg) | 357 x 572 | 109,249 | [sheet](baseline/exports/usecase-actor-inside.sizes.png) |
| usecase-include-reversed | [svg](baseline/exports/usecase-include-reversed.svg) | 740 x 210 | 102,791 | [sheet](baseline/exports/usecase-include-reversed.sizes.png) |
| usecase-is-flow | [svg](baseline/exports/usecase-is-flow.svg) | 526 x 574 | 130,312 | [sheet](baseline/exports/usecase-is-flow.sizes.png) |
| usecase-permit | [svg](baseline/exports/usecase-permit.svg) | 1023 x 454 | 156,995 | [sheet](baseline/exports/usecase-permit.sizes.png) |

Sizes and byte counts are from [`baseline/exports/report.json`](baseline/exports/report.json).

What the files show (the full review, with root causes and the v2 answer to each, belongs in
`EXPORT_QUALITY_AUDIT.md`; this is only what was seen while writing this audit):

- **Colors depend on the viewer.** `flow-approval.svg` sets every fill through a rule such as
  `.k-page{fill:var(--page,#FAFAF6)}` inside a `<style>`, with a second set under
  `@media (prefers-color-scheme:dark)`. It comes from `standaloneStyle()` in `src/core/svg.ts`. The
  file changes color with the viewer's system theme, and a tool without CSS variable support has
  nothing to fall back on.
- **No background.** The file has no backdrop rectangle. On the white page of the size sheets the
  shapes' off-white fills show as patches (`flow-approval.sizes.png`, `activity-parallel.sizes.png`).
- **Curved branch lines.** In `flow-approval.sizes.png` the two lines leaving the decision swoop,
  their arrowheads arrive at a tilt, and the "yes" guard sits away from its line.
- **A wide diagram does not survive small sizes.** `usecase-permit.svg` is 1023 px wide. At 240 px
  its labels cannot be read (`usecase-permit.sizes.png`).
- **One format, one look.** SVG only, pen style only. Kalam is embedded in the file; there is no
  fallback beyond the `font-family` list.

Three of the nine sheets were looked at for this document (flow-approval, usecase-permit,
activity-parallel). Nobody has opened the baseline files in PowerPoint, Word, Inkscape or
Illustrator.

## 5. What was kept, refactored, rewritten and removed

From `CONTINUE.MD` section B, checked against `git diff d30af12 HEAD`.

### Kept untouched

| What | Why |
|---|---|
| `src/core/pen.ts`, `src/core/pyrandom.ts` | the pen engine, still bit-compatible with the slides; its fixture tests pass |
| `src/core/lint.ts` | the notation rules and their wording, a port of the reviewer |
| `src/core/parse.ts` | the frozen v1 parser. No production code imports it now. It is the oracle `test/doc-parse.test.ts` uses to prove v1 compatibility (see decision 13 in `ARCHITECTURE_DECISIONS.md`) |
| `reference/`, `fixtures/diagrams/`, `fixtures/pen/` | the Python reference and its generated fixtures |
| `spec/`, `public/_headers`, `site/`, `src/play/tabs.ts`, `src/play/strokes.css`, `src/play/docs.html` | no differences between `d30af12` and the checkpoint. The specs and the syntax reference still describe v1 and are due an update |

### Refactored (same job, new inputs)

| What | Change |
|---|---|
| `src/embed/figure.ts`, `main.ts`, `download.ts`, `measure-dom.ts`, `embed.css` | moved to the new pipeline; stroke classes (`ks-*`) added beside the fill classes; Atkinson 700 loaded |
| `src/core/describe.ts` | takes the new model; describes class diagrams and partitions |
| `src/core/qa.ts` | reads the new scene; a label is now checked against its own line too |
| `src/core/measure.ts` | font family, shared sizes, `wrapText`, `PRECISION_SCALE` |
| `src/core/state.ts` | one new optional hash parameter, `look` |
| `vite.config.ts` | the preview server sends `public/_headers`, so browser tests run under the real policy |
| `test/render.test.ts`, `qa.test.ts`, `describe.test.ts`, `state.test.ts` | ported to the new API and extended |

### Rewritten

| What | Now |
|---|---|
| `src/play/main.ts` | the shell: one session, views loaded on demand, the document bar, draft and link persistence |
| `src/play/draw.ts` (678 lines, one function) | `src/play/draw/`: `canvas.ts`, `index.ts`, `inspector.ts`, `inline-edit.ts`, `dom.ts` |
| the write pane inside `main.ts` | `src/play/write.ts` and `src/play/editor/` (CodeMirror 6) |
| `src/play/play.css` | the views row with the document bar, the editor chrome, the draw and export sections. The shell, the syntax view and the phone rules are unchanged |
| `test/e2e/draw.spec.ts` | 16 pointer and keyboard scenarios (was 7) |
| `test/e2e/playground.spec.ts`, `embed.spec.ts`, `helpers.ts` | the editor replaced the textarea; the new download contract |

### Removed (the v1 render path)

`src/core/scene.ts`, `shapes.ts`, `svg.ts`, `layout-flow.ts`, `layout-usecase.ts`, `serialize.ts`,
`src/play/draw.ts`, `test/serialize.test.ts`. Copies are in the history at `d30af12`.
`src/core/model.ts` (the v1 model and the reviewer's contract types) is still in the tree: the
frozen parser and `lint.ts` read it.

### New

The document model and its tools (`src/core/doc/`), the shared geometry (`src/core/geom/`), the two
looks and the SVG writers (`src/core/render/`), the v2 rules (`src/core/diagnostics.ts`), the
exports (`src/export/`), eight v2 fixtures (`fixtures/v2/`), four unit test files, and the capture
scripts. `CONTINUE.MD` section B has the full table.

## 6. Compatibility that had to hold

These are contracts with pages that already embed a diagram. None of the three files that define
them changed (`git diff d30af12 HEAD -- spec public site` is empty).

### The `v=1` hash

`spec/embed-protocol.md` section 1. An embed URL is
`/embed/#v=1&d=<lz>&id=&step=&theme=&lint=&qa=&tools=`, read and written only through
`URLSearchParams` (`src/core/state.ts`: `parseHash()`, `buildHash()`).

- `d` is still `LZString.compressToEncodedURIComponent(ksdText)`, and every v1 `.ksd` text still
  parses to the same diagram. That second half is the real requirement, and it is what the
  differential test against the frozen v1 parser proves.
- An unknown version still gets the error card.
- One addition: an optional `look=sketch|precision`. A link without it behaves as before.
- The playground link is the same format. A new limit applies only to the playground: above 8,000
  characters of compressed text the link stops carrying the diagram (`LINK_LIMIT` in
  `src/play/main.ts`) and the local draft holds it instead.

### The message protocol

`spec/embed-protocol.md` section 2.

- Embed to host: `{ source: "ksyt-draw", v: 1, id, type }` with `ready`, `resize`, `step`, `lint`,
  `error`, posted with `window.parent.postMessage(msg, "*")` (`src/embed/main.ts`).
- Host to embed: `{ source: "ksyt-draw-host", v: 1, type }` with `theme`, `step`, `load`. The embed
  still ignores a message whose `source` or `v` does not match.
- The names keep `ksyt-draw` although the page now says Chalk.
- `test/e2e/host.spec.ts` (unchanged) and `test/e2e/embed.spec.ts` drive this from a second origin
  and pass at the checkpoint, per `CONTINUE.MD`.

### The content security policy

`public/_headers`.

- Playground: `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:;
  img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none';
  frame-ancestors 'none'`.
- Embed: the same, with `connect-src 'none'` and `frame-ancestors *`.
- No `unsafe-inline`, no `unsafe-eval`, no third-party origin. Three choices in v2 exist to keep it
  that way: CodeMirror runs inside a shadow root, where its run-time styles are constructed
  stylesheets and not `<style>` elements; the PNG export draws from a `data:` URL, which `img-src`
  already allows; export fonts arrive as inlined `data:` chunks, not by `fetch`.
- The browser tests now run under this policy (`vite.config.ts` serves `_headers` in preview). At
  the baseline they did not.

### Also held

- The iframe snippet from "copy embed code" is unchanged (`embedSnippet()` moved from `main.ts` to
  `src/play/write.ts`, same output).
- The embed loads no editor code: nothing under `src/embed/` imports CodeMirror, pdf-lib or
  `src/play/`. It did get heavier, about 71 KB of script gzipped against about 46 KB, per
  `CONTINUE.MD`; that figure was not measured again here.
- Everything from diagram text is still escaped before it reaches SVG or HTML (`esc()` in
  `src/core/render/svg.ts`; the draw canvas parses its markup as an SVG document, never as HTML, in
  `src/play/draw/dom.ts`).

## 7. One behavior that changed on purpose

"download SVG" used to write the file described in section 4: fills through CSS variables, a dark
media query, no background. It now writes a self-contained file in the theme that is on screen, with
a solid page background (`src/embed/download.ts`). `test/e2e/embed.spec.ts` was changed to assert
the new contract. This is the fix for an audited defect and is recorded as decision 14 in
`ARCHITECTURE_DECISIONS.md`.

## 8. Not verified here

- The v1 app was not run again; findings 3 and the font-timing note rest on the code.
- Which two browser tests failed at the baseline is inferred, not recorded.
- Six of the nine export sheets were not looked at for this document.
- The baseline screenshots are Chromium only. Firefox and Safari were never captured.
