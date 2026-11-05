# CONTINUE: Chalk (ksyt-draw) v2 revival, handoff at the checkpoint

Written 2026-11-04 at a controlled halt. The app runs, both views work, all tests pass. The work
stopped on request so the owner can inspect it; nothing here is abandoned. Read this file, then
`prompts/KSYT_DRAW_FABLE_COMPLETE_REVIVAL_BRIEF.md` (the full assignment; the folder is git-ignored
on purpose), then continue from section E.

## Checkpoint at a glance

| | |
|---|---|
| Branch | `feat/ksyt-draw-v2-revival` |
| Code checkpoint commit | `1a1e46f` (this file is committed right after it) |
| `npm run dev` | starts, http://localhost:5173/ |
| `npm run build` | passes (typecheck + build) |
| `npm test` | 411 passed, 0 failed (13 files) |
| `npm run test:e2e` | 78 passed, 0 failed (Chromium, served with the production CSP) |
| Browser errors on load | none (write, draw, syntax, embed, export dialog) |
| Write | usable |
| Draw | usable |
| Exports | SVG, PNG and PDF all produce real files |

The baseline before any change was: 191 unit tests passing, 67 browser tests passing and 2 failing.
Those 2 failures were not app bugs: the Windows checkout had CRLF line endings in the fixtures, and a
textarea normalizes to LF. Fixed by `.gitattributes` (`* text=auto eol=lf`) and by normalizing in the
test helper.

---

## A. Current state

### Architecture (what now exists)

One pipeline feeds everything: the write preview, the draw canvas, the embed and every export.

```
.ksd text
  └─ src/core/doc/parse.ts      parseSource(): text -> ChalkDoc + statement map + diagnostics
       └─ src/core/geom/resolve.ts   resolve(): ChalkDoc -> Geometry (boxes, routes, label places), inches
            └─ src/core/render/scene.ts   buildScene(): Geometry -> Scene, in the sketch or precision look
                 ├─ render/svg.ts  sceneToSvg()   for the page (role classes, follows the site's theme)
                 └─ render/svg.ts  portableSvg()  for export (self-contained, explicit colors and background)
```

- **Canonical document model** (`src/core/doc/types.ts`, schema version 2). Layers are kept apart:
  semantics (kind, label, from/to, members, containment), geometry (only what the author fixed by
  hand: `place`, `size`, `route`, `labelPos`, `thickness`, `pool`), presentation (`style`, theme roles
  only, never hex), authoring (`uid` stable identity, `id` the human name, `step`, `describe`).
- **The .ksd text is complete.** Everything Write and Draw can express is in the text, including
  hand-set positions, sizes, routes, label positions and styles, which live in a managed
  `layout { }` block at the end of the file. So the link, the embed and the local draft all carry
  the whole diagram. The project file (`.chalk.json`) adds the model as JSON and the workspace
  (viewport, export settings).
- **Write/Draw synchronization: targeted source edits.** A Draw edit changes the model, then
  `src/core/doc/sync.ts` writes that change into the text by touching only the lines the edit
  affects. Rule: print each statement for the old and the new document; if the prints are equal the
  source line is left exactly as the author wrote it. Comments, blank lines, spacing and order
  survive. Tested in `test/doc-sync.test.ts`.
- **One session, one history** (`src/core/doc/session.ts`). Both views edit through it. Write calls
  `setText()`, Draw calls `edit()` (a transaction: clone, apply commands, hold the picture still,
  write the text, one undo step). Undo and redo are the session's, not CodeMirror's, so Ctrl+Z in
  either view can undo an edit made in the other.
- **Text with a mistake never blanks the figure.** The last valid document stays on screen marked
  out of date, every bad line is underlined, and Draw is read-only until the text is fixed, so Draw
  can never overwrite a newer draft.
- **Layout ownership.** A shape is either automatic or placed. All shapes take part in the automatic
  layout, including placed ones (a placed shape keeps its slot, then is moved to where the author put
  it), so the result is a pure function of the document. In Draw, nothing moves unless the author
  moves it: if an edit would shift automatic shapes, exactly those shapes are placed where they
  already are, in the same undo step, and the status line says how many. "tidy up" hands shapes back
  to the layout engine, with a preview before it is kept.
