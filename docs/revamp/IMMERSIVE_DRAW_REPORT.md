# Immersive draw: report

2026-11-05. Brief: `prompts/CHALK_OPUS_UX_HANDOFF_2026-11-05.md`. Audit with causes and remedies:
[`IMMERSIVE_DRAW_UX_AUDIT.md`](IMMERSIVE_DRAW_UX_AUDIT.md). Branch `feat/immersive-draw`, local
only: not pushed, not merged, not deployed.

## Commits

- `7ad0416` make draw an immersive workspace: app shell, one-row tool bar, selection bar, a camera
  that keeps the drawing in view
- the commit holding this report and `CONTINUE.MD`

## Files

| File | What changed |
|---|---|
| `src/play/main.ts` | `html[data-view]` follows the current view; the app bar's mark and name; scroll to top on entering draw |
| `src/play/play.css` | the draw app shell and workspace grid, the one-row bar, compact library, docked or overlaid properties, selection bar, status strip and findings list, narrow-window rules |
| `src/play/draw/index.ts` | the workspace layout; the bar with glyphs, the shapes and properties toggles and "more"; remembered side zones; the selection bar; tidy up keeps or restores the view |
| `src/play/draw/canvas.ts` | `zoomStep` and `contain`, `fit` on the shown geometry, resize anchoring, a sanity check on a remembered view, tidy view save and restore, `selectionBox`, `busy`, `hovered`, the `framed` callback, wheel pans without focus |
| `src/play/draw/inspector.ts` | closed by default, opened and closed by its host, a close button |
| `src/play/draw/icons.ts` | new: the bar's own glyphs |
| `test/e2e/workspace.spec.ts` | new: 13 tests (below) |
| `test/e2e/flows.spec.ts` | new workflow test: empty shapes to save and reopen without the properties |
| `test/e2e/draw.spec.ts`, `helpers.ts` | `openTool` remembers the properties as open unless `panels: "default"`; two tests open with both zones closed instead of clicking the old toggles |
| `playwright.config.ts` | frame-timing tests run in a `timing` project after the rest |
| `scripts/audit-draw.mjs` | new: the measurements and screenshots in the audit |
| `docs/revamp/UI_PRESERVATION_CONTRACT.md` | section 0: what is superseded in draw only |

## Acceptance

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | No page scrolling for everyday drawing at 1920×1080 and 1440×900 | pass | audit: page height equals the window at all four sizes; tests "the canvas is the workspace" and "ordinary drawing never scrolls the page" at both sizes |
| 2 | The canvas is the dominant workspace; no 80rem limit | pass | canvas 79% of the window at 1920, 74% at 1440 (was 28% and 37%); test asserts over 65% and width over the window less 260 px |
| 3 | The tool bar does not wrap | pass | one row at 1920, 1440, 1024 and 390 (was 3, 3, 4, 5); asserted at 1920 and 1440 |
| 4 | A practical scale, not routinely 61% | pass | opens at 100% at 1920 and 1440, 76% at 1024 (was 60%, 60%, 33%) |
| 5 | Fit includes everything, an actor outside the boundary and its name; zooming in does not unexpectedly clip | pass, with a stated limit | test: after zooming far in and panning away, fit puts every shape and text inside the canvas; a step in from the opening view keeps everything; past fit the drawing fills the view with no empty side. Zooming beyond the size at which the drawing fits does put its edges off screen |
| 6 | Tidy gives a sensible view on keep and restores the prior view on put back | pass | test compares the world transform before and after "put it back", and checks everything is in view after "keep it" |
| 7 | Basic use-case and class diagrams without the properties | pass for use case; class by an older test | new workflow test builds a use-case diagram from empty shapes with the panel never shown, then saves and reopens it; the existing canvas-first class test never touches the panel (it opens with the panel shown through the test helper) |
| 8 | Diagnostics stay nonblocking | pass | canvas-first test draws an invalid self-dependency, saves and reopens it; findings sit in the status strip and open over the canvas |
| 9 | Narrow widths and view switching stay stable; no 68 px canvas | pass | tests at 820 and 390: full-width canvas over 60% of the height, library over it, write and the syntax are pages again, back and forward restore each; docked properties at 1440 leave the canvas over 900 px wide |
| 10 | Tests and artifacts back every claim | pass | below |

Not verified: Firefox, Safari, real touch devices, a screen reader, and how the workspace feels to
anyone but this session.

## Commands and results

| Command | Result |
|---|---|
| `npm test` | 473 passed, 13 files |
| `npm run build` | passed |
| `npm run test:e2e` | 119 passed (Chromium; the frame-timing test runs last in its own project) |
| `node scripts/audit-draw.mjs docs/revamp/immersive/after http://localhost:4182` | numbers in the audit |
| `node scripts/capture-ui.mjs docs/revamp/immersive/after/ui http://localhost:4182` | no browser errors |

The gallery was not rerun: layout, routing, the looks and the export pipeline were not touched.

## Screenshots

- Before: `docs/revamp/immersive/before/draw-{1920x1080,1440x900}-{light,dark}.png`, `draw-1024x768-light*.png`, `draw-390x844-light*.png` (`-full`, `-selected`, `-zoomed` variants)
- After: the same names in `docs/revamp/immersive/after/`
- Every view, light and dark, 1440, 820 and 390: `docs/revamp/immersive/after/ui/`
- From the tests: `test-results/workspace-{1920,1440,820,390}.png`, `test-results/workspace-workflow.png`

## Manual QA script

Use `npm run build && npx vite preview`, a desktop browser at about 1440×900, then a phone or a
narrow window.

1. Open the tool on write. The page looks as before: header, introduction, footer, page scroll.
2. Click draw. The header and footer go; a thin bar with the mark, "Chalk", the three views and
   new/open/save/export runs across the top; the tool bar is one row; the canvas fills the rest; the
   page does not scroll. The properties are closed.
3. Scroll the wheel over the canvas without clicking it first: the canvas pans.
4. Choose "use case" in the library and click three times on the canvas, then Escape. Choose
   "actor" and click once.
5. Choose "association" under lines, click the actor, then a use case. Choose "include", click two
   use cases.
6. Click a use case: a small bar appears above it. Click "text", type a name, Enter.
7. Click the include line: the bar shows what it means. Change it to "extend". Click "swap ends".
8. Hover another shape while the line is selected: the bar steps aside and that shape's dots show.
9. Drag a shape: the bar hides during the drag and comes back.
10. Zoom in three times with +: a selected shape holds still; with nothing selected, the drawing
    stays framed while it fits. Click fit: everything, actor names included, is on screen.
11. Drag a shape well away, zoom in, then tidy up, the whole diagram. The proposal is framed whole.
    Click "put it back": the zoom and position are exactly as before. Do it again and click "keep
    it": the result is framed.
12. Click "properties": the panel docks at the right and the drawing does not jump. Click "close"
    in its head. Click "shapes" to hide the library. Reload: both choices are remembered.
13. Open "more": start another kind of diagram, diagram settings, and the three themes. Switch to
    dark and back.
14. Draw a mistake (a class depending on itself in a class diagram). "what the check found (1)"
    appears at the right of the status strip; open it, click "show it".
15. Save as a project file, start a new diagram, open the file: everything comes back.
16. Click write, then the syntax, then draw, then use the browser's back and forward buttons. Each
    view looks right, and the canvas is full size every time.
17. Narrow the window below 1024 px: the library starts closed, opens over the canvas, and closes
    when a dragged shape is on its way. At phone width, redo and snap are in "more"; pinch zooms.
