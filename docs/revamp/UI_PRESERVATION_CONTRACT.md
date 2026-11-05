# UI preservation contract

The owner redesigned the tool's interface shortly before the revival and wants it kept. This
document records that design as it stood at commit `d30af12`, says what must stay, what may be
improved in place, and what is rebuilt, and then lists what did change.

Sources: the baseline screenshots in [`baseline/`](baseline/) (write, draw and the syntax; light and
dark; 1440, 820 and 390 px wide; a selected node and a selected line), `reference/ksyt.css` (the
site's tokens and components), and `src/play/play.css` at `d30af12` and now.

**What was and was not looked at.** Every statement about the baseline below was checked against
the baseline screenshots or the v1 CSS. The statements about the current app come from the current
code and from `CONTINUE.MD`. No after-screenshots are embedded here, and none were looked at while
writing this. They are produced by `node scripts/look.mjs .scratch/look` against a running
`npm run dev` (it saves `write.png` and `draw.png` at 1440 px, light). `CONTINUE.MD` says the draw
view was reviewed in light mode at desktop width only; its dark mode and phone widths have not been
looked at by anyone.

## 0. Superseded for an active draw view (2026-11-05)

The owner's handoff of 2026-11-05 (`prompts/CHALK_OPUS_UX_HANDOFF_2026-11-05.md`) asks for draw
to work like a diagramming application, not a section of a page. Where this contract's page-shell
rules conflict with that, they no longer apply **while draw is the current view**. Write, the
syntax view and the embed keep every rule below unchanged, and the page shell comes back as soon as
the reader leaves draw.

Superseded in draw only:

- **Item 4 (header, tool name, description, meta line)** and **item 12 (footer)**: hidden in draw.
  The views row carries a small mark and the name "Chalk" instead; the theme choice moves into the
  draw bar's "more" menu (it still drives the same `ksyt-theme` setting).
- **The 80rem page width, the gutters and the page scroll**: draw fills the window (`100dvh`),
  edge to edge, and the page itself never scrolls. Only the canvas pans, and the side panels scroll
  inside themselves.
- **Item 5 (views row)**: still three words with the pen underline and tab semantics, but in draw it
  is a thin bar with a solid hairline under it, and the document bar sits at its right.
- **Item 6 ("words, not icons")**: the draw tool bar and the selection bar use small glyphs drawn
  for Chalk (`src/play/draw/icons.ts`, a few pen strokes each, `currentColor`), not an icon pack.
  Each one keeps its word as its accessible name, and shows the word beside the glyph while there is
  room. Controls in the bar are 40 px tall (36 px in the selection bar), below the 44 px page rule.
- **Item 13 (breakpoints)**: in draw, a narrow window keeps the canvas full width and lays the
  library and the properties over it on demand, instead of stacking them above and below.

Still in force everywhere, draw included: the three fonts and their jobs; color roles, never hex;
the green accent as the one accent; no shadows, gradients, all-caps, emoji or icon packs; state and
severity never by color alone; the voice of labels and status lines; the checks' wording.

## 1. The design language at the baseline

### Character

A page on kyleschlaepfer.com, not an app shell. Warm off-white paper, charcoal handwriting, one
forest-green accent, pen strokes for emphasis, a lot of open space. No cards, panels with drop
shadows, gradients, icon bars or colored badges. Controls are words.

### Fonts

| Family | Token | Used for |
|---|---|---|
| Kalam (300, 400) | `--font-hand` | the wordmark, the tool's name, view names, section headings, labels, buttons, side notes, status lines, the text in a diagram |
| Atkinson Hyperlegible Next (400, 700) | `--font-body` | prose: the line under the name, the syntax reference, finding details, form field values |
| Atkinson Hyperlegible Mono (400) | `--font-mono` | the diagram text, code blocks and inline code |

Sizes are tokens: `--text` 18 px body, `--text-sm` 16 px, `--hand-sm` 20 px (labels, buttons,
notes), `--hand` 24 px (view names, section headings), `--hand-xl` for the tool's name (clamped,
2.25 to 3.5 rem). Kalam is never set under 18 px on the page because it runs small.