- **Draw canvas: a purpose-built interaction layer, no graph library.** See "decision to confirm"
  below. `src/play/draw/canvas.ts` owns no geometry; every frame, including each frame of a drag, it
  asks the core to resolve a draft and shows the result.
- **Two looks over one geometry.** Sketch is the pen style (`pen.ts`, untouched, still bit-compatible
  with the slides). Precision is crisp strokes and the prose font. Positions, sizes, routes and label
  centers are identical in both; tested.
- **Export is its own rendering target** (`src/export/`). The scene is built for the file, not copied
  from the screen. SVG is self-contained; PNG rasterizes that same SVG; PDF is drawn straight from
  the scene with pdf-lib (real text, embedded fonts).

### Decision to confirm with the owner: no canvas library

The brief asked for an evaluation of maxGraph, React Flow, JointJS and tldraw, and said to prefer not
re-implementing an editor's fundamentals. Facts checked on 2026-11-04 (`npm view`):

| Library | Version | License | Why it was not adopted |
|---|---|---|---|
| tldraw | 5.6.0 | its own license (`SEE LICENSE IN LICENSE.md`), not open source | fails "no mandatory commercial license" |
| maxGraph | 0.25.1 | Apache-2.0 | owns geometry: its own perimeters, edge styles and labels. Chalk needs one geometry for the embed and exports, which cannot load an editor. Using it means two routers that disagree, or bending most of the library |
| JointJS core | 4.3.4 | MPL-2.0 | selection, resize handles, viewport scroller, snaplines, in-place text, undo and clipboard are all in the paid JointJS+ only |
| React Flow | 12.12.1 | MIT | the only one that fits as a pure interaction shell. It would add React plus about 100 KB gzipped and a second state system to keep in step with the session, and everything specific to Chalk (routing, waypoints, labels, lanes, in-place text, snapping) is custom either way |

The deciding fact: Chalk is text-first, and the embed must stay lean, so layout, routing, attachment
and label placement have to live in the DOM-free core. What a library would then add is viewport,
selection, drag, resize and connect, which is `src/play/draw/canvas.ts` (about 850 lines) and is
covered by 16 pointer-driven browser tests. The canvas only consumes resolved geometry and emits
commands, so React Flow could still replace it later without touching the core. **This is a
substantial architectural choice and the owner has not yet signed off on it.** It should be written
up in `docs/revamp/ARCHITECTURE_DECISIONS.md` (not written yet).

Libraries that were adopted: CodeMirror 6 (MIT) for Write, pdf-lib and @pdf-lib/fontkit (MIT) for PDF.
dagre stays for ranking.

### Implemented and integrated (working end to end)

- v2 parser: reads every v1 file exactly as the reference parser does (differential test against the
  frozen port), reports every bad line with a column range, and adds partitions, classes with
  members, class relationships with multiplicities and roles, use-case descriptions, the layout
  block, and `lanes` / `look` header lines.
- Printer, targeted source sync, format-in-place ("tidy" in Write).
- Commands: add, remove, move, resize, release, label, rename, change kind, set parent, connect,
  change relationship, reconnect, swap ends, patch route / label position / style / ends, reorder
  partitions, copy and paste fragments.
- Geometry: node sizing with word wrap inside sized shapes, outline attachment, an orthogonal router
  (pattern candidates scored by length, bends and collisions, with an A* fallback around obstacles),
  flow / lane / use-case / class layout, cost-based label placement, snapping, align, distribute,
  match size.
- Write view: CodeMirror 6 in a shadow root (so the strict CSP holds), highlighting, line numbers,
  bracket matching, auto-indent, `#` comments, type-aware completions, diagnostics with ranges, find
  and replace, tidy, cursor line highlights its element in the figure, clicking the figure goes to
  its line.
- Draw view: pannable and zoomable canvas with a dot grid, palette drag or click-to-place with an
  exact ghost, select, shift-select, marquee, drag with live re-routing and snap guides, resize
  handles, in-place text editing, ports with a live routed preview, endpoint reconnect, elbow segment
  and straight waypoint editing, label dragging, lane dividers, lane membership by drop, floating
  properties panel, undo and redo, copy / cut / paste / duplicate, keyboard nudging and Tab walking,
  tidy up with preview.
