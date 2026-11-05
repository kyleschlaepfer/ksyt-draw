# Chalk: architecture (v2)

Chalk is the diagram tool for kyleschlaepfer.com. The repo, the deploy and the message protocol keep the name `ksyt-draw`. This file is the working map: what the pieces are, where they live, and how a diagram gets from text to ink. The reasons behind each choice are in [`docs/revamp/ARCHITECTURE_DECISIONS.md`](docs/revamp/ARCHITECTURE_DECISIONS.md) and are linked here by number, not repeated.

## 1. What it is

One diagram, two ways to edit it, one way to draw it.

- **Write.** A few lines of `.ksd` text become a use-case, activity, class or flow diagram.
- **Draw.** The same diagram on a canvas: place, connect, move, resize, restyle. Every change is written back into the text.
- **Embed.** A read-only figure in an iframe on any page, built from text carried in the link.
- **Export.** PNG, SVG and PDF files made for slides and reports.

```
diagram use-case
title Residents apply and track; paying the fee is always part of applying
actor resident "Resident"
boundary portal "Permit portal" {
  use-case apply "apply for permit"
  use-case pay "pay fee"
}
resident -- apply
apply -include-> pay
```

Still true from v1: shapes are predefined and nobody draws freehand; everything runs in the reader's browser; there is no backend and no account.

## 2. System shape

```
kyleschlaepfer.com  (site repo, Astro)                    chalk.kyleschlaepfer.com  (this repo)
┌──────────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ lessons/permits.mdx                          │          │ /embed/   embed/index.html, src/embed     │
│   <DiagramEmbed ksd={...} caption="..."/>    │  iframe  │   reads #v=1&d=<compressed .ksd>          │
│ ┌──────────────────────────────────────────┐ │ ───────▶ │   parse, resolve, paint, check            │
│ │ <iframe src=".../embed/#v=1&d=...&id=..."> │ │          │                                          │
│ └──────────────────────────────────────────┘ │ ◀─────── │   postMessage: ready, resize, step, lint  │
│ figcaption                                   │ ───────▶ │   postMessage: theme, step, load          │
│ small host script: resize + theme sync       │          │ /         index.html, src/play            │
└──────────────────────────────────────────────┘          │   draw, write (+ the syntax), export      │
                                                          │ /assets/  JS, CSS, fonts                  │
                                                          └──────────────────────────────────────────┘
                                                            Cloudflare Workers, static assets only
```

The diagram text travels in the URL hash, which browsers never send to a server. The tool page also keeps the open diagram as a local draft in the browser (decision 15).

## 3. The pipeline

Every surface (the write preview, the draw canvas, the embed, each export) runs the same stages. There is one answer to "where is everything" and one answer to "what does it look like" (decision 7).

```
.ksd text
  │  parseSource()            src/core/doc/parse.ts     text -> ChalkDoc + statement map + diagnostics
  ▼
ChalkDoc                      src/core/doc/types.ts     the canonical document, schema version 2
  │  resolve()                src/core/geom/resolve.ts  layout + router + label placement, in inches
  ▼
Geometry                                                every box, path and label position
  │  buildScene()             src/core/render/scene.ts  one of two looks: sketch or precision
  ▼
Scene                                                   a display list of paints and text
  ├─ sceneToSvg()             src/core/render/svg.ts    the page figure: theme role classes
  ├─ elementMarkup()          src/core/render/svg.ts    the draw canvas, element by element
  ├─ portableSvg()            src/core/render/svg.ts    the SVG export, and the source of the PNG
  └─ exportPdf()              src/export/pdf.ts         vector PDF

ChalkDoc ── review()          src/core/diagnostics.ts   the notation check (reviewer's rules + v2 rules)
Scene ──── checkScene()       src/core/qa.ts            the layout check (ink through text, overlaps, clipping)
ChalkDoc ── describeItems()   src/core/describe.ts      the text alternative
```

## 4. Module map

