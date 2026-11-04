"""Standards-informed structural review of teaching diagrams (diagram-semantics-reviewer).

Reads a diagram SPEC (the contract in references/contract.md): the sidecar `<Lesson>.diagrams.json`
that whiteboard-lecture-slides writes on save, a hand-written spec for a diagram not drawn yet, a
Mermaid flowchart, or (audit) a .pptx. Writes machine-readable results and a human report, and exits
1 when an unresolved critical or major finding remains (the export gate).

What this script can and cannot do: it checks structure (node kinds, edge kinds and directions,
labels, cardinalities, boundaries, narration cues such as "either/or" vs "at the same time"). It
cannot prove a diagram teaches the narrated claim, and it never sees pixels. The report lists the
contextual and visual checks the model still has to make. A finding it cannot settle is
`unverified`, never `pass`.

    python review_diagrams.py review SPEC.json [--stage pre-render|post-render] [--mode integrated|standalone]
                                   [--exceptions EXC.json] [--previous OLD_RESULT.json] [--out OUT_PREFIX]
    python review_diagrams.py audit DECK.pptx [--out OUT_PREFIX]      (sidecar if present and current)
    python review_diagrams.py mermaid FLOW.mmd --type flowchart [--narration "..."] [--out OUT_PREFIX]
    python review_diagrams.py gate RESULT.json SPEC.json             (stale or unresolved -> exit 1)

Standard library only; `audit` of a non-engine deck uses python-pptx when it is installed.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

CONTRACT = "1.0"
SEVERITIES = ("critical", "major", "minor", "suggestion", "unverified")
GATING = ("critical", "major")
PROFILES = ("strict-uml", "uml-inspired", "general-diagram")

# ---------------------------------------------------------------- vocabulary
STEP_KINDS = {"action", "process", "step"}
FLOW_KINDS = STEP_KINDS | {"decision", "merge", "fork", "join", "initial", "final", "flow-final", "terminator", "io"}
FAMILY_OF_NODE = {
    "action": "flow", "process": "flow", "step": "flow", "decision": "flow", "merge": "flow", "io": "flow",
    "terminator": "flow", "initial": "flow", "final": "flow", "flow-final": "flow", "fork": "flow", "join": "flow",
    "actor": "use-case", "use-case": "use-case",
    "entity": "data", "class": "class",
    "lifeline": "sequence", "state": "state",
    "data-store": "dfd", "external-entity": "dfd", "dfd-process": "dfd",
    "concept": "concept",
}
NEUTRAL_NODES = {"boundary", "note", "label"}
# claimed type -> structural family it should look like
TYPE_FAMILY = {
    "activity": "flow", "flowchart": "flow", "use-case": "use-case", "sequence": "sequence",
    "class": "class", "erd": "data", "state": "state", "dfd": "dfd", "causal": "concept", "concept": "concept",
    "sketch": "sketch", "unknown": None, None: None,
}
COMPATIBLE = [{"flow"}, {"data", "class"}, {"concept", "sketch"}]
UML_TYPES = {"activity", "use-case", "sequence", "class", "state"}
# meaning of a generic arrow by diagram type
ARROW_MEANING = {"activity": "control", "flowchart": "control", "dfd": "data-flow", "sequence": "message",
                 "state": "transition", "causal": "influence", "concept": "relation", "use-case": "association",
                 "sketch": "relation", "erd": "relationship", "class": "association"}
MEANING_CLASS = {"control": "sequence-of-work", "transition": "sequence-of-work", "message": "sequence-of-work",
                 "return": "sequence-of-work", "data-flow": "data", "influence": "causal", "relation": "causal",
                 "include": "structural", "extend": "structural", "dependency": "structural",
                 "generalization": "structural", "association": "link", "relationship": "link"}

EXCLUSIVE_CUES = [r"\beither\b", r"\bone or the other\b", r"\bdepending on\b", r"\bwhichever\b", r"\binstead\b",
                  r"\botherwise\b", r"\bnot both\b", r"\b\w+ed,? or \w+ed\b", r"\bor\b[^.]*\bbut not\b"]
PARALLEL_CUES = [r"\bat the same time\b", r"\bsimultaneous", r"\bin parallel\b", r"\bconcurrent", r"\bmeanwhile\b",
                 r"\bboth\b[^.]{0,60}\band\b", r"\bwhile\b[^.]{0,60}\balso\b", r"\bat once\b"]
VERBS = set("""accept add apply approve assign authenticate book browse buy calculate cancel change check checkout
choose close collect compare complete confirm create delete deliver deposit download edit enroll enter export file
fill find generate get give handle identify import issue log login logout look make manage monitor notify open order
pay place post prepare print process purchase read receive record register reject remove renew report request reserve
reset resolve retrieve return review run save schedule search select send set ship sign start submit subscribe
track transfer update upload validate verify view vote withdraw write""".split())


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def cue(patterns, text):
    t = (text or "").lower()
    return [p for p in patterns if re.search(p, t)]


def version_of(diagram):
    """Fingerprint of everything that carries meaning or placement (not slide speech): a moved label is a new version."""
    keep = {k: diagram.get(k) for k in ("claimed_diagram_type", "notation_profile", "nodes", "edges", "legend", "layout")}
    return "sha256:" + hashlib.sha256(json.dumps(keep, sort_keys=True).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- review core
class Review:
    def __init__(self, dg):
        self.d = dg
        self.nodes = {n["id"]: n for n in dg.get("nodes", [])}
        self.edges = list(dg.get("edges", []))
        self.profile = dg.get("notation_profile") or "uml-inspired"
        self.claimed = (dg.get("claimed_diagram_type") or "unknown").lower()
        self.narr = dg.get("narration_excerpt") or ""
        self.findings = []
        self.out = defaultdict(list)
        self.inc = defaultdict(list)
        for e in self.edges:
            self.out[e.get("from")].append(e)
            self.inc[e.get("to")].append(e)

    # severity tuned by profile: strict raises, general-diagram suppresses UML-only rules
    def add(self, sev, rule, loc, problem, why, fix, conf="high", uml_only=False, strict_sev=None):
        if uml_only and self.profile == "general-diagram":
            return
        if self.profile == "strict-uml" and strict_sev:
            sev = strict_sev
        self.findings.append(dict(severity=sev, rule_id=rule, location=loc, problem=problem, rationale=why,
                                  minimal_fix=fix, confidence=conf))

    def label(self, nid):
        n = self.nodes.get(nid)
        return (n.get("label") or nid) if n else str(nid)

    def kind(self, nid):
        n = self.nodes.get(nid)
        return n.get("kind") if n else None

    def edge_kind(self, e):
        k = e.get("kind") or "arrow"
        if k == "arrow":
            return ARROW_MEANING.get(self.claimed, "control")
        return k

    # ---------- family identification (before grading)
    def infer_family(self):
        votes = defaultdict(int)
        for n in self.nodes.values():
            f = FAMILY_OF_NODE.get(n.get("kind"))
            if f:
                votes[f] += 1
        kinds = {self.edge_kind(e) for e in self.edges}
        if {"include", "extend"} & kinds:
            votes["use-case"] += 2
        if "relationship" in kinds:
            votes["data"] += 2
        if "data-flow" in kinds and votes.get("dfd"):
            votes["dfd"] += 1
        if "message" in kinds and votes.get("sequence"):
            votes["sequence"] += 1
        formal = sum(votes.values())
        if formal == 0 or (len(self.nodes) <= 3 and set(votes) <= {"concept"}):
            return "sketch", votes
        # a use-case-looking diagram whose links are a chronological, branching flow is a flow
        uc_chain = [e for e in self.edges if self.kind(e.get("from")) == "use-case" and self.kind(e.get("to")) == "use-case"
                    and self.edge_kind(e) in ("control", "arrow", "association") and e.get("directed", True)]
        branchy = any(norm(e.get("label")) in ("yes", "no", "approved", "rejected", "true", "false") or
                      (e.get("label") or "").startswith("[") for e in self.edges)
        if votes.get("use-case") and (votes.get("flow") or uc_chain and branchy):
            if votes.get("flow", 0) + len(uc_chain) >= votes["use-case"] or branchy:
                return "flow", votes
        return max(votes, key=votes.get), votes

    # ---------- generic structure
    def check_structure(self):
        for e in self.edges:
            for end in ("from", "to"):
                if e.get(end) not in self.nodes:
                    self.add("major", "STRUCT-DANGLING-EDGE", "edge %s" % e.get("id"),
                             "The %s end of this connector is not attached to any diagram element (%r)." % (end, e.get(end)),
                             "A connector that starts or ends nowhere leaves the relationship unreadable.",
                             "Attach it to the element it refers to, or remove it.", conf="medium")
        linked = {e.get("from") for e in self.edges} | {e.get("to") for e in self.edges}
        if self.edges:
            for nid, n in self.nodes.items():
                if n.get("kind") in NEUTRAL_NODES or nid in linked:
                    continue
                if n.get("kind") in ("initial", "final", "terminator") and len(self.nodes) <= 2:
                    continue
                self.add("minor", "STRUCT-ISOLATED", "%s '%s'" % (n.get("kind"), self.label(nid)),
                         "This element is not connected to anything.",
                         "Unconnected parts invite the viewer to guess how they relate.",
                         "Connect it, or move it off this diagram if the narration does not use it.", conf="medium")

    def check_meanings_within(self):
        by_style = defaultdict(set)
        for e in self.edges:
            st = e.get("style")
            if st:
                by_style[st].add(MEANING_CLASS.get(e.get("meaning") or self.edge_kind(e), "other"))
        if self.d.get("legend"):
            return
        for st, ms in by_style.items():
            if len(ms) > 1:
                self.add("major", "XDIAG-ARROW-MEANING", "connectors drawn as '%s'" % st,
                         "The same connector style carries different meanings here (%s)." % ", ".join(sorted(ms)),
                         "A viewer reads one shape as one meaning; mixing them without a legend misleads.",
                         "Give each meaning its own stroke (solid vs dashed, labeled) or add a one-line legend.")

    # ---------- family: use case
    def check_use_case(self):
        boundaries = [n for n in self.nodes.values() if n.get("kind") == "boundary"]
        assoc = defaultdict(set)
        for e in self.edges:
            a, b = e.get("from"), e.get("to")
            if self.kind(a) == "actor" and self.kind(b) == "use-case" or self.kind(b) == "actor" and self.kind(a) == "use-case":
                actor, uc = (a, b) if self.kind(a) == "actor" else (b, a)
                assoc[uc].add(actor)
                if e.get("directed") and self.edge_kind(e) in ("control", "association", "arrow"):
                    self.add("minor", "UC-ASSOC-DIRECTED", "%s -> %s" % (self.label(a), self.label(b)),
                             "The actor link is drawn as a directed arrow.",
                             "Actor-use case associations are plain lines; an arrowhead reads as a step in a sequence.",
                             "Draw a plain line (no arrowhead).", uml_only=True, strict_sev="major")
        for n in self.nodes.values():
            inside = n.get("inside")
            if n.get("kind") == "actor" and inside:
                self.add("major", "UC-ACTOR-INSIDE", "actor '%s'" % self.label(n["id"]),
                         "The actor is drawn inside the system boundary.",
                         "Actors are roles outside the subject; inside the box they read as part of the system.",
                         "Move the actor outside the boundary.")
            if n.get("kind") == "use-case" and boundaries and not inside:
                self.add("minor", "UC-OUTSIDE-BOUNDARY", "use case '%s'" % self.label(n["id"]),
                         "This use case sits outside the system boundary.",
                         "Use cases are services of the subject, so they belong inside its box.",
                         "Move it inside the boundary (or draw a second subject if it belongs to another system).")
            if n.get("kind") == "use-case" and len((n.get("label") or "").split()) == 1 and \
                    norm(n.get("label")).split()[:1] and norm(n.get("label")).split()[0] not in VERBS:
                self.add("suggestion", "UC-LABEL-VERB", "use case '%s'" % self.label(n["id"]),
                         "A one-word, non-verb label reads as a thing, not a goal.",
                         "Use cases name something the actor wants done.",
                         "Use a verb phrase (\"place order\", not \"orders\").", conf="medium")
        for e in self.edges:
            k = self.edge_kind(e)
            a, b = e.get("from"), e.get("to")
            if self.kind(a) == "use-case" and self.kind(b) == "use-case" and k in ("control", "arrow") and e.get("directed", True):
                self.add("major", "UC-SEQUENCE-ARROW", "%s -> %s" % (self.label(a), self.label(b)),
                         "Two use cases are joined by a control-flow arrow.",
                         "Use-case diagrams have no time order; an arrow between goals reads as 'then'.",
                         "Use «include»/«extend» if one reuses the other; if the point is order, use an activity diagram.")
            if k not in ("include", "extend"):
                continue
            if e.get("style") and e.get("style") != "dashed-arrow" or not e.get("directed", True):
                self.add("minor", "UC-DEPENDENCY-STYLE", "«%s» %s -> %s" % (k, self.label(a), self.label(b)),
                         "«%s» is not drawn as a dashed arrow." % k,
                         "The dashed dependency arrow is what distinguishes «include»/«extend» from an association.",
                         "Draw it dashed with an open arrowhead and the «%s» label." % k, uml_only=True)
            # direction: narration first (high confidence), then structure (medium)
            rev = self._narrated_direction(k, a, b)
            if rev is None:
                if k == "include" and assoc.get(b) and not assoc.get(a):
                    rev = "medium"
                if k == "extend" and assoc.get(a) and not assoc.get(b):
                    rev = "medium"
            if rev:
                if k == "include":
                    self.add("major", "UC-INCLUDE-DIRECTION", "«include» %s -> %s" % (self.label(a), self.label(b)),
                             "The «include» arrow appears reversed: it points from '%s' to '%s'." % (self.label(a), self.label(b)),
                             "«include» points from the including (base) use case to the included, reused one. "
                             "Reversed, it says the reused fragment depends on the base.",
                             "Reverse it: arrow from '%s' to '%s'." % (self.label(b), self.label(a)), conf=rev)
                else:
                    self.add("major", "UC-EXTEND-DIRECTION", "«extend» %s -> %s" % (self.label(a), self.label(b)),
                             "The «extend» arrow appears reversed: it points from '%s' to '%s'." % (self.label(a), self.label(b)),
                             "«extend» points from the optional extension to the base use case it extends.",
                             "Reverse it: arrow from '%s' to '%s'." % (self.label(b), self.label(a)), conf=rev)

    def _narrated_direction(self, k, a, b):
        """'high' if the narration states the opposite direction, False if it confirms, None if silent."""
        t = norm(self.narr)
        la, lb = norm(self.label(a)), norm(self.label(b))
        if not la or not lb:
            return None
        verb = "includes" if k == "include" else "extends"
        if re.search(r"%s\s+(always\s+)?%s\s+%s" % (re.escape(la), verb, re.escape(lb)), t):
            return False
        if re.search(r"%s\s+(always\s+)?%s\s+%s" % (re.escape(lb), verb, re.escape(la)), t):
            return "high"
        return None

    # ---------- family: activity / flowchart
    def check_flow(self):
        is_flowchart = self.claimed == "flowchart" or (self.claimed not in ("activity",) and self.profile == "general-diagram")
        rule_pfx = "FLOW" if is_flowchart else "ACTIVITY"
        exclusive, parallel = cue(EXCLUSIVE_CUES, self.narr), cue(PARALLEL_CUES, self.narr)
        for nid, n in self.nodes.items():
            k = n.get("kind")
            outs, ins = self.out.get(nid, []), self.inc.get(nid, [])
            if k == "decision":
                if len(outs) >= 2:
                    unl = [e for e in outs if not (e.get("label") or e.get("guard"))]
                    if unl:
                        self.add("major", "%s-DECISION-GUARD" % rule_pfx, "decision '%s'" % self.label(nid),
                                 "%d of %d outgoing branches are unlabeled." % (len(unl), len(outs)),
                                 "The viewer cannot tell which path is which outcome.",
                                 "Label each branch where it leaves the diamond (%s)." %
                                 ("Yes / No" if is_flowchart else "[approved] / [rejected]"))
                    labels = [norm(e.get("label") or e.get("guard")) for e in outs if (e.get("label") or e.get("guard"))]
                    if len(labels) != len(set(labels)):
                        self.add("major", "%s-DUPLICATE-GUARD" % rule_pfx, "decision '%s'" % self.label(nid),
                                 "Two branches carry the same label.",
                                 "Branches of one decision must be distinguishable outcomes.",
                                 "Give each branch its own outcome label.")
                    targets = [e.get("to") for e in outs]
                    if len(set(targets)) < len(targets):
                        self.add("major", "%s-BRANCH-SAME-TARGET" % rule_pfx, "decision '%s'" % self.label(nid),
                                 "Two branches lead to the same next step.",
                                 "If every outcome goes to the same place, the decision changes nothing on the slide.",
                                 "Route each branch to the step that outcome actually leads to.", conf="medium")
                elif len(outs) == 1 and len(ins) >= 2:
                    self.add("suggestion", "%s-MERGE-AS-DECISION" % rule_pfx, "diamond '%s'" % self.label(nid),
                             "This diamond only joins paths (several in, one out).",
                             "That is a merge, not a decision; a question inside it suggests a choice that isn't there.",
                             "Leave the merge diamond empty, or drop it and join the arrows.", uml_only=True)
                else:
                    self.add("major", "%s-DECISION-ONE-EXIT" % rule_pfx, "decision '%s'" % self.label(nid),
                             "This decision has %d way out." % len(outs),
                             "A decision with one exit is not a choice.",
                             "Draw and label each outcome branch, or make it a plain step.")
            if k in ("fork", "join"):
                if k == "fork" and len(outs) < 2 or k == "join" and len(ins) < 2:
                    self.add("major", "ACTIVITY-%s-STRUCTURE" % k.upper(), "%s bar" % k,
                             "A %s bar needs at least two %s paths; this one has %d." %
                             (k, "outgoing" if k == "fork" else "incoming", len(outs) if k == "fork" else len(ins)),
                             "The bar's whole meaning is splitting into, or waiting for, concurrent paths.",
                             "Add the concurrent paths, or remove the bar.")
                if k == "fork" and any(e.get("label") or e.get("guard") for e in outs):
                    self.add("major", "ACTIVITY-GUARDED-FORK", "fork bar",
                             "Paths leaving the fork carry guards/labels.",
                             "Guards mean only one path is taken; a fork means all are.",
                             "If only one path runs, use a decision diamond; if all run, remove the guards.")
            has_end = any(self.kind(x) in ("final", "terminator", "flow-final") for x in self.nodes)
            if k in STEP_KINDS and not outs and ins and has_end:  # other paths end properly, this one just stops
                self.add("minor", "%s-DEAD-END" % rule_pfx, "step '%s'" % self.label(nid),
                         "The flow stops here without an end marker.",
                         "A viewer can't tell if the process ends or the drawing is unfinished.",
                         "Continue the arrow or add an end (%s)." % ("terminator" if is_flowchart else "final node"),
                         conf="medium")
        forks = [n for n in self.nodes.values() if n.get("kind") == "fork"]
        decisions = [n for n in self.nodes.values() if n.get("kind") == "decision"]
        if forks and exclusive and not parallel:
            self.add("major", "ACTIVITY-PARALLEL-VS-EXCLUSIVE", "fork bar",
                     "The narration describes a choice (\"%s\") but the diagram forks into concurrent paths." %
                     re.search(exclusive[0], self.narr.lower()).group(0),
                     "A fork bar teaches that every path runs at the same time.",
                     "Replace the fork with a decision diamond and label each outcome.", conf="medium")
        if decisions and parallel and not exclusive and not forks:
            self.add("major", "ACTIVITY-EXCLUSIVE-VS-PARALLEL", "decision '%s'" % self.label(decisions[0]["id"]),
                     "The narration describes concurrent work but the diagram uses a decision (one path taken).",
                     "A decision teaches that only one branch happens.",
                     "Use a fork bar to split into concurrent paths and a join bar where they meet.", conf="medium")
        if self.claimed == "activity":
            if not any(n.get("kind") == "initial" for n in self.nodes.values()):
                self.add("suggestion", "ACTIVITY-NO-INITIAL", "diagram",
                         "No initial node.", "In UML the filled dot shows where the activity starts.",
                         "Add a small filled dot before the first action.", uml_only=True, strict_sev="minor")
            if not any(n.get("kind") in ("final", "flow-final") for n in self.nodes.values()):
                self.add("suggestion", "ACTIVITY-NO-FINAL", "diagram",
                         "No activity final node.", "The bullseye shows where the whole activity ends.",
                         "Add a bullseye after the last action.", uml_only=True, strict_sev="minor")
        if self.claimed == "flowchart" and self.profile == "strict-uml":
            self.add("minor", "PROFILE-MISMATCH", "diagram", "A flowchart is reviewed under strict-uml.",
                     "Flowcharts are not UML; strict UML rules would be misapplied.",
                     "Use profile general-diagram for flowcharts, or redraw as a UML activity diagram.")

    # ---------- family: data models
    def check_erd(self):
        physical = any(any(r.get("key") for r in (n.get("rows") or [])) for n in self.nodes.values()
                       if n.get("kind") == "entity") or self.d.get("level") == "physical"
        for e in self.edges:
            if self.edge_kind(e) != "relationship":
                continue
            a, b = e.get("from"), e.get("to")
            ca, cb = e.get("card_from"), e.get("card_to")
            loc = "relationship %s - %s" % (self.label(a), self.label(b))
            if not ca or not cb:
                self.add("major", "ERD-CARDINALITY-MISSING", loc, "Cardinality is missing on %s end." %
                         ("both" if not ca and not cb else "one"),
                         "Without both ends the viewer can't tell one-to-many from many-to-many.",
                         "Mark both ends (crow's foot for many, bar for one, circle for optional).")
                continue
            if "many" in ca and "many" in cb and physical:
                self.add("major", "ERD-MN-NEEDS-JUNCTION", loc,
                         "Two tables are related many-to-many directly.",
                         "Relational tables can't store M:N without a junction table; drawn as tables, this teaches a schema that can't exist.",
                         "Insert a junction table with both foreign keys, one-to-many on each side.")
            elif "many" in ca and "many" in cb:
                self.add("suggestion", "ERD-MN-CONCEPTUAL", loc, "Many-to-many at the conceptual level.",
                         "Fine in a conceptual ERD; say so if the lesson later turns it into tables.",
                         "Optionally note 'resolved by a junction table' when the lesson gets there.", conf="medium")
        for nid, n in self.nodes.items():
            if n.get("kind") != "entity" or not n.get("rows"):
                continue
            keys = [r.get("key") or "" for r in n["rows"]]
            if physical and not any("PK" in k.upper() for k in keys):
                self.add("minor", "ERD-PK-MISSING", "table '%s'" % self.label(nid), "No primary key is marked.",
                         "Every table in a physical model has one; leaving it off hides how rows are identified.",
                         "Mark the key column(s) PK.")
            fks = [k for k in keys if "FK" in k.upper()]
            if len(fks) >= 2:  # junction-like: it should be the many side of each link
                for e in self.edges:
                    if self.edge_kind(e) != "relationship":
                        continue
                    end = "card_from" if e.get("from") == nid else "card_to" if e.get("to") == nid else None
                    if end and "many" not in (e.get(end) or ""):
                        self.add("major", "ERD-JUNCTION-SIDE", "junction '%s'" % self.label(nid),
                                 "The junction table is on the 'one' side of a relationship.",
                                 "Each row of a junction table references one parent row; many junction rows per parent.",
                                 "Put the crow's foot (many) at the junction end.")

    def check_class(self):
        for e in self.edges:
            k = self.edge_kind(e)
            if k == "generalization" and e.get("style") and e.get("style") != "hollow-triangle":
                self.add("minor", "CLASS-GENERALIZATION-STYLE", "%s -> %s" % (self.label(e["from"]), self.label(e["to"])),
                         "Inheritance is not drawn with a hollow triangle.", "That head is what says 'is a kind of'.",
                         "Use a hollow triangle pointing at the parent.", uml_only=True)
            if k == "association" and self.claimed == "class" and not (e.get("card_from") and e.get("card_to")):
                self.add("minor", "CLASS-MULTIPLICITY", "%s - %s" % (self.label(e["from"]), self.label(e["to"])),
                         "Association without multiplicities.", "The story usually depends on how many.",
                         "Add multiplicities (1, 0..1, *, 1..*) at both ends if the narration relies on them.",
                         conf="medium", strict_sev="major")

    def check_sequence(self):
        msgs = [e for e in self.edges if self.edge_kind(e) in ("message", "return")]
        orders = [e.get("order") for e in msgs]
        if msgs and (None in orders or len(set(orders)) != len(orders)):
            self.add("major", "SEQ-MESSAGE-ORDER", "messages",
                     "Messages have no unambiguous top-to-bottom order.",
                     "In a sequence diagram, time runs down the lifelines; order is the content.",
                     "Stack messages one per row in the order they happen.")
        for e in msgs:
            if self.kind(e.get("from")) != "lifeline" or self.kind(e.get("to")) != "lifeline":
                self.add("major", "SEQ-NOT-LIFELINE", "message %s" % e.get("id"),
                         "A message does not run between two lifelines.",
                         "Messages are sent between participants' lifelines.",
                         "Attach both ends to lifelines.", conf="medium")

    def check_state(self):
        for e in self.edges:
            if self.edge_kind(e) == "transition" and not e.get("label"):
                self.add("minor", "STATE-TRANSITION-EVENT", "%s -> %s" % (self.label(e["from"]), self.label(e["to"])),
                         "Transition without an event.", "A state change happens because of something.",
                         "Label it with the event (and [guard] if any).", strict_sev="major", uml_only=True)
        for n in self.nodes.values():
            if n.get("kind") == "state" and norm(n.get("label")).split()[:1] and norm(n.get("label")).split()[0] in VERBS:
                self.add("suggestion", "STATE-NAMED-AS-ACTION", "state '%s'" % self.label(n["id"]),
                         "This state is named like an action.", "States are situations (Submitted, Approved).",
                         "Rename to a condition or past participle.", conf="medium")

    def check_dfd(self):
        for nid, n in self.nodes.items():
            k = n.get("kind")
            ins = [e for e in self.inc.get(nid, []) if self.edge_kind(e) == "data-flow"]
            outs = [e for e in self.out.get(nid, []) if self.edge_kind(e) == "data-flow"]
            if k in ("dfd-process", "process", "action", "step"):
                if ins and not outs:
                    self.add("major", "DFD-BLACK-HOLE", "process '%s'" % self.label(nid), "Data goes in, nothing comes out.",
                             "A process transforms inputs into outputs.", "Add the output flow, or explain it is a sink.")
                if outs and not ins:
                    self.add("major", "DFD-MIRACLE", "process '%s'" % self.label(nid), "Data comes out of nothing.",
                             "A process cannot produce data without input.", "Add the input flow.")
        for e in self.edges:
            if self.edge_kind(e) != "data-flow":
                continue
            ka, kb = self.kind(e.get("from")), self.kind(e.get("to"))
            loc = "%s -> %s" % (self.label(e.get("from")), self.label(e.get("to")))
            if ka == "data-store" and kb == "data-store":
                self.add("major", "DFD-STORE-TO-STORE", loc, "Data flows store to store with no process.",
                         "Something has to move it; that something is a process.", "Put a process between the stores.")
            if {ka, kb} == {"external-entity", "data-store"}:
                self.add("major", "DFD-EXTERNAL-TO-STORE", loc, "An external entity touches a data store directly.",
                         "Outsiders reach stored data only through a process.", "Route the flow through a process.")
            if ka == "external-entity" and kb == "external-entity":
                self.add("major", "DFD-EXTERNAL-TO-EXTERNAL", loc, "Flow between two external entities.",
                         "That exchange is outside the system and doesn't belong on its DFD.", "Remove it or add the process.")
            if not e.get("label"):
                self.add("minor", "DFD-UNLABELED-FLOW", loc, "Data flow has no label.", "Each flow names the data that moves.",
                         "Label it with the data (\"order details\").")

    def check_causal(self):
        for e in self.edges:
            if self.edge_kind(e) == "influence" and not (e.get("label") or e.get("polarity")):
                self.add("minor", "CAUSAL-UNLABELED", "%s -> %s" % (self.label(e.get("from")), self.label(e.get("to"))),
                         "Influence arrow without a sign or verb.",
                         "Whether more A means more or less B is the whole claim.",
                         "Label + / - (or a short verb like 'increases').")

    # ---------- run
    def run(self):
        fam, votes = self.infer_family()
        self.inferred = fam
        want = TYPE_FAMILY.get(self.claimed)
        if self.claimed == "use-case" and fam == "flow":
            self.add("critical", "FAMILY-USECASE-IS-FLOW", "diagram",
                     "Called a use-case diagram, but it shows a chronological flow with branches.",
                     "Use-case diagrams show who uses the system for which goals; they have no order or decisions. "
                     "Re-shaping boxes into ovals would not fix this.",
                     "Redraw as an activity diagram (or a flowchart): steps, a decision with labeled outcomes. "
                     "Keep a use-case diagram only if the lesson is about actors and goals.")
        elif want and fam != "sketch" and want != fam and not any({want, fam} <= c for c in COMPATIBLE):
            self.add("major", "FAMILY-MISMATCH", "diagram",
                     "Claimed %s, but the structure reads as %s." % (self.claimed, fam),
                     "Grading against the wrong family produces wrong fixes and teaches the wrong notation.",
                     "Either change the claim/title to what it is, or redraw in the claimed notation.", conf="medium")
        if self.claimed in ("erd",) and fam == "class" or self.claimed == "class" and fam == "data":
            pass  # compatible families: graded by the claimed notation, never by the other one
        if self.claimed in UML_TYPES and self.profile == "general-diagram":
            self.add("suggestion", "PROFILE-MISMATCH", "diagram", "A UML diagram type reviewed as general-diagram.",
                     "UML conventions will not be checked.", "Use uml-inspired (default) or strict-uml.")
        fams = [f for f, v in votes.items() if v >= 2 and f not in ("concept",)]
        if len(fams) > 1 and not self.d.get("legend") and not (self.claimed == "use-case" and fam == "flow"):
            if not any(set(fams) <= c for c in COMPATIBLE):
                self.add("major", "XDIAG-NOTATION-MIX", "diagram",
                         "Mixes notations from different diagram families (%s) without explanation." % ", ".join(sorted(fams)),
                         "Shapes borrowed from another notation carry that notation's meaning.",
                         "Pick one family for this diagram, or split it into two slides.", conf="medium")
        self.check_structure()
        self.check_meanings_within()
        grade = self.claimed if self.claimed not in ("unknown",) else {
            "flow": "flowchart", "use-case": "use-case", "data": "erd", "class": "class", "sequence": "sequence",
            "state": "state", "dfd": "dfd", "concept": "causal"}.get(fam, "sketch")
        if grade in ("activity", "flowchart") or fam == "flow":
            self.check_flow()
        if grade == "use-case" and fam != "flow":
            self.check_use_case()
        if grade == "use-case" and fam == "flow":
            pass
        if grade in ("erd",) or fam == "data":
            self.check_erd()
        if grade == "class":
            self.check_class()
        if grade == "sequence":
            self.check_sequence()
        if grade == "state":
            self.check_state()
        if grade == "dfd":
            self.check_dfd()
        if grade in ("causal", "concept"):
            self.check_causal()
        return self.findings


def status_for(findings, inferred, claimed):
    open_ = [f for f in findings if not f.get("exception")]
    sev = {f["severity"] for f in open_}
    if "critical" in sev:
        return "blocked"
    if "major" in sev:
        return "changes-required"
    if "unverified" in sev:
        return "unverified"
    if inferred == "sketch" and claimed in ("sketch", "unknown", "concept") and not open_:
        return "not-a-diagram"
    if findings:  # open minor/suggestion, or accepted exceptions that stay visible
        return "pass-with-notes"
    return "pass"


NEGATIVE_CUES = r"\b(can't|cannot|can not|won't|doesn't work|wrong|broken|mistake|problem|fails?|impossible)\b"


def contextual_checks(dg):
    """What the model must still judge (the script can't): printed into every report."""
    extra = []
    if dg.get("intent") == "counterexample":
        extra.append("Counterexample: is it visibly marked as the wrong way (a cross, a strike, a 'problem' label) "
                     "no later than the narration says so, and is the right way shown afterwards?")
    elif re.search(NEGATIVE_CUES, (dg.get("narration_excerpt") or "").lower()):
        extra.append("The narration sounds like this may be the problem shown on purpose. If so, declare "
                     "intent='counterexample' (d.diagram_meta) instead of fixing it; if not, fix the finding.")
    return extra + [
        "Does the diagram make the narrated claim, or an adjacent one? Narration: \"%s\"" % (dg.get("narration_excerpt") or "(none given)")[:400],
        "Are actors/steps/states/data the right KINDS of thing for the story?",
        "Would the simplification teach something false at this level? If so, fix or add a short caveat.",
        "Post-render: open the slide PNG(s) for %s; check the hand-drawn shapes still read as their notation "
        "(fork bar vs line, dashed vs solid, arrowheads, crow's feet) and every label sits on what it names."
        % ", ".join(dg.get("slide_ids") or ["this diagram"]),
    ]


# ---------------------------------------------------------------- deck-level
def deck_findings(diagrams):
    """Cross-diagram: one connector style, contradictory meanings, no legend (acceptance test 9)."""
    uses = defaultdict(lambda: defaultdict(list))
    for dg in diagrams:
        if dg.get("legend"):
            continue
        claimed = (dg.get("claimed_diagram_type") or "unknown").lower()
        for e in dg.get("edges", []):
            st = e.get("style")
            if not st:
                continue
            k = e.get("kind") or "arrow"
            meaning = e.get("meaning") or (ARROW_MEANING.get(claimed, "control") if k == "arrow" else k)
            uses[st][MEANING_CLASS.get(meaning, meaning)].append((dg["diagram_id"], meaning))
    out = []
    for st, by in uses.items():
        if len(by) < 2:
            continue
        where = "; ".join("%s as %s in %s" % (st, m, ", ".join(sorted({d for d, _ in v})))
                          for _, v in by.items() for m in sorted({mm for _, mm in v})[:1])
        ids = sorted({d for v in by.values() for d, _ in v})
        if len(ids) < 2:
            continue  # within one diagram: XDIAG-ARROW-MEANING already covers it
        out.append(dict(severity="major", rule_id="XDECK-ARROW-MEANING", location=where,
                        problem="The same connector style means different things on different slides with no legend.",
                        rationale="Viewers learn a shape's meaning once; a later slide reusing it for something else reads wrong.",
                        minimal_fix="Use a distinct stroke for one meaning (dashed, labeled) or add a one-line legend where the second meaning first appears.",
                        confidence="medium", diagrams=ids))
    return out


# ---------------------------------------------------------------- exceptions, results, reports
def load_exceptions(path):
    if not path or not os.path.exists(path):
        return [], []
    raw = json.load(open(path))
    good, bad = [], []
    for x in raw.get("exceptions", raw if isinstance(raw, list) else []):
        target = (x.get("rule_id") and (x.get("diagram_id") or x.get("slide_id"))) or x.get("a")
        (good if target and x.get("reason") and x.get("accepted_by") else bad).append(x)
    return good, bad


def _base(n):
    return re.sub(r"-[0-9a-fA-F]{6}$", "", (n or "").lstrip("!"))


def _exc_matches(x, diagram_id, f):
    """An exception names a rule on a diagram (or slide), or a pair of shapes (a, b) as written in the deck,
    the same pair format the slide skill's render check takes; b omitted means 'a with anything'."""
    if x.get("rule_id") and x["rule_id"] != f["rule_id"]:
        return False
    if x.get("slide_id") and x["slide_id"] not in (f.get("slide_ids") or []):
        return False
    if x.get("a"):
        have = {_base(s) for s in f.get("shapes") or []}
        return _base(x["a"]) in have and (not x.get("b") or _base(x["b"]) in have)
    if x.get("diagram_id"):
        return x["diagram_id"] in (diagram_id, "*")
    return bool(x.get("slide_id"))


def apply_exceptions(diagram_id, findings, exc):
    for f in findings:
        for x in exc:
            if _exc_matches(x, diagram_id, f):
                f["exception"] = {"reason": x["reason"], "accepted_by": x["accepted_by"]}


DIM_ORDER = ("blocked", "changes-required", "unverified", "pass-with-notes", "pass", "not-a-diagram", "not-measured")


def dim_status(findings):
    open_ = [f for f in findings if not f.get("exception")]
    sev = {f["severity"] for f in open_}
    if "critical" in sev:
        return "blocked"
    if "major" in sev:
        return "changes-required"
    if "unverified" in sev:
        return "unverified"
    return "pass-with-notes" if findings else "pass"


def worst(*statuses):
    ss = [x for x in statuses if x and x not in ("not-measured",)]
    return min(ss, key=DIM_ORDER.index) if ss else "pass"


def merge_render(results, render):
    """Fold render-check findings into each diagram; a render finding matching a source finding confirms it."""
    by = {r["diagram_id"]: r for r in results}
    for r in results:
        if r.get("review_status") in ("skip-with-reason",):
            continue
        r["render_status"] = "unverified"
        r["render_note"] = render.get("note")
    for f in render.get("findings", []):
        r = by.get(f.pop("diagram_id", None))
        if not r:
            continue
        same = next((x for x in r["findings"] if x.get("review_dimension") == "layout" and x["rule_id"] == f["rule_id"]
                     and set(x.get("element_ids") or []) & set(f.get("element_ids") or [])), None)
        if same:
            if "rendered-slide" not in same["verified_by"]:
                same["verified_by"].append("rendered-slide")
            for sid in f["slide_ids"]:
                if sid not in same["slide_ids"]:
                    same["slide_ids"].append(sid)
        else:
            r["findings"].append(f)
    if render.get("status") in ("verified", "failed"):
        failed = {r["diagram_id"] for r in results for f in r["findings"] if "rendered-slide" in f.get("verified_by", [])
                  and not f.get("exception") and f["severity"] in GATING}
        for r in results:
            if "render_status" in r:
                r["render_status"] = "failed" if r["diagram_id"] in failed else "verified"


def review_spec(spec, stage="post-render", mode="integrated", exceptions=None, previous=None, render=None, limits=None):
    import layout_rules
    exc, bad_exc = load_exceptions(exceptions)
    lim = dict(spec.get("layout_limits") or {})
    lim.update(limits or {})
    prev = {}
    if previous and os.path.exists(previous):
        for r in json.load(open(previous)).get("results", []):
            prev[r["diagram_id"]] = r
    results = []
    for dg in spec.get("diagrams", []):
        v = version_of(dg)
        base = dict(contract_version=CONTRACT, slide_id=(dg.get("slide_ids") or [None])[0], diagram_id=dg["diagram_id"],
                    source_version=v, stage=stage, mode=mode, slide_ids=dg.get("slide_ids"),
                    claimed_diagram_type=dg.get("claimed_diagram_type"))
        if dg.get("skip_reason"):
            results.append(dict(base, review_status="skip-with-reason", skip_reason=dg["skip_reason"], findings=[]))
            continue
        if dg.get("inspectable") is False:
            f = [dict(severity="unverified", rule_id="INPUT-NOT-INSPECTABLE", location="diagram", review_dimension="semantics",
                      problem=dg.get("inspect_note") or "Only an image or unparsed shapes are available.",
                      rationale="Structure can't be read, so it can't be passed.",
                      minimal_fix="Review the rendered slide by eye against the rubric, or supply the diagram source.",
                      confidence="high")]
            apply_exceptions(dg["diagram_id"], f, exc)
            results.append(dict(base, review_status="unverified", semantic_status="unverified", layout_status="unverified",
                                render_status="unverified", confidence="low", findings=f, inferred_family=None,
                                contextual_checks=contextual_checks(dg)))
            continue
        rv = Review(dg)
        fs = rv.run()
        for f in fs:
            f["review_dimension"] = "semantics"
        if dg.get("intent") == "counterexample":  # the meaning is wrong on purpose; legibility still has to hold
            for f in fs:
                f.setdefault("exception", {"reason": "declared counterexample (shown as the wrong way on purpose)",
                                           "accepted_by": "diagram_meta intent"})
            if not fs:
                fs.append(dict(severity="suggestion", rule_id="COUNTEREXAMPLE-NOTHING-WRONG", location="diagram",
                               review_dimension="semantics",
                               problem="Declared a counterexample, but nothing structural is wrong with it.",
                               rationale="If the error is in the meaning, the viewer must still be able to see it.",
                               minimal_fix="Check the intended mistake is visible, or drop intent='counterexample'.",
                               confidence="medium"))
        sem_status = status_for(fs, rv.inferred, rv.claimed)
        if "layout" in dg:
            lf, lsum = layout_rules.review_layout(dg, lim)
        else:
            lf, lsum = [], dict(measured=False)
        all_f = fs + lf
        apply_exceptions(dg["diagram_id"], all_f, exc)
        if dg.get("semantic_source") == "inferred":
            for f in fs:  # read back from pen geometry: the structure may be misread, so never more than medium
                if f.get("confidence") == "high":
                    f["confidence"] = "medium"
        sem_status = status_for(fs, rv.inferred, rv.claimed)
        lay_status = dim_status(lf) if lsum.get("measured") or lf else "not-measured"
        conf = "high" if all(f.get("confidence") == "high" for f in all_f) else "medium"
        if dg.get("semantic_source") == "inferred":
            conf = "medium"
        base["semantic_source"] = dg.get("semantic_source", "sidecar")
        r = dict(base, review_status=worst(sem_status if sem_status != "not-a-diagram" else "pass", lay_status)
                 if lay_status != "not-measured" or sem_status != "not-a-diagram" else sem_status,
                 semantic_status=sem_status, layout_status=lay_status, render_status="not-run",
                 semantic_pass=sem_status in ("pass", "pass-with-notes", "not-a-diagram"),
                 layout_pass=lay_status in ("pass", "pass-with-notes"),
                 confidence=conf, findings=all_f, inferred_family=rv.inferred,
                 notation_profile=rv.profile, layout_summary=lsum, contextual_checks=contextual_checks(dg))
        if sem_status == "not-a-diagram" and lay_status in ("pass", "not-measured"):
            r["review_status"] = "not-a-diagram"
        p = prev.get(dg["diagram_id"])
        if p and p.get("source_version") != v:
            r["superseded_result"] = {"source_version": p.get("source_version"), "review_status": p.get("review_status"),
                                      "note": "previous findings are stale: the diagram changed since that review"}
        results.append(r)
    slide_findings = []
    if render is not None:
        merge_render(results, render)
        for r in results:  # no source geometry (record without layout, inferred): layout is judged on the render alone
            if r.get("layout_status") == "not-measured" and r.get("render_status") in ("verified", "failed"):
                rf = [f for f in r["findings"] if f.get("review_dimension") == "layout"]
                apply_exceptions(r["diagram_id"], rf, exc)
                r["layout_status"] = dim_status(rf)
                r["layout_basis"] = "render-only"
                r["layout_pass"] = r["layout_status"] in ("pass", "pass-with-notes")
                r["review_status"] = worst(r["review_status"] if r["review_status"] != "not-a-diagram" else "pass",
                                           r["layout_status"])
        for r in results:
            apply_exceptions(r["diagram_id"], [f for f in r["findings"] if "rendered-slide" in f.get("verified_by", [])], exc)
        slide_findings = [dict(f) for f in render.get("slide_findings", [])]
        apply_exceptions(None, slide_findings, exc)
        for r in results:
            if r.get("render_status") == "failed" and not any(
                    "rendered-slide" in f.get("verified_by", []) and f["severity"] in GATING and not f.get("exception")
                    for f in r["findings"]):
                r["render_status"] = "verified"
        for r in results:
            if r.get("render_status") == "failed":
                r["review_status"] = worst(r["review_status"], "changes-required")
                r["layout_status"] = worst(r.get("layout_status"), "changes-required")
                r["layout_pass"] = False
    for r in results:
        r["render_verified"] = r.get("render_status") == "verified"
    deck = deck_findings(spec.get("diagrams", []))
    for f in deck:
        f["review_dimension"] = "semantics"
        for x in exc:
            if x["diagram_id"] == "*" and x["rule_id"] == f["rule_id"]:
                f["exception"] = {"reason": x["reason"], "accepted_by": x["accepted_by"]}
    gate_open = [(r["diagram_id"], f) for r in results for f in r["findings"]
                 if f["severity"] in GATING and not f.get("exception")]
    gate_open += [("deck", f) for f in deck if not f.get("exception")]
    for r in results:  # nothing gets a pass on content that wasn't inspected
        if r.get("review_status") == "unverified":
            for f in r["findings"]:
                if f["rule_id"] == "INPUT-NOT-INSPECTABLE" and not f.get("exception"):
                    gate_open.append((r["diagram_id"], f))
    gate_open += [(f["slide_ids"][0], f) for f in slide_findings if f["severity"] in GATING and not f.get("exception")]
    out = dict(contract_version=CONTRACT, deck=spec.get("deck"), pptx_sha256=spec.get("pptx_sha256"), stage=stage,
               mode=mode, source=spec.get("source"), results=results, deck_findings=deck, slide_findings=slide_findings,
               ignored_exceptions=bad_exc, unresolved=len(gate_open))
    if render is not None:
        out["render"] = {k: v for k, v in render.items() if k in ("status", "note", "dpi", "slides_checked")}
        out["render"]["pptx_sha256"] = render.get("pptx_sha256")
    gaps = []
    cov = spec.get("coverage")
    if cov is not None:
        cov = dict(cov)
        need = cov.get("render_required") or []
        done = ["slide-%02d" % n for n in (render or {}).get("slides_checked", [])]
        if render is None:
            gaps.append("the slides weren't render-checked")
        elif render.get("status") == "unverified":
            gaps.append("render check unverified: %s" % render.get("note"))
        else:
            miss = [s for s in need if s not in done]
            if miss:
                gaps.append("%d slide(s) not render-checked: %s" % (len(miss), ", ".join(miss[:8])))
        if cov.get("complete") is False and cov.get("note"):
            gaps.append(cov["note"])
        cov["render_checked"] = done
        cov["gaps"] = gaps
        cov["complete"] = not gaps
        out["coverage"] = cov
    out["gate"] = "blocked" if gate_open or gaps else "open"
    return out


def report_md(res):
    L = ["# Diagram review (%s, %s)" % (res["stage"], res["mode"]), ""]
    if res.get("deck"):
        L += ["Deck: `%s`" % res["deck"], ""]
    cov = res.get("coverage")
    if res.get("source"):
        L += ["Read from: %s." % res["source"], ""]
    if cov:
        srcs = defaultdict(list)
        for k, v in cov.get("semantic_sources", {}).items():
            srcs[v].append(k)
        L += ["**Coverage: %s.** %d of %d slides render-checked. Diagram structure from: %s. Sketch slides (no diagram "
              "structure found, render-checked only): %s.%s" % (
                  "complete" if cov.get("complete") else "INCOMPLETE", len(cov.get("render_checked", [])),
                  cov.get("slides_total", 0),
                  "; ".join("%s (%s)" % (k, ", ".join(v)) for k, v in sorted(srcs.items())) or "none",
                  ", ".join(cov.get("sketch_slides", [])) or "none",
                  " **Gaps:** " + "; ".join(cov["gaps"]) if cov.get("gaps") else ""), ""]
        if cov.get("stale_record"):
            L += ["Edited after build (record not trusted, re-read from geometry): %s." % ", ".join(
                "%s (%s)" % (k, ", ".join(v[:4])) for k, v in cov["stale_record"].items()), ""]
    L += ["**Gate: %s** (%d unresolved critical/major). Standards-informed structural review; it does not certify "
          "UML conformance, and the contextual checks below are still the model's job." % (res["gate"], res["unresolved"]), ""]
    unv = [r["diagram_id"] for r in res["results"] if r["review_status"] == "unverified"]
    if unv:
        L += ["**Not verified:** %s could not be inspected structurally. They are not passed; review them by eye." %
              ", ".join(unv), ""]
    if res.get("render"):
        L += ["Render: **%s** (%s)." % (res["render"]["status"], res["render"].get("note")), ""]
    else:
        L += ["Render: **not run**. Layout is checked on source geometry only; the final look is unverified until "
              "`--render <deck>.pptx` and a look at the slide PNGs.", ""]
    L += ["| diagram | slides | claimed → read as | semantics | layout | render | overall |", "|---|---|---|---|---|---|---|"]
    for r in res["results"]:
        L.append("| %s | %s | %s → %s | %s | %s | %s | %s |" % (
            r["diagram_id"], ", ".join(r.get("slide_ids") or []) or "-", r.get("claimed_diagram_type") or "?",
            r.get("inferred_family") or "?", r.get("semantic_status", "-"), r.get("layout_status", "-"),
            r.get("render_status", "-"), r["review_status"]))
    L.append("")
    for r in res["results"]:
        L += ["## %s · %s" % (r["diagram_id"], r["review_status"]), ""]
        if r.get("skip_reason"):
            L += ["Skipped: %s" % r["skip_reason"], ""]
            continue
        if r.get("superseded_result"):
            L += ["> Earlier result (%s, %s) is stale: the diagram changed." % (
                r["superseded_result"]["source_version"], r["superseded_result"]["review_status"]), ""]
        for f in r["findings"]:
            tag = " (accepted exception: %s, %s)" % (f["exception"]["reason"], f["exception"]["accepted_by"]) if f.get("exception") else ""
            extra = ""
            if f.get("review_dimension") == "layout":
                extra = " [layout; slides %s; elements %s; verified by %s]" % (
                    ", ".join(f.get("slide_ids") or []), ", ".join(f.get("element_ids") or []) or "-",
                    " + ".join(f.get("verified_by") or []))
            L += ["- **%s** `%s` at %s%s: %s %s **Fix:** %s _(confidence: %s)_%s" % (
                f["severity"], f["rule_id"], f["location"], tag, f["problem"], f["rationale"], f["minimal_fix"],
                f.get("confidence", "high"), extra)]
        if not r["findings"]:
            L.append("- No structural or layout findings.")
        ls = r.get("layout_summary") or {}
        if ls.get("region"):
            L += ["", "Placement: %s alignment in %s %s; diagram box %s (offset %s of the region width)." % (
                ls.get("alignment"), ls.get("region_source"), ls.get("region"), ls.get("group_bbox"),
                "%.1f%%" % (ls["offset"] * 100) if ls.get("offset") is not None else "n/a")]
        if r.get("layout_basis") == "render-only":
            L += ["", "Layout judged on the render only (no source geometry recorded for this diagram)."]
        if r.get("semantic_source") == "inferred":
            L += ["", "Structure inferred from the pen geometry and shape names (no diagram record); confidence is "
                  "medium at best, so confirm the reading against the slide."]
        L += ["", "Contextual checks (model):"] + ["- [ ] " + c for c in r.get("contextual_checks", [])] + [""]
    sf = res.get("slide_findings") or []
    if sf:
        L += ["## Outside diagrams (sketches, scenes, text)", "",
              "Measured on the render; these block like any other finding when critical or major.", ""]
        for f in sorted(sf, key=lambda f: (f["slide_ids"], DIM_ORDER.index("blocked") if f["severity"] == "major" else 9)):
            tag = " (accepted exception: %s, %s)" % (f["exception"]["reason"], f["exception"]["accepted_by"]) if f.get("exception") else ""
            L.append("- **%s** `%s` %s, %s%s: %s **Fix:** %s" % (f["severity"], f["rule_id"], ", ".join(f["slide_ids"]),
                                                                f["location"], tag, f["problem"], f["minimal_fix"]))
        L.append("")
    if res["deck_findings"]:
        L += ["## Whole deck", ""]
        for f in res["deck_findings"]:
            tag = " (accepted exception)" if f.get("exception") else ""
            L.append("- **%s** `%s`%s: %s %s **Fix:** %s" % (f["severity"], f["rule_id"], tag, f["location"] + ". " + f["problem"],
                                                         f["rationale"], f["minimal_fix"]))
        L.append("")
    if res.get("ignored_exceptions"):
        L += ["Ignored exceptions (missing rule_id, diagram_id, reason or accepted_by): %d" % len(res["ignored_exceptions"]), ""]
    return "\n".join(L)


def write(res, prefix):
    json.dump(res, open(prefix + ".diagram-review.json", "w"), indent=1)
    open(prefix + ".diagram-review.md", "w").write(report_md(res))
    return prefix + ".diagram-review.json", prefix + ".diagram-review.md"


def summary(res):
    for r in res["results"]:
        n = defaultdict(int)
        for f in r["findings"]:
            n[f["severity"] + ("*" if f.get("exception") else "")] += 1
        dims = "sem=%s layout=%s render=%s" % (r.get("semantic_status", "-"), r.get("layout_status", "-"), r.get("render_status", "-"))
        print("DIAGRAM %-28s %-17s %-58s %s" % (r["diagram_id"], r["review_status"], dims,
                                                " ".join("%s=%d" % kv for kv in sorted(n.items())) or "-"))
    for f in res["deck_findings"]:
        print("DECK    %-28s %s" % (f["rule_id"], f["severity"]))
    for f in res.get("slide_findings", []):
        if f["severity"] in GATING or f.get("exception"):
            print("SLIDE   %-28s %-8s %s%s" % (", ".join(f["slide_ids"]), f["severity"], f["rule_id"],
                                             " (accepted: %s)" % f["exception"]["reason"] if f.get("exception") else ""))
    minor = [f for f in res.get("slide_findings", []) if f["severity"] not in GATING and not f.get("exception")]
    if minor:
        print("SLIDE   %d minor finding(s) outside diagrams (see the report)" % len(minor))
    unv = [r["diagram_id"] for r in res["results"] if r["review_status"] == "unverified"]
    if unv:
        print("UNVERIFIED %d diagram(s) not inspectable here: review their renders by eye (%s)" % (len(unv), ", ".join(unv)))
    cov = res.get("coverage")
    if cov:
        srcs = defaultdict(int)
        for v in cov.get("semantic_sources", {}).values():
            srcs[v] += 1
        print("COVERAGE %s: %d/%d slides render-checked; diagrams by source: %s; %d sketch slide(s) (render only)%s" % (
            "complete" if cov.get("complete") else "INCOMPLETE", len(cov.get("render_checked", [])), cov.get("slides_total", 0),
            ", ".join("%s=%d" % kv for kv in sorted(srcs.items())) or "none", len(cov.get("sketch_slides", [])),
            "; gaps: " + "; ".join(cov["gaps"]) if cov.get("gaps") else ""))
    print("GATE %s (%d unresolved critical/major%s)" % (res["gate"], res["unresolved"],
                                                       ", coverage incomplete" if cov and not cov.get("complete") else ""))


# ---------------------------------------------------------------- inputs: mermaid, pptx
def parse_mermaid(text, claimed="flowchart"):
    """Mermaid `flowchart`/`graph` subset: ids, [step] (round) ([pill]) {decision} [/io/] [(store)], -->, -- label -->, -->|label|."""
    lines = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith("%%")]
    if not lines or not re.match(r"^(flowchart|graph)\b", lines[0]):
        return None
    nodes, edges = {}, []
    shape = [(r"^\(\[(.*)\]\)$", "terminator"), (r"^\[\((.*)\)\]$", "data-store"), (r"^\{(.*)\}$", "decision"),
             (r"^\[/(.*)/\]$", "io"), (r"^\((.*)\)$", "action"), (r"^\[(.*)\]$", "process")]

    def node(tok):
        m = re.match(r"^([A-Za-z0-9_]+)(.*)$", tok.strip())
        if not m:
            return None
        nid, rest = m.group(1), m.group(2).strip()
        if rest:
            for pat, kind in shape:
                mm = re.match(pat, rest)
                if mm:
                    nodes[nid] = dict(id=nid, kind=kind, label=mm.group(1).strip('"'))
                    break
        nodes.setdefault(nid, dict(id=nid, kind="process", label=nid))
        return nid
    for l in lines[1:]:
        parts = re.split(r"\s*(-->\|[^|]*\||--\s[^-]+?\s-->|-->|---)\s*", l)
        if len(parts) == 1:
            node(parts[0])
            continue
        prev = node(parts[0])
        for i in range(1, len(parts) - 1, 2):
            op, tok = parts[i], parts[i + 1]
            lab = re.match(r"-->\|([^|]*)\|", op) or re.match(r"--\s(.+?)\s-->", op)
            cur = node(tok)
            edges.append(dict(id="e%d" % len(edges), kind="arrow", from_=prev, to=cur,
                              label=lab.group(1).strip() if lab else None, directed=op != "---", style="solid-arrow"))
            prev = cur
    for e in edges:
        e["from"] = e.pop("from_")
    return dict(claimed_diagram_type=claimed, nodes=list(nodes.values()), edges=edges)


