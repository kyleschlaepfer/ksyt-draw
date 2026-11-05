# Export quality audit

What was wrong with the v1 export, why, what v2 does about each cause, and what the files look like
now. The evidence is real files, opened and looked at, not download notifications.

- Before: `docs/revamp/baseline/exports/` (the v1 SVG of each v1 fixture, and a sheet of it at three widths).
- After: `docs/revamp/gallery/` (every fixture, both looks, SVG and PDF, and a sheet per fixture). Start at
  [`gallery/README.md`](gallery/README.md).
- Remake the gallery: start the app, then `node scripts/gallery.mjs`.

## 1. How the review was done

1. `scripts/gallery.mjs` opens each of the 17 fixtures in the running app, opens the export dialog, and
   downloads SVG, PNG and PDF in the sketch look and in the precision look, plus the SVG with its
   letters as shapes. That is 136 files, all written by the same code a person's click runs.
2. Each file's first bytes are checked, and the dialog's own layout check line is recorded
   (`gallery/report.json`).
3. Each fixture gets a sheet: the files as images on a white page at 600 px (half a slide), 420 px (a
   report column) and 240 px (an embed or a thumbnail), with the v1 export above them where there is one.
4. Every sheet was looked at. So was each SVG pair at its natural size.
5. Files were also opened in two renderers that are not the app:
   - **librsvg** (through `sharp`), which is not a browser and ignores embedded web fonts. This stands
     in for the programs that treat an SVG the same way.
   - **pdf.js** (the PDF renderer in Firefox), which reported the fonts and the text in each PDF and
     drew the page.

The layout check passing is not the bar. All 34 exports passed it before this review started, and
four of them still read badly. The findings in section 4 came from looking.

## 2. What was wrong in v1, and why

| Defect in the v1 file | Root cause | What v2 does |
|---|---|---|
| Colors flip or go missing outside a browser | fills were `var(--role, hex)` inside a `<style>`, with an `@media (prefers-color-scheme: dark)` block | plain `fill` and `stroke` attributes for a chosen theme; no CSS variables, no classes, no media queries |
| Off-white patches on a white page | no background; the knockouts behind shapes were hard-coded to the site's page color | an explicit background rect; knockouts take the background's color; a see-through export has no knockouts at all |
| Swooping arrows with tilted heads | dagre's edge points were fed to a spline | an orthogonal router; ends meet the outline square-on |
| Guards floating away from their lines | the label tried two sides of one segment | candidates along the whole line, scored against shapes, lines, other text and arrowheads |
| Arrows into a shared node at odd angles | the layout had no notion of sides | side preferences by flow direction; arriving and leaving lines avoid sharing a side |
| One format, one look | one writer | SVG, PNG and vector PDF; sketch and precision over the same geometry |
| Fonts lost in programs that ignore embedded fonts | the embedded font was the only plan | embedded font, a fallback stack and `textLength`; and, since this review, the option to write the letters as shapes (section 5) |
| The file followed the viewer's OS theme | the media query above | the file is written in one theme, chosen in the dialog |

The first seven rows were fixed when the pipeline was rebuilt (`src/core/geom/`, `src/core/render/`,
`src/export/`). The export is its own rendering target: `document -> resolve() -> buildScene() for the
file -> writer -> checkScene()`. Nothing from the screen is copied, so no selection, grid or handle can
be in a file.

## 3. The brief's checklist, before and after

"Before" is the v1 export in `baseline/exports/`. "After" is the gallery.

| # | Question | Before | After |
|---|---|---|---|
| 1 | Proportions, empty space | flows fine; use-case boundary had an empty corner | flows fine; use case tighter (4.3); lane diagrams are wide by nature (section 6) |
| 2 | Framing and margins | tight, even | frame computed from all ink and text (unit test: the frame is tight); padding is a choice: 0.1, 0.25 or 0.5 in |
| 3 | Text size, centering, wrap, clipping | fine in a browser | same sizes; wraps inside sized shapes; text stays in its shape in any program when exported as shapes |
| 4 | Baselines, font fidelity | font embedded only | embedded, with a fallback stack; PDF embeds subsets; PNG is pixels; SVG can be shapes |
| 5 | Stroke quality, wobble | pen strokes, good | unchanged pen engine in sketch; even strokes of about 2 px in precision |
| 6 | Arrowheads | tilted on curved lines | square to the outline; label placement keeps text off them |
| 7 | Lines through labels or shapes | guards could sit away from or on a line | checked by `checkScene` (label against every line, its own included) and by unit tests on every fixture |
| 8 | Layout and routing | curves, long diagonals | orthogonal; no shared channels (4.1); corners used on decisions (4.2) |
| 9 | Use-case boundary and actors | actors far out; a right-hand actor's line ran the width of the system | actor beside its own use cases (4.3) |
| 10 | Swimlanes | not supported | dividers and titles align; lines cross lanes cleanly (`activity-lanes`, `dense`) |
| 11 | Class compartments | not supported | name, attributes, operations; rows inside the box (`class-orders`, `class-shapes`) |
| 12 | Background, contrast, transparency | none, patches | white, off-white page, see-through, chalkboard |
| 13 | Screen and export agree | export was the screen's markup | one geometry for both; the two looks draw identical positions (unit test) |
| 14 | Raster resolution | no PNG | 1x to 4x; pixel size is natural size times scale; capped at 16 million pixels with a note |
| 15 | SVG compatibility | CSS variables, media query | `viewBox`, `width`, `height`, plain attributes, no classes |
| 16 | Bounds | fine | frame from paint bounds, including strokes, heads and labels |
| 17 | Small sizes | curves muddied at 240 px | straight runs stay readable; text is the limit (section 6) |
| 18 | Invalid or silently dropped output | none found | none found; every file opens |

