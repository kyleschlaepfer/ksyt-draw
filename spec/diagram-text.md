# The diagram text format (.ksd), v2

One diagram per file. The text is the whole diagram: what it means, and anything the author arranged by hand. This file states the grammar and the contract. The full reference with every kind, message and example is the in-app page `src/play/docs.html` (write, "the syntax").

## 1. Sources of truth

| What | Where | Checked by |
|---|---|---|
| reading | `src/core/doc/parse.ts` (`parseSource`) | `test/doc-parse.test.ts` |
| writing | `src/core/doc/print.ts` (`printDoc` and one printer per statement) | `test/doc-sync.test.ts` |
| the document it becomes | `src/core/doc/types.ts` (`ChalkDoc`) | |
| the reference people read | `src/play/docs.html` | `test/docs.test.ts`: every kind, operator, header word, rule code, message and embed parameter is covered, and every example parses |
| the v1 format | `reference/ksd_parse.py`, ported in `src/core/parse.ts` (frozen) | `test/parse.test.ts` |

If this file and the parser disagree, the parser is right and this file has a bug.

## 2. The contract

1. **v2 is a superset of v1.** Every v1 file reads as the same diagram. Every input in `fixtures/parse-errors.json` fails on the same line with the same message, except the two messages that list the diagram types, which now also name `class`. `test/doc-parse.test.ts` checks both against the fixtures the Python reference wrote.
2. **The text is complete.** Positions, sizes, routes, label positions and styles set in the draw view live in a `layout { }` block in the same file. A link, an embed and a saved `.ksd` carry the arrangement.
3. **Reading then writing loses nothing that matters.** `printDoc(parse(text))` parses back to the same document.
4. **A draw edit touches only the lines it changes.** Comments, blank lines, statement order and spacing stay as the author left them (`syncSource` in `src/core/doc/sync.ts`).
5. **A mistake never blanks the figure.** The parser reports every bad line and goes on. A text with any error gives no document; callers keep the last good one.
6. **No em dashes.** One anywhere in a title, label or description is an error. House rule.

## 3. Lines

- One statement per line. Leading and trailing spaces are ignored; indentation is for the reader.
- A blank line is ignored.
- A line that starts with `#` is a comment. One exception: inside a class block, `#name` (a letter or underscore straight after the `#`) is a protected member.
- An id is a letter, then letters, digits, `-` or `_`. Ids are unique per file, containers included.
- Quoted text uses double quotes. `\n` breaks a line, `\"` is a quote, `\\` is a backslash.
- Numbers in positions and sizes are inches, as decimals.

## 4. Grammar

```
file        = "diagram" type NL { header } { body }
type        = "flowchart" | "activity" | "use-case" | "class"

header      = "id" ID
            | "title" text
            | "profile" ( "strict-uml" | "uml-inspired" | "general-diagram" )
            | "desc" text
            | "narration" text
            | "direction" ( "down" | "right" )
            | "legend" text
            | "lanes" ( "vertical" | "horizontal" )
            | "look" ( "sketch" | "precision" )

body        = node | container | class | edge | step | describe | layout

node        = kind ID [ quoted ] { "left" | "right" | "at" X Y | "size" W H }
kind        = "action" | "process" | "decision" | "merge" | "fork" | "join"
            | "initial" | "final" | "flow-final" | "terminator" | "io"
            | "actor" | "use-case" | "usecase" | "note" | "start" | "end"

container   = "boundary" ID quoted "{" NL { node | edge | step } "}"
            | ( "partition" | "lane" | "swimlane" ) ID quoted "{" NL { node | edge | step } "}"

class       = [ "abstract" ] ( "class" | "interface" ) ID [ quoted ] [ stereotype ]
              { "at" X Y | "size" W H } [ "{" NL { member NL } "}" ]
stereotype  = "<<" text ">>" | "«" text "»"
member      = [ "+" | "-" | "#" | "~" ] name [ ":" type-text ]              (attribute)
            | [ "+" | "-" | "#" | "~" ] name "(" params ")" [ ":" type-text ]   (operation)
              with "{static}" or "{abstract}" before or after

edge        = ID [ quoted ] op [ quoted ] ID [ ":" text ]
op          = "->" | "-->" | "--" | "-include->" | "-extend->" | "..>"
            | "--|>" | "<|--" | "..|>" | "<|.." | "o--" | "--o" | "*--" | "--*"

step        = "step" whole-number

describe    = "describe" ID "{" NL { field text NL } "}"
field       = "goal" | "primary" | "supporting" | "trigger" | "pre"
            | "main" | "alt" | "post" | "related"

layout      = "layout" "{" NL { layout-line NL } "}"
layout-line = "place" ID X Y
            | "size" ID W H
            | "lane" ID thickness
            | "pool" [ "at" X Y ] [ "length" L ]
            | "route" edge-ref ( "straight" | "elbow" ) [ "from" side ] [ "to" side ] [ "via" X Y { "," X Y } ]
            | "label" edge-ref t dx dy
            | "style" ID [ "fill" fill ] [ "color" color ] [ "weight" weight ]
            | "style" edge-ref [ "color" color ] [ "weight" weight ]
edge-ref    = ID op ID [ "#" n ]
side        = "top" | "right" | "bottom" | "left"
fill        = "none" | "page" | "wash"
color       = "ink" | "ink-2" | "accent" | "accent-strong" | "terra"
weight      = "thin" | "normal" | "bold"
```

