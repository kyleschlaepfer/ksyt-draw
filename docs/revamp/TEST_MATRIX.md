# Test matrix

What is tested, how, and what the result was. Last full run: 2026-11-05, on the branch
`feat/ksyt-draw-v2-revival`, Windows 11, Node, Chromium (Playwright).

| Command | Result |
|---|---|
| `npm test` | 472 passed, 0 failed, 0 skipped (13 files) |
| `npm run test:e2e` | 102 passed, 0 failed, 0 skipped (6 files) |
| `npm run build` | typecheck and build succeed |

At the baseline, before any change: 191 unit tests passing; 67 browser tests passing and 2 failing
(line endings in the Windows checkout, not the app; see `BASELINE_AUDIT.md`).

The browser tests run against the production build, served with the production headers
(`public/_headers`), so the strict content security policy is in force while they run.

A status in this document means one of four things, and they are not the same:

- **tested**: an automated test asserts it and passes.
- **looked at**: a person-style review of a rendered picture, by me, in this session.
- **in the code**: written, not exercised by a test or a review.
- **not verified**: nobody has checked it.

## 1. Unit tests (`npm test`)

| File | Tests | What it holds |
|---|---|---|
| `pen.test.ts` | 19 | the pen engine reproduces `reference/pen.py` stroke for stroke |
| `pyrandom.test.ts` | 26 | the random number generator and the seeds match CPython |
| `parse.test.ts` | 30 | the frozen v1 parser reproduces `ksd_parse.py`, messages included |
| `lint.test.ts` | 21 | the notation check reproduces `review_diagrams.py` on every fixture |
| `doc-parse.test.ts` | 48 | the v2 parser reads every v1 file as the v1 parser does and fails where it fails, on the same line; v2 syntax; error recovery and ranges; identity |
| `doc-sync.test.ts` | 69 | printing; a draw edit touches only the lines it changes; comments, spacing and order survive; containers, classes, descriptions; build-up steps set from Draw; tidy |
| `model.test.ts` | 30 | commands, arranging, the router, the v2 rules |
| `session.test.ts` | 23 | draw edits through the session; one history for both views; text with a mistake; holding still and making room; the project file, hostile input included |
| `render.test.ts` | 172 | every fixture in both looks: no collisions, nothing clipped, both looks on one geometry; use-case, flow, lane and class layout; the page SVG and the export SVG; lines from a shape to itself |
| `qa.test.ts` | 6 | the layout check catches a stroke through text, overlapping labels, clipping, small text |
| `describe.test.ts` | 7 | the text alternative for a figure |
| `docs.test.ts` | 17 | the syntax reference names every keyword, relationship, rule id and error the code has; its examples parse and pass; house rules |
| `state.test.ts` | 4 | the link format |

Round trips the brief asks for, and where each is held:

| Round trip | Held by |
|---|---|
| Write, model, Draw, model, Write | `doc-sync.test.ts` (targeted edits), `session.test.ts` (one history), browser scenarios M and N |
| Draw, save, reload, Draw | `session.test.ts` (the project file), browser scenario S (4 tests) |
| old `.ksd`, import, edit, export, reload | `doc-parse.test.ts` (differential against the v1 parser), `doc-sync.test.ts`, browser scenario S (from `.ksd` text) |
| style and geometry, save, reload, compare | browser scenario S: resized lane, placed and sized shape, bent line, moved label, styled line |
| Write with comments, a draw edit, comments kept | `doc-sync.test.ts` "syncSource leaves untouched text alone" (18 tests), browser scenario N |

## 2. Browser scenarios from the brief

Every scenario is a real pointer or keyboard workflow in Chromium unless the row says otherwise.

