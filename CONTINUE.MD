# CONTINUE: Chalk (ksyt-draw) v2 revival, where it stands

Written 2026-11-05, replacing the handoff of 2026-11-04. The eight items that handoff listed are done.
What is left needs the owner, or a machine this session did not have. Read this file, then
`docs/revamp/IMPLEMENTATION_REPORT.md`. The full assignment is in
`prompts/KSYT_DRAW_FABLE_COMPLETE_REVIVAL_BRIEF.md` (that folder is git-ignored on purpose).

## At a glance

| | |
|---|---|
| Branch | `feat/ksyt-draw-v2-revival`, not pushed, not deployed |
| `npm test` | 472 passed, 0 failed, 0 skipped (13 files) |
| `npm run test:e2e` | 102 passed, 0 failed, 0 skipped (Chromium, served with the production CSP) |
| `npm run build` | passes (typecheck + build) |
| Write, Draw, the syntax, the embed, export to SVG, PNG and PDF | all working |

The baseline before any change was 191 unit tests passing, and 67 browser tests passing with 2
failing on Windows line endings.

## A. Two questions for the owner, still open

They were asked at the start of the last session and not answered. The work went on assuming both
stay as built. Ask again before any work that depends on them.

1. **Is the purpose-built canvas acceptable, or should React Flow be the interaction shell?**
   `docs/revamp/ARCHITECTURE_DECISIONS.md`, decision 12. A switch is roughly 10 to 20 hours.
2. **Is hold-still right, or should a Draw edit let automatic shapes re-flow, with an animation?**
   Decision 6. Hold-still has two exceptions now: a uniform shift of everything is not counted as a
   move, and a shape that an edit newly crowds is pushed over just far enough (`Session.makeRoom`).

## B. What the last session did

In the order of the old list:

1. **The `docs/revamp/` set** is written: `BASELINE_AUDIT`, `UI_PRESERVATION_CONTRACT`,
   `ARCHITECTURE_DECISIONS`, `EXPORT_QUALITY_AUDIT`, `UX_DESIGN_SYSTEM`, `TEST_MATRIX`,
   `IMPLEMENTATION_REPORT` (with the 13-item readiness scorecard).
2. **Export gallery and review.** `node scripts/gallery.mjs` exports every fixture as SVG, PNG and
   PDF in both looks into `docs/revamp/gallery/`, with a sheet at 600, 420 and 240 px. Every sheet
   was looked at; what was fixed and what still reads less than well is in the export audit.
3. **Browser tests for scenarios M to X** are in `test/e2e/flows.spec.ts`. They found six defects.
   All six are fixed.
4. **The syntax reference** covers v2 and `test/docs.test.ts` checks it against the v2 parser and
   the rules.
5. **Project docs**: `ARCHITECTURE.md`, `README.md`, `CLAUDE.md`, the four files in `spec/`, and a
   user guide in `docs/GUIDE.md`.
6. **Draw polish**: the findings list under the status line with "show it"; undo keys anywhere in
   the draw view; dark and phone review (`docs/revamp/after/`, `node scripts/capture-ui.mjs`);
   shorter status wording.
7. **Smaller features**: lines from a shape to itself are drawn; build-up steps are set in Draw;
   horizontal lanes have a pointer test; SVG text as outlines; the embed bundle measured.
8. **Accessibility and performance**: an axe-core run, the fixes it led to, and no contrast failures left; the
   drop in a 100-shape diagram went from about 980 ms to about 230 ms.

## C. What is left

Needs the owner or other machines:

1. The two answers in A, and a look at `docs/revamp/after/` and `docs/revamp/gallery/`.
2. Open exports in PowerPoint, Word, Keynote, Inkscape, Illustrator. Print one. None of this could
   be done here; librsvg and pdf.js stood in.
3. Safari, Firefox, a phone and a tablet. Everything ran in Chromium on a desktop. Pinch and
   one-finger pan are written and have never been run on a touch device.
