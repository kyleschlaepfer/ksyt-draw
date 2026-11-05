# Architecture decisions: Chalk v2

The decisions behind the v2 revival, as numbered records. Each has the context, the decision, the
alternatives that were on the table, and what follows from it. They describe the code at the
checkpoint (`1a1e46f` on `feat/ksyt-draw-v2-revival`).

Sources: `CONTINUE.MD` (sections A, B and D), the brief (sections 3 and 4), and the code named in
each record. Where a fact was not checked again for this document, the record says so.

**Two decisions are awaiting the owner's sign-off** and are marked in their headings:

- **Decision 6, hold-still.** The alternative is to let automatic shapes re-flow, with an animation.
- **Decision 12, the purpose-built canvas.** The alternative is React Flow as the interaction shell.

Work that depends on either answer should wait for it.

## The pipeline, for reference

```
.ksd text
  -> src/core/doc/parse.ts      parseSource(): text -> ChalkDoc + statement map + diagnostics
  -> src/core/geom/resolve.ts   resolve(): ChalkDoc -> Geometry (boxes, routes, label places), inches
  -> src/core/render/scene.ts   buildScene(): Geometry -> Scene, in the sketch or precision look
  -> src/core/render/svg.ts     sceneToSvg()  for the page (role classes, follows the site's theme)
                                portableSvg() for export (self-contained, explicit colors)
```

| # | Decision | Status |
|---|---|---|
| 1 | One canonical document model, in layers | decided |
| 2 | The `.ksd` text is complete; a managed `layout { }` block; a `.chalk.json` project file | decided |
| 3 | Write and Draw stay in step by targeted source edits | decided |
| 4 | One session and one undo history | decided |
| 5 | Invalid text never blanks the figure, and makes Draw read-only | decided |
| 6 | Layout ownership and hold-still | **awaiting the owner's sign-off** |
| 7 | One geometry pipeline for preview, canvas, embed and export | decided |
| 8 | Two looks over one geometry | decided |
| 9 | Export is its own rendering target | decided |
| 10 | CodeMirror 6 for Write | decided |
| 11 | pdf-lib for PDF | decided |
| 12 | A purpose-built canvas, no graph library | **awaiting the owner's sign-off** |
| 13 | The "ports stay ports" rule no longer covers the parser | decided, an override of `CLAUDE.md` |
| 14 | "download SVG" writes a different file | decided, a behavior change |
| 15 | A local draft, with the link as a second copy | decided |

---

## 1. One canonical document model, in layers

**Context.** In v1 the model was the reviewer's contract (`src/core/model.ts`): what the notation
check needs, plus one geometric field, `at`. Draw edited it and `serialize()` wrote it back. It had
nowhere to keep a size, a route, a label position, a style or a lane, and an edge had no identity
beyond its position in the file (`BASELINE_AUDIT.md`, concerns 8 and 9). The brief (section 4)
requires one versioned model that is not the SVG scene, not a canvas library's objects and not a
serialized string.

**Decision.** `ChalkDoc` in `src/core/doc/types.ts`, schema version 2. Its layers are kept apart:

| Layer | Fields | Rule |
|---|---|---|
| Semantics | `kind`, `label`, `from`, `to`, `parent`, `members`, `ends`, `meaning`, `navigable` | what the diagram says |
| Geometry | `place`, `size`, `thickness`, `route`, `labelPos`, `pool` | only what the author fixed by hand. An absent field means the layout engine or the router owns it |
| Presentation | `style` (`fill`, `color`, `weight`), `meta.look` | theme roles only, never hex |
| Authoring | `uid`, `id`, `step`, `describe`, `inline` | `uid` is the stable identity, never shown or typed. `id` is the name people type |
| Persistence | `format`, `version`, `ext` | `ext` keeps unknown keys through a save and reload |

Identity is split in two. A node's `uid` survives a rename and a re-parse (`adoptUids()` in
`src/core/doc/parse.ts` matches nodes by id, and lines by their ends and kind). An edge's `id` is
still `e1`, `e2`, ... in file order, but it is derived, and only the notation check's findings use
it.

The reviewer's contract 1.0 is now a projection of this model (`src/core/doc/contract.ts`), so
`lint.ts` reads what it always read.

Edits are named commands over the model (`src/core/doc/commands.ts`): add, remove, move, resize,
release, label, rename, change kind, set parent, connect, change relationship, reconnect, swap
ends, patch route, label position, style and ends, reorder partitions, copy and paste.

**Alternatives.**
- Extend the v1 contract model with geometry fields. Rejected: it would put editor state into the
  shape the reviewer's rules are written against, and edges would still have no identity.
- Use a canvas library's node and edge objects as the model. Ruled out by the brief, and it would
  put the model out of reach of the embed and the exports (see decision 12).