PPTX_KIND = {"FLOWCHART_DECISION": "decision", "DIAMOND": "decision", "FLOWCHART_TERMINATOR": "terminator",
             "FLOWCHART_PROCESS": "process", "RECTANGLE": "process", "ROUNDED_RECTANGLE": "action",
             "FLOWCHART_ALTERNATE_PROCESS": "action", "FLOWCHART_DATA": "io", "PARALLELOGRAM": "io",
             "OVAL": "ellipse", "FLOWCHART_MAGNETIC_DISK": "data-store", "CAN": "data-store"}


def _native_inventory(prs, stale_note=""):
    """Office-drawn diagrams (auto-shapes joined by real connectors) and slides that can only be judged by eye."""
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    out = []
    for i, slide in enumerate(prs.slides, 1):
        sid = "slide-%02d" % i
        nodes, edges, free, texts, pics = {}, [], 0, [], 0
        notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
        for sh in slide.shapes:
            if sh.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
                try:
                    ast = sh.auto_shape_type
                    k = PPTX_KIND.get(getattr(ast, "name", str(ast).split(" ")[0]))
                except Exception:
                    k = None
                if k:
                    nodes[sh.shape_id] = dict(id="s%d" % sh.shape_id, kind=k,
                                              label=sh.text_frame.text.strip() if sh.has_text_frame else "")
            elif sh.shape_type == MSO_SHAPE_TYPE.FREEFORM:
                free += 1
            elif sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pics += 1
            elif sh.has_text_frame and sh.text_frame.text.strip():
                texts.append(sh.text_frame.text.strip())
            if sh.shape_type == MSO_SHAPE_TYPE.LINE or sh.__class__.__name__ == "Connector":
                edges.append(dict(id="c%d" % sh.shape_id, kind="arrow", style="solid-arrow", raw=sh))
        resolved = []
        for e in edges:
            sh = e.pop("raw")
            xml = sh._element.xml
            st = re.search(r'<a:stCxn id="(\d+)"', xml)
            en = re.search(r'<a:endCxn id="(\d+)"', xml)
            e["from"] = "s%s" % st.group(1) if st else None
            e["to"] = "s%s" % en.group(1) if en else None
            e["directed"] = "tailEnd" in xml or "headEnd" in xml
            if e["from"] or e["to"]:
                resolved.append(e)
        if len(nodes) >= 2 and resolved:
            uc = "use case" in " ".join(texts + [n["label"] for n in nodes.values()]).lower()
            for n in nodes.values():
                if n["kind"] == "ellipse":
                    n["kind"] = "use-case" if uc else "terminator"
            out.append(dict(diagram_id="%s-native" % sid, slide_ids=[sid], claimed_diagram_type="unknown",
                            notation_profile="general-diagram", narration_excerpt=notes, semantic_source="native",
                            nodes=list(nodes.values()), edges=resolved, source="native shapes"))
        elif pics or (nodes and not resolved and free < 3):
            out.append(dict(diagram_id="%s-drawn" % sid, slide_ids=[sid], inspectable=False, semantic_source="none",
                            narration_excerpt=notes,
                            inspect_note=("%s: %d images and %d native shapes but no parsable connectors%s. The render "
                                          "check still measures it; its meaning needs a look. Text on slide: %s" %
                                          (sid, pics, len(nodes), stale_note, "; ".join(texts)[:200] or "(none)"))))
    return out


