# CONTINUE: Chalk (KSyt-Draw)

## Now: immersive draw (2026-11-05, released)

The authoritative assignment is `prompts/CHALK_OPUS_UX_HANDOFF_2026-11-05.md`: make draw feel like
a diagramming application rather than an editor set into a page, keeping Chalk's look. It is
implemented on `feat/immersive-draw` (from `a237b02`), fast-forwarded to `main` as `1d6f8f2` and
live at https://chalk.kyleschlaepfer.com (a push to `main` deploys; the build was live about a minute later).

Read, in order: `docs/revamp/IMMERSIVE_DRAW_REPORT.md` (acceptance matrix, files, commands, manual
QA script), `docs/revamp/IMMERSIVE_DRAW_UX_AUDIT.md` (issues, causes, remedies, before/after
numbers), and section 0 of `docs/revamp/UI_PRESERVATION_CONTRACT.md` (what is superseded in draw
only).

### Follow-up corrections (2026-11-05, same day)

- The notation check is a clear count at the right of the status strip ("1 notation warning",
  "no notation issues"); the whole control is a button that opens a list upward with severity,
  problem, fix and "show it". "Show it" closes the list, selects the element and pans or zooms to
  it (`Canvas.revealAll`). Escape, "close" or a click elsewhere closes the list.
- Select mode: a plain drag on empty canvas pans (4 px threshold; a click clears the selection),
  Shift+drag draws the selection box, Space+drag and the middle button pan over anything, Escape
  during a pan restores the view, Ctrl+arrows pan from the keyboard. The guide, the library hint,
  the canvas's accessible name and the status strip's idle line say so.
- 11 more tests in `test/e2e/workspace.spec.ts`; all 130 browser tests and 473 unit tests pass.
  Screenshots: `docs/revamp/immersive/corrections/`.

### Verification on this branch

| Check | Result |
|---|---|
| `npm test` | 473 passed (13 files) |
| `npm run build` | passed |
| `npm run test:e2e` | 119 passed (Chromium); frame-timing tests run last in a separate `timing` project |
| Workspace audit (`scripts/audit-draw.mjs`) | canvas 79% / 74% / 67% / 80% of the window at 1920 / 1440 / 1024 / 390 (was 28 / 37 / 33 / 56); no page scroll at any size (was scrolling at all); one tool row (was 3 to 5); opening zoom 100% at 1920 and 1440 (was 60%) |
| Looked at | `docs/revamp/immersive/after/` and `after/ui/` in light and dark at 1920, 1440, 1024, 820 and 390 |

### What changed, briefly

- Draw is an app shell: `html[data-view="draw"]` hides the page header, introduction and footer,
  fixes `#app` to the window, and turns the views row into a thin app bar. Write and the syntax are
  unchanged pages.
- One-row tool bar with Chalk's own glyphs (`src/play/draw/icons.ts`); words where there is room.
  "Change type" and the themes are under "more".
- Library and properties toggle from the bar and are remembered (`localStorage`
  `chalk-draw-panels`). Properties start closed. Below 64rem both lie over a full-width canvas.
- A selection bar beside the selection: text or name, what a line means, label, swap ends,
  delete, properties.
- Camera: bar and key zoom hold the selection and keep a fitting drawing in view (`zoomStep`,
  `contain`); fit frames the shown geometry; a resize leaves the drawing where it was; tidy up
  frames its proposal and "put it back" restores the view; the wheel pans without focus.
- Tests: `test/e2e/workspace.spec.ts` (13) and a workflow test in `flows.spec.ts`. `openTool`
  remembers the properties as open unless called with `{ panels: "default" }`.

### Remaining after this branch

