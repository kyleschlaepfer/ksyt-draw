# UX design system: how the new surfaces use it

Chalk did not get a new design system in the revival. It got new surfaces (a real canvas, a floating properties panel, an export dialog, a code editor) built from the one it already had. This document says which tokens, fonts and patterns each new surface uses, with the class names and behaviors as they are in the code at the checkpoint (`1a1e46f`).

Sources: `reference/ksyt.css` (tokens, buttons, notes), `src/play/play.css` (every class named here), `src/play/draw/canvas.ts`, `src/play/draw/index.ts`, `src/play/draw/inspector.ts`, `src/play/draw/inline-edit.ts`, `src/play/export-dialog.ts`, `src/play/editor/editor.ts`, `src/play/write.ts`, `src/play/files.ts`, `src/play/app.ts`, `src/play/tabs.ts`.

What this document is not: a visual sign-off. The styles are described from the CSS and the code. Section 11 says what was looked at and what was not.

Companion documents: `UI_PRESERVATION_CONTRACT.md` (what had to stay, what changed), `ARCHITECTURE_DECISIONS.md` (why the canvas is purpose-built, why shapes hold still).

## 1. Tokens and roles

Every color on the new surfaces is a theme role from `reference/ksyt.css`. A search of `src/play/` for hex colors, gradients and `text-transform` finds none. There is no `box-shadow` either (the one the checkpoint had is gone; section 10).

| Role | Light | Dark | Used on the new surfaces for |
|---|---|---|---|
| `--page` | `#FAFAF6` | `#1E2521` | canvas background, panel and dialog background, handle and port fill |
| `--page-2` | `#F3F3EC` | `#262E29` | form fields, palette buttons, editor background, export preview ground |
| `--ink` | `#242B27` | `#ECEAE2` | text, the diagram itself |
| `--ink-2` | `#606A63` | `#A9B2AB` | field labels, notes, comments in the editor, the "properties" toggle |
| `--accent` | `#256B4A` | `#7CC39A` | quiet buttons, selection, the pen underline, new line previews, the in-place text field border |
| `--accent-strong` | `#184C36` | `#A8DCBD` | handle and port outlines, focus outlines, keywords in the editor |
| `--wash` | `#DCEBDF` | `#2B4536` | hover and armed fill on palette buttons, marquee fill, active line in the editor |
| `--terra` | `#C77859` | `#E3A086` | snap guides, the stale note's border, warning underlines |
| `--terra-ink` | `#9C4A31` | `#EBAF97` | a refused connection, error underlines, strings in the editor |
| `--rule` | `#C9CCC2` | `#46514A` | borders, the grid dots, dashed dividers |

The pattern across all of it: green means "this is yours right now" (selected, armed, focused, about to connect). Terracotta means "look here" (a guide line, a mistake, a refused drop). Neither is ever the only signal; see section 9.

Other tokens in use:

- Spacing: `--s-1` to `--s-6` for gaps and padding. Small inner gaps in the panel and palette are written in `rem` directly (0.2 to 0.75rem).
- Type sizes: `--text-sm` (16px) for form fields, `--hand-sm` (20px) for handwritten labels and buttons, `--hand` (24px) for section headings.
- Motion: one transition in all of `play.css`, the palette button's background on hover (`--dur-fast`, `--ease-out`). The reduced-motion rule in `ksyt.css` cuts it to nothing.
- Borders: 1.5px solid `--rule` with a 6px radius for boxes (canvas, panel, dialog, fields). 1px dashed `--rule` for dividers inside a box. Palette buttons keep the uneven pen-style radius of `.btn`.
- No shadows and no elevation. The floating panel and the dialog sit on the page with a border, not a shadow.

## 2. Fonts

Three families, as before, each with one job.

