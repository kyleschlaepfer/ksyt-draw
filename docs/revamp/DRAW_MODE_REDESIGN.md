# Draw mode canvas-first redesign

Written 2026-11-05 for the canvas-first implementation in
`prompts/KSYT_DRAW_CANVAS_FIRST_REDESIGN.md`.

## Why the previous Draw workflow felt restrictive

The underlying canvas was more capable than the visible workflow suggested. It already supported
dragging, selection, resizing, inline labels, connected routing, one undo history, persistence and
export. The restrictive experience came from the shell around it:

- New diagrams opened as completed examples instead of asking for a type and opening a free canvas.
- Palette items were text pills. A user had to read the control before recognizing the symbol.
- A newly placed shape received visible generated text, which made placement feel like schema entry
  rather than free visual construction.
- Relationship choice was a form select. It was not an authoring tool with a source and target state.
- The properties panel opened over the canvas, including on a fresh document.
- `canConnect()` rejected self-links and some invalid endpoint combinations before the notation
  checker could explain them.
- Pointer ports were the only way to begin a connector.

The document model was not the cause. `ChalkDoc` already separates semantic content, geometry,
presentation, stable identity and persistence, and the complete `.ksd` projection preserves all of
those layers.

## Architecture decision

Keep the purpose-built SVG interaction layer and the existing core pipeline:

```
Draw gesture or keyboard action
  -> document command
  -> Session transaction and undo history
  -> targeted .ksd synchronization
  -> parse verification
  -> shared geometry
  -> shared canvas, preview and export rendering
```

This is smaller and safer than introducing a second canvas state system. The canvas does not own
diagram geometry, so retaining it does not couple the document to the editor. The implementation
changes its tools, authoring states and responsive layout while preserving the tested router,
renderer, export pipeline and persistence contract.

## Interaction model

- **Type first:** New opens an accessible diagram-family picker. Choosing a family creates that
  document and enters Draw. The chosen family is visible in the Draw header and scopes both symbol
  and relationship libraries.
- **Canvas first:** the symbol library is collapsible, the inspector is docked and collapsed on a
  fresh canvas, and the canvas occupies the flexible center column.
- **Shape first:** Draw-created labeled shapes use an empty quoted label. Their internal id is still
  valid and stable, but no generated content is imposed on the picture. Empty labels survive text,
  project, local-draft and export round trips.
- **Two placement routes:** drag a graphical symbol to a coordinate, or arm it and click repeatedly
  until Escape or a tool change.
- **Two connection routes:** drag from a visible port, or arm a relationship tool and choose source
  and target. The tool route works with pointer selection and keyboard selection.
- **Validation after commands:** notation findings never veto placement, movement, content editing,
  saving or a technically representable connection. The diagnostic surface remains compact until
  opened and its Show it action selects and reveals the target.
- **Context, not forms:** direct manipulation remains primary. The inspector supplements inline
  editing and spatial gestures with precise and advanced fields.

## Write and Draw contract

Text remains the durable, complete source of truth. Draw is not implemented by requiring a user to
author valid syntax, but every successful visual command is projected into targeted text edits and
reparsed before commit. The layout block preserves positions, sizes, routes, label positions and
styles. Stable uids are restored during parsing and from project identity data.

An empty visible label is represented explicitly as `""`, which is distinct from an omitted label
whose display default is the id. This makes an unfinished visual object lossless in Write, Draw,
save/open, links and export.

Changing to a different diagram family is treated as creating a new diagram, because the current
grammar cannot represent every family's symbols under another family header. The UI explains this
and uses the normal undoable open operation, so the current document is not silently converted or
discarded. Direct in-place type coercion is not offered when it could make declarations invalid.

## Validation boundary

Only technical failures block a command: a missing object, invalid coordinates, corrupt text, or a
change that cannot be serialized and reparsed. UML and house-notation concerns are findings. In
particular, self-links and semantically questionable endpoints are stored and rendered first, then
reviewed. Diagram-family relationship tools stay relevant to the selected family; an invalid
combination within that family remains drawable and diagnosable.

The 12 v2 notation rules remain provisional because they have not been independently audited
against UML 2.5.1. This redesign does not strengthen or relabel them as verified UML requirements.

## Migration and risks

Existing documents need no schema migration. The explicit empty string is already accepted by the
parser and project sanitizer. Older documents continue to use their existing labels and layout.

The main risks are event-state regressions in connector creation, responsive loss of canvas space,
and source synchronization of empty labels and self-edges. Unit tests cover command and text round
trips; Playwright workflows cover pointer and keyboard construction, incomplete save/open, and the
negative requirement that invalid notation remains present.

Touch hardware, screen readers, Safari, Firefox and external office/vector applications remain
manual verification targets unless explicitly recorded as run in the implementation report.