def audit_pptx(path):
    """Find every diagram in a delivered .pptx. Nothing is skipped as a pass: sources, most trusted first,
      1. <deck>.diagrams.json next to it, if its pptx_sha256 matches this exact file;
      2. the record whiteboard-lecture-slides embeds in the .pptx (customXml/evs-record.xml), per diagram, only
         while its shape fingerprints still match (a diagram edited later in PowerPoint falls through to 3);
      3. inference from the engine's pen geometry and shape names (infer_diagrams.py), for decks with no record;
      4. native PowerPoint shapes and connectors, for decks made elsewhere.
    Every slide is render-checked regardless (main), and `coverage` says what each slide was reviewed from."""
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    side = os.path.splitext(path)[0] + ".diagrams.json"
    spec = None
    stale_side = False
    if os.path.exists(side):
        s = json.load(open(side))
        if s.get("pptx_sha256") == sha:
            spec = s
            spec["source"] = "engine sidecar (matches this .pptx)"
            for dg in spec.get("diagrams", []):
                dg.setdefault("semantic_source", "sidecar")
        else:
            stale_side = True
    try:
        from pptx import Presentation
    except ImportError:
        spec = spec or dict(contract_version=CONTRACT, deck=os.path.basename(path), pptx_sha256=sha, diagrams=[],
                            source="none")
        spec["coverage"] = dict(complete=False, note="python-pptx is not installed, so the deck can't be parsed")
        return spec
    prs = Presentation(path)
    n_slides = len(prs.slides)
    engine = any(sh.name.startswith("!!") for sl in prs.slides for sh in sl.shapes)
    import deck_record
    rec = deck_record.read(path)
    stale_rec = {}
    if spec is None:
        spec = dict(contract_version=CONTRACT, deck=os.path.basename(path), pptx_sha256=sha, diagrams=[])
        srcs = []
        if rec:
            cur = deck_record.check_current(path, rec)
            for dg in rec.get("diagrams", []):
                ok, changed = cur.get(dg["diagram_id"], (False, ["(no fingerprint recorded)"]))
                if ok:
                    dg = dict(dg, semantic_source="record")
                    spec["diagrams"].append(dg)
                else:
                    stale_rec[dg["diagram_id"]] = changed
            srcs.append("embedded deck record (%d current, %d edited since)" % (len(spec["diagrams"]), len(stale_rec)))
        if stale_side:
            srcs.append("the .diagrams.json next to it describes a different version and was ignored")
        if not engine:
            covered = {s for dg in spec["diagrams"] for s in dg.get("slide_ids") or []}
            nat = _native_inventory(prs, "; the .diagrams.json sidecar is stale" if stale_side else "")
            spec["diagrams"] += [d for d in nat if not covered & set(d["slide_ids"])]
            srcs.append("native-shape inventory")
        spec["source"] = "; ".join(srcs)
    if engine:
        # pen diagrams no record describes (drawn by hand rather than with diagrams.py, or edited since): read them back
        import infer_diagrams
        covered = {s for dg in spec["diagrams"] for s in dg.get("slide_ids") or []}
        inf = infer_diagrams.infer(path)
        added = 0
        for dg in inf["diagrams"]:
            if covered & set(dg["slide_ids"]):
                continue
            dg["semantic_source"] = "inferred"
            spec["diagrams"].append(dg)
            added += 1
        spec["sketch_slides"] = ["slide-%02d" % n for n in inf["sketch_slides"]]
        spec["source"] = "; ".join(x for x in (spec.get("source"), "inferred from pen geometry (%d diagram state(s), %d sketch "
                                                "slide(s))" % (added, len(inf["sketch_slides"]))) if x)
    if rec:
        spec["slide_roles"] = rec.get("slide_roles")
        spec["allowed_overlaps"] = rec.get("allowed_overlaps")
    dslides = sorted({s for dg in spec.get("diagrams", []) for s in dg.get("slide_ids") or []})
    spec["coverage"] = dict(
        slides_total=n_slides, engine_deck=engine,
        diagram_slides=dslides,
        semantic_sources={dg["diagram_id"]: dg.get("semantic_source", "sidecar") for dg in spec.get("diagrams", [])},
        sketch_slides=spec.get("sketch_slides", []),
        stale_record=stale_rec,
        render_required=["slide-%02d" % n for n in range(1, n_slides + 1)])
    return spec


