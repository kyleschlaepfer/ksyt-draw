# Lint: the notation check (v2)

The notation check has two parts:

1. **The reviewer's rules**, a port. `src/core/lint.ts` follows the `Review` class and `status_for` in `reference/review_diagrams.py` (diagram-semantics-reviewer 1.2). Same rule ids, severities, confidence, locations and wording, so a diagram gets the same verdict on the site as on a slide.
2. **The v2 rules**, written here. `rulesV2()` in `src/core/diagnostics.ts` covers what v2 added and the reviewer does not know yet: partitions, class members and relationships, use-case descriptions.

`review(d)` in `src/core/diagnostics.ts` runs both and gives one status. It is what every surface calls.

```ts
review(d: ChalkDoc): { inferred_family: string; status: LintStatus; findings: RuleFinding[] }
// = lint(toContract(d)).findings + rulesV2(d), with the status worked out over all of them
```

The lint never gets weaker to make a diagram pass.

## 1. The port

Don't write new reviewer rules in `lint.ts`. A rule changes in the Python reviewer first, the fixtures are regenerated with `npm run fixtures`, and `lint.ts` is matched to them.

### What is ported

- Constants: `STEP_KINDS`, `FLOW_KINDS`, `FAMILY_OF_NODE`, `NEUTRAL_NODES`, `TYPE_FAMILY`, `COMPATIBLE`, `UML_TYPES`, `ARROW_MEANING`, `MEANING_CLASS`, `EXCLUSIVE_CUES`, `PARALLEL_CUES`, `VERBS`.
- Helpers: `norm`, `cue`.
- `class Review`: `add` (profile handling: `uml_only` skipped under `general-diagram`, `strict_sev` under `strict-uml`), `label`, `kind`, `edge_kind`, `infer_family`, `check_structure`, `check_meanings_within`, `check_use_case`, `_narrated_direction`, `check_flow`, `check_erd`, `check_class`, `check_sequence`, `check_state`, `check_dfd`, `check_causal`, `run`.
- `status_for(findings, inferred, claimed)`.

The whole class is ported, not only the use-case and flow checks. Everything about layout, rendering, decks, exceptions files, versions and gates is left out.

```ts
export interface Finding { severity: "critical" | "major" | "minor" | "suggestion" | "unverified";
  rule_id: string; location: string; problem: string; rationale: string; minimal_fix: string;
  confidence: "high" | "medium" | "low"; }
export function lint(d: Diagram): { inferred_family: string; status: string; findings: Finding[] }
```

### What the port reads

`lint()` reads the reviewer's contract 1.0, not the v2 document. `toContract()` in `src/core/doc/contract.ts` makes that projection (section 16 of `spec/diagram-text.md`). In it a partition is a boundary, which the reviewer treats as a neutral container, and an interface is a class. Multiplicities become `card_from` and `card_to`, so the reviewer's own `CLASS-MULTIPLICITY` rule works on v2 class diagrams.

### Python-to-TypeScript traps (each one changes a result)