**Consequences.**
- Everything Draw can do has a field to live in, so it can be saved, undone and written as text.
- Two model files exist: `src/core/model.ts` (the contract types, read by `lint.ts`, `describe.ts`,
  `diagnostics.ts`, `src/embed/figure.ts` and the frozen parser) and `src/core/doc/types.ts`.
- `src/core/doc/project.ts` has to validate this shape field by field when it comes from a file
  (`sanitizeDoc()`).

## 2. The `.ksd` text is complete; a managed `layout { }` block; a `.chalk.json` project file

**Context.** The brief (4.4) says every Draw feature needs a path to be saved and reopened, and
that if something cannot be represented in a standalone `.ksd` file the product must say so and
never drop it quietly. Chalk's link, its embed and its local draft all carry text. A diagram whose
geometry lived only in a side file would lose it in all three.

**Decision.** The text holds everything. Hand-set positions, sizes, routes, label positions, lane
sizes and styles are written in a managed block at the end of the file:

```
# layout: written by the draw view. Delete a line to hand that part back to automatic layout.
layout {
  place publish 3.4 3.2
  size publish 1.8 0.7
  route ok -> draft elbow from left to left via -0.9 3.03, -0.9 1.6
  style ok -> publish color accent weight bold
  style publish fill wash
}
```

(From `fixtures/v2/manual-layout.ksd`.) The statement kinds are `place`, `size`, `lane`, `pool`,
`route`, `labelpos` and `style`. The semantic part of the file reads as it did in v1: nobody has to
type a coordinate to make a diagram.

The project file, `.chalk.json` (`src/core/doc/project.ts`, format `chalk-project`, version 2), holds
`source` (the text, which is authoritative), `model` (the document as JSON, for inspection and other
tools) and `workspace` (the draw view's viewport and the export settings, which are not part of the
diagram).

**Alternatives** (the brief names them in 4.4).
- A native project format as the only complete form, with `.ksd` as a lossy "text-only projection".
  Rejected: links, embeds and drafts would silently lose layout, which is the failure the brief
  forbids.
- Geometry written on each declaration line. v1 did this with `at X Y`. Kept for reading old files
  (the `inline` flag keeps such a line as it was), not used for new geometry: it clutters the lines
  people read and edit.
- A sidecar file beside the `.ksd`. Rejected for the same reason as the first.

**Consequences.**
- "save" offers two files and either reopens the whole diagram. The `.ksd` loses only the workspace.
- Deleting a line from the block is the text-side way to hand that part back to automatic layout.
- A layout line that names something that no longer exists is kept with a warning, never an error
  (`test/doc-parse.test.ts`).
- Opening a project re-parses `source` with the same parser as typed text. The `model` is used only
  if the text is missing or broken, and then only after validation. A project file is untrusted
  input.
- A long, heavily arranged diagram makes a long link. See decision 15.

## 3. Write and Draw stay in step by targeted source edits

**Context.** v1 regenerated the whole file from the model after every Draw edit, which threw away
comments, blank lines, order and spacing (`BASELINE_AUDIT.md`, concern 11). The brief requires that
a Draw edit leave unrelated comments and formatting alone.

**Decision.** `syncSource()` in `src/core/doc/sync.ts` writes a Draw edit into the text by changing
only the lines that edit touches. The parser returns a statement map (`Stmt`: line, kind, owner
`uid`) with the document. The rule is the same for every statement: print it for the old document
and for the new one (`src/core/doc/print.ts`); if the two prints are equal, the source line is left
exactly as the author wrote it; otherwise that one line is replaced, removed or added.

"tidy" in Write (`formatSource()`) is the only thing that rewrites formatting, and only when asked.

**Alternatives** (from the brief, 4.4).
- Regenerate the text (v1). Rejected: data loss.
- A lossless concrete-syntax tree with edits applied to the tree. More machinery than a line-based
  format needs: every `.ksd` statement is one line, so "which line does this belong to" is the whole
  problem, and the statement map answers it.
- Keep the text and the model as two sources of truth and reconcile them. Rejected: there must be
  one answer to "what is the diagram".

**Consequences.**
- Comments, blank lines, spacing and order survive Draw edits. `test/doc-sync.test.ts` covers it.
- This is the piece where a bug would corrupt text. It is guarded: after every Draw edit,
  `Session.edit()` re-parses the new text, and if it does not parse the edit is refused and nothing
  changes ("that change can't be written as text"). The unit tests compare the re-parsed document
  with the intended one for every edit they make.
- Every command must have a printer for what it changes.
- Build-up steps are edited from Draw the same way: a statement whose step changed gets a `step` line
  before it and the step that was in force is put back after it; step lines left doing nothing are
  dropped. A new shape still joins the step in force where its line is inserted.