Spaces around an edge's operator are required. The header ends at the first body line.

## 5. Header

| Line | Required | Meaning |
|---|---|---|
| `diagram <type>` | yes, first line | the claimed diagram type. A wrong first line stops the parse |
| `title <text>` | yes | what the figure shows (its finding, not its topic). Becomes the SVG `<title>` |
| `id <slug>` | no, default `diagram` | the diagram's id. It seeds every element's wobble and names downloaded files |
| `profile <name>` | no | how strictly the notation is checked. Default: flowchart `general-diagram`; the others `uml-inspired` |
| `desc <text>` | no | the text alternative. When missing, `src/core/describe.ts` writes one from the structure |
| `narration <text>` | no, repeatable | the words the diagram goes with. Lines are joined with a space. The notation check uses it |
| `direction down` or `right` | no, default `down` | which way a flow runs |
| `legend <text>` | no | declares arrow meanings; silences the mixed-meaning rule |
| `lanes vertical` or `horizontal` | no | which way partitions lie. Without it they follow the direction |
| `look sketch` or `precision` | no, default `sketch` | which look the figure is drawn in |

`lanes` and `look` are header words only when exactly one value follows. `look -> buy` is still an edge from a node called `look`, as it was in v1.

## 6. Nodes

```
<kind> <id> ["label"] [left|right] [at X Y] [size W H]
```

| Kind | Meant for | Drawn as | Default label |
|---|---|---|---|
| `process` | flowchart | square-cornered box | the id, with `-` and `_` as spaces |
| `terminator` | flowchart | pill | id as words |
| `io` | flowchart | parallelogram | id as words |
| `action` | activity | rounded box | id as words |
| `decision` | flowchart, activity | diamond with the question inside | id as words |
| `merge` | flowchart, activity | small empty diamond | none |
| `initial` | activity | solid dot | none |
| `final` | activity | bullseye | none |
| `flow-final` | activity | circle with an X | none |
| `fork`, `join` | activity | thick bar | none |
| `actor` | use-case | stick figure with its role below | id as words |
| `use-case` (also `usecase`) | use-case | ellipse | id as words |
| `note` | any | graphite handwriting, no box | id as words |
| `start`, `end` | flowchart, activity | flowchart: a `terminator` labeled start or end. Activity: `initial` or `final` | |

- `left` or `right` says which side an actor stands on. Default left.
- `at X Y` pins the node's center. `size W H` sets its width and height. Written on the node's own line, they stay on that line when the draw view changes them. Otherwise the draw view keeps them in the layout block.
- `start` and `end` are errors in use-case and class diagrams.
- The parser does not tie these kinds to a diagram type. A shape from another notation parses, and the notation check reports it.

## 7. Containers

```
boundary portal "Permit portal" {
  use-case apply "apply for permit"
}

partition clerk "Clerk" {
  action check "check the form"
}
```