| ID | Scenario | Status | Test |
|---|---|---|---|
| A | create shapes in Draw | tested | `draw.spec.ts` "A: shapes dragged or clicked from the palette land exactly where they were put, with stable ids" |
| B | double-click and type character by character | tested | `draw.spec.ts` B (2 tests): one character at a time with caret and focus kept; Escape, click away, type to replace |
| C | drag at different zooms | tested | `draw.spec.ts` C |
| D | resize handles | tested | `draw.spec.ts` D |
| E | connect by dragging from a port | tested | `draw.spec.ts` E: live preview, highlighted target, attached at both outlines |
| F | reconnect an end | tested | `draw.spec.ts` F |
| G | drag waypoints | tested | `draw.spec.ts` G: the bend is saved and survives a reload |
| H | line color, weight, dash | tested | `draw.spec.ts` H: color and weight are choices; the pattern belongs to the relationship and is not |
| I | three lanes and flows across them | tested | `draw.spec.ts` I |
| J | resize lanes, move an action between them | tested | `draw.spec.ts` J, plus rename, reorder, duplicate, delete; and the same drag and move with horizontal lanes ("horizontal lanes") |
| K | align and distribute | tested | `draw.spec.ts` K: marquee and shift-click, one undo step each |
| L | copy and paste a fragment | tested | `draw.spec.ts` L |
| M | type `.ksd`, switch to Draw | tested | `flows.spec.ts` M |
| N | change geometry in Draw, return to Write | tested | `flows.spec.ts` N: a layout block is written, the author's lines stay untouched |
| O | text with a mistake | tested | `playground.spec.ts` "a parse error shows its line, then clears"; `session.test.ts` "text with a mistake in it" (3) |
| P | include and extend | tested | `flows.spec.ts` P (2 tests): direction, dashes, stereotype, clear of the shapes before any tidying |
| Q | class attributes and operations | tested | `flows.spec.ts` Q (2 tests): compartments and rows; a class that grows never grows over its neighbour |
| R | multiplicities | tested | `flows.spec.ts` R (2 tests): right ends, written to the text, no overlap on a short line |
| S | save and reload every property | tested | `flows.spec.ts` S (4 tests): activity, class, use case, and shape identity through the project file |
| T | export SVG, PNG, PDF | tested, and looked at | `flows.spec.ts` T (4 tests): each format in both looks for three diagram types is the file the dialog described; 2x PNG is exactly twice 1x. The files were looked at in the gallery (section 4) |
| U | old `v=1` embed | tested | `embed.spec.ts` (8), `host.spec.ts` (6), `fixtures.spec.ts` (38): the v1 hash, the host messages, theme sync, steps |
| V | a large diagram | tested, measured | `flows.spec.ts` V; numbers in section 3 |
| W | back, refresh, restore | tested | `flows.spec.ts` W (3 tests) |
| X | line styling in both looks at export size | tested, and looked at | `flows.spec.ts` X: color, weight and dashes are in the exported file in both looks |

The tests for M to X found six defects when they were first written. All six are fixed and the tests
that pinned them now pass:

1. A line made by dragging between two close use cases was 0.38 in long, with its stereotype across
   the outlines. An edit that newly crowds a shape now pushes it over just far enough.
2. End texts overlapped on a short association. Same fix: the two classes are given room for them.
3. A class that grew as members were added grew over the class beside it. Same fix.
4. A project file did not bring shape identities back. It does now, and hostile or shared identities
   in a file are dropped.
5. A 2x PNG could be one pixel off the size the dialog showed.
6. Clicking a tab added no history entry, so the back button left the tool. A change of view is now
   an entry; back never brings back older text.

Browser tests beyond the lettered scenarios:

| What | Test |
|---|---|
| A line's label edited in place, dragged off the line and reset | `draw.spec.ts` |
| A lane renamed, reordered, duplicated and deleted | `draw.spec.ts` |
| Keyboard in Draw | `draw.spec.ts` "keyboard: Tab walks shapes ..." |
| Horizontal lanes: a row's divider dragged, an action moved to another row | `draw.spec.ts` "horizontal lanes" |
| A build-up step set in the panel, for one shape and for many | `draw.spec.ts` "a shape's step is set in the panel" |
| Undo and redo keys after a click in the properties panel; a text field keeps them for itself | `draw.spec.ts`. Checked to fail without the fix |
| Tabs, deep links, examples, the reference's house rules | `playground.spec.ts` (10) |

## 3. Performance, measured

Scenario V builds a diagram, drags one shape through 48 pointer steps, and records every animation
frame. Latest run of that test on its own, headless Chromium on this desktop, timed by the clock:

| Diagram | A frame that redraws, median | 95th percentile | The drop |
|---|---|---|---|
| 100 shapes, 150 lines | about 36 ms | about 41 ms | about 230 ms |
| 50 shapes, 75 lines | about 21 ms | about 24 ms | about 95 ms |

Run beside the other browser tests, which share the processor, the 50-shape frames come out at 33 to
46 ms with a 95th percentile near 80 ms. The test fails if the median reaches 50 ms or the 95th
percentile 120 ms.

During a drag above 60 shapes only the lines touching the dragged shape are re-routed. The drop
re-routes everything and writes the text. It used to take about 980 ms at 100 shapes and 310 ms at 50.
Two things were found and fixed:

- The layout check worked out every polygon's bounds again for every label (about 650 ms of the 980).
  It now works them out once and only looks at ink near a label: about 30 ms. Its output was compared
  before and after on all 18 fixtures in both looks, as written and with the shapes squeezed together
  so they collide (216 cases, 1,137 errors reported): byte for byte the same.
- The write view redrew its figure after every draw edit while it was hidden. It now waits until it
  is shown.

What is left: about 28 redraws a second while dragging in a 100-shape diagram. That keeps up with the
pointer but is not smooth, and it has not been run on a slower machine. Each automatic layout of 100
shapes takes about 80 ms, and a drop does two.

Load size, gzipped, from the production build:

| What loads | Size |
|---|---|
| An embed: script | about 71 KB (parser 7, layout, router, both looks and checks 45, download 16, the rest 3) |
| An embed: CSS | 2.5 KB |
| The tool, before any view: script and CSS | about 131 KB |
| The write editor (CodeMirror), on first use | 123 KB |
| The draw view, on first use | 29 KB |
| PDF export, on first PDF | 158 KB |
| Fonts as data for export, on first export | 334 KB |

At the baseline an embed's script was about 46 KB. The growth is the router, classes, lanes and the
second look. Loading the download code on demand was tried and saved 2.4 KB, so it was left as it is.

## 4. Visual review

| What | Where | Status |
|---|---|---|
| The tool before the work | `docs/revamp/baseline/` (20 screenshots; v1 exports at three widths) | looked at |
| The tool now: write, draw, syntax; light and dark; 1440, 820 and 390 px; selections, a linked line, a mistake, the export dialog | `docs/revamp/after/` (33 screenshots, `node scripts/capture-ui.mjs`) | looked at, each kind of view in both themes |
| Every fixture exported as SVG, PNG and PDF in both looks, with a sheet at 600, 420 and 240 px | `docs/revamp/gallery/` (18 fixtures, 36 exports, `node scripts/gallery.mjs`) | looked at: every sheet. What still reads less than well is listed in `EXPORT_QUALITY_AUDIT.md` section 6 |
| The nine v1 fixtures in the embed, light and dark, 1280 and 375 px | `test-results/*.png`, written by `fixtures.spec.ts` on every run | tested for zero layout errors and 13 px labels; a sample looked at in each theme and width after the last run |
| SVG in a second renderer | librsvg, by the gallery script | looked at |
| PDF in a second renderer | pdf.js, by the gallery script | looked at |

## 5. Accessibility

| Check | Status |
|---|---|
| axe-core 4.10 (WCAG 2.0 to 2.2 A and AA, best practices) over write, draw with findings open, draw with a selection, the syntax, the export dialog and the embed; light and dark; 1440 and 390 px | run by hand, not part of `npm run test:e2e`. No contrast failures. Still reported: the code editor's scroller as not focusable (the editor's text takes focus and the arrow keys scroll it), and three page-level notes on the embed that are about a top-level page, not a figure in a frame |
| Tabs with real tab semantics and arrow keys | tested (`playground.spec.ts`) |
| Keyboard in Draw: Tab walks shapes, arrows nudge, Escape lets go, shortcuts leave fields alone | tested (`draw.spec.ts`) |
| Step controls take arrow keys | tested (`embed.spec.ts`) |
| Severity and state never by color alone | looked at; the linked shape and the findings list carry words, weight or an underline as well |
| Text alternative for a figure | tested (`describe.test.ts`), shown under "describe this figure" |
| A line can be started from the keyboard | no: there is no keyboard way to start a line in Draw. The text view is the keyboard path |
| A screen reader | not verified |
| Reduced motion | in the code (one transition, covered by the global rule); not verified in a browser |

## 6. Security

| Check | Status |
|---|---|
| Hostile labels render literally and open no dialog, in the embed and in the tool | tested (`embed.spec.ts`, `playground.spec.ts`) |
| Messages from a wrong source are ignored, both ways | tested (`host.spec.ts`) |
| A project file is untrusted: unknown kinds, bad numbers, style values outside the theme roles, malformed or shared identities | tested (`session.test.ts` "the project file") |
| Exported SVG stands alone: plain color attributes, no classes, no CSS variables, no script, image or foreign object | tested (`render.test.ts` "portable svg", `flows.spec.ts` T) |
| The production content security policy holds with the editor, the canvas and every export | tested: all 102 browser tests run under it |

## 7. Not covered

Said plainly, so nobody reads a pass count as more than it is.

- **Other browsers.** Everything ran in Chromium. Firefox and Safari: not verified.
- **Touch.** Pinch and one-finger pan are in the code. Not run on a device.
- **Third-party programs.** No export was opened in PowerPoint, Word, Keynote, Google Slides,
  Inkscape, Illustrator or Figma. librsvg and pdf.js stood in. Printing: not verified.
- **The write editor's completions, find and replace, and tidy** have no browser test. Cursor to
  figure linking is looked at in a screenshot only.
- **Screenshot comparison.** There is no pixel-diff regression test. The gallery's SVG files are the
  regression record: they are deterministic, and the 34 from before the last layout change came out
  byte for byte the same after it.
- **The Python fixtures.** `npm run fixtures` needs python3, which this machine does not have. The
  fixtures were not regenerated and not edited.
- **The v2 notation rules against the UML 2.5.1 text.** They follow the reviewer's rules and common
  teaching practice; nobody has read them against the specification.
- **Slower machines.** The frame times are from one desktop.