- Owner review of the feel, then merge and deploy (owner's call).
- The selection bar can sit over a neighbouring shape or label; try the other side first.
- Between 64 and 80rem most bar buttons are glyphs with tooltips; check discoverability with a
  real user.
- Firefox, Safari, a real touch device, a screen reader.
- The earlier follow-ups below still stand, except "fit the canvas after accepting tidy up", which
  is done.

### Completion estimate

The handoff's ten acceptance criteria pass in Chromium with tests and screenshots behind each
(criterion 5 with the stated limit that zooming past fit puts the drawing's edges off screen, and
criterion 7 for class diagrams resting on the older canvas-first test). I put the immersive-draw
work at **about 90%**: the remainder is the owner's subjective review, cross-browser and touch
passes, and the selection bar's placement. Estimated **1 to 3 days** of follow-up, most of it
driven by what those passes find.

---

## History: canvas-first release (2026-11-05, before this branch)

Updated 2026-11-05 after production release. The canvas-first redesign was committed as `51c6646`, pushed to both `main` and `feat/ksyt-draw-v2-revival`, and deployed at `https://chalk.kyleschlaepfer.com`.

The assignment then was `prompts/KSYT_DRAW_CANVAS_FIRST_REDESIGN.md`. Read it with `docs/revamp/DRAW_MODE_REDESIGN.md` and `docs/revamp/IMPLEMENTATION_REPORT.md` for that history.

### Verification at that release

| Check | Result |
|---|---|
| `npm test` | 473 passed, 0 failed, 0 skipped (13 files) |
| `npm run test:e2e` | 105 passed, 0 failed, 0 skipped (Chromium) |
| `npm run build` | passed (`tsc --noEmit` and Vite production build) |
| Canvas-first acceptance workflow | passed: five empty classes, free arrangement, valid and invalid connections, warning navigation, text added later, project save/reopen |
| Production smoke check | passed: root and embed return 200, production serves the release asset hashes, Draw bundle size matches the release build, and the expected CSP headers are present |

The acceptance screenshot is `docs/revamp/after/canvas-first-class.png` (the test that writes it now shows the immersive workspace).

### Implemented and released then

- New opens a diagram-type chooser for blank flowchart, activity, use-case, or class diagrams and enters Draw.
- The Draw shell was three zones: a collapsible graphical symbol/relationship library, the dominant canvas, and a collapsible docked inspector. A grid-placement defect that could shrink the canvas to 68 px when side zones were collapsed was fixed.
- Shape tools stay armed for repeated empty placement until Escape or another tool is chosen. Empty labels survive source synchronization instead of being replaced with generated display text.
- Relationship buttons arm a source/target connector tool. It works with pointer clicks and with keyboard selection, Tab, and Enter. Existing port dragging remains available.
- Self-referencing connectors can be initiated in Draw and render as loops. Containers, notes, temporarily incomplete combinations, and notation mistakes are no longer rejected by the connection command; diagnostics report notation problems nonblockingly.
- Classes expose direct `+ attribute` and `+ operation` affordances below the selected shape; Alt+A and Alt+O are keyboard equivalents. The new row is edited inline.
- Diagram type is contextual information, not an inspector field that can silently coerce/drop objects. "Change type" starts a new blank diagram through the explicit type chooser.
- A source-sync defect for inserting the first node into a metadata-only blank document is fixed.
- Existing Write, parser, persistence, export, history, lanes, routing, diagnostics, and rendering paths remain shared and covered by the complete suite.

### Architecture retained and why

The purpose-built canvas remains. It already has stable IDs, pointer and keyboard manipulation, manual geometry, routing, shared rendering, targeted source synchronization, one undo history, persistence, and export. The restrictive experience came mainly from the shell and command policy: populated templates, generated labels, a text-heavy library, form-led relationships, and connection rejection. Replacing the canvas with a graph library would duplicate geometry/routing and would not solve those interaction-policy problems. The immersive branch kept this architecture too: the changes are the shell, the chrome and the camera.

`.ksd` remains the complete persisted document. Draw edits go through `Session.edit()`, update the structured `ChalkDoc`, synchronize only the affected source lines, reparse, and then resolve shared geometry. This preserves Write/Draw continuity and existing export/embed behavior while allowing incomplete labels and lint-invalid UML to be saved.

### Follow-ups from then (still open unless noted)

- Profile dragging on slower hardware. The 100-shape Chromium test passes; alone, a 50-shape drag redraws at a 16.7 ms median and 100 shapes at about 33 ms.
- Consider auto-scrolling/panning while a pointer drag approaches a canvas edge.
- Add browser coverage for Write completions and find/replace. (Tidy up now has browser coverage.)
- ~~Fit the canvas automatically after accepting "tidy up."~~ Done on `feat/immersive-draw`.
- Render an interface's own stereotype; it is parsed and preserved today.
- Decide whether generic grouping, z-order controls, and system-clipboard integration are desirable beyond current UML containment and internal copy/paste.
- Independent verification: Firefox and Safari; real phone/tablet touch and pinch; screen reader; PowerPoint, Word, Keynote, Google Slides, Inkscape, Illustrator, Figma and printing for exported files; an audit of the 12 v2 notation rules against UML 2.5.1; `npm run fixtures` on a machine with Python 3.

## Commands

```text
npm install
npx playwright install chromium
npm run dev          # http://localhost:5173/ (embed at /embed/)
npm test
npm run test:e2e
npm run build
npx vite preview     # production build preview
```

Review utilities need a running dev or preview server (use a build when files are changing):

```text
node scripts/audit-draw.mjs <outDir> [baseUrl]            # draw workspace measurements and screenshots
node scripts/gallery.mjs [outDir] [baseUrl] [nameFilter]
node scripts/capture-ui.mjs [outDir] [baseUrl]
```

## Recommended next actions

1. Walk the manual QA script in `docs/revamp/IMMERSIVE_DRAW_REPORT.md` on a real screen.
2. If it feels right, merge `feat/immersive-draw` and deploy (owner's decision).
3. Firefox/Safari and touch passes; then the UML rules audit and the export compatibility checks.