`src/core/` has no DOM access, so all of it runs in Node tests. DOM code lives in `src/embed/`, `src/play/` and the browser-only parts of `src/export/`.

| Folder | Files | What it holds |
|---|---|---|
| `src/core/doc/` | `types.ts` | `ChalkDoc`, node and edge kinds, style roles |
| | `parse.ts` | the v2 parser: a superset of v1, with error recovery, a statement map and `adoptUids()` |
| | `print.ts` | one printer per statement; `printDoc()` for a whole file |
| | `sync.ts` | `syncSource()` (targeted edits) and `formatSource()` (tidy) |
| | `commands.ts` | edit operations on a draft: add, move, resize, connect, rename, paste |
| | `session.ts` | `Session`: the text, the last good document, its geometry, one undo history |
| | `project.ts` | the `.chalk.json` project file; defensive reading of untrusted files |
| | `contract.ts` | `toContract()`: the document as the reviewer's contract 1.0 |
| `src/core/geom/` | `shape.ts` | each kind's size, outline, side anchors |
| | `layout.ts` | dagre ranking for flows and classes, lanes, the use-case columns |
| | `route.ts` | the router: straight lines, orthogonal elbows, an A* fallback |
| | `resolve.ts` | `resolve()`: layout, routing, label placement, bounds |
| | `arrange.ts` | snapping, align, distribute, match size |
| `src/core/render/` | `scene.ts` | `buildScene()`, paints, framing |
| | `sketch.ts` | the sketch look: pen strokes from `pen.ts` |
| | `precision.ts` | the precision look: real strokes, exact corners |
| | `svg.ts` | `sceneToSvg()` for the page, `portableSvg()` for files; all escaping |
| `src/core/` | `pen.ts`, `pyrandom.ts` | bit-compatible ports of the slide skill's pen and CPython's random |
| | `lint.ts` | the notation check: a port of the reviewer |
| | `diagnostics.ts` | `review()`, `rulesV2()`, `allIssues()`: one list of findings for the UI |
| | `qa.ts` | the layout check |
| | `describe.ts` | the text alternative |
| | `measure.ts` | the `Measurer` interface, the test stub, text sizes |
| | `state.ts` | the URL hash |
| | `parse.ts`, `model.ts` | the frozen v1 parser and the contract 1.0 types (see section 13) |
| `src/export/` | `options.ts`, `svg.ts`, `png.ts`, `pdf.ts` | the export pipeline and its three writers |
| | `outline.ts` | SVG text as shapes |
| | `fonts.ts`, `woff.ts` | font data, loaded lazily |
| | `save.ts` | hands a file to the browser's download |
| `src/embed/` | `main.ts`, `figure.ts`, `download.ts`, `measure-dom.ts`, `embed.css` | the embed page; `mountFigure()` is shared with the write preview |
| `src/play/` | `main.ts`, `app.ts`, `tabs.ts` | the tool page, its views row, `APP_NAME` |
| | `write.ts`, `editor/` | the write view and the CodeMirror 6 editor |
| | `draw/` | the draw view: `canvas.ts`, `inspector.ts`, `inline-edit.ts`, `index.ts`, `dom.ts` |
| | `export-dialog.ts`, `files.ts`, `storage.ts`, `templates.ts`, `examples.ts` | export, the document bar, the local draft |
| | `docs.html` | the in-app syntax reference |

Around the source:

| Path | What it is |
|---|---|
| `spec/` | the contract: text format, rendering, lint, embed protocol |
| `reference/` | read-only Python and CSS sources the ports follow |
| `fixtures/` | golden outputs from the Python reference; `fixtures/v2/` holds hand-written v2 examples |
| `site/` | `DiagramEmbed.astro` and `draw-host.ts`, to copy into the site repo |
| `scripts/` | scripts that drive a running app (section 15) |
| `docs/GUIDE.md` | the user guide |
| `docs/revamp/` | the revival's audits, decisions and galleries |
| `public/_headers` | CSP, framing and caching |