- Classes: compartments, structured members, stereotype, abstract, in-place member editing.
- Use-case descriptions: structured fields in the panel, written as `describe id { }` blocks.
- Exports: dialog with live preview of the actual file, SVG / PNG / PDF, sketch or precision, four
  backgrounds, padding, PNG scale, PDF page presets.
- Persistence: local draft in `localStorage`, the link still carries short diagrams, new / open /
  save (project `.chalk.json` or `.ksd`), drag a file onto the page, "the diagram you had before".
- Embed: moved to the new pipeline; the v1 protocol, hash format, host messages and theme sync are
  unchanged and their browser tests pass. New optional hash parameter `look=sketch|precision`.

### Exists but not fully integrated or verified

- **v2 notation rules** (`src/core/diagnostics.ts`, `rulesV2`) are live in the lint panel but are not
  in the syntax reference and have not been reviewed against OMG UML 2.5.1 text.
- **Issue focus**: findings know their elements and lines (`allIssues`, `locate`), and Write
  underlines them, but Draw does not yet select a shape when a finding is clicked.
- **Horizontal lanes** work in layout and rendering (unit tested) but have had no pointer testing.
- **Touch**: pinch zoom and one-finger pan are coded in the canvas and have never been run on a
  touch device.

### Partially implemented

- **Export quality review.** The pipeline is rebuilt and the known root causes are fixed (see D and
  "audit findings" below), and all 17 fixtures pass the layout check in both looks. The systematic
  before/after gallery at slide, document and embed sizes has not been assembled, and no one has
  opened the files in Office, Inkscape or Illustrator.
- **Browser scenarios M to X** from the brief's test table are not written as tests. See D.

### Untouched