| Python | TypeScript |
|---|---|
| `dict` insertion order, `max(votes, key=votes.get)` returns the first key with the top count | a `Map`; iterate in insertion order and keep the first maximum |
| Truthiness: `[]`, `0`, `""`, `None` are false | test lengths and nullish explicitly |
| `a and b or c and d` | `(a && b) \|\| (c && d)`; check every mixed `and`/`or` line by hand |
| `e.get("directed", True)` | `e.directed ?? true` (default only when the key is missing) |
| `e.get("label") or e.get("guard")` | `e.label \|\| e.guard` (empty string counts as missing) |
| `"%r" % s` for a string | `pyRepr(s)` (Python repr with single quotes, as in `STRUCT-DANGLING-EDGE`'s problem text) |
| `re.escape` | a regex-escape helper |
| `re.search(p, text.lower())` | `new RegExp(p).test(text.toLowerCase())`; the cue patterns are ASCII, `\b` behaves the same |
| `norm`: lowercase, `[^a-z0-9 ]` to space, collapse whitespace, strip | same, in that order |
| `"%d of %d" % (a, b)` | template string |
| `defaultdict(list)` | `Map<string, Edge[]>` with a getter that returns `[]` |
| `{"a", "b"} <= c` (subset) | an explicit every-member check |

### Tests for the port

For every `fixtures/diagrams/*.json` (the parsed diagram), `lint()` must return the same `inferred_family`, the same `status`, and the same `full_findings` as the matching `*.lint.json`, after sorting both by `(rule_id, location)`. All fields are compared, including the wording. `test/lint.test.ts`.

Expected verdicts, for a quick read:

| Fixture | Status | Findings |
|---|---|---|
| flow-approval | pass | none |
| flow-unlabeled | changes-required | FLOW-DECISION-GUARD |
| activity-fork-either | changes-required | ACTIVITY-PARALLEL-VS-EXCLUSIVE |
| activity-parallel | pass | none |
| usecase-permit | pass | none |
| usecase-include-reversed | changes-required | UC-INCLUDE-DIRECTION (high, from the narration) |
| usecase-is-flow | blocked | FAMILY-USECASE-IS-FLOW (critical) |
| usecase-actor-inside | changes-required | UC-ACTOR-INSIDE, UC-ASSOC-DIRECTED |
| dangling | changes-required | STRUCT-DANGLING-EDGE |

## 2. Status

`statusFor()` in `src/core/lint.ts`, over the reviewer's findings and the v2 findings together:

| Status | In words | When |
|---|---|---|
| `blocked` | blocked | any critical finding |
| `changes-required` | needs changes | any major finding |
| `pass-with-notes` | pass with notes | only minor findings or suggestions |
| `pass` | pass | no findings |

The reviewer also has `unverified` and `not-a-diagram`. The four diagram types the text format can write do not reach them.

## 3. The v2 rules

**These rules have not yet been reviewed against the OMG UML 2.5.1 text.** Treat their severities and wording as provisional until that review is done, and move them into the reviewer once it is.

They follow the reviewer's conventions so the move is a copy: an id, a severity, a location, a problem, why it matters, and the smallest fix. A rule marked "UML only" stays quiet under `general-diagram`. Under `strict-uml` some severities rise. Unlike the reviewer's findings, each v2 finding names the nodes and lines it is about, so the UI does not have to read them out of the location text.

| Rule | Severity | Under strict-uml | UML only | What it catches |
|---|---|---|---|---|
| `STRUCT-SELF-LINE` | major | | | a line from a shape to itself that cannot be true: a use case that includes or extends itself, any other self line in a use-case diagram, a class that realizes or depends on itself |
| `ACT-PARTITION-OUTSIDE` | minor | major | yes | a node outside every partition, in a diagram that has partitions. Notes and boundaries are let off |
| `ACT-PARTITION-EMPTY` | suggestion | | | a partition with nothing in it |
| `ACT-PARTITION-SINGLE` | suggestion | | | only one partition |
| `CLASS-GENERALIZATION-CYCLE` | major | | | classes that inherit from each other in a circle |
| `CLASS-REALIZATION-TARGET` | minor | major | yes | a realization that points at something that is not an interface |
| `CLASS-GENERALIZATION-INTERFACE` | minor | | yes | a class joined to an interface by a generalization |
| `CLASS-DUPLICATE-MEMBER` | minor | | | the same member twice in one class: same name, parameters and type |
| `CLASS-ABSTRACT-OPERATION` | minor | major | yes | a member marked `{abstract}` in a class that is not abstract |
| `UC-DESCRIBE-PRIMARY` | minor | | | a description's `primary` names someone who is not an actor in the diagram, or an actor with no line to this use case. Medium confidence |
| `UC-DESCRIBE-MAIN` | suggestion | | | a description with no `main` lines |
| `UC-DESCRIBE-TRIGGER` | minor | | | a description whose `trigger` is also listed as a `pre` |

Notes:

- The partition rules run only when the diagram has at least one partition. A flowchart is `general-diagram` unless it says otherwise, so `ACT-PARTITION-OUTSIDE` is quiet there.
- The class rules run only in class diagrams. The reviewer's own `CLASS-MULTIPLICITY` and `CLASS-GENERALIZATION-STYLE` come from the port.
- A line from a shape to itself is drawn, and some are good notation: a class associated with itself, a step that repeats. `STRUCT-SELF-LINE` reports only the ones above. A class that is its own parent is left to `CLASS-GENERALIZATION-CYCLE`.
- Tests: `test/model.test.ts` ("diagnostics").

The plain-language version of every rule, old and new, is the "notation check" section of `src/play/docs.html`. `test/docs.test.ts` fails when a rule id in the code is missing from it.

## 4. One list for the UI

`allIssues(parsed, review, qa)` in `src/core/diagnostics.ts` puts everything that can be said about a document in one list, kept apart by `source`:

| Source | From | Example |
|---|---|---|
| `syntax` | the parser, code `PARSE` | "can't read this line" |
| `reference` | the parser's warnings | `PARSE-UNKNOWN-NODE`, `LAYOUT-UNKNOWN-REF` |
| `notation` | `review()` | every rule in this file |
| `layout` | `checkScene()` in `src/core/qa.ts` | `LINE_THROUGH_TEXT` |

Each issue names its nodes and lines and, when the text has a line for them, a range to underline. `locate()` finds the elements for a reviewer finding from its location text.

## 5. In the UI

- **Panel title:** "notation check: <status in words>".
- **One row per finding**, worst first: severity, rule id, location; then the problem and the smallest fix. Never color alone: the severity word is always there.
- **The lint never blocks rendering.** A blocked diagram still draws; the panel says why it is wrong. Lessons sometimes show a wrong diagram on purpose; the host just does not turn the panel on.
- **The profile** shows in the panel footer ("checked as uml-inspired").
- **Write:** the panel is always on, under the figure. Findings are also underlined in the editor on the line that declares the shape or line. Critical counts as an error, major and minor as a warning, suggestion as a note.
- **Draw:** the status line under the canvas shows "notation check: <status in words>" when it has nothing newer to say.
- **Embed:** off unless the page asks with `lint=1`.