- A node declared inside gets that container as its `parent`.
- Containers do not nest.
- `boundary` is the system boundary of a use-case diagram. It is an error in a class diagram. An actor inside a boundary parses on purpose: the notation check reports it (`UC-ACTOR-INSIDE`).
- `partition` (also `lane`, `swimlane`) is a swimlane. It belongs to activity diagrams and flowcharts only. Lanes are laid out in file order.

## 8. Classes

Class diagrams only.

```
abstract class Shape <<entity>> {
  +name: String
  #area(): Number {abstract}
  +count: int {static}
}
interface Drawable {
  +draw(canvas: Canvas)
}
class Point
```

- `class` and `interface` take an id, an optional quoted label (default: the id exactly as typed), an optional stereotype, and optional `at` and `size`.
- A `{` at the end of the line opens the member block. One member per line until `}`.
- Visibility marks: `+` public, `-` private, `#` protected, `~` package.
- A member with parentheses is an operation; without, an attribute. A member name has no spaces.

## 9. Edges

```
a <operator> b [: label]
a "end text" <operator> "end text" b [: label]      (class diagrams)
```

| Operator | Flowchart, activity, use-case | Class |
|---|---|---|
| `->` or `-->` | arrow: control flow | association, navigable toward `b` |
| `--` | association: actor to use case | association |
| `-include->` | «include»: base use case to the included one | error |
| `-extend->` | «extend»: extension to the base use case | error |
| `..>` | a proposed or hypothetical path | dependency |
| `--\|>` or `<\|--` | error | generalization: child to parent |
| `..\|>` or `<\|..` | error | realization: class to interface |
| `o--` or `--o` | error | aggregation: the diamond sits at the whole |
| `*--` or `--*` | error | composition: the diamond sits at the whole |

- A reversed form (`<|--`, `<|..`, `--o`, `--*`) means the same as its mirror with the ends swapped.
- `: label` sets the line's label: `ok -> schedule : yes`, `ok -> schedule : [approved]`.
- **End text** (class diagrams only) is a quoted string next to an end: a multiplicity (`*`, `1`, `0..1`, `1..*`), then optional role words. `Customer "1" -- "0..* orders" Order`. Text that does not start with a multiplicity is a role name.
- Both ends may name the same node: `Employee "0..1 manager" -- "* reports" Employee : manages`. The line is drawn round a corner of the shape. The notation check reports the ones that cannot be true (`STRUCT-SELF-LINE`).
- Lines get ids `e1`, `e2`, ... in file order. Findings in the notation check use them.
- A line to an undeclared id is kept. It adds the warning `PARSE-UNKNOWN-NODE`, the notation check reports `STRUCT-DANGLING-EDGE`, and it is not drawn.

## 10. Build-up steps

`step <n>` applies to every node and line after it, until the next `step` line. Step 0 is everything before the first one. The embed shows step 0 first and the reader clicks through. Use steps when the order of the parts is the lesson.

## 11. Use-case descriptions

Use-case diagrams only.

```
describe apply {
  goal The resident gets a permit application on file
  primary resident
  trigger The resident opens the portal
  pre The resident has an account
  main The resident fills in the form
  main The portal checks the form
  alt The form is incomplete: the portal says what is missing
  post The application is on file
}
```

- The id must be a use case declared above the block. One block per use case.
- `goal`, `primary` and `trigger` hold one value; a second line replaces the first.
- `supporting`, `pre`, `main`, `alt`, `post` and `related` are lists: one entry per line, kept in order.
- The description is part of the document and of the notation check (section 3 of `spec/lint.md`). It is not drawn in the figure.

## 12. The layout block

```
# layout: written by the draw view. Delete a line to hand that part back to automatic layout.
layout {
  pool at 0.5 0.5 length 9
  place check 2.4 1.1
  size check 1.8 0.7
  lane clerk 2.6
  style check fill wash weight bold
  route check -> ok elbow from bottom to top via 2.4 2, 3.1 2
  label check -> ok 0.3 0.1 -0.12
  style check -> ok color terra
}
```