| Family | Token | Where on the new surfaces |
|---|---|---|
| Kalam | `--font-hand` | section headings ("shapes", "lines", "export"), field labels, palette buttons, toolbar buttons, checkboxes, radio labels, the "properties" toggle, sketch-look diagram text and its in-place field |
| Atkinson Hyperlegible Next | `--font-body` | what you type into a field, the hint under an export choice, precision-look diagram text and its in-place field |
| Atkinson Hyperlegible Mono | `--font-mono` | the write editor, id fields (`input.mono`), class member rows (`.member-row input`) |

The rule of thumb in the code: the label for a thing is handwritten, the value of a thing is prose, and anything that is `.ksd` text is mono.

The in-place text field takes the font of the shape it edits: hand for sketch, body for precision, scaled by the zoom, never below 9px (`inline-edit.ts`, `index.ts` `editText()`).

## 3. Page chrome: the document bar and menus

The document bar (`.doc-bar`, `role="group"`, `aria-label="document"`, built in `files.ts`) sits above both views. It holds four quiet buttons:

| Button | Opens |
|---|---|
| new | a menu of starting diagrams |
| open | "a file from this computer", "the diagram you had before" |
| save | "project file" (`.chalk.json`), "diagram text" (`.ksd`) |
| export | the export dialog (`#open-export`) |

A file dropped on the page opens it.

Menus (`.menu`, `.menu-list`, `.menu-item`, `.menu-hint`, built by `menuButton()` in `app.ts`) are lists, not cards: a handwritten word and a quieter hint line under it. They carry `role="menu"` and `role="menuitem"`. The same menu builds "tidy up" in the draw toolbar.

## 4. The write view

Layout is the v1 two columns (`.play`: editor left, figure right, one column under 48rem).

**Editor chrome.** A head row (`.play-editor-head`) holds the label "diagram text" (`.play-editor-label`) and two quiet buttons in `.play-editor-tools`: "tidy" (title: "put every line in its standard form (Shift+Alt+F)") and "find" (title: "find and replace (Ctrl+F)"). Under the editor: the v1 actions row ("copy embed code", "copy link", "copy for the site", "download SVG") and the status line.

**The editor.** CodeMirror 6 in a shadow root on `.ksd-editor`, styled only from tokens (`editor.ts`):

| Part | Style |
|---|---|
| Box | `--page-2` background, 1.5px `--rule` border, 6px radius, min-height 24rem, max-height 70vh |
| Text | mono, 0.95rem, line-height 1.5 |
| Focus | 3px `--accent-strong` outline, the same as every other focusable thing |
| Gutter | dashed `--rule` divider |
| Active line | `--wash` at 45% |
| Keyword | `--accent-strong`, bold |
| Type name | `--accent` |
| String | `--terra-ink` |
| Comment | `--ink-2`, italic |
| Invalid | wavy underline |

Until the editor's code arrives the text is shown in a plain `<pre class="play-editor-loading">`, so it can be read from the first paint.

**Findings in the text.** Each severity has its own line style and its own gutter mark, so none depends on color:

| Severity | Underline | Gutter mark | Message border |
|---|---|---|---|
| error | wavy, `--terra-ink` | filled square | solid |
| warning | dashed, `--terra` | hollow square | double |
| info | dotted, `--ink-2` | dot | dotted |

A message reads `severity: problem (rule_id)` and then `fix: ...` on the next line. Syntax problems use plain words from the `WORD` table in `editor.ts` ("mistake", "loose end").

**Text and figure point at each other.** The line the cursor is on marks its shape in the figure (`.is-linked`). Clicking a shape in the figure moves the editor to the line that declares it. In the editor the linked line gets `.cm-linked`: a wash and a 3px accent bar down its left edge.

**A mistake in the text.** The figure stays. Above it a note appears (`.stale-note`, `role="status"`): "the text has a mistake on line N, so this is the last version that worked". The note has `--terra-ink` text and a 1.5px dashed `--terra` border. It goes away by itself when the text is fixed. Only when there has never been a good version does the figure give way to the error card ("This diagram has a mistake in its text.").