## 5. The document model

`ChalkDoc` (`format: "chalk-doc"`, `version: 2`) keeps five layers apart (decision 1).

| Layer | Fields | Rule |
|---|---|---|
| semantics | `kind`, `label`, `from`, `to`, `members`, `parent`, `ends` | what the diagram means |
| geometry | `place`, `size`, `thickness`, `route`, `labelPos`, `pool` | only what the author fixed by hand; absent means automatic |
| presentation | `style`, `meta.look` | theme roles, never hex |
| authoring | `uid`, `id`, `step`, `describe`, `inline` | `uid` is the stable identity; `id` is the name people type |
| persistence | `format`, `version`, `ext` | `ext` survives a save untouched |

Four diagram types: `flowchart`, `activity`, `use-case`, `class`. Edge ids (`e1`, `e2`, ...) are derived from file order because the reviewer's findings use them; identity is the `uid`.

## 6. Text and sync

The `.ksd` text is complete. Hand-set positions, sizes, routes, label positions and styles live in a managed `layout { }` block at the end of the file, so a link, an embed and a saved file all carry the arrangement (decision 2). The grammar is in [`spec/diagram-text.md`](spec/diagram-text.md).

- **Reading.** `parseSource()` returns the document, a statement map (which line declares which node or edge) and diagnostics with column ranges. It does not stop at the first mistake. A text with any error has `doc: null`.
- **Writing.** A draw edit goes back into the text through `syncSource()`: each statement is printed for the old document and the new one, and only the lines whose print changed are replaced, added or removed. Comments, blank lines, order and spacing stay as the author left them (decision 3).
- **Tidy.** `formatSource()` puts every line in its standard form and keeps comments and order.
- **Identity across a re-parse.** `adoptUids()` gives a fresh parse the uids of the document it replaces: nodes by id, lines by their ends and kind.

The native file is `.chalk.json` (`src/core/doc/project.ts`): the text, the model as inspectable JSON, and the workspace (viewport, export choices). Opening one re-parses the text with the same parser as anything typed; nothing from the file is trusted.

## 7. The session

`Session` (`src/core/doc/session.ts`) is the one open document. Both views read and change it; neither holds its own copy (decision 4).

| Call | Used by | Does |
|---|---|---|
| `setText(text, label)` | Write; also new, open and a link | parses; a valid text becomes the document; typing within 1.2 s is one undo step. Opening a file is one undo step too, so undo brings back what was there |
| `edit(label, fn)` | Draw | clones the document, applies commands, holds other shapes still, writes the text, records one undo step |
| `undo()`, `redo()` | both | one history of text snapshots, 300 deep, with the selection |
| `load(text)` | the constructor only | sets the first document with an empty history |

**Text with a mistake** (decision 5). The last valid document stays on screen and `inSync` is false. Write underlines every bad line. Draw goes read-only until the text is fixed, so it can never overwrite a newer draft.

## 8. Who owns the layout