## 4. What this review found and fixed

Each of these passed the automated check and still read badly. Each was fixed in the shared geometry,
so the write preview, the draw canvas, the embed and all three export formats changed together.

### 4.1 Two lines in one channel (`flow-branched`)

"send help article" left by its left side along the same level as the "no" line leaving "fixed?", so
the two read as one line and the picture said the help article loops back to "work the ticket". That
is a wrong diagram, not an ugly one.

- Cause: each line was routed without knowing where earlier lines ran.
- Fix: `sharing()` in `src/core/geom/route.ts`. A route that runs along a channel another line uses
  (within 0.1 in) costs as much as five inches of detour; a plain crossing costs a quarter inch. Two
  lines that end at the same shape may share the last short stub and no more.
- Guard: a unit test on every fixture asserts that no two elbow lines share a run.

### 4.2 A decision whose answers hook back in (`activity-decision-merge`)

Both answers sat under a wide diamond, inside its span. The corners could not reach them, so one line
dropped from the bottom point and hooked sideways, and the other left a corner and stepped back in.

- Cause: dagre spaces siblings by their own widths, not by the parent's.
- Fix: `answerRoom()` in `src/core/geom/layout.ts` asks for a second ranking with extra room, so the
  answers stand 0.3 in past the corners. Each line leaves a corner and turns once.
- Related fix: route length in a flow is now measured center to center (`reach()`), because measuring
  between outlines made a wide shape's sides look nearer than they are and pulled lines out sideways.
  With it, the two paths come back into the merge at two corners instead of joining first.
- Cost: this diagram is 0.9 in wider.

### 4.3 A right-hand actor far from its use case (`usecase-permit`, `usecase-described`)

"Permit clerk" stood on the right while "review application" sat in the left column, so their line ran
the width of the system and the boundary had an empty corner.

- Fix: a use case that only right-hand actors use stands in the far column, in the first free row
  (`rightOnly` in `layoutUseCase`). The line is now under 2 in.

### 4.4 SVG text in programs that ignore the embedded font

Rendered by librsvg, the sketch SVG of `class-orders` fell back to a wider handwriting font and ignored
`textLength`: "+placeOrder(cart: Cart): Order" ran out of its class box, and the last letters of several
members sat on the box's edge. PowerPoint, Word, Inkscape and Illustrator were not available to test,
but none of them is known to read a web font embedded in an SVG, so the same should be expected there.

- Fix: the export dialog has "SVG text: letters or shapes" under "more" (`src/export/outline.ts`).
  Shapes are the outlines of the letters in the real fonts, placed where the text would be. The file
  then has no text element and no font, and librsvg draws it exactly as the browser does.
- The default stays "letters", which is real text (searchable, retypable) and is right for web pages.
- PNG and PDF never had this problem: PNG is pixels, and the PDF embeds a subset of each font, which
  pdf.js confirmed (`Kalam-Regular`, `AtkinsonHyperlegibleNext-Regular` and `-Bold`, none missing).

## 5. Formats as delivered

| Format | What is in the file | Checked with |
|---|---|---|
| SVG, letters | paths with plain colors, real text, fonts embedded as WOFF2 with a fallback stack and `textLength` | Chromium; librsvg (shows the fallback problem in 4.4) |
| SVG, shapes | the same, with each label as one path that keeps its words as its `<title>` | Chromium; librsvg (identical to the browser) |
| PNG | the SVG rasterized at 1x to 4x of 96 px per inch | Chromium; pixel size asserted in the browser tests |
| PDF | vector paths and real text in embedded font subsets; page fits the diagram, or US Letter, A4 or a 16:9 slide, never enlarged past natural size | pdf.js: one page, the right size in points, text extractable, fonts embedded |

## 6. What still reads less than well

These are known and were left, with the reason.

- **Large lane diagrams at small widths.** `dense` (20 shapes, 4 lanes) is 18 x 25 in at natural size.
  At 600 px its text is about 7 px and at 420 px it cannot be read. No diagram of that size reads in
  a report column; it needs a full page. The lanes are wide because a lane leaves room for the longest
  guard beside its decisions. Narrowing that was measured at 10% at best and was not done.
- **Pen strokes on small ellipses.** In the sketch look an ellipse's stroke overlaps itself where it
  starts and ends, by design of the pen engine. On short use-case ovals that reads as a small hook at
  the left. The pen engine is a port of the slide tool's and was not changed.
- **Curved lines in the two deliberately wrong use-case fixtures.** `usecase-is-flow` and
  `usecase-actor-inside` exist to trip the notation check. Their lines swing around shapes in wide
  curves. A correct use-case diagram does not produce these.
- **Two arrows landing on one spot.** In `flow-branched` the loop back and the line from "add to team
  queue" both end at the right side of "work the ticket". They share the last 0.2 in only.
- **Slashed zero in precision multiplicities.** Atkinson Hyperlegible draws 0 with a slash, so `0..*`
  shows one. That is the font's design.

## 7. Not verified

- Opening the files in PowerPoint, Word, Keynote, Google Slides, Inkscape, Illustrator or Figma. None
  was available here. librsvg and pdf.js are the stand-ins, and they are not the same programs.
- Printing.
- Text beyond Latin and extended Latin. The fonts have no other scripts; such characters fall back to
  the viewer's font in SVG letters and are left out of the PDF and of SVG shapes.
- The gallery was made from a production build served without the site's response headers. The browser
  tests run the export dialog under the production content security policy.