## 5. The draw view

```
.draw-editor
  .draw-side            the rail: "shapes" and "lines" (.draw-sec)
  .draw-main
    .draw-toolbar       role="toolbar", aria-label="drawing tools"
    .draw-banner        only when the text has a mistake
    .draw-proposal      only while a tidy-up is being previewed
    .draw-stage
      .draw-canvas      the canvas
      .draw-inspector   the floating properties panel
      .draw-inline      the in-place text field, while editing
    .play-status        the status line
```

The rail is 11.5rem wide beside the canvas. Under 56rem it moves above the canvas and its sections sit side by side.

### 5.1 The rail

**shapes** (`.draw-palette` of `.draw-shape` buttons). Note under the heading: "drag one onto the canvas, or click it and then click where it goes". The buttons are words, not icons, at least 44px tall, with `cursor: grab`. The list changes with the diagram type.

Three ways to place a shape:

1. Drag it from the rail onto the canvas. Dropped anywhere else, nothing is added ("dropped outside the canvas: nothing added").
2. Click it, then click the canvas. Shift+click keeps placing; Escape or a second click on the armed button stops.
3. Focus it and press Enter or Space. The shape goes to the middle of what is on screen and the canvas takes focus.

The armed button has `aria-pressed="true"`: a wash fill, an accent border and a check mark character (U+2713) before its word.

**lines.** Note: "point at a shape, then drag from one of its dots to another shape". One select, "new lines are", defaulting to "the usual for the two shapes".

### 5.2 The toolbar

Quiet buttons, 40px tall, in three groups split by a 1px `--rule` separator (`.toolbar-sep`, hidden from assistive technology).

| Button | Title | Does |
|---|---|---|
| undo | undo (Ctrl+Z) | one step back in the session's history |
| redo | redo (Ctrl+Y) | one step forward |
| minus sign (`aria-label="zoom out"`) | zoom out (Ctrl+-) | zoom by 1/1.2 |
| 100% (`#draw-zoom`) | back to actual size (Ctrl+0) | shows the zoom; click for 100% |
| + (`aria-label="zoom in"`) | zoom in (Ctrl++) | zoom by 1.2 |
| fit | show the whole diagram (Ctrl+1) | fits the diagram, clear of the panel |
| snap to grid | keep shapes on an eighth-inch grid (hold Alt to place freely) | a toggle with `aria-pressed` |
| tidy up | hand shapes and lines back to automatic layout | a menu |

A pressed toggle gets the pen underline in `--accent` (the same `--stroke-underline` mask the views row uses) and its text goes from `--accent` to `--ink`. The zoom label uses tabular figures so it does not jiggle.

"tidy up" offers "the whole diagram", "what is selected" and "only the lines". Each hint says what it would do, or why it is disabled ("nothing is placed by hand"). Nothing is applied straight away: the canvas shows the result and a bar appears (`.draw-proposal`, dashed accent border): "This is what tidying gives." with "keep it" (`.btn`, focused) and "put it back" (`.btn-quiet`). Escape puts it back.

### 5.3 The canvas

`.draw-canvas` is a bordered box in `--page`, `clamp(30rem, 74vh, 64rem)` tall (`clamp(24rem, 62vh, 40rem)` under 56rem). It has `role="application"`, `aria-roledescription="drawing canvas"` and a label that teaches the keys: "drawing canvas: Tab steps through the shapes, arrows nudge, Enter edits text, Delete removes, Escape lets go". The SVG inside is hidden from assistive technology; what happens is spoken through the status line.

The diagram on the canvas is painted by the same code as the figure and the export, so a shape looks the same in all three.

