# Implementation report: Chalk v2 revival

Written 2026-11-05 and updated after release. The canvas-first redesign was committed as
`51c6646`, pushed to `main` and `feat/ksyt-draw-v2-revival`, and deployed at
`https://chalk.kyleschlaepfer.com`.

This is the summary. The detail is in the documents beside it:

| Document | What it holds |
|---|---|
| `BASELINE_AUDIT.md` | the tool before the work: test results, the brief's concerns checked against the v1 code, what was kept, rewritten and removed, the compatibility that had to hold |
| `UI_PRESERVATION_CONTRACT.md` | the design language at the baseline, what was to be preserved, what actually changed |
| `ARCHITECTURE_DECISIONS.md` | 12 numbered decisions with their alternatives, the library and license review |
| `UX_DESIGN_SYSTEM.md` | every surface, control, string and key as built |
| `EXPORT_QUALITY_AUDIT.md` | what was wrong with exports, what was fixed, what still reads less than well |
| `TEST_MATRIX.md` | every test and scenario, measured performance, what is not covered |
| `baseline/`, `after/`, `gallery/` | screenshots before, screenshots after, every fixture exported in every format |

## Canvas-first Draw redesign addendum (2026-11-05)

This addendum records the implementation requested by `prompts/KSYT_DRAW_CANVAS_FIRST_REDESIGN.md` and supersedes older statements below that self-connectors or keyboard connector initiation are missing.

The existing canvas engine was retained, while the restrictive shell and command policy were replaced. The retained engine already provided stable identities, direct pointer manipulation, manual geometry, routing, targeted source synchronization, shared rendering/export, one undo history, and complete project persistence. The earlier form-led experience came from populated templates, generated labels, text-only palette controls, a relationship dropdown, and command-level rejection of temporarily invalid connections.

Implemented changes:

- An explicit visual diagram-type chooser creates a blank flowchart, activity, use-case, or class diagram and enters Draw.
- Draw now has a collapsible graphical shape/relationship library, dominant canvas, contextual type/title header, and docked collapsible inspector. Collapsing side zones correctly returns their width to the canvas.
- A selected symbol tool stays armed for repeated empty placement. Empty labels are preserved in `.ksd`, so five or fifty shapes can be laid out before any text is entered.
- Relationship buttons arm a pointer-and-keyboard source/target tool. Port dragging still works; self-referencing relationships can now be initiated directly and render as loops.
- Connection commands permit existing endpoints and leave notation judgment to diagnostics. Invalid UML is drawn, saved, reopened, and explained without blocking construction.
- Selected classes provide on-canvas `+ attribute` and `+ operation` actions, with Alt+A and Alt+O equivalents and inline member editing.
- Diagram type is no longer a mutating inspector field. Changing notation explicitly starts another blank diagram, avoiding silent loss or coercion of visual information.
- The first-node source-sync path for metadata-only blank documents was corrected.

The purpose-built canvas is now the architectural decision, not an unanswered question. Replacing it with React Flow would add a second interaction abstraction while retaining custom routing, lanes, labels, editing, persistence, and rendering; it would not address the product-policy defects above. Manual positions continue to hold still unless the user invokes tidy-up.

The behavioral acceptance test in `test/e2e/flows.spec.ts` places five empty classes, rearranges them, draws an association and an invalid self-dependency, navigates the warning, names one class afterward, saves the incomplete project, starts a different blank diagram, and reopens the project without loss. The screenshot is `after/canvas-first-class.png`.

Final verification for this working tree:

| Check | Result |
|---|---|
| Unit | 473 passed, 0 failed, 0 skipped |
| Chromium end-to-end | 105 passed, 0 failed, 0 skipped |
| Draw-specific browser suite | 21 passed, including repeated empty placement, self-link initiation, keyboard connector, direct class members, lanes, resize, routing, multi-select, undo/redo |
| Production smoke check | root and embed returned 200; release asset hashes and Draw bundle byte size matched; expected CSP headers were present |
| Production build | passed (`tsc --noEmit`, then Vite build) |

Functional completeness against the canvas-first specification is estimated at **92%**. Remaining implementation effort is estimated at **2–5 engineering days**, with uncertainty driven by findings from Firefox/Safari, real touch devices, screen-reader use, external export applications, and an independent UML 2.5.1 rules audit. The implemented acceptance workflow itself is not blocked by those checks.

## 1. Earlier architecture questions (resolved by the canvas-first assignment)

The canvas-first assignment granted architectural freedom and made the interaction outcome authoritative.

