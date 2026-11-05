# CONTINUE: KSYT-Draw canvas-first Draw mode

Updated 2026-11-05 after production release. The canvas-first redesign was committed as `51c6646`, pushed to both `main` and `feat/ksyt-draw-v2-revival`, and deployed at `https://chalk.kyleschlaepfer.com`.

The authoritative assignment is `prompts/KSYT_DRAW_CANVAS_FIRST_REDESIGN.md`. Read it with `docs/revamp/DRAW_MODE_REDESIGN.md` and `docs/revamp/IMPLEMENTATION_REPORT.md` before continuing.

## Current verification

| Check | Result |
|---|---|
| `npm test` | 473 passed, 0 failed, 0 skipped (13 files) |
| `npm run test:e2e` | 105 passed, 0 failed, 0 skipped (Chromium) |
| `npm run build` | passed (`tsc --noEmit` and Vite production build) |
| Canvas-first acceptance workflow | passed: five empty classes, free arrangement, valid and invalid connections, warning navigation, text added later, project save/reopen |
| Production smoke check | passed: root and embed return 200, production serves the release asset hashes, Draw bundle size matches the release build, and the expected CSP headers are present |

The new acceptance screenshot is `docs/revamp/after/canvas-first-class.png`.

## Implemented and released

- New opens a diagram-type chooser for blank flowchart, activity, use-case, or class diagrams and enters Draw.
- The Draw shell is three zones: a collapsible graphical symbol/relationship library, the dominant canvas, and a collapsible docked inspector. A grid-placement defect that could shrink the canvas to 68 px when side zones were collapsed is fixed.
- Shape tools stay armed for repeated empty placement until Escape or another tool is chosen. Empty labels survive source synchronization instead of being replaced with generated display text.
- Relationship buttons arm a source/target connector tool. It works with pointer clicks and with keyboard selection, Tab, and Enter. Existing port dragging remains available.
- Self-referencing connectors can be initiated in Draw and render as loops. Containers, notes, temporarily incomplete combinations, and notation mistakes are no longer rejected by the connection command; diagnostics report notation problems nonblockingly.
- Classes expose direct `+ attribute` and `+ operation` affordances below the selected shape; Alt+A and Alt+O are keyboard equivalents. The new row is edited inline.
- Diagram type is contextual information, not an inspector field that can silently coerce/drop objects. “Change type” starts a new blank diagram through the explicit type chooser.
- A source-sync defect for inserting the first node into a metadata-only blank document is fixed.
- Existing Write, parser, persistence, export, history, lanes, routing, diagnostics, and rendering paths remain shared and covered by the complete suite.

## Architecture retained and why

The purpose-built canvas remains. It already has stable IDs, pointer and keyboard manipulation, manual geometry, routing, shared rendering, targeted source synchronization, one undo history, persistence, and export. The restrictive experience came mainly from the shell and command policy: populated templates, generated labels, a text-heavy library, form-led relationships, and connection rejection. Replacing the canvas with a graph library would duplicate geometry/routing and would not solve those interaction-policy problems.

`.ksd` remains the complete persisted document. Draw edits go through `Session.edit()`, update the structured `ChalkDoc`, synchronize only the affected source lines, reparse, and then resolve shared geometry. This preserves Write/Draw continuity and existing export/embed behavior while allowing incomplete labels and lint-invalid UML to be saved.

## Remaining work

### Functional follow-ups (not blockers for the implemented acceptance workflow)

- Profile dragging on slower hardware. The 100-shape Chromium test passes, but redraws remain roughly 28 fps and a drop is about 241 ms on this machine.
- Consider auto-scrolling/panning while a pointer drag approaches a canvas edge.
- Add browser coverage for Write completions, find/replace, and tidy.
- Fit the canvas automatically after accepting “tidy up.”
- Render an interface's own stereotype; it is parsed and preserved today.
- Decide whether generic grouping, z-order controls, and system-clipboard integration are desirable beyond current UML containment and internal copy/paste.

### Independent verification still required

- Firefox and Safari; real phone/tablet touch and pinch; screen reader.
- PowerPoint, Word, Keynote, Google Slides, Inkscape, Illustrator, Figma, and printing for exported files.
- An independent audit of the 12 v2 notation rules against UML 2.5.1.
- `npm run fixtures` on a machine with Python 3. The Python-generated fixtures were not changed here.

## Completion estimate

The requested canvas-first functional redesign is estimated at **92% complete**. The core construction-order freedom, direct manipulation, connectors (including self and keyboard paths), nonblocking validation, persistence, exports, and regression coverage are implemented and verified in Chromium. The remaining 8% is principally cross-browser/touch/manual compatibility work and the focused follow-ups above, not a missing alternate editing architecture.

Estimated remaining implementation effort is **2–5 engineering days**, with substantial uncertainty from touch/browser findings and the UML rules audit. External application compatibility and device/screen-reader QA add calendar time but may produce little or no code work.

## Commands

```text
npm install
npx playwright install chromium
npm run dev          # http://localhost:5173/ (embed at /embed/)
npm test
npm run test:e2e
npm run build
npm run preview      # production build preview
```

Optional review utilities need a running dev or preview server:

```text
node scripts/gallery.mjs [outDir] [baseUrl] [nameFilter]
node scripts/capture-ui.mjs [outDir] [baseUrl]
```

## Recommended next actions

1. Manually walk the canvas-first class workflow shown in `docs/revamp/after/canvas-first-class.png`.
2. Run Firefox/Safari and touch-device passes before changing architecture.
3. Audit the 12 UML rules against the UML 2.5.1 source.
4. Open representative SVG, PNG, and PDF exports in the target office/design applications.
5. Address only findings from those passes, then rerun all three verification commands above and redeploy.