### Color roles

Colors are roles from `reference/ksyt.css`. A component names a role, never a hex value.

| Role | Light | Dark | What it is for |
|---|---|---|---|
| `--page` | `#FAFAF6` | `#1E2521` | the page |
| `--page-2` | `#F3F3EC` | `#262E29` | inset surfaces: the text box, fields, code blocks, palette buttons |
| `--ink` | `#242B27` | `#ECEAE2` | all default text and linework |
| `--ink-2` | `#606A63` | `#A9B2AB` | graphite: side notes, labels above fields, status lines, the footer |
| `--accent` | `#256B4A` | `#7CC39A` | forest green: quiet buttons and links, the pen underline on the current view |
| `--accent-strong` | `#184C36` | `#A8DCBD` | hover, focus outlines |
| `--wash` | `#DCEBDF` | `#2B4536` | the primary button's fill, text selection |
| `--terra`, `--terra-ink` | `#C77859`, `#9C4A31` | `#E3A086`, `#EBAF97` | the rare second accent: marks, and error text |
| `--rule` | `#C9CCC2` | `#46514A` | hairlines on working chrome: field borders, dashed dividers |

**The green accent has one meaning per view:** where you are, and what you can press. At the
baseline it marks the current view (the underline), the current theme, quiet buttons and, in the
draw view, the selected shape.

Dark is the "chalkboard": the same roles, re-valued. It follows `prefers-color-scheme` unless
`<html data-theme>` says otherwise. The light and dark screenshots show the same layout.

### Spacing and width

An 8 px scale (`--s-1` 0.5 rem to `--s-8` 4 rem). The content column is `--wide` (80 rem on this
page) with a fluid gutter (`--gutter`, 1 to 2 rem). At 1440 px the screenshots show wide margins on
both sides and generous gaps between sections. Functional boxes use a 6 px radius and a 1.5 px
border in `--rule`.

### Header and wordmark

Top left: a small pen-drawn face (the narrator's head) and "kyle schlaepfer" in Kalam, one link to
the main site (`.wordmark`). Nothing else in the header: no navigation bar, no buttons.

### The tool's name and what it does

- The name, "Chalk", in Kalam at `--hand-xl`, with "(beta)" beside it, small and graphite.
- One sentence of prose under it in the body font.
- A meta line in light Kalam, graphite, parts separated by a middle dot: "use case, activity,
  flowchart · nothing leaves your browser; the link is the file".

### The views row

Three views as words in a row: "write", "draw", "the syntax" (`.views-list`, `.views-tab`). Kalam,
24 px, charcoal. The current one has a green pen stroke under it (a mask of `--stroke-underline`
filled with `--accent`). It is a real tab list (`role="tablist"`, `aria-selected`). A 1 px dashed
rule in `--rule` runs under the row across the full width. Each tab is at least 44 px tall.

### Buttons

Two kinds, both Kalam, both at least 44 px tall (`.btn`, `.btn-quiet` in `ksyt.css`).

- **Primary** (`.btn`): charcoal words on the green wash, no border, a slightly lopsided radius
  "like a marker swipe". One per group: "copy embed code", "connect two shapes".
- **Quiet** (`.btn-quiet`): green words, no box: "copy link", "copy for the site", "download SVG",
  "undo", "start over", "delete", "swap ends". Disabled ones turn graphite.

Icons are rare, pen-drawn, colored by the text, and always beside a word (the download arrow on
"download SVG"). There is no icon-only button.

### Lists, not cards

- The draw view's controls run down the left as a plain list of sections ("diagram", "shapes",
  "connect", "selected"), each a Kalam heading, separated by dashed rules. No boxes around them.
- The syntax view has "on this page" as a plain list of graphite links on the left.
- The only bordered boxes are working surfaces: the diagram text, form fields, and the checks panel
  (1.5 px rule, 6 px radius, rows divided by dashed rules).