- All of `docs/revamp/*.md` (only `docs/revamp/baseline/` evidence exists).
- `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `BUILD_BRIEF.md`, `spec/*.md`: still describe v1.
- `src/play/docs.html` (the in-app syntax reference): still v1 syntax only.
- Sequence, state, package, component, deployment diagrams (the brief says later).
- Accessibility audit, performance measurement, Firefox and Safari.

---

## B. Files changed

### New

| Path | Purpose |
|---|---|
| `src/core/doc/types.ts` | the canonical model, kinds, defaults, `newUid` |
| `src/core/doc/parse.ts` | v2 parser, diagnostics, statement map, `adoptUids`, `parseMember`, `opSpec` |
| `src/core/doc/print.ts` | one printer per statement; `printDoc` |
| `src/core/doc/sync.ts` | `syncSource` (targeted edits), `formatSource` |
| `src/core/doc/commands.ts` | edit operations, `RELATIONS`, `canConnect`, copy and paste |
| `src/core/doc/session.ts` | the open document, hold-still, unified undo and redo |
| `src/core/doc/contract.ts` | model -> the reviewer's contract 1.0, which `lint.ts` reads |
| `src/core/doc/project.ts` | `.chalk.json`: `toProject`, `openFile`, `sanitizeDoc` (untrusted input) |
| `src/core/geom/shape.ts` | node sizes, outlines, side anchors, class row layout |
| `src/core/geom/route.ts` | the router and path helpers |
| `src/core/geom/layout.ts` | dagre ranking (cached), lanes, use-case columns |
| `src/core/geom/resolve.ts` | `resolve`, `routeAll`, label placement, `nodeTexts` |
| `src/core/geom/arrange.ts` | snap, align, distribute, match size |
| `src/core/render/scene.ts` | display list, `buildScene`, `paintPolys` for QA |
| `src/core/render/sketch.ts` | the pen look (v1 recipes ported, plus class, lane, UML line ends) |
| `src/core/render/precision.ts` | the crisp look |
| `src/core/render/svg.ts` | `sceneToSvg` (page), `portableSvg` (export), `elementMarkup` |
| `src/core/diagnostics.ts` | `review`, `rulesV2`, `locate`, `allIssues` |
| `src/export/` | `svg.ts`, `png.ts`, `pdf.ts`, `fonts.ts`, `options.ts`, `save.ts` |
| `src/play/app.ts`, `write.ts`, `files.ts`, `templates.ts`, `storage.ts`, `export-dialog.ts` | the page's parts |
| `src/play/editor/editor.ts`, `language.ts` | CodeMirror setup, .ksd language, completions |
| `src/play/draw/canvas.ts`, `index.ts`, `inspector.ts`, `inline-edit.ts`, `dom.ts` | the draw view |
| `fixtures/v2/*.ksd` | 8 hand-written v2 fixtures (lanes, classes, described use case, manual layout, dense) |
| `test/doc-parse.test.ts`, `doc-sync.test.ts`, `session.test.ts`, `model.test.ts` | new unit tests |
| `scripts/smoke.mjs`, `shots.mjs`, `look.mjs`, `capture-baseline.mjs`, `capture-exports.mjs` | visual checks (see F) |
| `docs/revamp/baseline/` | before-screenshots of the UI and the v1 SVG exports at insertion sizes |
| `.gitattributes` | LF line endings |

### Modified

| Path | What changed |
|---|---|
| `src/play/main.ts` | rewritten as the shell: session, lazy views, document bar, draft and link persistence |
| `src/play/play.css` | views row with the document bar; write editor chrome; the whole draw and export sections |
| `src/embed/figure.ts`, `main.ts`, `download.ts`, `measure-dom.ts`, `embed.css` | new pipeline; `ks-*` stroke classes; Atkinson 700 |
| `src/core/describe.ts` | takes the new model; class diagrams and partitions |
| `src/core/qa.ts` | reads the new scene; a label is now checked against its own line too |
| `src/core/measure.ts` | font family, shared sizes, `wrapText`, `PRECISION_SCALE` |
| `src/core/state.ts` | `look` hash parameter |
| `vite.config.ts` | preview serves `public/_headers`, so browser tests run under the real CSP |
| `test/render.test.ts`, `qa.test.ts`, `describe.test.ts`, `state.test.ts` | ported to the new API, extended |
| `test/e2e/draw.spec.ts` | rewritten: 16 pointer and keyboard scenarios |
| `test/e2e/playground.spec.ts`, `embed.spec.ts`, `helpers.ts` | the editor replaced the textarea; new export contract |
| `package.json` | added CodeMirror packages, `@lezer/highlight`, `pdf-lib`, `@pdf-lib/fontkit` |

### Removed (v1 render path; copies are in the git history at `d30af12`)

`src/core/scene.ts`, `shapes.ts`, `svg.ts`, `layout-flow.ts`, `layout-usecase.ts`, `serialize.ts`,
`src/play/draw.ts`, `test/serialize.test.ts`.

### Kept on purpose

- `src/core/parse.ts`: the frozen v1 port. No production code imports it; `test/doc-parse.test.ts`
  uses it as the oracle that proves v1 compatibility. `test/docs.test.ts` still reads it (see D).
- `src/core/pen.ts`, `pyrandom.ts`, `lint.ts`: untouched ports. All their fixture tests pass.
- `reference/`, `fixtures/diagrams/`, `fixtures/pen/`: untouched.

### A deliberate behavior change to know about

"download SVG" (embed and write) used to write a file with `var(--ink, ...)` fills and a
`prefers-color-scheme: dark` media query. That file changes color with the viewer's OS theme and
needs CSS-variable support, which Office and Inkscape lack. It now writes a self-contained file in
the theme on screen, with a solid background. `test/e2e/embed.spec.ts` was updated to assert the new
contract; this is the fix for an audited defect, not a weakened test.

---

## C. Progress by subsystem

"Written" is code that exists. "Working" is verified end to end by tests or by driving the app.

| Subsystem | Written | Working | Notes |
|---|---|---|---|
| Architecture and document model | 90% | 85% | model, session, project format done; not documented |
| Parser and source synchronization | 90% | 85% | 102 tests; step editing from Draw not supported; reorder only for containers |
| Shared geometry engine | 80% | 75% | all fixtures clean; self-loops not drawn; no crossing minimization beyond dagre |
| Draw canvas | 80% | 70% | 16 browser tests; no touch testing; no minimap; no generic grouping; no z-order |
| Connectors and routing | 80% | 70% | port connect, reconnect, bends, labels work; parallel elbow lines can share a channel |
| Swimlanes | 80% | 70% | vertical lanes fully exercised; horizontal lanes only unit tested |
| Write editor | 85% | 75% | no browser test yet for completions, find, or cursor-to-figure linking |
| UML functionality | 70% | 60% | activity, use case, class; v2 rules not reviewed against the UML text; no object nodes |
| Export rendering and quality | 75% | 55% | pipeline rebuilt and working; gallery, third-party viewers and size review not done |
| Persistence and compatibility | 80% | 70% | draft, link, project, v1 embeds verified; reload and back button have one test (scenario G) |
| Automated testing and QA | 65% | 60% | 411 unit, 78 browser; scenarios M to X, visual regression, a11y and perf missing |
| Documentation | 5% | 5% | only this file and code comments |

---

## D. Known problems

### Build, tests, runtime

- No build failures, no failing tests, no known runtime errors.
- `npm run fixtures` needs `python3`, which is not installed on this machine, so the Python-generated
  fixtures could not be regenerated. They were not edited.
- The PDF chunk is 1.1 MB (507 KB gzipped). It loads only when a PDF is exported.
- The embed got heavier: about 71 KB gzipped of script now against about 46 KB before (router,
  classes, lanes, precision look). No editor code is in it. Not yet measured precisely or trimmed.

### Not done, and not hidden

1. **Syntax reference is stale.** `src/play/docs.html` documents only v1. `test/docs.test.ts` passes
   because it still checks the frozen `src/core/parse.ts`. It must be pointed at
   `src/core/doc/parse.ts` and `diagnostics.ts` when the reference is updated, and it will then fail
   until the docs cover classes, partitions, describe, layout, `lanes`, `look` and the v2 rule ids.
2. **Project docs are stale.** `CLAUDE.md` still says "ports stay ports" for `parse.ts` and names
   files that are gone; `ARCHITECTURE.md`, `README.md` and `spec/` describe v1.
3. **Brief scenarios without a browser test:** M (type then switch to Draw), N (Draw geometry seen in
   Write), P (include / extend by pointer), Q and R (class members and multiplicities by pointer),
   S (save and reopen through the file dialogs), T (exports asserted, not just smoke-tested),
   V (100 nodes / 150 edges, measured), W (refresh and back), X (line styling at export size).
   O is covered in `playground.spec.ts`; U by `embed.spec.ts` and `host.spec.ts`. P, Q, R and S have
   unit coverage in `model.test.ts`, `doc-sync.test.ts` and `session.test.ts`.
4. **Hold-still can pin many shapes.** Adding or connecting a shape in an all-automatic diagram
   changes dagre's answer for others, so they get placed (the status line says how many, undo is one
   step, tidy up reverses it). After a few Draw edits most of a diagram is hand-placed. This is the
   documented contract, but the owner may find it too eager; see the open question in E.
5. **Self-loops are not drawn.** A line from a shape to itself parses and is reported by rule
   `STRUCT-SELF-LINE`, and `canConnect` refuses to create one in Draw.
6. **Build-up steps cannot be edited in Draw.** A new shape joins whatever `step` is in force where
   its line is inserted. Steps are Write-only.
7. **No generic grouping, no bring-forward / send-back.** Deliberately skipped: containment
   (boundary, partition) is the grouping these diagram types have, and shapes never legitimately
   overlap.
8. **Text as outlines** in SVG is not offered. The fallback is a font stack plus `textLength`.
9. **Undo shortcuts in Draw work when the canvas has focus.** After clicking a button in the
   properties panel, Ctrl+Z does nothing until the canvas is clicked or focused.
10. **Use-case automatic layout is sparse**: actors sit far out and the boundary can have empty
    corners. Flagged in the export audit; not improved beyond moving actors 0.2 in closer.
11. **Dark mode and phone widths of the Draw view have not been looked at.** The CSS is written; no
    screenshot review was done. Light desktop was reviewed.
12. **Accessibility** has not been audited (the canvas has a role, a label, keyboard paths and a
    live status line; the SVG inside is `aria-hidden`).

### Temporary or unusual code

- `window.chalk` (`src/play/main.ts`): `getText`, `setText`, `undo`, `redo`, `inspect`. A small
  scripting surface the browser tests use to read resolved geometry. Decide whether to keep it public.
- `src/core/geom/layout.ts` keeps the last dagre result in a module variable (a one-entry cache) so
  a drag does not re-rank every frame.
- `Canvas.clip` is a static in-memory clipboard; it does not use the system clipboard.

### Risks

- The purpose-built canvas is the largest unreviewed decision (see A).
- Hold-still semantics (item 4) is the most likely thing the owner will want changed.
- `syncSource` is the piece where a bug would corrupt text. It is guarded: after every Draw edit the
  new text is re-parsed, and if it does not parse the edit is refused and nothing changes. The unit
  tests compare the re-parsed document with the intended one for every edit they make.
- Sketch-look label clearance is tuned on 17 fixtures. Unusual diagrams can still produce a
  `LINE_THROUGH_TEXT` finding; the label can then be dragged by hand.

### Audit findings that exist only here (write them into `docs/revamp/` first)

Baseline UI evidence: `docs/revamp/baseline/*.png` (write, draw, syntax; light and dark; 1440, 820,
390 px; selected node and edge). Baseline exports: `docs/revamp/baseline/exports/*.svg` and
`*.sizes.png` (each at 600, 420 and 240 px on a white page).

Root causes found in the v1 export, and what v2 does about each:

| Defect | Root cause | v2 |
|---|---|---|
| Colors flip or break outside a browser | fills were `var(--role, hex)` inside a `<style>`, plus `@media (prefers-color-scheme: dark)` | plain `fill` and `stroke` attributes for a chosen theme; no CSS variables, classes or media queries |
| Off-white patches on a white page | no background; shape knockouts hard-coded to the page color | explicit background rect; knockouts take the background's color; transparent export has no knockouts at all |
| Swooping arrows with tilted heads | dagre's edge points fed to a spline | orthogonal router; ends attach square to the outline |
| Guards floating away from their lines | label tried two sides of one segment | candidates along the whole line, scored against shapes, lines, text and arrowheads |
| Arrows into a shared node at odd angles | no notion of sides | side preferences by flow direction; arriving and leaving lines avoid sharing a side |
| Only SVG, only sketch | one writer | SVG, PNG, vector PDF; sketch and precision |
| Fonts lost in tools that ignore embedded fonts | embedded font only | embedded font, fallback stack, and `textLength` so text keeps its measured width |

Not yet verified: opening exports in PowerPoint, Word, Inkscape, Illustrator.

---

## E. Continuation, in order

**First: ask the owner two questions** (do not start work that depends on them before the answers).

1. Is the purpose-built canvas acceptable, or should React Flow be the interaction shell?
2. Is hold-still right as it is, or should a Draw edit let automatic shapes re-flow (with an
   animation) instead of pinning them?

Then, assuming both stay:

1. **Write the `docs/revamp/` set** while the evidence is fresh: `BASELINE_AUDIT.md`,
   `UI_PRESERVATION_CONTRACT.md`, `ARCHITECTURE_DECISIONS.md`, `EXPORT_QUALITY_AUDIT.md`,
   `UX_DESIGN_SYSTEM.md`, `TEST_MATRIX.md`, `IMPLEMENTATION_REPORT.md`. Sources: sections A and D of
   this file, `docs/revamp/baseline/`. The house rules in CLAUDE.md apply to these too.
2. **Export gallery and review** (release-blocking in the brief). Add a script that exports every
   fixture as SVG, PNG and PDF in both looks into `docs/revamp/gallery/`, and a sheet at slide (600),
   report (420) and embed (240) widths beside the baseline. Start from `scripts/capture-exports.mjs`
   and `scripts/smoke.mjs`. Look at every picture. Fix what reads badly; known candidates: sparse
   use-case layout (`src/core/geom/layout.ts`, `ACTOR_X`, `fitBoundary`), multiplicity crowding
   beside diamonds (`placeEdgeTexts` in `src/core/geom/resolve.ts`), parallel elbow lines sharing a
   channel (`routeAll`). Acceptance: every fixture passes `checkScene` in both looks and reads cleanly
   at 420 px wide.
3. **Browser tests for scenarios M, N, P, Q, R, S, T, V, W, X.** New file `test/e2e/flows.spec.ts`,
   using `test/e2e/helpers.ts` (`openTool`, `inspect`, `drag`, `box`, `field`). For T, save the
   downloads under `test-results/exports/`, assert the PNG's pixel size equals natural size times the
   scale, the SVG has no `var(` or `class=`, the PDF starts with `%PDF` and contains a font. For V,
   generate 100 nodes and 150 edges, drag one, and record the time per frame; the canvas switches to
   partial re-routing above 60 nodes (`Canvas.preview`), so measure both sides of that line.
4. **Syntax reference and its test.** Update `src/play/docs.html` for v2 syntax, the layout block,
   the v2 rule ids and errors. Point `test/docs.test.ts` at `src/core/doc/parse.ts` and
   `src/core/diagnostics.ts`. Add class and lanes examples to `src/play/examples.ts`.
5. **Project docs.** Rewrite `ARCHITECTURE.md`, `README.md`, `CLAUDE.md` (the "ports stay ports" rule
   now covers `pen.ts`, `pyrandom.ts`, `lint.ts` and the frozen `parse.ts` only), and `spec/` for v2.
   Add user-facing instructions for Write, Draw, lanes, classes, save and load, export, shortcuts.
6. **Draw polish from review**: click a finding to select its shape; undo shortcuts from the panel;
   dark and phone review of the Draw view; touch testing; a "status" line for placed shapes that is
   less wordy.
7. **Remaining features, smaller**: self-loops; step editing in Draw; horizontal lane pointer tests;
   text-as-outlines option for SVG; precise embed bundle measurement and trimming.
8. **Accessibility and performance pass**, then the final scorecard in `IMPLEMENTATION_REPORT.md`.

Dependencies: 1 has none. 2 before the final report. 3 can run alongside 2. 4 before 5. 6 and 7
after the owner's answers.

---

## F. Commands

```
npm install                     install dependencies
npx playwright install chromium once, for the browser tests
npm run dev                     start the app: http://localhost:5173/  (embed at /embed/)
npm test                        unit tests (vitest)
npm run test:e2e                browser tests; builds, then serves dist/ with the production headers
npm run build                   typecheck + build to dist/
```

Visual checks (start `npm run dev` first):

```
node scripts/smoke.mjs                      every view loads; PNG, SVG and PDF are real files; saved in .scratch/smoke/
node scripts/shots.mjs .scratch/shots       every fixture, both looks, with its layout check result
node scripts/look.mjs .scratch/look         screenshots of write and draw
```

On this Windows machine: avoid shell heredocs that contain backslash escapes or apostrophes when
patching files; they get mangled. Write a small `.cjs` file and run it, or use the editor tools.

To resume: check out `feat/ksyt-draw-v2-revival`, run `npm install`, `npm test`, `npm run test:e2e`
to confirm the checkpoint, read section E, and ask the owner the two questions first.

---

## Estimates

**Overall completeness of the full revival: about 62%.** Weighted by what the brief treats as
important, not by lines or test counts: the foundation that everything depends on (model, sync,
shared geometry, session) is nearly done and is the hardest part to get right; Draw, connectors and
lanes work and are tested by pointer but lack touch, polish and the owner's review; Write works but
its newer features lack browser tests; exports work in three formats but the release-blocking
quality review and gallery are not done; documentation is essentially absent; accessibility and
performance are unmeasured.

**Minimum usable checkpoint: 100% of the eight requirements are met.**

Remaining active development time (ranges, not calendar time):

| Target | Active hours |
|---|---|
| Minimum usable checkpoint | 0 (reached) |
| Substantially functional v2: docs set, export gallery reviewed, scenarios M to X tested, syntax reference current | 8 to 14 |
| Complete and polished: the above plus Draw polish, remaining features, accessibility, performance, third-party viewer checks, final scorecard | 20 to 35 in total |

Largest uncertainties: the owner's answers to the two questions in E (a switch to React Flow would
add roughly 10 to 20 hours); what the export review turns up once every picture is looked at; how
exports behave in Office and Inkscape, which could not be tested here; touch behavior.