# ---------------------------------------------------------------- gate
def gate(result_path, spec_path, source_only=None):
    """Exit 1 unless every current diagram was reviewed at this version, nothing critical/major is open, and the
    exported deck was render-checked (or the caller states why a source-only approval is acceptable)."""
    res = json.load(open(result_path))
    is_deck = spec_path.lower().endswith(".pptx")
    spec = audit_pptx(spec_path) if is_deck else json.load(open(spec_path))
    current = {d["diagram_id"]: version_of(d) for d in spec.get("diagrams", [])}
    seen = {r["diagram_id"]: r.get("source_version") for r in res.get("results", [])}
    problems = []
    for did, v in current.items():
        if did not in seen:
            problems.append("STALE %s was never reviewed" % did)
        elif seen[did] != v:
            problems.append("STALE %s changed after review (%s reviewed, now %s)" % (did, seen[did], v))
    if spec.get("pptx_sha256") and res.get("pptx_sha256") and spec["pptx_sha256"] != res["pptx_sha256"]:
        problems.append("STALE deck changed after review")
    if res.get("unresolved"):
        problems.append("OPEN %d unresolved critical/major or uninspected item(s)" % res["unresolved"])
    cov = res.get("coverage")
    if is_deck and cov is None:
        problems.append("COVERAGE the result has no coverage block: audit the .pptx itself (review_diagrams.py audit <deck>.pptx)")
    if cov is not None and not cov.get("complete"):
        problems.append("COVERAGE incomplete: %s" % "; ".join(cov.get("gaps") or ["unknown"]))
    rend = res.get("render") or {}
    needs = [r["diagram_id"] for r in res.get("results", []) if r.get("layout_status") not in (None, "not-measured")
             and r.get("review_status") != "skip-with-reason"]
    if needs and not source_only:
        if rend.get("status") != "verified" and not (rend.get("status") == "failed" and res.get("unresolved")):
            problems.append("RENDER %s: the exported slides weren't verified (%s); run review --render <deck>.pptx and "
                            "look at the PNGs, or pass --source-only \"<why>\"" % (rend.get("status", "not run"), rend.get("note", "no render")))
        elif spec.get("pptx_sha256") and rend.get("pptx_sha256") and rend["pptx_sha256"] != spec["pptx_sha256"]:
            problems.append("STALE the render checked a different .pptx than the current sidecar describes")
    if source_only:
        print("NOTE  source-only approval: %s" % source_only)
    for p in problems:
        print(p)
    print("GATE %s" % ("blocked" if problems else "open"))
    return 1 if problems else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("review")
    r.add_argument("spec")
    a = sub.add_parser("audit")
    a.add_argument("pptx")
    m = sub.add_parser("mermaid")
    m.add_argument("file")
    m.add_argument("--type", default="flowchart")
    m.add_argument("--profile", default="general-diagram")
    m.add_argument("--narration", default="")
    m.add_argument("--id", default=None)
    for p in (r, a, m):
        p.add_argument("--stage", default="post-render", choices=("pre-render", "post-render"))
        p.add_argument("--mode", default=None, choices=("integrated", "standalone"))
        p.add_argument("--exceptions")
        p.add_argument("--previous")
        p.add_argument("--out")
        p.add_argument("--limits", help="JSON object overriding layout thresholds, e.g. '{\"center_tol\": 0.08}'")
    for p in (r, a):
        p.add_argument("--render", nargs="?", const="auto", help="render-check the exported deck (path, or auto: next to the sidecar)")
        p.add_argument("--dpi", type=int, default=100)
        p.add_argument("--render-font", help="TEST ONLY: render the text in this font to simulate a substitution")
        p.add_argument("--keep-pngs", help="copy the full-slide render PNGs here for visual review")
    g = sub.add_parser("gate")
    g.add_argument("result")
    g.add_argument("spec")
    g.add_argument("--source-only", help="approve without a render check, with the reason")
    args = ap.parse_args(argv)
    if args.cmd == "gate":
        return gate(args.result, args.spec, args.source_only)
    if args.cmd == "review":
        spec = json.load(open(args.spec))
        mode = args.mode or "integrated"
        prefix = args.out or re.sub(r"(\.diagrams)?\.json$", "", args.spec)
    elif args.cmd == "audit":
        spec = audit_pptx(args.pptx)
        mode = args.mode or "standalone"
        prefix = args.out or os.path.splitext(args.pptx)[0]
        print("SOURCE %s" % spec.get("source"))
    else:
        dg = parse_mermaid(open(args.file).read(), args.type)
        did = args.id or os.path.splitext(os.path.basename(args.file))[0]
        if dg is None:
            spec = dict(diagrams=[dict(diagram_id=did, inspectable=False,
                                       inspect_note="Only Mermaid flowchart/graph is parsed; other Mermaid types need source-aware review.")])
        else:
            dg.update(diagram_id=did, notation_profile=args.profile, narration_excerpt=args.narration)
            spec = dict(diagrams=[dg])
        mode = args.mode or "standalone"
        prefix = args.out or os.path.splitext(args.file)[0]
    if args.stage == "pre-render" and args.cmd == "audit":
        args.stage = "post-render"
    render = None
    deck_path = None
    if args.cmd == "audit" and args.render != "none":
        deck_path = args.pptx  # an audit always measures every slide of the delivered file
    if args.cmd in ("review", "audit") and args.render and args.render not in ("auto", "none"):
        deck_path = args.render
    elif args.cmd == "review" and args.render == "auto":
        deck_path = os.path.join(os.path.dirname(os.path.abspath(args.spec)), spec.get("deck") or "")
    if deck_path:
        import hashlib as _h
        import render_check
        if not os.path.exists(deck_path):
            render = dict(status="unverified", note="deck %s not found" % deck_path, findings=[])
        else:
            sha = _h.sha256(open(deck_path, "rb").read()).hexdigest()
            if spec.get("pptx_sha256") and spec["pptx_sha256"] != sha:
                render = dict(status="unverified", note="the sidecar describes a different version of %s; rebuild first"
                              % os.path.basename(deck_path), findings=[])
            else:
                # exceptions are applied in review_spec, so accepted overlaps stay visible in the report
                render = render_check.check(deck_path, spec, dpi=args.dpi, font=args.render_font, keep_pngs=args.keep_pngs)
            render["pptx_sha256"] = sha
        print("RENDER %s (%s)" % (render["status"], render.get("note")))
    limits = json.loads(args.limits) if getattr(args, "limits", None) else None
    res = review_spec(spec, args.stage, mode, args.exceptions, args.previous, render=render, limits=limits)
    if args.cmd == "audit":
        res["audited_pptx"] = os.path.abspath(args.pptx)
    j, md = write(res, prefix)
    summary(res)
    print("WROTE %s %s" % (j, md))
    return 1 if res["gate"] == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