### Write, at the baseline

Two columns ([`baseline/write-light-1440.png`](baseline/write-light-1440.png)).

- Left: the label "diagram text" (graphite Kalam); the text in a box filled with `--page-2`,
  bordered in `--rule`, mono type; then the actions in one row (the primary "copy embed code", then
  the quiet ones); then a status line in graphite Kalam: "Use-case diagram, 8 nodes, 5 edges,
  notation check: pass".
- Right: the figure, the "describe this figure" disclosure, and the checks panel: "notation check:
  pass", "layout check: pass", a line each for the result, "checked as uml-inspired".

### Draw, at the baseline

A 16 rem column of controls and the figure
([`baseline/draw-light-1440.png`](baseline/draw-light-1440.png)).

- Controls: "diagram" (type, title, id, "undo", "start over"); "shapes" (a note, then the shapes as
  soft buttons filled with `--page-2`); "connect" (a line type, then "connect two shapes");
  "selected" (a form for the selected thing, or "click a shape or a line").
- The drawing: the figure itself between two dashed rules, at its natural size, with a status line
  under it.
- Selected ([`baseline/draw-selected-node-light-1440.png`](baseline/draw-selected-node-light-1440.png)):
  the shape's strokes and text turn green, and the form for it grows under "selected", far from the
  shape. The focused drawing area has the site's focus outline.

### The syntax, at the baseline

A sticky list of sections on the left, the reference on the right at reading width (`--measure`,
68 ch): Kalam headings, body prose, code blocks on `--page-2`, and a quiet "load this in the
playground" button under each example
([`baseline/syntax-light-1440.png`](baseline/syntax-light-1440.png)).

### Footer and theme switch