1. **The purpose-built canvas is retained.** (Decision 12.) tldraw's
   license rules it out, JointJS keeps the needed parts in its paid edition, and maxGraph brings its
   own geometry, which would give the editor one router and the embed another. React Flow is the only
   one that fits, as a shell for pan, zoom, select and drag. It would add React and about 100 KB
   gzipped to the tool, and everything particular to Chalk (routing, bends, labels, lanes, text in
   place) stays custom either way. The canvas as built is 1,210 lines, takes resolved geometry in and
   gives commands out, and is driven by 21 Draw browser tests. A switch is estimated at 10 to
   20 hours. The redesign showed that the restrictive behavior was in the shell and command policy,
   not the canvas engine.
2. **Hold still remains the Draw behavior.** (Decision 6.) In Draw nothing moves unless the
   author moves it: when an edit would shift shapes the layout placed, those shapes are pinned where
   they are, in the same undo step, and the status line says how many ("3 others stay put"). After a
   few edits much of a diagram is placed by hand; "tidy up" hands it back. The one exception added
   this session: a shape an edit newly crowds is pushed over just far enough ("made room: 1 shape
   moved over"). The alternative is to let the layout move things and animate the change.

## 2. Test results

| | Baseline (`main`) | Checkpoint (`1a1e46f`) | Now |
|---|---|---|---|
| Unit tests | 191 passed | 411 passed | 473 passed, 0 failed, 0 skipped |
| Browser tests | 67 passed, 2 failed | 78 passed | 105 passed, 0 failed, 0 skipped |
| Build | passes | passes | passes |

The two baseline failures were line endings in the Windows checkout, not the app. The browser tests
run against the production build under the production content security policy.

## 3. What was built

One pipeline feeds the write preview, the draw canvas, the embed and every export:

```
.ksd text -> parse -> ChalkDoc -> resolve (layout, routes, label places) -> scene (sketch or precision) -> SVG for the page, or a file
```

**Reused, untouched.** The pen engine, the random number port, the notation check and the v1 parser
(now the oracle that proves v1 files still read the same). The Python references, the v1 fixtures,
the site's tokens and fonts, the embed's message protocol and hash format.

**Rewritten.** The parser (a superset of v1 that reports every bad line with a range), layout and
routing (an orthogonal router in place of splines), rendering (a display list with two looks), the
write view (CodeMirror 6 in place of a textarea), the draw view (a real canvas in place of a form
that rebuilt the figure), export (its own target in place of a copy of the screen).

**New.** A document model with stable identities; targeted source edits, so a draw edit changes only
the lines it touches and comments survive; one session with one undo history for both views;
partitions (swimlanes), class diagrams with compartments, members, seven relationships, multiplicities
and roles; structured use-case descriptions; a layout block in the text for what is placed by hand;
a project file; PNG and vector PDF; a precision look; SVG text as outlines; a local draft; 12 notation
rules for the new diagram parts.

**Removed.** The v1 render path (`scene.ts`, `shapes.ts`, `svg.ts`, the two layout files,
`serialize.ts`, the old `draw.ts`). Copies are in the history at `d30af12`.

**Dependencies added.** CodeMirror 6 (MIT), pdf-lib and @pdf-lib/fontkit (MIT). No canvas or graph
library. dagre stays for ranking.

### Done in this session, in order

| Commit | What |
|---|---|
| `7fbb1d4` | export review: lines keep out of each other's channels, decision answers leave from corners, right-hand actors sit beside their use cases, SVG text as shapes |
| `6157bac` | the syntax reference covers v2 and is checked against the parser; the parser, printer and sync bugs that turned up |
| `8687e28` | write and export views: house rules, and two things the dark and phone review found |
| `792f455` | the export gallery and the audit: every fixture in both looks as SVG, PNG and PDF, with review sheets |
| `5a764c7` | the revamp documents; `CLAUDE.md` for v2 |
| `3488c7e` | a line from a shape to itself is drawn |
| `e445ed3` | browser tests for scenarios M to X, the six bugs they found fixed, the findings list in Draw |
| `0874459` | project documents for v2: architecture, readme, the four specs, a user guide |
| `335c262` | accessibility pass |
| `e402429` | the gallery gains the reflexive class fixture; the views captured in light and dark at three widths |
| `f7f56ee` | a drop in a big diagram is four times quicker |
| `1f0da74` | draw sets build-up steps; undo keys work anywhere in the draw view; horizontal lanes driven by pointer |

Before it: `7d58cd0` (the v2 core), `1a1e46f` (the checkpoint), `70c9c27` (the handoff).

## 4. Evidence

- **The interface stayed familiar.** `baseline/` holds 20 screenshots of the tool before (write, draw
  and the syntax; light and dark; 1440, 820 and 390 px). `after/` holds 33 of the tool now at the same
  sizes. The header, the wordmark, the views row, the buttons, the fonts, the colors and the footer
  are the same. The draw view is rebuilt, as the brief asked. `UI_PRESERVATION_CONTRACT.md` section 5
  lists every change, and the departures worth the owner's eye.
- **Exports.** `baseline/exports/` holds the v1 SVG of each fixture and a sheet of it at 600, 420 and
  240 px. `gallery/` holds every fixture now, as SVG, PNG and PDF in both looks (18 fixtures, 36
  exports, 144 files), each with a sheet at the same three widths, the SVG also drawn by librsvg and
  the PDF by pdf.js. Every sheet was looked at. At 420 px, a report column, all but `dense` (20
  shapes in 4 lanes, which needs a full page) can be read. What still reads less than well is listed
  in `EXPORT_QUALITY_AUDIT.md` section 6.
- **Old files and embeds.** The v2 parser is tested against the v1 parser on every v1 file: the same
  document, and the same error on the same line for files with mistakes (22 tests). The embed's 52
  browser tests from v1 (hash format, host messages, theme sync, steps, hostile labels) pass
  unchanged, apart from the one export contract changed on purpose (`BASELINE_AUDIT.md` section 7).

## 5. Readiness scorecard

Four words, used exactly: **built** (the code exists), **tested** (an automated test asserts it and
passes), **looked at** (rendered and reviewed in this session), **ready** (I would ship it without
another check). Nothing below is marked ready without saying what stands between it and that.

| # | Area | Built | Tested | Looked at | Ready? |
|---|---|---|---|---|---|
| 1 | Draw canvas interaction | yes | yes: 21 pointer and keyboard tests (repeated empty placement, type in place, drag at several zooms, resize, marquee, align, copy and paste, keyboard) | yes: light and dark at 1440, 820 and 390 px; new canvas-first acceptance screenshot | Ready for Chromium desktop use. Touch has never been run |
| 2 | Connector editing and routing | yes | yes: pointer and keyboard initiation, self-connect, reconnect, bend, restyle, label drag, include and extend, multiplicities; router unit tests | yes: every gallery sheet | Close. Two arrows into one side can share their last 0.2 in; other browsers and touch remain unverified |
| 3 | Swimlanes | yes | yes: build three lanes, cross-lane flows, divider drag, move between lanes, rename, reorder, duplicate, delete; vertical and horizontal | yes | Yes for the cases tested. No lanes inside lanes, by design for now |
| 4 | Write editing and diagnostics | yes | partly: typing, errors with lines, the syntax reference against the parser (17 tests). Completions, find and replace, and tidy have no browser test | yes | Close. The untested editor features work by hand |
| 5 | UML correctness | yes | yes for what the rules say: the v1 rules are a verified port; the 12 v2 rules have unit tests | n/a | Not yet. The v2 rules have not been read against the UML 2.5.1 text. An interface's own stereotype is parsed but not drawn |
| 6 | Class diagrams | yes | yes: compartments, members typed in place and in the panel, growth without overlap, multiplicities and roles at the right ends, reflexive lines | yes: the 3 class fixtures in the gallery | Close, subject to item 5 |
| 7 | Round trips between write and draw | yes | yes: 69 sync tests, 23 session tests, scenarios M and N | n/a | Yes. Every draw edit is re-parsed before it is kept, and refused if the text would not read |
| 8 | Continuity with the redesigned UI | yes | house rules tested in the reference; the rest is not a thing a test can hold | yes: before and after, both themes, three widths | Needs the owner's eye. The departures are listed in the contract, section 5 |
| 9 | Export quality: SVG, PNG, PDF | yes | yes: each format in both looks for three diagram types is the file the dialog described; exact pixel sizes; no CSS variables or classes; fonts embedded in the PDF | yes: all 18 sheets at 600, 420 and 240 px, in a second renderer | Not yet. No file has been opened in PowerPoint, Word, Keynote, Inkscape or Illustrator, and none has been printed |
| 10 | Save and reload | yes | yes: project file and `.ksd` for three diagram types, identities, hostile files, refresh, back, the local draft | n/a | Yes |
| 11 | Accessibility | yes | partly: tab semantics, keyboard connector initiation, canvas keyboard paths, step keys; axe-core run by hand with no contrast failures | yes | Not yet. No screen reader has been used. Reduced motion not checked in a browser |
| 12 | Performance | yes | yes: frame times asserted at 50 and 100 shapes | measured | Acceptable on this desktop: about 28 redraws a second while dragging at 100 shapes, a drop in about 230 ms. Not measured on a slower machine. An embed's script is 71 KB gzipped, up from 46 |
| 13 | Automated and manual QA | yes | 473 unit and 105 browser tests, none skipped | 34 screenshots and 18 export sheets reviewed | Good for Chromium on a desktop. No other browser, no touch device, no pixel-diff regression test |

**Overall.** The tool works end to end and is tested more deeply than a count of tests suggests:
the tests for scenarios M to X found six real defects, and all six are fixed. It is ready for the
owner to use and judge. It is not ready to deploy without a look at exports in the programs people
will paste them into, an independent UML rules audit, and a pass in Safari and on a phone.

## 6. The acceptance demonstration, step by step

Each step of the brief's demonstration, and the test that performs it with a real pointer or keyboard.

| Step | Held by |
|---|---|
| 1. Open the familiar interface | `playground.spec.ts` "starts with the example"; `after/write-light-1440.png` beside `baseline/write-light-1440.png` |
| 2. Enter Draw and see a workable canvas | `playground.spec.ts` "write, draw and syntax views"; `draw.spec.ts` A |
| 3. Create a three-swimlane activity diagram | `draw.spec.ts` I |
| 4. Drag actions into lanes | `draw.spec.ts` I and J |
| 5. Double-click and type without interruption | `draw.spec.ts` B, one character at a time |
| 6. Resize and align | `draw.spec.ts` D and K |
| 7. Connect by dragging ports with visible snapping | `draw.spec.ts` E |
| 8. Change a route and styling | `draw.spec.ts` G and H |
| 9. Add a decision with labeled guards | `draw.spec.ts` A (decision from the palette), "a line's label is edited in place" |
| 10. Move shapes and lane boundaries, lines stay attached | `draw.spec.ts` C and J |
| 11. Undo and redo several transactions | `draw.spec.ts` J, K and "undo and redo keys work after a click in the properties panel" |
| 12. Switch to Write, see it faithfully, edit it | `flows.spec.ts` N |
| 13. Switch back without losing geometry or content | `flows.spec.ts` M and N |
| 14. Save and reopen | `flows.spec.ts` S (4 tests) |
| 15. Export SVG and PNG fit for a slide or a report | `flows.spec.ts` T and X; `gallery/` |
| 16. Import and render an old `.ksd` | `doc-parse.test.ts` (differential), `fixtures.spec.ts` |
| 17. Load an existing embed without breaking the host | `host.spec.ts`, `embed.spec.ts` |
| Second: a class diagram with compartments, relationships and multiplicities, exported cleanly | `flows.spec.ts` Q, R, S (class) and T (class-orders); `gallery/class-*.sheet.png` |

The steps are held by separate tests. There is no single test that walks all 17 in one session.

## 7. Known gaps and defects

Not done:

- Sequence, state, package, component and deployment diagrams (the brief places them later).
- No lanes inside lanes. No notes attached to a specific shape. No object nodes.
- No generic grouping and no bring-forward or send-back, on purpose: containment is the grouping
  these diagram types have, and shapes never rightly overlap.
- The canvas clipboard is Chalk's own, in memory. It does not use the system clipboard.
- The canvas does not fit itself again after "tidy up".

Small things found and left, each a few lines to change once decided:

- An interface's own stereotype is parsed and kept but never drawn.
- `lanes` and `look` header lines are accepted without a word in diagram types where they do nothing.
- A bare `pool` line with no name prints nothing.
- Button titles name Ctrl only; on a Mac the key is Cmd (the keys themselves work with both).
- The armed palette button uses a check mark character (U+2713) and the member "move up" button an
  arrow (U+2191). They are text characters, not an icon pack. Whether they fit the house rules is the
  owner's call.
- `site/DiagramEmbed.astro` has no `look` prop. A `look` line in the diagram's own text does the job.
- The doc comment on `Session.load()` describes an earlier version.
- The parse error for a bad placement still says "(left, right, at X Y)". It must match the v1
  reference message, so it changes in the Python reference first.

Not verified, anywhere:

- Firefox and Safari. Touch devices. A screen reader. Printing.
- Exports opened in PowerPoint, Word, Keynote, Google Slides, Inkscape, Illustrator or Figma.
- `npm run fixtures`: this machine has no python3, so the Python-generated fixtures were not
  regenerated. They were not edited either.
- The v2 notation rules against the UML 2.5.1 specification.

## 8. What to do next

1. The owner walks the canvas-first acceptance workflow and looks at `after/` and `gallery/`.
2. Open a handful of gallery files in PowerPoint and Word, and print one. Fix what that shows.
3. Run the tool in Firefox, Safari, and on a phone and a tablet. Fix what that shows.
4. Read the 12 v2 rules against the UML 2.5.1 text.
5. Decide the small things in section 7.
6. After any follow-up changes, rerun the complete verification suite and redeploy.