- Known limit: reorder exists only for containers.

## 4. One session and one undo history

**Context.** v1 had two histories that knew nothing of each other: the `textarea`'s own, and a
stack of text snapshots inside Draw with no redo, one entry per keystroke
(`BASELINE_AUDIT.md`, concern 10).

**Decision.** `Session` in `src/core/doc/session.ts` holds the one open document for both views:
the text, the last valid document parsed from it, its resolved geometry, and a single history.

- Write calls `setText()`. Typing within 1.2 seconds of the last keystroke joins the same undo step
  (`TYPING_WINDOW`).
- Draw calls `edit(label, fn)`: a transaction that clones the document, applies commands, holds the
  picture still (decision 6), writes the text (decision 3), re-parses it as a check, and records one
  undo step with a label and the selection.
- Undo and redo are the session's. CodeMirror's own history is not installed, and its `Mod-z` and
  `Mod-y` keys are rebound to the session (`src/play/editor/editor.ts`).
- The history holds text, at most 300 entries (`HISTORY_LIMIT`).
- The session has no DOM access, so it runs in Node tests (`test/session.test.ts`).

**Alternatives.**
- Keep the editor's history for Write and a command history for Draw. Rejected: Ctrl+Z after
  switching views would undo the wrong thing, or nothing.
- A history of inverse commands. Text snapshots are simpler and are always exactly right, and
  `.ksd` files are small.

**Consequences.**
- Ctrl+Z in either view can undo an edit made in the other. A whole drag is one step.
- Opening a file, a link or a template goes through `setText()` with its own label, so undo brings
  back what was there.