One row: a graphite note on the left ("diagrams are checked with the same rules as the videos. If
one gets flagged, that's the point."), then "kyleschlaepfer.com", "source on GitHub", and the theme
switch: three quiet words, "light", "dark", "system", the current one in charcoal with the same pen
underline as the views (`.theme-switch`).

### Responsive behavior

| Width | Write | Draw | The syntax |
|---|---|---|---|
| 1440 px | two columns | controls left, figure right | list left, reference right |
| 820 px | still two columns (it stacks under 48 rem); the figure scrolls sideways with the note "wider than the screen: scroll sideways" | stacked (under 56 rem): controls first, laid out as a wrapping grid, then the figure | stacked (under 56 rem): the section list becomes a wrapping row with a dashed rule under it |
| 390 px | one column: text, actions, status, figure, checks | one column: all the controls, then the figure, shrunk to fit | one column |

Under 34 rem the wordmark and the view names get smaller and the footer tightens. At 390 px the
checks panel lists a `PHONE_LEGIBILITY` warning for each label of the wide example
([`baseline/write-light-390.png`](baseline/write-light-390.png)): the tool tells the author when a
figure is too small to read on a phone.

### Voice

Short, plain, lowercase handwritten labels: "copy embed code", "describe this figure", "start
over", "click a shape or a line". Status lines are sentences about the diagram, not codes.
Severity is spelled out ("warning"), never a colored dot.

## 2. Preserve

These do not change. A new library's defaults are not a reason to touch any of them.

1. The three fonts and their jobs. No fourth family.
2. The color roles and their values, light and dark. Components name roles, never hex.
3. The green accent as the one accent, with its meanings: where you are, what you can press, what
   is selected.
4. The header with the wordmark alone, the tool's name with "(beta)", the one-line description and
   the meta line.
5. The views row: three words, the pen underline on the current one, the dashed rule under it, tab
   semantics.
6. The two button kinds and their look. Words, not icons. At least 44 px tall in the page chrome.
7. Lists, not cards. Hairlines only on working chrome. A 6 px radius and a 1.5 px rule border on
   working boxes.
8. No shadows, gradients, all-caps labels, emoji or icon packs.
9. The write view's shape: text on the left with its label, actions and status line; the figure,
   its description and its checks on the right.
10. The checks panel and the wording of its findings.
11. The syntax view as it is.
12. The footer and the theme switch, including the stored choice (`ksyt-theme`).
13. The breakpoints' intent: two columns where there is room, one column on a phone, nothing that
    needs a sideways scroll except the figure itself, which says so.
14. The voice of the labels and status lines.
15. State and severity are never shown by color alone.

## 3. May improve without wholesale redesign

Changes are allowed here when a new function needs them. They use the existing tokens, fonts and
button kinds, and they keep the surface where it is.

1. **The inside of the write view's text box.** A real editor may replace the `textarea`, inside
   the same frame: same fill, border, radius, type and minimum height. It may add a line-number
   gutter, highlighting in role colors, underlines for mistakes, a completion list and a search
   bar, all styled from the tokens.
2. **A few controls beside "diagram text"** for the editor's own actions.
3. **The views row may carry the document's actions** (new, open, save, export) at its far end, as
   quiet buttons, so they are reachable from every view.
4. **The draw view's side list and forms.** Sections may be added, removed, narrowed or moved to
   keep the canvas dominant. Fields keep the `.draw-field` look.
5. **Dialogs and menus** needed by new functions (export, file menus), built from the same parts:
   Kalam headings, quiet and primary buttons, rule borders, no shadow.
6. **Status lines** may say more (what a gesture did, what was held in place) in the same voice.
7. **The description line and the meta line** may name what the tool newly does.
8. **Fixes to the preserved rules themselves**, where the baseline broke one (selection by color
   alone, see below).

## 4. Rebuild substantially

**The draw view's canvas and its interaction model.** At the baseline the "canvas" was the figure,
cropped to its content and rebuilt after every edit (see `BASELINE_AUDIT.md`, concerns 1 to 10). It
is replaced by a real workspace:

- a bordered surface that takes most of the view, with a quiet dot grid;
- pan and zoom over a coordinate system that stays put;
- selection shown by an outline and handles, not by recoloring the shape;
- ports, a live line preview, snap guides, resize handles, bend handles;
- text edited where it is;
- a toolbar for the view's own tools, and a properties panel for whatever is selected.

It may look different from the baseline because its job is different. It must still read as part of
this page: the same roles, the same fonts, rule borders, no shadows, words for buttons. The canvas's
controls are specified in [`UX_DESIGN_SYSTEM.md`](UX_DESIGN_SYSTEM.md).

## 5. What actually changed

A comparison of the baseline with the app at the checkpoint (`1a1e46f`), from `CONTINUE.MD`
section B and the current `src/play/`. "Unchanged" means the code that builds it is the same.

### Unchanged

- Header, wordmark, the name with "(beta)", footer, footer note, theme switch (`src/play/main.ts`
  builds them with the same code).
- The views: the same three, the same labels, the same underline (`src/play/tabs.ts` has no
  differences).
- The syntax view's layout and styles. Its content still describes v1 syntax and is due an update.
- Fonts, tokens, button classes, the checks panel, the figure's description, the phone rules.
- Write's four actions and their order: "copy embed code", "copy link", "copy for the site",
  "download SVG".

### Changed inside a preserved surface (section 3)

| Surface | Baseline | Now |
|---|---|---|
| The description line | "A few lines of text, and you get a use-case, activity or flow diagram..." | "Write a few lines of text or draw it yourself, and you get a use-case, activity, class or flow diagram..." |
| The meta line | "use case, activity, flowchart" | "use case, activity, class, flowchart" |
| The views row | the three views, with the dashed rule on the list | the views on the left and a document bar on the right ("new", "open", "save", "export", quiet buttons in graphite), sharing one row and one dashed rule (`.views-row`, `.doc-bar`). "new", "open" and "save" open a small menu (`.menu-list`) |
| The write view's text box | a `textarea`, resizable by its corner | a CodeMirror editor in the same frame (`--page-2` fill, 1.5 px rule border, 6 px radius, mono 0.95 rem, 24 rem minimum height). It scrolls inside itself above 70% of the window height. New inside it: a line-number gutter, highlighting, an active-line tint, underlined mistakes with marks in the gutter, a completion list, a search bar |
| Beside "diagram text" | nothing | two small quiet buttons: "tidy" and "find" |
| A mistake in the text | the figure was replaced by an error card | the last figure that worked stays, under a dashed terracotta note ("the text has a mistake on line N, so this is the last version that worked"). The error card remains only when there has never been a valid figure |
| The figure in write | not interactive | the part the cursor's line declares is tinted green; clicking a part goes to its line |
| "download SVG" | a file that followed the viewer's system theme, no background | a self-contained file in the theme on screen, with the page background |

### Rebuilt (section 4): the draw view

| Part | Baseline | Now |
|---|---|---|
| Left column | 16 rem: "diagram", "shapes", "connect", "selected" | 11.5 rem: "shapes" and "lines" only |
| Shapes | click adds below the picture; drag drops onto the picture | drag onto the canvas, or click a shape and then click where it goes; the armed shape shows a check mark and an outline |
| Connecting | a line type, then "connect two shapes", then two clicks | drag from a dot on a shape to another shape. "new lines are" picks the meaning, default "the usual for the two shapes" |
| Above the canvas | nothing | a toolbar of quiet buttons: "undo", "redo", zoom out, the zoom percentage, zoom in, "fit", "snap to grid", "tidy up" |
| The canvas | the figure between two dashed rules, natural size | a bordered box (1.5 px rule, 6 px radius), `clamp(30rem, 74vh, 64rem)` tall, dot grid, pan and zoom |
| Selection | the shape turns green | a dashed green outline with handles; the shape keeps its own colors |
| The form for the selection | under "selected" in the left column | a "properties" panel floating over the canvas's top right corner (17.5 rem), which can be hidden. On narrow screens it sits under the canvas |
| Diagram settings (type, title, id) | under "diagram" in the left column | in the same properties panel when nothing is selected |
| "start over" | a quiet button in the left column | gone; "new" in the document bar replaces it |
| A mistake in the text | an empty state, nothing to draw | the last version that worked, the canvas border dashed, a note above it, editing off until the text is fixed. The empty state remains only when there has never been a valid diagram |
| Phone width | all the controls, then a shrunken figure | the palette, then the canvas (`clamp(24rem, 62vh, 40rem)` tall), then the properties panel. Written in CSS; not yet looked at |

### Added

- **The export dialog** (`.export-dialog`): a modal with a preview of the file on the left and the
  choices on the right (format, "drawn as", background, and "more"). Kalam heading, radio choices,
  one primary "download", quiet "copy" and "close". No shadow; the backdrop is the ink role at 45%.
- **A local draft**, with no chrome of its own. It shows only as "the diagram you had before" under
  "open", and in a status line if the browser refuses to store it.

### Departures from the baseline worth the owner's eye

1. The document bar in the views row. It is the largest change outside the draw view. The
   alternative was a second row above or below the views.
2. The draw view's diagram settings moved from the always-visible left column into the properties
   panel, where they show only when nothing is selected.
3. "start over" became "new" (a menu of starting points), and it now lives outside the draw view.
4. Selection no longer recolors the shape. This fixes a broken house rule (state by color alone)
   but it does look different.
5. Minimum heights inside the draw view's toolbar, panel and editor tools are 32 to 40 px, under
   the 44 px used in the page chrome, to keep the canvas large. The palette buttons keep 44 px.

### Not verified

- No after-screenshot was compared with a baseline screenshot for this document.
- The draw view in dark mode and at 820 and 390 px has not been looked at (`CONTINUE.MD`, known
  problem 11).
- The embed's look after its move to the new pipeline was not compared with the baseline here. Its
  browser tests pass at the checkpoint.
- Firefox and Safari.
