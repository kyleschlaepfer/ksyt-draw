# The diagram text format (.ksd)

One diagram per file. Line-based, `#` starts a comment, blank lines are ignored. The executable spec is `reference/ksd_parse.py`; `src/core/parse.ts` must produce the same JSON for every `fixtures/diagrams/*.ksd` (compare to the matching `.json`) and fail on every input in `fixtures/parse-errors.json` with the same line number.

## Header (before the first node or edge)

| Line | Required | Meaning |
|---|---|---|
| `diagram flowchart` / `activity` / `use-case` | yes, first line | the claimed diagram type |
| `title <text>` | yes | what the figure **shows** (its finding, not its topic). Becomes the SVG `<title>` and the iframe's default title |
| `id <slug>` | no (default `diagram`) | diagram id; prefixes every element's wobble seed |
| `profile strict-uml` / `uml-inspired` / `general-diagram` | no | defaults: flowchart → `general-diagram`; activity, use-case → `uml-inspired` |
| `desc <text>` | no | the text alternative, in reading order. If missing, `describe.ts` writes one from the structure |
| `narration <text>` | no, repeatable (joined with a space) | the words this diagram goes with; the linter uses it for «include» direction and either/or vs. at-the-same-time cues |
| `direction down` / `right` | no (default `down`) | flow layout direction (flowchart, activity) |
| `legend <text>` | no | declares arrow meanings; silences the mixed-meaning rule |

## Nodes

```
<kind> <id> ["label"] [left|right] [at X Y]
```

| Kind | Diagram | Drawn as | Default label |
|---|---|---|---|
| `process` | flowchart | square-cornered box | id with `-`/`_` as spaces |
| `action` | activity | rounded box | id as words |
| `decision` | both | diamond, question inside | id as words |
| `merge` | both | small empty diamond | none |
| `terminator` | flowchart | pill | id as words |
| `io` | flowchart | parallelogram | id as words |
| `initial` | activity | solid dot | none |
| `final` | activity | bullseye | none |
| `flow-final` | activity | circle with an X | none |
| `fork`, `join` | activity | thick bar | none |
| `actor` | use-case | stick figure (never the narrator) with role below | id as words |
| `use-case` (alias `usecase`) | use-case | ellipse | id as words |
| `note` | any | graphite handwriting, no box | id as words |
| `start`, `end` | flowchart → `terminator` labeled "start"/"end"; activity → `initial`/`final` | | |

- Ids: a letter, then letters, digits, `-`, `_`. Unique per file (including boundaries).
- Labels: double quotes; `\n` breaks a line, `\"` is a quote. **No em dashes** (parse error, house rule).
- `left` / `right`: which side an actor stands on (use-case; default left).
- `at X Y`: pin the node's center in inches (overrides auto layout for that node). This is also how the future editor will save a drag.

## Boundaries (use-case)

```
boundary <id> "System name" {
  use-case ...
}
```

Nodes inside get `"inside": "<boundary id>"`. One level only (no nesting). An actor inside a boundary is allowed by the parser on purpose: the linter reports it (`UC-ACTOR-INSIDE`).

## Edges

Spaces around the operator are required.

| Line | Kind (contract) | Style | Directed | Use |
|---|---|---|---|---|
| `a -> b` (or `a --> b`) | `arrow` | `solid-arrow` | yes | control flow; in use-case diagrams the linter reads it as a directed association |
| `a -- b` | `association` | `plain-line` | no | actor to use case |
| `a -include-> b` | `include` | `dashed-arrow` | yes | base use case to the included one |
| `a -extend-> b` | `extend` | `dashed-arrow` | yes | extension to the base use case |
| `a ..> b` | `arrow` + `meaning: "proposed"` | `dashed-arrow` | yes | a proposed or hypothetical path |

`: label` after any edge sets its label (`ok -> schedule : yes`, `ok -> schedule : [approved]`). Edges get ids `e1, e2, ...` in file order. An edge to an undeclared id is kept (the linter reports `STRUCT-DANGLING-EDGE`, the renderer skips it) and adds a `PARSE-UNKNOWN-NODE` warning.

## Build-up steps

`step <n>` applies to every node and edge after it, until the next `step` line. Step 0 is everything before the first `step`. The embed shows step 0 first and the reader clicks through (`back`, `next step`, `show all`), the web version of a phased slide. Use steps when the order of parts is the lesson; give each step one idea, in the order the narration introduces them.

## Output shape

```json
{
  "contract_version": "1.0", "diagram_id": "permit-portal", "claimed_diagram_type": "use-case",
  "notation_profile": "uml-inspired", "narration_excerpt": "...", "legend": null,
  "nodes": [{"id": "apply", "kind": "use-case", "label": "apply for permit", "step": 0, "inside": "portal"}],
  "edges": [{"id": "e4", "kind": "include", "from": "apply", "to": "pay", "label": null,
             "style": "dashed-arrow", "directed": true, "step": 0}],
  "web": {"title": "...", "desc": "...", "direction": "down", "warnings": []}
}
```

Key order doesn't matter; compare parsed objects, not strings. `meaning` appears only on `..>` edges, `side` and `at` only when given, `inside` only inside a boundary.

## Errors (stop rendering; show line and message)

First line isn't `diagram <type>` · unknown type, kind, profile or option · duplicate id · bad `boundary` line or nesting · unclosed boundary or stray `}` · `at` without two numbers · `start`/`end` in a use-case diagram · em dash anywhere · no `title`. Messages say how to fix it ("a diagram needs a title: one line saying what it shows").

## Example

```
diagram activity
id onboarding
title A new hire's laptop and badge are prepared at the same time
narration After the offer is accepted, IT orders the laptop and security prints the badge at the same time.

start begin
action accept "accept offer"
begin -> accept

step 1
fork split
action laptop "order laptop"
action badge "print badge"
accept -> split
split -> laptop
split -> badge

step 2
join wait
action first "first day"
end done
laptop -> wait
badge -> wait
wait -> first
first -> done
```