Layout is automatic until the author says otherwise (decision 6, awaiting the owner's sign-off).

- A node without `place` is placed by the engine. A node with `place` keeps its slot in the automatic layout and is then moved to where the author put it, so the result is a pure function of the document.
- **Hold still.** After a draw edit, `holdStill()` resolves the draft again. Any automatic shape the edit would have shifted gets a `place` where it already was. Moving one shape moves one shape. Then `makeRoom()` checks that holding still did not break the picture: a shape the edit newly crowds (a class that grew into its neighbour, a new labelled line between two close shapes) is pushed over just far enough. Edits that place or size a shape are left exactly as made.
- One exception: when nothing is placed by hand and the whole diagram slides by the same amount, nothing is pinned. The canvas pans to cancel the slide.
- "tidy up" and "let it find its own place" delete `place`, `size`, `route` and `labelPos`, which hands those parts back. Tidy up shows the result before it is kept.

## 9. Geometry

`resolve()` is three steps. Details and constants are in [`spec/rendering.md`](spec/rendering.md).

1. **Layout** (`layout.ts`). dagre ranks flowcharts, activity diagrams and class diagrams. Partitions then pull each node into its lane. Use-case diagrams use their own columns: actors outside, use cases inside the boundary. `answerRoom()` re-ranks a flow with extra room so a decision's two answers stand past its corners. In a use-case diagram, a use case that only right-hand actors use stands in the far column, next to them.
2. **Routing** (`route.ts`). Use-case lines run straight. Everything else is an orthogonal elbow: the router scores short patterns for every pair of sides and falls back to an A* search when all of them are blocked. Lines are routed in file order, and a later line keeps out of the channels earlier lines use (`sharing()`); a plain crossing costs a little. In a flow, route length is measured center to center (`reach()`). A line from a shape to itself goes round a corner of the shape (`loopRoute()`).
3. **Labels** (`resolve.ts`). Each label tries spots beside its line and takes the clearest one.

While a shape is dragged, `resolve()` takes a `partial` option and routes only the lines that touch the moved shapes.

## 10. Two looks

`buildScene()` paints the same geometry in one of two looks (decision 8).

| Look | Ink | Text |
|---|---|---|
| `sketch` | filled polygons from `pen.ts`, seeded by `<diagram id>:<element id>` | Kalam |
| `precision` | real strokes with exact corners and standard UML line ends | Atkinson Hyperlegible Next at 0.86 of the size |

Geometry is always sized with the handwriting font, so positions, sizes and routes are identical in both looks. The look comes from the file's `look` line, and can be overridden by the embed's `look` parameter or the export dialog.

## 11. Export

Export is its own rendering target (decision 9). `exportScene()` builds a scene for the file from the document: no selection, grid or handle can be in it, because they were never there.

| Format | Writer | Notes |
|---|---|---|
| SVG | `portableSvg()` | every color a plain attribute, an explicit background, fonts embedded, `textLength` on every text |
| SVG, text as shapes | `src/export/outline.ts` | `ExportOptions.outlineText`: the letters as outlines, so the file looks the same in programs that ignore an embedded font |
| PNG | `src/export/png.ts` | the same SVG rasterized by the browser at 1x to 4x, capped at 16,000,000 pixels |
| PDF | `src/export/pdf.ts` | true vector with pdf-lib; text stays text, fonts subset and embedded (decision 11) |

The PDF writer and the outline writer are large and load only when asked for. The review of the exported files is in [`docs/revamp/EXPORT_QUALITY_AUDIT.md`](docs/revamp/EXPORT_QUALITY_AUDIT.md), with every fixture in [`docs/revamp/gallery/`](docs/revamp/gallery/README.md).

"download SVG" on the embed and in Write uses the same writer, in the look and theme on screen (decision 14).

## 12. The tool page and the embed

**The tool page** (`/`, `src/play/main.ts`) has two views in one row: draw (where it opens) and write. Write has a second, quieter row of its own: the editor and the syntax reference. The document bar beside the views holds new, open, save and export.

- Write is CodeMirror 6 in a shadow root (decision 10), loaded after first paint.
- Draw is a purpose-built SVG canvas with no graph library (decision 12, awaiting the owner's sign-off), loaded the first time the view is opened.
- The open diagram is saved to `localStorage` 300 ms after each change, and rides in the link while its compressed text is under 8,000 characters (decision 15).
- `window.chalk` is a small scripting surface for the console and for tests: `getText`, `setText`, `valid`, `undo`, `redo`, `inspect`.

**The embed** (`/embed/`, `src/embed/main.ts`) is unchanged in protocol: hash version `v=1`, the same messages, the same host rules. v2 adds one optional hash parameter, `look`. See [`spec/embed-protocol.md`](spec/embed-protocol.md).

How the new surfaces look and behave is in [`docs/revamp/UX_DESIGN_SYSTEM.md`](docs/revamp/UX_DESIGN_SYSTEM.md). What had to stay the same is in [`docs/revamp/UI_PRESERVATION_CONTRACT.md`](docs/revamp/UI_PRESERVATION_CONTRACT.md).

## 13. Ports and the reference

| Port | Follows | Checked by |
|---|---|---|
| `src/core/pyrandom.ts` | CPython `random.Random`, `pen.seed_for` | `fixtures/prng.json`, `fixtures/seeds.json` |
| `src/core/pen.ts` | `reference/pen.py` | `fixtures/pen/*.json` |
| `src/core/lint.ts` | `reference/review_diagrams.py` | `fixtures/diagrams/*.lint.json` |
| `src/core/parse.ts` | `reference/ksd_parse.py` | `fixtures/diagrams/*.json`, `fixtures/parse-errors.json` |

Change behavior in the Python reference first, regenerate with `npm run fixtures`, then match it here. Never hand-edit fixture JSON.

The parser is the one deliberate exception (decision 13). `src/core/parse.ts` stays a frozen port and is kept as the reference check. The parser the app runs is `src/core/doc/parse.ts`, which reads every v1 file to the same diagram with the same messages on the same lines, and adds partitions, classes, descriptions and the layout block. `src/core/lint.ts` still imports one helper (`pyRepr`) from the frozen file, and `src/core/model.ts` still holds the contract types the reviewer port reads.

The v2 notation rules in `rulesV2()` (`src/core/diagnostics.ts`) are not a port. They follow the reviewer's conventions so they can move into it later. They have not yet been reviewed against the OMG UML 2.5.1 text; see [`spec/lint.md`](spec/lint.md).

## 14. Tests

```
npm test            vitest, test/*.test.ts, Node only
npm run test:e2e    playwright, test/e2e/*.spec.ts, Chromium against the production build
```

Unit tests, in 13 files. `npm test` prints the current count (460 when this was written, and rising):

| File | Covers |
|---|---|
| `test/pyrandom.test.ts`, `test/pen.test.ts` | the ports against the Python fixtures |
| `test/parse.test.ts` | the frozen v1 parser against the reference |
| `test/doc-parse.test.ts` | the v2 parser: v1 files and v1 errors, error recovery, v2 syntax, identity |
| `test/doc-sync.test.ts` | `printDoc`, targeted edits, containers, classes, `formatSource` |
| `test/session.test.ts` | draw edits, one history, text with a mistake, the project file |
| `test/model.test.ts` | commands, arranging, the router, diagnostics |
| `test/render.test.ts` | layout of every fixture, lanes, classes, the two looks, page SVG, portable SVG, partial resolve |
| `test/lint.test.ts`, `test/qa.test.ts`, `test/describe.test.ts`, `test/state.test.ts` | the notation check, the layout check, the text alternative, the hash |
| `test/docs.test.ts` | the in-app reference against the parser, the rules and the embed parameters |

Browser tests run against `vite preview`, which serves `dist/` with the headers from `public/_headers`, so the production CSP is in force during the tests. They live in `test/e2e/`: `embed.spec.ts`, `fixtures.spec.ts`, `host.spec.ts`, `playground.spec.ts`, `draw.spec.ts` (scenarios A to L, driven by a real pointer) and `flows.spec.ts` (scenarios M to X). For the list of scenarios and the current count, see `docs/revamp/TEST_MATRIX.md`.

## 15. Scripts

Each needs a running app (`npm run dev`, or `npx vite preview --port 4173` after a build). None is part of `npm test`.

| Script | Makes |
|---|---|
| `node scripts/look.mjs <outDir> [base]` | screenshots of the running app, for a quick look |
| `node scripts/smoke.mjs [base] [outDir]` | loads every view and downloads one file per export format |
| `node scripts/shots.mjs <outDir> [base] [filter]` | every fixture through the embed, one contact sheet per look |
| `node scripts/gallery.mjs [outDir] [base] [filter]` | `docs/revamp/gallery/`: every fixture exported in both looks as SVG, PNG and PDF, with a sheet at 600, 420 and 240 px |
| `node scripts/capture-ui.mjs [outDir] [base]` | the three views in light and dark at 1440, 820 and 390 px, to set beside the v1 shots |
| `node scripts/capture-baseline.mjs <outDir>`, `node scripts/capture-exports.mjs <outDir> [fixtureDir]` | the v1 evidence in `docs/revamp/baseline/` |

## 16. Hosting and deploy

- **Cloudflare Workers with static assets, no Worker script.** `wrangler.jsonc` serves `./dist` on the custom domain `chalk.kyleschlaepfer.com`. The custom domain creates the DNS record and certificate; do not hand-create a `chalk` CNAME first.
- **Headers** are in `public/_headers`, which Vite copies to `dist/`. A strict CSP everywhere (`script-src 'self'`, `style-src 'self'`, no inline script or style). The tool page refuses framing (`frame-ancestors 'none'`). `/embed/*` may be framed anywhere and makes no network calls (`connect-src 'none'`). Hashed `/assets/*` are cached for a year.
- **Fonts** come from the `@fontsource` packages, so they are fingerprinted into `/assets/` and nothing loads from a third-party CDN.
- **Deploy:** `npm run deploy` runs the unit tests, builds, and runs `wrangler deploy`. It needs `npx wrangler login` once. Kyle runs it.

## 17. Security model

The hash is attacker-controlled: anyone can craft a link. A project file is untrusted too.

- **All text from a diagram is escaped** when it becomes SVG (`esc()` in `src/core/render/svg.ts`) and reaches the DOM only as `textContent`. The draw canvas parses the core's SVG markup as an SVG document, never as HTML (`src/play/draw/dom.ts`). The one `innerHTML` on the tool page is the static syntax reference, which is authored content.
- **Strict CSP**, tested: the browser tests run with the production headers.
- **Opening a file** (`openFile()` in `src/core/doc/project.ts`) re-parses the text and rebuilds the model field by field. Files over 4 MB are refused.
- **postMessage.** The embed posts only non-sensitive data with target `*`, and accepts `theme`, `step` and `load` from its parent only, after checking their shape. `load` text takes the same parse and escape path as hash text.
- **No state-changing action in the embed**, so framing it anywhere is safe. The tool page cannot be framed.

## 18. How it connects to the rest of the system

| Piece | Relationship |
|---|---|
| `whiteboard-lecture-slides` | source of `pen.py` and the shape recipes in `diagrams.py` |
| `diagram-semantics-reviewer` | source of the notation rules; new rules land there first |
| `ksyt-web-design` | source of tokens, `ksyt.css`, buttons, the "describe this figure" pattern and the house rules |
| Video workflow | a lesson that needs a diagram gets a `.ksd` file next to its lesson file; `DiagramEmbed` points at it |

## 19. Decisions for Kyle

Carried over from v1 (the defaults are what the code does):

| # | Decision | Default | Alternative |
|---|---|---|---|
| D1 | Repo name and visibility | `ksyt-draw`, private | public, as the channel's open-source tool |
| D2 | Who may embed `/embed/` | anyone (`frame-ancestors *`) | an allowlist of kyleschlaepfer.com origins |
| D3 | Subdomain | `chalk.kyleschlaepfer.com` | `tools.` with `/draw/` under it |
| D4 | Build-up start state | step 1 of N, the reader clicks through | final state first, with a replay button |

New in v2, both awaiting sign-off, both written up in `docs/revamp/ARCHITECTURE_DECISIONS.md`:

| # | Decision | Default | Alternative |
|---|---|---|---|
| 6 | What other shapes do when one is edited | they hold still | automatic shapes re-flow, with an animation |
| 12 | The draw canvas | purpose-built on the core's geometry | React Flow as the interaction shell |