- The undo keys work anywhere in the draw view, not only on the canvas. A text field that is being
  typed in keeps them for its own text. When a control goes away with the edit it made (a deleted
  shape's "delete"), the canvas takes the focus.

## 5. Invalid text never blanks the figure, and makes Draw read-only

**Context.** In v1 the parser stopped at the first mistake, the write preview was replaced by an
error card, and the draw view showed an empty state. The brief (6.3) asks that a draft with a
mistake keep its text, show diagnostics, keep the last valid diagram on screen marked out of sync,
recover by itself, and never be overwritten by Draw.

**Decision.**
- The v2 parser does not stop. Each bad line gets a diagnostic with a column range and parsing goes
  on. A text with any error has `doc: null`.
- The session keeps the last valid parse (`good`) beside the current one. `inSync` is false while
  they differ.
- Write keeps the last figure under a note ("the text has a mistake on line N, so this is the last
  version that worked") and underlines every bad line.
- Draw shows the same last version with a banner, a dashed canvas border and disabled panel fields.
  `Session.edit()` refuses with "fix the text first: the drawing is showing the last version that
  worked".
- When the text parses again, both views catch up by themselves.

**Alternatives.**
- Blank the figure (v1). Rejected by the brief.
- Let Draw edit the last valid document and write it back. Rejected: it would overwrite the newer,
  unfinished text.
- Render what parses and skip the bad lines. Rejected: a figure with a missing piece teaches the
  wrong thing, and a mistake that hides half the diagram looks like data loss.

**Consequences.**
- Draw can never overwrite a newer draft.
- The error card and the empty state remain for one case only: there has never been a valid
  document (a broken link, for example).
- The notation and layout findings are shown only while the text is in step (`allIssues()` is given
  no lint or layout results otherwise).
- Brief scenario O is covered in `test/e2e/playground.spec.ts`, per `CONTINUE.MD`.

## 6. Layout ownership and hold-still (awaiting the owner's sign-off)

**Context.** v1's `freeze()` pinned every node whenever one moved, which ended automatic layout for
the whole diagram after one drag. The brief (4.3) says: distinguish automatic from placed; do not
freeze everything because one element was dragged; editing a label must not re-run global layout;
give explicit, previewable "re-layout" and "reset route" actions. It also says (5.2) that adding a
node must cause no unrelated movement. Those pull against each other: dagre's answer for every node
can change when one node or line is added.

**Decision.** Two parts.

*Ownership.* A shape is automatic (no `place`) or placed. Every node takes part in the automatic
layout, including placed ones: a placed node keeps its slot and is then moved to where the author
put it (`src/core/geom/layout.ts`). So the result is a pure function of the document, and a saved
file reopens exactly as it looked.

*Hold-still.* In Draw, nothing moves unless the author moves it. After a Draw edit,
`Session.holdStill()` resolves the edited document and compares it with what was on screen:

- any automatic shape the edit would shift by more than 0.004 in is given a `place` where it
  already is, in the same undo step;
- a partition whose thickness would change keeps its thickness;
- the status line says how many were held ("2 others stay put (tidy up lets them go)"); the shape
  the edit was about is not counted among the others;
- a second exception, because holding still must not break the picture: when the edit leaves two
  shapes with less room between them than they need, `Session.makeRoom()` pushes the neighbour over
  just far enough, and whatever it then crowds after it. The room needed is 1 in between shapes
  joined by a line with multiplicities or role names, 0.55 in for a line with a name or a stereotype,
  0.3 in for a bare line, 0.08 in otherwise. A pair that was
  already that close before the edit is left alone, and so is everything when the edit itself placed
  or sized a shape (that is the author arranging things). Inside a partition a shape is only pushed
  along its lane. The status line says "made room: 1 shape moved over";
- one exception: if nothing in the diagram is placed by hand and the whole layout slid by one
  uniform amount (a wider box re-centers its column), nothing is pinned and the canvas pans by that
  amount, so nothing appears to move;
- edits that are meant to move other shapes pass `hold: false`: tidy up, resizing or reordering a
  partition, changing the direction or the type, changing an actor's side, moving a shape into a
  container, releasing a shape.

"tidy up" (the whole diagram, the selection, or only the lines) hands shapes and routes back to the
layout engine and the router. It shows the result first and asks "keep it" or "put it back".

**How it differs from v1's `freeze()`.** v1 pinned every shape on every move. v2 pins exactly the
shapes that would otherwise have moved, and says so.

**Alternatives.**
- **Let automatic shapes re-flow after each Draw edit, with an animation.** This is the alternative
  put to the owner. Automatic layout stays automatic for longer, and the diagram keeps tidying
  itself. The cost is that shapes the author did not touch move, which the brief's 5.2 forbids as
  written, and an animation is needed so the author can follow what happened.
- Pin everything on the first drag (v1). Rejected by the brief.
- Pin nothing and animate nothing. Rejected: shapes would jump under the pointer.

**Consequences.**
- The picture is stable under every Draw edit, and each edit is one undo step whatever it pinned.
- Before `makeRoom()`, a class that gained members grew over the class below it from the fifth
  member, and a line drawn between two use cases that sat close came out 0.38 in long with its
  stereotype across both outlines. Both were found by the browser tests (scenarios Q and P in
  `test/e2e/flows.spec.ts`) and are covered there and in `test/session.test.ts`.
- Known problem 4 in `CONTINUE.MD`: adding or connecting a shape in an all-automatic diagram often
  changes dagre's answer for others, so they get placed. After a few Draw edits most of a diagram
  can be hand-placed. Tidy up reverses it, but the owner may find the pinning too eager.
- Hand-placed shapes add lines to the `layout { }` block, so the text grows with Draw use.
- Editing in Write is not held still: a text edit re-runs the layout, and placed shapes stay where
  their `place` lines say.

**Open question for the owner.** Is hold-still right as it is, or should a Draw edit let automatic
shapes re-flow, with an animation, and pin nothing?

## 7. One geometry pipeline for preview, canvas, embed and export

**Context.** v1 had one path too, but it ended in a cropped scene (`buildScene()` translated
everything so the frame started at 0, 0), which is right for a figure and wrong for a workspace. A
canvas library would have brought a second geometry of its own. The brief (8.9) asks that positions,
labels, routing and proportion be the same in the canvas, the embed and every export.

**Decision.** `resolve()` in `src/core/geom/resolve.ts` is the one answer to "where is everything":
each shape's box, each line's path, each label's place, in inches, in the document's own
coordinates. Nothing is re-centered at this stage. It has no DOM access.

| Consumer | How it uses the geometry |
|---|---|
| Write preview and the embed | `mountFigure()` in `src/embed/figure.ts`: `resolve()` -> `buildScene()` -> `sceneToSvg()` |
| Draw canvas | `resolve()` on the session's document, or on a draft during a gesture, then `paintNode()` / `paintEdge()` / `elementMarkup()` per element |
| Exports | `exportScene()` in `src/export/svg.ts`: `resolve()` -> `buildScene()` with the export's look, padding and backdrop |

Framing (the margin around the ink) happens in `buildScene()`, for output only.

What lives in the core, behind `resolve()`: node sizing with word wrap (`shape.ts`), outline
attachment, the orthogonal router (`route.ts`: pattern candidates scored by length, bends and
collisions, with an A* fallback around obstacles), flow, lane, use-case and class layout
(`layout.ts`), cost-based label placement, snapping, align, distribute and match size
(`arrange.ts`). dagre stays, for ranking only.

**Alternatives.**
- Let the editor own its geometry and export what it shows. Rejected: the embed and the exports
  cannot load an editor, so there would be two routers that disagree.
- Keep v1's layout modules and add an editor-only geometry on top. Rejected for the same reason.

**Consequences.**
- What is on the canvas is what the preview, the embed and the file will draw.
- The canvas owns no geometry. During a drag it resolves a draft every frame and patches only the
  elements whose markup changed (`KeyedLayer` in `src/play/draw/dom.ts`). Above 60 nodes a drag
  re-routes only what moved (`Canvas.preview()`).
- `layout.ts` keeps the last dagre result in a module variable (a one-entry cache) so a drag does
  not re-rank every frame.
- The embed got heavier: about 71 KB of script gzipped against about 46 KB before, per
  `CONTINUE.MD` (the router, classes, lanes and the precision look). It still loads no editor code.
  The figure has not been measured precisely or trimmed.
- Not done: self-loops are not drawn; there is no crossing minimization beyond dagre's; parallel
  elbow lines can share a channel. Interaction speed at 100 nodes and 150 edges has not been
  measured.

## 8. Two looks over one geometry

**Context.** The brief (8.5) asks for a precision mode for formal documents and a sketch mode in
the pen style of the videos, with the same semantics and geometry, and says (9.1) that decorative
wobble must never define connection geometry or hit targets.

**Decision.** `buildScene()` in `src/core/render/scene.ts` paints one geometry in one of two looks.

- **Sketch** (`render/sketch.ts`): every stroke is a filled polygon from `pen.ts`, seeded by the
  element's name, so a shape wobbles the same way wherever it appears. `pen.ts` is untouched and
  still bit-compatible with the slides.
- **Precision** (`render/precision.ts`): real strokes, exact corners, the prose font.

The look is chosen by a `look` header line in the text, by the embed's optional `look` hash
parameter, by "drawn as" in the draw view's properties, and per export in the export dialog.

**Alternatives.**
- Sketch only (v1). Does not meet the brief's formal-document use.
- Two renderers, each with its own layout. Rejected: positions would drift between the looks.
- Change `pen.ts` to make a cleaner sketch. Not needed, and it would break slide parity.

**Consequences.**
- Positions, sizes, routes and label centers are identical in both looks
  (`test/render.test.ts`: "draw the same geometry: same shapes, same routes, same label centers").
- Hit targets, handles, ports and snapping come from the geometry, never from the ink.
- Text is measured per look (the precision font is scaled by `PRECISION_SCALE`), with label boxes
  anchored by their centers so the centers agree.
- Sketch-look label clearance was tuned on the 17 fixtures. An unusual diagram can still produce a
  `LINE_THROUGH_TEXT` finding; the label can then be dragged by hand.

## 9. Export is its own rendering target

**Context.** v1's only export was the on-screen SVG with a `<style>` block added. The brief (8.3)
requires export to be a first-class target, never a screenshot of the canvas, and never able to
include handles, grid or selection.

**Decision.** `src/export/` builds a scene for the file:

```
document -> resolve() -> buildScene(look, padding, knockouts) -> checkScene() -> writer
```

| Format | Writer | How |
|---|---|---|
| SVG | `portableSvg()` in `src/core/render/svg.ts` | self-contained: plain `fill` and `stroke` attributes for the chosen theme, an explicit background rectangle unless see-through, fonts embedded as `@font-face` data, a fallback font stack, and `textLength` so text keeps its measured width |
| PNG | `src/export/png.ts` | rasterizes that same SVG at the asked scale, capped at 16 million pixels |
| PDF | `src/export/pdf.ts` | drawn straight from the scene with pdf-lib: paths for ink, real text in embedded fonts |

Options (`src/export/options.ts`): look, theme, backdrop (white, page, see-through), padding (tight
0.1 in, normal 0.25 in, roomy 0.5 in), PNG scale 1 to 4, PDF page (the diagram's own size, US
Letter, A4, 16:9 slide) and orientation. With a see-through backdrop the scene is built without
knockouts.

The export dialog previews the file itself (the same SVG, shown as an image), not the canvas.

**Alternatives.**
- Serialize the canvas's SVG. Rejected by the brief; selection and grid would need stripping, and
  the canvas uses role classes that only mean something on the page.
- Keep v1's file (CSS variables with fallbacks and a dark media query). Rejected: see decision 14.
- Rasterize on a server. Rejected: no backend, and nothing leaves the browser.

**Consequences.**
- No handle, grid dot or selection can be in a file: they never exist in the export's scene.
- The file does not depend on the viewer's theme, on CSS variable support, or on installed fonts.
- PNG and the preview are the SVG, so they cannot disagree with it. PDF is a second writer over the
  same scene and has to be kept in step with the SVG writer by hand.
- Text as outlines is not offered in SVG.
- Not verified: opening the files in PowerPoint, Word, Inkscape or Illustrator. The export quality
  review and the before/after gallery belong to `EXPORT_QUALITY_AUDIT.md`.

## 10. CodeMirror 6 for Write

**Context.** Write was a `textarea`. The brief (6.1) asks for highlighting, line numbers, bracket
matching, auto-indent, comment support, completion aware of the diagram type, diagnostics with
ranges, find and replace, and format, and names CodeMirror and Monaco as candidates. Two things in
this project narrow the choice: the page's policy is `style-src 'self'`, and undo must belong to
the session (decision 4).

**Decision.** CodeMirror 6 (`src/play/editor/editor.ts`, `language.ts`). The packages in use are
`@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `lint`, `search` and
`@lezer/highlight`, all MIT (read from the installed `package.json` files; `@codemirror/view` is
6.43.15).

- It lives in a **shadow root**. CodeMirror writes its styles at run time. In the main document
  that needs a `<style>` element, which the policy refuses. Inside a shadow root it uses constructed
  stylesheets, which the policy allows. Theme tokens are CSS custom properties, which cross the
  shadow boundary, so the editor follows the page's theme.
- CodeMirror's history extension is not installed. `Mod-z`, `Mod-y` and `Mod-Shift-z` call the
  session.
- The session, not the editor, owns the text. Text from outside (a Draw edit, undo, a file) goes in
  through `setText()`, which replaces only the span between the common start and the common end, so
  the cursor and the scroll position stay put.
- Diagnostics come from the v2 parser and the checks (`setIssues()`), not from a CodeMirror linter.
- The editor is loaded on demand (`import("./editor/editor")` in `src/play/write.ts`). Until it
  arrives the text shows in a plain `<pre>`.

**Alternatives.**
- Monaco. The brief names it. `CONTINUE.MD` records no measured comparison, so none is claimed
  here.
- Keep the `textarea` and add an overlay for highlighting. It would not give completion, ranges or
  search.

**Consequences.**
- The strict policy holds with no `unsafe-inline`, and the browser tests run under it.
- The embed does not load the editor.
- The editor's theme is written against CodeMirror's class names, so a major CodeMirror upgrade
  means checking `editor.ts`.
- Not yet covered by browser tests: completions, find, and the link between the cursor's line and
  the figure.

## 11. pdf-lib for PDF

**Context.** The brief (8.8) says to consider PDF strongly and implement it if feasible, with real
text where possible (8.6), and not to let a PDF button stand in for quality.

**Decision.** `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1, both MIT (read from the installed
`package.json` files). `src/export/pdf.ts` draws the export scene straight into a page: ink as
paths, text as real text in the embedded fonts, subset to the glyphs used. The fonts are the WOFF
files the page already ships (Kalam and Atkinson Hyperlegible Next, both SIL OFL, which permits
embedding). Page presets are the diagram's own size, US Letter, A4 and a 16:9 slide; the diagram is
never stretched to fill a page.

The module is loaded only when a PDF is asked for (`import("../export/pdf")` in
`src/play/export-dialog.ts`).

**Alternatives.**
- Put the PNG inside a PDF. Rejected: text would not be selectable, searchable or sharp at any size.
- The browser's print dialog. Rejected: the result depends on the browser and the user's print
  settings, and it is not a file the tool can name and save.

No other PDF library is recorded as evaluated in `CONTINUE.MD`.

**Consequences.**
- A true vector PDF with selectable text and no server.
- The PDF chunk is 1.1 MB, 507 KB gzipped (`CONTINUE.MD`). It costs nothing until a PDF is exported.
- A second writer over the scene (see decision 9).
- Not verified: the PDF in a viewer other than the browser's.

## 12. A purpose-built canvas, no graph library (awaiting the owner's sign-off)

**Context.** The brief (3.1) asks for an evaluation of maxGraph, React Flow, JointJS and tldraw, a
check of their current licenses, and a preference for not re-implementing an editor's fundamentals.
It also sets constraints that bear on the choice: no mandatory commercial license (3), the embed
must stay lean and must not load an editor (3.2), and the canvas, embed and exports must agree on
positions and routes (8.9).

**The evaluation.** Versions and licenses were checked on 2026-11-04 with `npm view`, as recorded
in `CONTINUE.MD`. They were not checked again for this document.

| Library | Version | License | Why it was not adopted |
|---|---|---|---|
| tldraw | 5.6.0 | its own license (`SEE LICENSE IN LICENSE.md`), not open source | fails "no mandatory commercial license" |
| maxGraph | 0.25.1 | Apache-2.0 | it owns geometry: its own perimeters, edge styles and labels. Chalk needs one geometry for the embed and the exports, which cannot load an editor. Using it means two routers that disagree, or bending most of the library |
| JointJS core | 4.3.4 | MPL-2.0 | selection, resize handles, the viewport scroller, snaplines, in-place text, undo and clipboard are all in the paid JointJS+ only |
| React Flow | 12.12.1 | MIT | the only one that fits as a pure interaction shell. It would add React, about 100 KB gzipped, and a second state system to keep in step with the session. Everything specific to Chalk (routing, waypoints, labels, lanes, in-place text, snapping) is custom either way |

**The deciding fact.** Chalk is text-first and the embed must stay lean, so layout, routing,
attachment and label placement have to live in the DOM-free core (decision 7). What a library would
then add is the viewport, selection, drag, resize and connect.

**Decision.** A purpose-built interaction layer in `src/play/draw/`:

| File | Job |
|---|---|
| `canvas.ts` | the viewport, layers, hit targets, gestures (pan, marquee, move, resize, connect, reconnect, bend, label, lane divider, place), keyboard, clipboard |
| `index.ts` | the palette, the toolbar, tidy up with its preview, in-place text |
| `inspector.ts` | the properties panel |
| `inline-edit.ts` | the in-place text field |
| `dom.ts` | SVG helpers and the keyed layer that patches only what changed |

The canvas owns no geometry. Every frame, including each frame of a drag, it asks the core to
resolve a document (the session's, or a draft with the change in progress) and shows the result. A
gesture becomes one `Session.edit()` when it ends. So the canvas only consumes resolved geometry
and emits commands.

`canvas.ts` is 1,209 lines at the checkpoint. (`CONTINUE.MD` says "about 850"; the file was already
1,200 lines at commit `7d58cd0`.) It is covered by 16 pointer and keyboard driven browser tests in
`test/e2e/draw.spec.ts` (brief scenarios A to L, plus label editing, lane management and keyboard).

No interaction spike with React Flow is recorded. The brief asks for one where candidates are
close.

**Alternative: React Flow as the interaction shell.** This is the alternative put to the owner.
- For: a maintained library carries the viewport, selection, drag and connect; a minimap and touch
  handling come with it; less interaction code to own.
- Against: React and a second state system beside the session; about 100 KB gzipped more in the
  draw view; routing, waypoints, labels, lanes, in-place text and snapping stay custom.
- Because the canvas only consumes geometry and emits commands, React Flow could replace
  `src/play/draw/canvas.ts` later without touching the core. `CONTINUE.MD` puts a switch at roughly
  10 to 20 hours.

**Consequences.**
- No new run-time dependency for Draw, no license to track, and the draw view loads on demand
  (`import("./draw/index")`).
- Chalk owns the editor fundamentals the brief hoped to avoid owning: pointer capture and cancel,
  hit testing, zoom arithmetic, touch.
- Gaps today (`CONTINUE.MD`): pinch zoom and one-finger pan are written but have never been run on
  a touch device; no minimap; no generic grouping and no bring-forward or send-back (skipped on
  purpose: containment is the grouping these diagram types have, and shapes do not overlap); the
  clipboard is in memory (`Canvas.clip`), not the system's. Horizontal lanes have a pointer test now, and accessibility has had
  a machine audit (`TEST_MATRIX.md`).
- This is the largest unreviewed decision in the revival.

**Open question for the owner.** Is the purpose-built canvas acceptable, or should React Flow be
the interaction shell?

## 13. The "ports stay ports" rule no longer covers the parser

**Context.** `CLAUDE.md` says `pen.ts`, `pyrandom.ts`, `parse.ts` and `lint.ts` follow
`reference/*.py` exactly, and that behavior changes in the Python reference first. The v1 parser is
a port of `reference/ksd_parse.py`: it stops at the first mistake, reports a line and no column,
and reads v1 syntax only. v2 needs partitions, classes with members, class relationships with
multiplicities and roles, use-case descriptions, the layout block, `lanes` and `look` header lines,
every bad line reported with a range, and a statement map for decision 3. The brief (3, 14.1) allows
changing old `CLAUDE.md` assumptions and the Python parity process when they block the new needs,
provided it is documented and legacy compatibility is kept and tested.

**Decision.** A deliberate override, for the parser only.

- `src/core/doc/parse.ts` is the v2 parser. It is written in TypeScript first and is not a port.
- `src/core/parse.ts`, the v1 port, is frozen. Nothing parses with it in production. It stays as
  the test oracle.
- `test/doc-parse.test.ts` is a differential test: the v2 parser reads every v1 fixture exactly as
  the frozen port does, and fails where v1 fails, with the same message on the same line.
- The rule still covers `pen.ts`, `pyrandom.ts` and `lint.ts`. They are untouched, and all their
  fixture tests pass.
- The lint did not get weaker. The v2 rules (`rulesV2` in `src/core/diagnostics.ts`) are additions
  beside it.

**Alternatives.**
- Extend `reference/ksd_parse.py` first, regenerate fixtures, then port. This is the house process.
  Not followed because the v2 parser needs things a port of that parser does not give (recovery,
  column ranges, the statement map, stable identity), and because `python3` is not installed on the
  machine the work was done on, so `npm run fixtures` could not run. The Python-generated fixtures
  were not edited.
- Keep v1 syntax and put everything new in the project file. Rejected with decision 2.

**Consequences.**
- Every v1 file and every v1 embed link still parses to the same diagram, and a test proves it.
- The Python reference parser does not read v2 syntax. A `.ksd` file that uses classes, partitions,
  a describe block or a layout block cannot go through `reference/ksd_parse.py` until that file is
  extended. This matters to the owner's other tools that share the reference.
- The frozen file is still part of the build: `src/core/lint.ts` imports its `pyRepr` helper.
  `CONTINUE.MD` says no production code imports it; that is true of its `parse()` function, not of
  the module.
- `CLAUDE.md` still states the old rule and names files that are gone. It should say the rule
  covers `pen.ts`, `pyrandom.ts`, `lint.ts` and the frozen `parse.ts`.
- `test/docs.test.ts` still checks the syntax reference against the frozen parser's source. It has
  to be pointed at `src/core/doc/parse.ts` and `diagnostics.ts` when the reference is updated, and
  it will fail until the reference covers the v2 syntax and rule ids.
- The v2 rules have not been reviewed against the OMG UML 2.5.1 text.

## 14. "download SVG" writes a different file

**Context.** The "download SVG" button (on the embed and in Write) wrote the on-screen SVG with a
`<style>` block: fills as `var(--role, hex)` and a second set of values under
`@media (prefers-color-scheme: dark)`, with no background (`standaloneStyle()` in v1's
`src/core/svg.ts`; see [`baseline/exports/`](baseline/exports/)). That file changes color with the
viewer's system theme, needs CSS variable support that Office and Inkscape lack (`CONTINUE.MD`),
and shows off-white patches on a white page.

**Decision.** A deliberate behavior change. The button now calls `exportSvg()`
(`src/embed/download.ts`) and writes a self-contained file: the look on screen, the theme on screen
(light or dark, decided once at download), a solid page background, 0.25 in of padding, explicit
colors, embedded fonts. The button, its label and its place did not change.

**Alternatives.**
- Keep the adaptive file and offer the portable one only in the export dialog. Rejected: the
  default download would stay the one that breaks outside a browser.
- Always write the light theme. Rejected: a reader in dark mode expects the picture they see.

**Consequences.**
- The file looks the same wherever it is opened, and no longer follows a dark-mode viewer.
- A page that inlined the old file so it would follow the site's theme loses that. The embed itself
  still follows the host's theme; only the downloaded file changed.
- `test/e2e/embed.spec.ts` was updated to assert the new contract. This is the fix for an audited
  defect, not a weakened test.
- `spec/embed-protocol.md` does not describe the file's contents, so the protocol is unchanged.

## 15. A local draft, with the link as a second copy

**Context.** In v1 the link was the only copy ("the link is the file"): the hash held the whole
diagram. The brief (10.1) asks for a reliable local draft, restore after refresh, explicit new,
open and save, and not keeping long documents only in a URL hash. With decision 2 the text can now
carry a layout block, so it can get long.

**Decision.**
- The open diagram and the workspace are saved to `localStorage` (`chalk:draft`,
  `src/play/storage.ts`) 300 ms after a change.
- The link still carries the diagram while its compressed text is at most 8,000 characters
  (`LINK_LIMIT` in `src/play/main.ts`). Above that the hash keeps only `v=1` and the view.
- A link wins over the draft on load. The draft it replaces is kept (`chalk:previous`) and offered
  as "the diagram you had before" under "open".
- If the browser refuses storage, the page keeps running and the status line says where the
  diagram is held.
- "new", "open" and "save" are in the document bar. A file can also be dropped on the page.

**Alternatives.**
- The hash only (v1). Fails for long diagrams and on refresh after the limit.
- IndexedDB with several named documents. More than a one-document tool needs yet.

**Consequences.**
- A refresh, a closed tab or a crash loses nothing where storage works.
- One draft per browser. Opening a link replaces it, with one earlier diagram kept.
- Reload and back have one browser test (scenario G); scenario W is not written (`CONTINUE.MD`).

---

## Not verified for this document

- The library versions and licenses in decision 12 are from `CONTINUE.MD` (`npm view`,
  2026-11-04). The licenses and versions of the adopted libraries (decisions 10 and 11) were read
  from `node_modules`.
- Bundle sizes (the embed, the PDF chunk, React Flow's) are quoted from `CONTINUE.MD`.
- Test counts (411 unit, 78 browser, all passing at the checkpoint) were not re-run.
- No export was opened in a third-party tool.