4. A screen reader.
5. Read the 12 v2 notation rules (`src/core/diagnostics.ts`) against the UML 2.5.1 text.
6. `npm run fixtures` on a machine with python3. The Python fixtures were neither regenerated nor
   edited.
7. Deploy (`npm run deploy`). The owner runs this. Do not deploy or push without being told to.

Could be built next, none blocking:

- Start a line from a shape back to itself in Draw (`canConnect` in `src/core/doc/commands.ts`
  refuses it today; the router and the text already handle it).
- A keyboard way to start a line in Draw.
- Browser tests for the editor's completions, find and replace, and tidy.
- Fit the canvas again after "tidy up".
- Draw an interface's own stereotype (parsed and kept, never drawn).
- Say something when `lanes` or `look` is written where it does nothing; print a bare `pool`.
- Button titles that say Cmd on a Mac.
- A `look` prop on `site/DiagramEmbed.astro`.
- Smoother dragging at 100 shapes: a layout of 100 shapes takes about 80 ms, a frame of the drag about
  36 ms. The candidates are in `src/core/geom/layout.ts` (the one-entry dagre cache) and
  `Canvas.preview` in `src/play/draw/canvas.ts`.
- A pixel-diff regression test. Today the gallery's SVG files are the record: they are
  deterministic and can be compared byte for byte.

For the owner's eye (house rules): the armed palette button shows a check mark character (U+2713)
and the class member "move up" button an arrow (U+2191). They are text, not an icon pack.

## D. Things to know before changing code

- **Ports.** `src/core/pen.ts`, `pyrandom.ts`, `lint.ts` and the v1 `src/core/parse.ts` follow
  `reference/*.py`. The v1 parser is the oracle in `test/doc-parse.test.ts`, and `lint.ts` imports
  `pyRepr` from it. `src/core/model.ts` (the v1 model) is still there for those two.
- **The v2 parser** (`src/core/doc/parse.ts`) is a superset. A message that v1 also gives must match
  v1 exactly, which is why "unknown option ... (left, right, at X Y)" still reads that way.
- **The text is the file.** Every Draw edit goes through `Session.edit()`: clone, apply commands,
  hold still, make room, `syncSource`, re-parse. If the new text does not parse the edit is refused.
  A new command needs a printer for what it changes and a case in `syncSource`.
- **The layout check** (`src/core/qa.ts`) was made faster without changing its output. If you change
  it, compare its output before and after on every fixture in both looks, crowded variants too.
- **The write figure is not drawn while the write view is hidden** (`render()` in `src/play/write.ts`).
  It is drawn when the view is shown.
- **`window.chalk`** (`src/play/main.ts`) is the surface the browser tests use: `getText`, `setText`,
  `undo`, `redo`, `valid`, `inspect`. Decide whether to keep it public.
- **The canvas** (`src/play/draw/canvas.ts`, 1,210 lines) owns no geometry. Every frame, including each
  frame of a drag, it asks the core to resolve a draft. Above 60 shapes a drag re-routes only the
  lines that touch what is moving.
- **On this Windows machine** shell heredocs mangle backslashes, and some test files have CRLF line
  endings. Patch files with the editor tools, or with a small `.cjs` script that handles both endings.

## E. Commands

```
npm install                     install dependencies
npx playwright install chromium once, for the browser tests
npm run dev                     the app: http://localhost:5173/  (embed at /embed/)
npm test                        unit tests (vitest)
npm run test:e2e                browser tests; builds, then serves dist/ with the production headers
npm run build                   typecheck + build to dist/
node scripts/gallery.mjs [outDir] [base url] [name filter]    every fixture, every format, review sheets
node scripts/capture-ui.mjs [outDir] [base url]               the tool's views, light and dark, three widths
```

The two scripts need a running server (`npm run dev`, or a preview of a build).

To resume: check out `feat/ksyt-draw-v2-revival`, run `npm install`, `npm test`,
`npm run test:e2e`, read `docs/revamp/IMPLEMENTATION_REPORT.md`, and ask the owner the two
questions in A.