| Element | Class | How it looks | Notes |
|---|---|---|---|
| Dot grid | `.grid-dot` | `--rule` dots on `--page` | one dot per quarter inch (24px at 100%); the spacing doubles while dots would be closer than 14px |
| Selected shape | `.sel` | 1.5px dashed `--accent` outline (dash 5 4), 5px outside the shape | |
| Selected line | `.sel-line` | a 6px `--accent` band at 28% along the line | |
| Resize handles | `.handle`, `.h-nw` and so on | 10px squares, `--page` fill, `--accent-strong` outline | eight per shape, two on a fork or join; each has its own resize cursor |
| Connection dots | `.port` | circles, `--page` fill, 2px `--accent-strong` outline; filled `--accent` and larger when live (`.is-on`) | on the shape under the pointer or the one selected shape; not on containers or notes; cursor `crosshair` |
| Line ends | `.end` | filled `--accent` circles | drag to re-attach an end |
| Elbow segments | `.seg`, `.seg-h`, `.seg-v` | small handles with a one-axis resize cursor | drag to slide a segment |
| Bend points | `.via` | open circles | drag to move, double-click to remove |
| Add a bend | `.mid` | smaller circle with a dashed outline, cursor `copy` | drag to make a bend |
| Snap guides | `.guide` | 1px dashed `--terra` (dash 4 3) | appear when an edge or center lines up with a neighbor |
| Marquee | `.marquee` | `--wash` at 35% with a dashed `--accent` edge | drag on empty canvas; Shift adds to the selection |
| New line preview | `.preview` | 2.5px dashed `--accent` (dash 7 5) | `.is-bad`: `--terra-ink`, dash 2 5 |
| Drop target | `.target` | 2.5px solid `--accent` outline | `.is-bad`: `--terra-ink`, dashed 3 4 |
| Ghost | `.ghost` | the real shape at 45% opacity | follows the pointer while placing |
| Lane dividers | `.divider.col`, `.divider.row` | col-resize or row-resize cursor | drag to resize a lane |

Overlay sizes are screen pixels whatever the zoom (`vector-effect: non-scaling-stroke`). A line's hit area is a transparent 14px stroke, so thin lines are easy to pick up.

**Cursors say what a drag will do:** `grab` over a shape, `pointer` over a line or a container, `crosshair` over a connection dot, `copy` while placing (`.is-placing`), `grabbing` while panning (`.is-panning`).

**Pointer behavior** (`canvas.ts`):

- Click selects. Shift+click adds or removes. A drag only starts after 4px.
- Dragging snaps to neighbors within 6 screen pixels and shows the guide. With "snap to grid" on it also snaps to an eighth of an inch. Alt switches snapping off for that drag.
- Dragging a handle resizes. Alt resizes from the center.
- Dragging from a connection dot starts a line. The far end snaps to a side of the shape under it.
- Double-click edits text in place.
- Ctrl or Cmd with the wheel zooms about the pointer (20% to 400%). The plain wheel pans, but only when the canvas has focus, so the page still scrolls past it. Shift+wheel pans sideways.
- The middle button, or Space and drag, pans.
- Touch: one finger on empty canvas pans, two fingers pinch. This is in the code and has not been run on a device.

**Moving one shape moves one shape.** The others hold their place. When the diagram had to shift to make room, the status line says so ("added the actor; 3 others stay put"). The one exception keeps the picture readable: a shape the edit newly crowds is pushed over just far enough, and the status line says "made room: 1 shape moved over" (decision 6).

### 5.4 Editing text in place

`.draw-inline` is a text field laid over the shape: `--page` background, 2px `--accent` border, 6px radius, the shape's own font at the canvas zoom. It is `.draw-inline-center` or `.draw-inline-left` to match how the shape sets its text, and it grows with what is typed. The label for assistive technology comes from the thing being edited.

Enter keeps the text. Shift+Enter makes a new line where the shape allows several. Escape gives up. Clicking away keeps it.

A class or interface edits one row at a time. A shape that has no text says so in the status line ("a fork has no text") and does not open a field.

