# Immersive draw: UX audit

2026-11-05, branch `feat/immersive-draw` from `a237b02`. The brief is
`prompts/CHALK_OPUS_UX_HANDOFF_2026-11-05.md`: make draw feel like a diagramming application, not
a diagram editor set into a web page, while keeping Chalk's look.

Measurements come from `node scripts/audit-draw.mjs <outDir> <base url>`, which opens
`fixtures/diagrams/usecase-permit.ksd` in draw against a production build, the way a first visit
does (no remembered panel choices). It records where the canvas is, whether the page scrolls, how
many rows the tool bar takes, the zoom, and how much of the two actors stays visible while zooming
in from fit. Each run writes `report.json` and screenshots beside it.

- Before: `docs/revamp/immersive/before/` (build of `a237b02`)
- After: `docs/revamp/immersive/after/` (this branch), plus every view in light and dark at 1440,
  820 and 390 px in `docs/revamp/immersive/after/ui/` (from `scripts/capture-ui.mjs`)

## Numbers

| Viewport | Canvas before | Share before | Canvas after | Share after | Page scrolls (before / after) | Tool rows (before / after) | Opening zoom (before / after) |
|---|---|---|---|---|---|---|---|
| 1920×1080 | 688×842 | 28% | 1720×949 | 79% | yes, 1567 px / no | 3 / 1 | 60% / 100% |
| 1440×900 | 688×702 | 37% | 1240×769 | 74% | yes, 1427 px / no | 3 / 1 | 60% / 100% |
| 1024×768 | 433×599 | 33% | 824×637 | 67% | yes, 1375 px / no | 4 / 1 | 33% / 76% |
| 390×844 | 355×523 | 56% | 390×672 | 80% | yes, 2638 px / no | 5 / 1 | 25% / 34% |

Before, the canvas's bottom edge was below the window at every size, and the properties panel took
288 px with nothing selected. After, the bottom edge is on screen at every size and the properties
stay closed until asked for.

Zooming in with the bar, starting from fit, at 1920×1080 (share of each actor still on the canvas):

| | step 0 | step 1 | step 2 | step 3 |
|---|---|---|---|---|
| before | 60%: resident 1, clerk 1 | 72%: 0.97, 1 | 86%: **0**, 0.22 | 104%: 0, 0 |
| after | 150%: 1, 1 | 180%: 0.99, 0.99 | 216%: 0, 0.21 | 259%: 0, 0 |

Before, the resident vanished at 86%, a scale at which the whole drawing would have fit easily:
the zoom held the middle of a canvas whose lower part was off the bottom of the window. After, the
drawing stays whole until it is genuinely bigger than the canvas (fit is already 150% here); past
that, the edges of a drawing larger than the view are off screen, which is what zooming in means.

## Issues, causes and remedies

### P0: draw was a narrow section of a page

Screenshots: `before/draw-1920x1080-light.png`, `before/draw-1920x1080-light-full.png`;
after: `after/draw-1920x1080-light.png`.

Cause: the page shell. `main.wrap` was capped at 80rem with gutters; the header, the tool's
introduction and the footer stayed on screen; the draw grid gave 13rem to the library and 18rem to
an always-open properties panel; and the canvas height was `clamp(34rem, 78vh, 68rem)`, which with
the header above it always ran past the window.

Remedy: draw is an app shell while it is the view. `main.ts` sets `html[data-view]` on every view
change; in draw the header, introduction and footer are hidden, `#app` is `100dvh` with no page
scroll, the views row becomes a thin app bar with the mark and "Chalk", and the draw panel is a
grid of five areas (bar, library, stage, properties, status strip) whose stage takes everything
left. The canvas fills the stage edge to edge. Leaving draw removes the attribute and the page
comes back unchanged (checked by the "narrow windows and switching views" tests, including the
back and forward buttons).

### P0: zooming in clipped the resident actor

Screenshots: `before/draw-1920x1080-light-zoomed.png`; after: `after/draw-1920x1080-light-zoomed.png`.

Cause: the bar's zoom held the canvas's middle still, and that middle was below the window;
there was no rule keeping a drawing that fits in view; `fit` measured the session's geometry, not
what was shown, and left room for a floating panel that no longer floated.

Remedy (`src/play/draw/canvas.ts`):