| Line | Sets |
|---|---|
| `place <id> X Y` | the node's center |
| `size <id> W H` | the node's width and height, both above zero |
| `lane <id> <thickness>` | how thick a partition is, across the flow |
| `pool [at X Y] [length L]` | where the block of lanes starts, and how long it is at least |
| `route <a op b> straight\|elbow ...` | the line's kind of route, the sides it leaves and arrives by, and its bend points. `via` comes last |
| `label <a op b> <t> <dx> <dy>` | the label's place: `t` along the line from 0 to 1, then an offset |
| `style <id> ...` | a node's fill, color and weight, as theme roles |
| `style <a op b> ...` | a line's color and weight |

- One block per file, at the top level. `printDoc` writes it last.
- A layout line names a line by its ends and operator, in the standard form. When several lines join the same ends the same way, `#2` picks the second.
- The block is applied after the rest is read, so it can sit anywhere. A line that names something undeclared, places a node twice, or gives `lane` to something that is not a partition is kept and does nothing, with the warning `LAYOUT-UNKNOWN-REF`.
- Colors and fills are theme roles, never hex. There is no way to write a color of your own.
- Deleting a line hands that part back to automatic layout.

## 13. The standard form

`printDoc` and "tidy" write each statement one way.

- Header order: `diagram`, `id`, `title`, `profile`, `desc`, `narration`, `direction`, `legend`, `lanes`, `look`. A value that equals its default is left out.
- Then nodes (a container's children indented two spaces, a class's members indented two spaces), a blank line, lines, `describe` blocks, the layout block.
- A label equal to the default is left out.
- Aliases are rewritten: `usecase` to `use-case`, `lane` and `swimlane` to `partition`, `initial` and `final` in an activity diagram to `start` and `end`, a flowchart `terminator` labeled start or end to `start` or `end`.
- Operators are rewritten: reversed forms to their mirror with the ends swapped, `->` between classes to `-->`, `-->` in a flow to `->`.
- Members print as `+name: Type {static}`.
- Numbers print with up to three decimals.

"tidy" (`formatSource`) rewrites each line in place and keeps comments and order. A draw edit (`syncSource`) rewrites only the lines whose standard form changed.

## 14. Errors and warnings

`parseSource()` returns `{ text, lines, eol, doc, stmts, diagnostics }`.

- Each diagnostic has a severity, a code, a message, a line, and a column range for the editor to underline.
- Errors have the code `PARSE`. Any error makes `doc` null.
- Whole-file errors carry line 0: an empty file, no `title`, a block never closed with `}`.
- Only two mistakes stop the parse at once: a first line that is not `diagram <type>`, and an unknown type.
- Warnings leave the document valid: `PARSE-UNKNOWN-NODE` and `LAYOUT-UNKNOWN-REF`.
- `firstError()` gives the first error in v1's shape. `parseDoc()` throws it as a `ParseError`.

Messages say how to fix the line ("a diagram needs a title: one line saying what it shows (its finding, not its topic)"). The full list is in the reference under "errors", and `test/docs.test.ts` fails when a parser message is missing from it.

## 15. Identity

- Every node and line has a `uid` that is never typed or shown. It survives renames.
- After a re-parse, `adoptUids()` gives the new document the uids of the one it replaces: nodes by id, lines by ends and kind (the n-th of several). Selection and undo survive typing.
- `stmts` maps each source line to the node or line it declares. The editor uses it to link the cursor to a shape, and `syncSource` uses it to find the line to change.

## 16. What the reviewer sees

The notation check reads the reviewer's contract 1.0, the JSON shape v1 produced. `toContract()` in `src/core/doc/contract.ts` projects the document onto it.

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

For a v1 file this is the object the Python reference writes for the same text. For v2 content: a partition is projected as a boundary, an interface as a class, and multiplicities as `card_from` and `card_to`.

## 17. The project file

`.chalk.json` (`src/core/doc/project.ts`) wraps the text for saving: `format: "chalk-project"`, `version: 2`, `source` (the `.ksd` text, which is authoritative), `model` (the document as JSON, for other programs to read), and `workspace` (viewport and export choices). Opening one re-parses `source`. If the text is missing or broken, the model is checked field by field and printed back to text.

## 18. Example

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

More examples, one per diagram type, are in `src/play/examples.ts` and `fixtures/v2/`.