### 5.5 The properties panel

`<aside class="draw-inspector" aria-label="properties">` floats over the top right corner of the canvas: 17.5rem wide, 0.6rem in from the edges, `--page` background, 1.5px `--rule` border, no shadow. "fit" keeps the diagram out from under it. Under 56rem it stops floating and sits below the canvas.

The head (`.inspector-head`) is one toggle (`.inspector-toggle`): the word "properties" followed by "hide" or "show". Collapsed (`.is-collapsed`), the panel shrinks to that toggle.

The body (`.inspector-body`) is a column of labelled fields (`.draw-field`: a handwritten label in `--ink-2` over a `--page-2` field at least 40px tall), rows of two (`.inspector-row`), checkboxes (`.draw-check`) and fold-away groups (`.inspector-section`, a `<details>` with a handwritten summary and a dashed rule above).

What it shows depends on the selection:

| Selection | Heading | Fields |
|---|---|---|
| nothing | diagram | type, title, id, runs, drawn as; under "more": checked as, narration, described as |
| one shape | the kind's name | kind, text, id, "stands on the" left or right (actors), attributes and operations (classes), description, inside; place and size (x, y, width, height in inches; "let it find its own place", "fit to its text"); build-up ("shows from step", a whole number, 0 is there from the start; open when the diagram has steps); look (fill, color, weight); delete |
| one line | line | what it means, label, multiplicities and roles, route, sides, reset route, reset label, swap ends; build-up; look; delete |
| several | N selected | align, space evenly, same size, build-up (empty with "mixed" when they differ), duplicate, delete |

Rules the panel follows:

- A field commits when you press Enter or leave it, never on each keystroke. One change is one step in undo.
- After a change the panel is rebuilt, and focus and the caret go back to the same field (`data-field`).
- Look choices are theme roles under plain names, never hex values. Fill: "page (default)", "wash", "none (see-through)". Color: "ink (default)", "graphite", "green", "dark green", "terracotta". Weight: "thin", "normal", "bold". The file stores the role (`accent`, `terra`); the theme decides the color.
- A line's pattern and its ends are not style choices. The panel says why: they are part of what the line means.
- Layout state is said in words: "Placed by hand: it stays here until you move it or let it go." or "Placed for you: it follows the layout until you drag it."
- Class members are rows (`.member-row`): a mono field, then "move up" and "remove". Emptying a row's field also removes it. A member that cannot be read is refused with the form to write ("can't read that member: write + name: Type or + name(params...").

### 5.6 When the text has a mistake

Draw goes read-only and says so three ways:

1. A banner above the canvas (`.draw-banner`, `role="status"`): "The text has a mistake on line N, so this is the last version that worked, and it can't be changed here until the text is fixed." followed by a "fix it in write" button.
2. The canvas border turns dashed (`.draw-stage.is-readonly`), and the grab cursors go back to the default.
3. The panel's fields are disabled under a note: "The text has a mistake, so nothing here can be changed until it is fixed."

Trying anyway gets "fix the text first: the drawing is showing the last version that worked".

If there has never been a good version, the canvas gives way to the empty state (`.empty-state`): the shrugging narrator, "The text has a mistake, so there's nothing to draw yet.", the parser's message, and "fix it in write".

## 6. The export dialog

A native `<dialog class="export-dialog">` opened with `showModal()`, labelled by its heading "export". `--page` background, 1.5px `--rule` border, 6px radius. The backdrop is a veil of `--page` at 78%, which quiets the page behind in light and in dark (an ink veil turned a dark page to fog). Two columns (preview 1.5, choices 1); one column under 48rem.

**The preview is the file.** `.export-preview` shows the same SVG the download will hold, as an image (alt: "the picture this export will save"), on `--page-2` with a dashed `--rule` border. A see-through export is shown on `--page` with a dotted `--accent` border instead (`[data-ground="clear"]`), so it can be told from a white one.

**The facts line** (`.export-facts`, `aria-live="polite"`) is plain numbers: pixel size and inches, "Smallest text Npx.", "Layout check: pass." or the count and the first problem. For a PDF on a fixed page it gives the page and the scale ("diagram at 62%"), and warns when that is under 60%. For a PNG over the pixel limit it says the largest the browser can make will be used.

**Choices** are radio groups (`fieldset.export-group` with a handwritten legend; `.export-choice` rows at least 36px tall; the hint in a `<small>` in the body font):

| Group | Choices |
|---|---|
| format | PNG "a picture: slides, documents, anywhere"; SVG "vector: web pages, design tools"; PDF "vector: print and reports" |
| drawn as | sketch "the pen style of the videos"; precision "crisp lines for formal documents" |
| background | white; off-white page; none (see-through); chalkboard |
| more: space around it | tight; normal; roomy |
| more: PNG size | 1x; 2x "sharp on slides"; 3x; 4x "print" |
| more: SVG text | letters "can be searched and retyped; other programs may swap the font"; shapes "looks the same in every program" |
| more: PDF page | the diagram's own size; US Letter; A4; 16:9 slide |
| more: which way up | landscape; portrait |

"more" is a `<details>` (`.export-more`). Groups that do not apply to the chosen format are hidden: PNG size for PNG only, SVG text for SVG only, PDF page for PDF only, which way up only for a fixed PDF page.

Defaults: PNG, 2x, white, normal. Choices are remembered with the workspace.

**Actions:** "download" (`.btn`, `#export-download`), "copy" (`.btn-quiet`; reads "copy picture" for PNG and "copy SVG text" for SVG; hidden for PDF), "close". Escape and a click on the backdrop also close it.

**The note line** (`.export-note`, `aria-live="polite"`): "making the PDF", "saved name.png", "copied the picture", "copied the SVG text", "the export failed: reason", "this browser wouldn't let the page copy that; download it instead".

## 7. Status line wording

Each view has one status line (`.play-status.note`, `aria-live="polite"`). It has a standing summary and it steps aside for a message, then comes back: after 5 seconds in write, 6 in draw.

| | Standing summary |
|---|---|
| Write | "Use-case diagram, 8 nodes, 5 edges, notation check: pass" with the finding count in brackets and ", layout: N errors" when there are any |
| Write, text broken | "line N: the parser's message" |
| Draw | "notation check: pass" with the finding count in brackets. Under it, when there are findings, "what the check found (N)" opens the list: severity, the problem, the smallest fix, and a "show it" button that selects what the finding is about on the canvas |

Messages are short, lowercase, past tense, and say what happened and what it cost:

| When | Says |
|---|---|
| undo, redo | "undone", "redone", "nothing to undo", "nothing to redo" |
| tidy the text | "tidied", "already tidy" |
| tidy up kept | "tidied (undo puts it back the way you had it)" |
| tidy up put back | "left as it was" |
| add a shape | "added the actor; 2 others stay put" |
| an edit that crowds a neighbour | "connected; made room: 1 shape moved over" |
| arm a shape | "click the canvas to place the actor (Shift+click keeps placing, Escape stops)" |
| start a line | "drag to the shape this line goes to" |
| Tab to a shape | its kind and its text: `actor "Customer"` |
| marquee | "3 selected" |
| Escape | "cancelled", "stopped placing", "nothing selected" |
| delete | "deleted it", "deleted 3 things; 2 shapes that were inside stayed, outside any container" |
| copy, paste | "copied 2 shapes", "pasted 2 shapes with new ids", "duplicated 1 shape with new ids", "nothing copied yet", "select a shape to copy" |
| snap toggle | "snapping to the grid", "placing freely; shapes still line up with their neighbours" |
| export | "exported name.png" |
| write actions | "copied the link", "downloaded the SVG" |

The voice rules these follow: no exclamation, no "successfully", no "error:" prefix. A refusal says what to do next ("fix the text first...", "download it instead").

## 8. Keyboard

Only what the code implements. "Mod" is Ctrl, or Cmd on a Mac.

### The views row (`tabs.ts`, unchanged from v1)

| Key | Does |
|---|---|
| Left, Right | previous, next view |
| Home, End | first, last view |

### Menus (`menuButton()` in `app.ts`)

| Key | Does |
|---|---|
| Down, Up | move through the items |
| Home, End | first, last item |
| Escape | close and return focus to the button |
| Tab | close |

### The write editor (`editor.ts`)

| Key | Does |
|---|---|
| Mod+Z | undo (the session's history, shared with Draw) |
| Mod+Y, Mod+Shift+Z | redo |
| Shift+Alt+F | tidy: put every line in its standard form |
| Mod+/ | comment or uncomment the line |

The editor also loads CodeMirror's stock keymaps for close-brackets, completion, search (Ctrl+F is named on the "find" button), lint, and its default keymap with its own Mod+Z, Mod+Y and Mod+U taken out. Those keys are CodeMirror's and are not listed one by one here.

### The canvas (`Canvas.key()`; only while the canvas itself has focus)

| Key | Does | Needs good text |
|---|---|---|
| Space (held) | pan mode: drag to pan | no |
| Escape | cancel the drag or stop placing; otherwise clear the selection | no |
| Mod+Z | undo | no |
| Mod+Shift+Z, Mod+Y | redo | no |
| Mod+A | select every shape (not containers) and every line | no |
| Mod+0 | zoom to 100% | no |
| Mod+1 | fit the diagram | no |
| Mod+= or Mod++ | zoom in | no |
| Mod+- | zoom out | no |
| Mod+C | copy | yes |
| Mod+X | cut | yes |
| Mod+V | paste (each paste lands a little further over) | yes |
| Mod+D | duplicate | yes |
| Delete, Backspace | remove the selection | yes |
| Tab, Shift+Tab | with a shape selected: next, previous shape. With nothing selected Tab leaves the canvas as usual | yes |
| Arrows | nudge the selection 0.05in (an eighth of an inch with snap to grid on). With nothing selected, an arrow selects the first shape | yes |
| Shift+Arrows | nudge a quarter inch | yes |
| Enter, F2 | edit the text of the one selected shape or line | yes |
| any character | start replacing the text of the one selected shape or line (not a class, an interface, or a shape with no text) | yes |

Modifiers during a drag: Shift+click adds to or removes from the selection; Shift on a marquee adds; Shift+click keeps placing; Alt switches snapping off; Alt on a handle resizes from the center.

### Around the canvas

| Where | Key | Does |
|---|---|---|
| A palette button | Enter, Space | place the shape at the middle of the view |
| The in-place text field | Enter | keep the text |
| | Shift+Enter | new line, where the shape allows it |
| | Escape | give up the change |
| A panel field | Enter | commit the field |
| The tidy-up preview | Escape | put it back |
| The export dialog | Escape | close |

## 9. State is never shown by color alone

| State | Color | And also |
|---|---|---|
| Current view | accent | the pen underline; `aria-selected` |
| Armed palette shape | wash, accent border | a check mark before the word; `aria-pressed` |
| Toggle on (snap to grid) | ink instead of accent | the pen underline; `aria-pressed` |
| Selected shape | accent | a dashed outline and square handles; the panel's heading; the status line on Tab |
| Selected line | accent band | filled end circles and bend handles; the panel's heading |
| Live connection dot | accent fill | larger radius |
| Connection that will be refused | terra-ink | a different dash on the preview; the target outline goes from solid to dashed |
| Snap guide | terra | a dashed line that only exists while aligned |
| Draw is read-only | none | the banner; the dashed canvas border; disabled fields with a note; default cursors |
| Figure is out of date | terra-ink text | the note's words; a dashed border |
| Finding severity in the editor | terra-ink, terra, ink-2 | wavy, dashed or dotted underline; square, hollow square or dot in the gutter; the severity word starts the message |
| See-through export | accent border | a dotted border instead of a dashed one; the page color behind it |
| Focus | accent-strong | a 3px outline (the canvas also changes its border) |

One exception is known and is listed in section 10.

## 10. Known departures and gaps

These are in the code at the checkpoint. They are listed so the owner sees them here, not in the product.

1. **Fixed: the linked shape in the write figure was marked by color only.** `.play-preview .is-linked` now also draws a heavier outline and underlines the label.
2. **Fixed: one `box-shadow`.** `.cm-linked` in `editor.ts` now draws its left bar with `border-left`.
3. **A check mark character.** The armed palette button uses U+2713 as its second signal. It is a text character, not an icon pack and not an emoji. If it reads wrong beside Kalam, the pen underline would be the in-house alternative.
4. **Fixed: undo keys in Draw needed canvas focus.** Mod+Z and Mod+Y now work anywhere in the draw view. In a text field that is being typed in they stay the field's own.
5. **Fixed: Draw showed only a count of findings.** It now lists them under the status line, and "show it" selects the shapes a finding is about.
6. **The canvas clipboard is in memory.** Copy and paste work inside Chalk, in one tab. They do not use the system clipboard.
7. **No keyboard way to draw a line.** A line is made by dragging from a connection dot. The keyboard can place, move, edit and delete shapes, and edit a selected line, but cannot start one. The text is the keyboard's way to add a line.
8. **Titles name Ctrl.** Button titles say "Ctrl+Z" and so on. The keys also work with Cmd; the titles do not say so.
9. **Found in the dark and phone review and fixed.** The editor's line numbers had no ground of their own, so long lines ran under them when the editor scrolled sideways. The zoom buttons were 18 px wide (now at least 32). A figure wider than the screen and the reference's long code blocks scrolled sideways without being reachable from the keyboard (they take focus now).
10. **The draw tab can't start a line from a shape back to itself.** Such lines are written in the text; Draw shows them and can bend, rename and delete them.

## 11. What was and was not verified

Read from the code and the CSS: every class, string, size and key in this document.

Looked at, on a production build (2026-11-05):

- **Screenshots.** `node scripts/capture-ui.mjs` takes write, draw and the syntax in light and dark at 1440, 820 and 390 px, plus a lanes diagram, a class diagram, a selected shape, a selected line, a linked line in write, a mistake in write, the export dialog and a selected shape on a phone. The 33 images are in `docs/revamp/after/`. Each kind of view was looked at in both themes; that review is what found items 9 and the foggy backdrop.
- **Browser tests.** 102 passing: the draw canvas driven by real pointer events, the export dialog and its files, save and reopen, refresh and the back button, and the write view.
- **Accessibility, by machine.** axe-core (WCAG 2.0 to 2.2 A and AA, and best practices) over write, draw with findings open, draw with a selection, the syntax, the export dialog and the embed, in light and dark at 1440 and 390 px. No contrast failures. What it still reports: the code editor's scroller as not focusable (it is: the editor's text takes focus and the arrow keys scroll it), and three page-level notes on the embed (no main landmark, no level-one heading, content outside landmarks) that are about a top-level page, not a figure inside a frame.

Not verified:

- **Touch.** Pan and pinch are in the code. They have not been run on a device.
- **A screen reader.** Roles, labels, live regions and focus handling are in the code as described and pass axe. Nobody has listened to it.
- **Firefox and Safari.** Everything above ran in Chromium.
- **Reduced motion.** There is one transition and the global rule covers it. Not checked in a browser.
- **How the 390 px draw view feels.** It works and nothing overlaps, but a diagram fitted into a phone-wide canvas is small (the permit example fits at 25%).