- `zoomStep` (bar and keys) holds the selection still when it is on screen, otherwise the middle of
  the view, then `contain()`s: a drawing that fits stays wholly on screen, one that does not leaves
  no empty margin wider than the padding. Wheel and pinch zoom still hold the point under the
  pointer.
- `fit(maxZoom, geo)` frames the geometry on show (so a proposal frames the proposal), with padding
  that scales with the canvas and no allowance for a panel.
- A resize (a panel opened or closed, the window changed) leaves the drawing where it was on the
  screen, and keeps a drawing that was wholly in view wholly in view.
- A remembered view that would show less than a quarter of the drawing is replaced by a fit.

### P1: tidy up left the diagram small, and cancelling lost the view

Cause: the proposal was shown in whatever view was current, and nothing framed it or put the view
back.

Remedy: `propose` remembers the view and fits the proposal (up to 125%); "keep it" keeps that
framing on the result; "put it back" restores the exact view (checked by comparing the world
transform before and after).

### P1: the properties panel led every edit

Cause: the panel was open by default and was the only place to change a line's meaning, swap its
ends or delete a shape with the pointer.

Remedy: the properties start closed and are a toggle in the bar (remembered per browser in
`localStorage` under `chalk-draw-panels`). A small bar beside the selection carries the everyday
actions: for a shape, "text" or "name" and "delete"; for a line, what it means (a select of the
diagram type's relationships), "label", "swap ends" and "delete"; for several, the count and
"delete"; and "properties" to open the full panel. It steps aside during a drag and while the
pointer is on another shape (so that shape's connection dots are free), and sits clear of the
selection's own dots. Classes keep their "+ attribute" and "+ operation" on the canvas.

### P1: the tool bar wrapped and controls were scattered

Cause: a wrapping flex row of word buttons, the type and "change type" on a row of their own, and
the findings and status stacked under the canvas.

Remedy: one row that never wraps: the library toggle, the type and title, select, undo, redo, zoom
out, the zoom, zoom in, fit, snap, tidy up, then the properties toggle and "more" at the right.
Each has a small glyph; words show beside the glyphs above 80rem, only on the library, tidy and
properties toggles between 64 and 80rem, and not at all below 64rem (the word is always the
accessible name and the tooltip). On a phone, redo, snap and the zoom steps move into "more"
(pinch zooms). "Change type" and the theme moved into "more". The status line and "what the check
found" share a fixed-height strip under the canvas; the findings open as a list over the canvas.

### P2: diagrams opened at about 61%

Cause: a small canvas.

Remedy: the bigger canvas. The opening fit is capped at 100% (actual size), which the fixture now
reaches at 1440 and 1920.

### Found while testing

- The status strip grew by a few pixels when the first finding appeared, which (with the new
  resize handling) nudged the drawing. The strip now has a fixed height.
- The selection bar first covered a shape's top connection dot, which broke the self-loop gesture
  in test E. It now sits 28 px above the selection and hides while another shape is hovered.
- The frame-timing test (V) measures drag smoothness. With a canvas three times larger it missed
  its 50 ms budget by a hair only when fifteen other browsers were drawing at the same time; alone
  it runs at a 16.7 ms median. It now runs in its own Playwright project after the rest.

## What remains

- The selection bar can sit over a neighbouring shape or label (it never covers the selection or
  its dots). A smarter placement would try the other side first.
- Zooming in past fit puts the edges of the drawing off screen. That is expected; panning is by
  the wheel (it now pans whether or not the canvas has the focus, since the page has nothing to
  scroll), a space-drag or a middle-button drag.
- Between 64 and 80rem most bar buttons are glyphs with a tooltip; first-time discoverability there
  depends on the glyphs. Nobody outside this session has tried them.
- On a phone a wide diagram opens small (34% for the permit fixture). Pinch zoom works in Chromium
  emulation; it has not been tried on a real touch device.
- Firefox and Safari have not been run. `100dvh` has a `100vh` fallback.
- No screen reader pass. The bar is a `role="toolbar"` and so is the selection bar, but Tab inside
  the canvas steps through shapes, so keyboard users reach the selection's actions through the
  canvas keys (Enter edits, Delete removes) and the properties panel, not through the selection bar.
