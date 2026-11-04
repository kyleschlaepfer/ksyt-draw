# Lint: the notation check

`src/core/lint.ts` is a **port** of the `Review` class and `status_for` in `reference/review_diagrams.py` (diagram-semantics-reviewer 1.2). Same rule IDs, severities, confidence, locations and wording, so a diagram gets the same verdict on the site as on a slide. Don't write new rules here; new rules go into the reviewer first.

## What to port

- Constants: `STEP_KINDS`, `FLOW_KINDS`, `FAMILY_OF_NODE`, `NEUTRAL_NODES`, `TYPE_FAMILY`, `COMPATIBLE`, `UML_TYPES`, `ARROW_MEANING`, `MEANING_CLASS`, `EXCLUSIVE_CUES`, `PARALLEL_CUES`, `VERBS`.
- Helpers: `norm`, `cue`.
- `class Review`: `add` (profile handling: `uml_only` skipped under `general-diagram`, `strict_sev` under `strict-uml`), `label`, `kind`, `edge_kind`, `infer_family`, `check_structure`, `check_meanings_within`, `check_use_case`, `_narrated_direction`, `check_flow`, `check_erd`, `check_class`, `check_sequence`, `check_state`, `check_dfd`, `check_causal`, `run`.
- `status_for(findings, inferred, claimed)`.

Port the whole class, not only the use-case and flow checks: the other families cost little now and the editor will need them. Skip everything about layout, rendering, decks, exceptions files, versions and gates (lines 539 onward except `status_for`).

```ts
export interface Finding { severity: "critical" | "major" | "minor" | "suggestion" | "unverified";
  rule_id: string; location: string; problem: string; rationale: string; minimal_fix: string;
  confidence: "high" | "medium" | "low"; }
export function lint(d: Diagram): { inferred_family: string; status: string; findings: Finding[] }
```

## Python-to-TypeScript traps (each one changes a result)

| Python | TypeScript |
|---|---|
| `dict` insertion order, `max(votes, key=votes.get)` returns the **first** key with the top count | a `Map`; iterate in insertion order and keep the first maximum |
| Truthiness: `[]`, `0`, `""`, `None` are false | test lengths and nullish explicitly |
| `a and b or c and d` | `(a && b) \|\| (c && d)`; check every mixed `and`/`or` line by hand |
| `e.get("directed", True)` | `e.directed ?? true` (default only when the key is missing) |
| `e.get("label") or e.get("guard")` | `e.label \|\| e.guard` (empty string counts as missing) |
| `"%r" % s` for a string | `'` + s + `'` (Python repr with single quotes, as in `STRUCT-DANGLING-EDGE`'s problem text) |
| `re.escape` | a regex-escape helper |
| `re.search(p, text.lower())` | `new RegExp(p).test(text.toLowerCase())`; the cue patterns are ASCII, `\b` behaves the same |
| `norm`: lowercase, `[^a-z0-9 ]` → space, collapse whitespace, strip | same, in that order |
| `"%d of %d" % (a, b)` | template string |
| `defaultdict(list)` | `Map<string, Edge[]>` with a getter that returns `[]` |
| `{"a", "b"} <= c` (subset) | an explicit every-member check |

## Tests

For every `fixtures/diagrams/*.json` (the parsed diagram), `lint()` must return the same `inferred_family`, the same `status`, and the same `full_findings` as the matching `*.lint.json`, after sorting both by `(rule_id, location)`. Compare all fields, including the wording.

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

## In the UI

- Panel title: "notation check: <status in words>" (pass, pass with notes, needs changes, blocked).
- One row per finding, worst first: severity, rule id, location; then problem and minimal fix. Never color alone: the severity word is always there.
- The lint never blocks rendering. A blocked diagram still draws; the panel says why it's wrong. (Lessons sometimes show a wrong diagram on purpose; the host just doesn't turn the panel on.)
- The notation profile shows in the panel footer ("checked as uml-inspired").
