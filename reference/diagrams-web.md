# Diagrams on the web: meaning first, then placement, then access

This is the diagram-semantics-reviewer's standard applied to web figures. When that skill is installed, its references are authoritative (`diagram-selection.md`, `notation-profiles.md`, the UML and other-family files, `visual-layout-qa.md`); this page is the part a web figure needs, plus what the web adds. Its scripts review slide decks (`.diagrams.json`, `.pptx`), not SVG files, so on the web the checks are `figure.check()`, a render, and the rubric below applied by eye.

## Contents
1. Does it need a formal diagram at all?
2. Pick the type
3. Notation essentials
4. Placement rules
5. Accessibility: every diagram is also text
6. Review checklist

## 1. Does it need a formal diagram at all?

Start from the sentence the reader takes away, not the topic. No formal diagram for a basic idea, a distinction, an analogy, a ratio or a two-box "this becomes that": those are sketches, proportional strips, a handwritten fraction or a boundary loop. A formal diagram earns its place when the reader has to read **structure**: order with choices, who uses what, what calls what, which table points where, which states lead where.

Never add actors, swimlanes, forks, states or relationships to look more formal.

## 2. Pick the type

| The reader needs to see... | Use | Not | Pitfall |
|---|---|---|---|
| steps, decisions, handoffs, parallel work | UML activity diagram, or a flowchart for simple yes/no logic | use-case diagram | label every branch; a fork bar only when things really happen at once |
| who uses the system, for which goals | UML use-case diagram | a chronological flow | no order, no decisions; actors outside the boundary |
| messages between components over time | sequence diagram | class diagram | time runs down; one message per row |
| classes, attributes, associations | class diagram | ERD with methods | multiplicities where the text uses them |
| tables, keys, cardinalities | crow's-foot ERD | UML class diagram | both ends marked; M:N needs a junction table |
| one thing's states and what changes them | state machine | activity diagram | states are situations, transitions are events |
| data between processes and stores | DFD, convention named | activity diagram | no store-to-store flows; every flow labeled |
| causes and feedback | causal loop, arrow meaning stated (+/-) | UML association | say what an arrow means |
| an idea, ratio or distinction | a small sketch or no diagram | any formal notation | don't grade it |

**Notation profile** (say it in the figure's description or caption when it matters): `strict-uml` when the page teaches UML; `uml-inspired` (default) when it borrows UML shapes to explain a system; `general-diagram` for flowcharts, ERDs, DFDs and sketches, never called UML. **Simplification test:** would a student who learned from this figure draw something wrong on an exam? A missing final node, no. A fork where the text says "either", yes.

Write a one-line Mode A plan before drawing:
```
figure "approval" · flowchart · general-diagram
claim: after review, a request takes exactly one of two paths
elements: start pill, submit request, review, decision approved?, schedule the work, notify requester
labels: yes / no on the two exits · pitfall: no fork bar (only one path happens)
steps: happy path first, then the no branch
```

## 3. Notation essentials

| Family | Must | Must not |
|---|---|---|
| Flowchart | pill start/end, rectangle steps, diamond decisions, every exit labeled | unlabeled exits, two arrows leaving a step with no decision |
| Activity | solid dot start, bullseye end, decisions with guards `[approved]`, fork/join bars only for concurrency | a fork for either/or |
| Use case | stick-figure actors outside a named boundary, verb-phrase ellipses inside, plain association lines, dashed `«include»` pointing from base to included, `«extend»` from extension to base | arrows on associations, order or decisions |
| ERD (crow's-foot) | both ends of every relationship marked, keys tagged, junction table for M:N | a relationship with one end bare |
| Sequence | lifelines top to bottom, one message per row, return messages dashed | messages going back in time |
| State | rounded states named as situations, transitions labeled with events | states named as actions |
| DFD | processes, stores, external entities, every flow labeled with what moves | store-to-store or outsider-to-store flows |

Use the same arrow meaning across a page. If two figures use arrows differently, say so in a key.

## 4. Placement rules

From the reviewer's visual layout QA, in web units (1 in = 96 px):

- **No line through or touching text.** Labels keep a clearance of 0.03 in + 6% of their size. `figure.check()` enforces it.
- **Connectors end on outlines**, the arrowhead at the edge (within 0.07 in). Never stopping short in space, never passing through a node they don't connect.
- **Labels sit beside their line** (above a level run, right of an upright one), never on it.
- **No crossings** between connectors of one diagram; reroute or reorder.
- **Arrows at least 0.5 in** from edge to edge, or the head crowds the shaft (`connect()` refuses shorter ones).
- **Peers share an axis and a size** (`after()` places them that way). A tiny offset reads as a mistake, a big one as a choice.
- **Density:** about 8 nodes per figure. More than that, split it or use build-up steps.
- **Centered in its column**, frame tight to the ink (about 0.2 in margin), no empty bands.
- Fixes never change meaning: rerouting keeps the same two ends, the same direction, the same «include» or «extend», the same decision vs fork.

## 5. Accessibility: every diagram is also text

- `<title>`: the figure's finding ("After review, a request takes exactly one of two paths"), not its topic ("Approval process").
- `<desc>`: the structure in words, in reading order, the way you'd say it to someone who can't see it.
- A visible caption (`figcaption.note`) states the claim. For formal diagrams add `<details><summary>describe this figure</summary>` with an ordered list or a small table of the same structure. ERDs: a table of relationships. Flows: numbered steps with the branches.
- Color never carries meaning alone: the accent path is also labeled, waste is also hatched.
- Labels are real text, so they're searchable and selectable (inline SVG).

## 6. Review checklist

Revise if any answer is yes:
- Would a student draw something wrong on an exam after learning from it?
- Is the type chosen for this claim, or copied from another page?
- Is any branch unlabeled, any arrow ambiguous, any relationship missing an end?
- Does a line cross or touch a label, or end in empty space?
- Does it shrink below 13 px labels on a phone without a narrow variant?
- Could someone using a screen reader get the same point from the title, description and details?
- Did anything get drawn that the page doesn't talk about?
