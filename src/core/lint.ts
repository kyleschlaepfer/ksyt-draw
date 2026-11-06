/**
 * The notation check: a port of `Review` and `status_for` from reference/review_diagrams.py
 * (diagram-semantics-reviewer 1.2). Same rule ids, severities, confidence, locations and wording.
 *
 * It is written against the reviewer's contract 1.0 shape, so it also grades the families the
 * parser can't produce yet (ERD, class, sequence, state, DFD, causal) from a hand-written spec.
 * Keep it a port: new rules go into the reviewer first (spec/lint.md).
 *
 * One addition the reviewer doesn't have: each finding also records the node and edge ids it is about
 * (`refs`, via lintWithRefs). The reviewer locates by label, and two shapes can share a label, so "show it"
 * can't find the right one from the location alone. The findings themselves are untouched; the fixtures
 * still compare them to the Python output field for field.
 */
import type { Confidence, Diagram, Finding, LintResult, LintStatus, Severity } from "./model";
import { pyRepr } from "./parse";

// Contract 1.0 as the reviewer reads it: any node or edge may carry the extra fields other families use.
export interface ReviewNode {
  id: string;
  kind?: string | null;
  label?: string | null;
  inside?: string | null;
  rows?: Array<{ name?: string; key?: string | null }> | null;
  [k: string]: unknown;
}
export interface ReviewEdge {
  id?: string;
  kind?: string | null;
  from?: string;
  to?: string;
  label?: string | null;
  guard?: string | null;
  style?: string | null;
  directed?: boolean;
  meaning?: string | null;
  card_from?: string | null;
  card_to?: string | null;
  order?: number | string | null;
  polarity?: string | null;
  [k: string]: unknown;
}
export interface ReviewDiagram {
  claimed_diagram_type?: string | null;
  notation_profile?: string | null;
  narration_excerpt?: string | null;
  legend?: string | null;
  level?: string | null;
  nodes?: ReviewNode[];
  edges?: ReviewEdge[];
  [k: string]: unknown;
}

// ---------------------------------------------------------------- vocabulary
export const STEP_KINDS = new Set(["action", "process", "step"]);
export const FLOW_KINDS = new Set([...STEP_KINDS, "decision", "merge", "fork", "join", "initial", "final", "flow-final", "terminator", "io"]);
export const FAMILY_OF_NODE: Record<string, string> = {
  action: "flow", process: "flow", step: "flow", decision: "flow", merge: "flow", io: "flow",
  terminator: "flow", initial: "flow", final: "flow", "flow-final": "flow", fork: "flow", join: "flow",
  actor: "use-case", "use-case": "use-case",
  entity: "data", class: "class",
  lifeline: "sequence", state: "state",
  "data-store": "dfd", "external-entity": "dfd", "dfd-process": "dfd",
  concept: "concept",
};
export const NEUTRAL_NODES = new Set(["boundary", "note", "label"]);
export const TYPE_FAMILY: Record<string, string | null> = {
  activity: "flow", flowchart: "flow", "use-case": "use-case", sequence: "sequence",
  class: "class", erd: "data", state: "state", dfd: "dfd", causal: "concept", concept: "concept",
  sketch: "sketch", unknown: null,
};
export const COMPATIBLE: Array<Set<string>> = [new Set(["flow"]), new Set(["data", "class"]), new Set(["concept", "sketch"])];
export const UML_TYPES = new Set(["activity", "use-case", "sequence", "class", "state"]);
export const ARROW_MEANING: Record<string, string> = {
  activity: "control", flowchart: "control", dfd: "data-flow", sequence: "message",
  state: "transition", causal: "influence", concept: "relation", "use-case": "association",
  sketch: "relation", erd: "relationship", class: "association",
};
export const MEANING_CLASS: Record<string, string> = {
  control: "sequence-of-work", transition: "sequence-of-work", message: "sequence-of-work",
  return: "sequence-of-work", "data-flow": "data", influence: "causal", relation: "causal",
  include: "structural", extend: "structural", dependency: "structural",
  generalization: "structural", association: "link", relationship: "link",
};

export const EXCLUSIVE_CUES = ["\\beither\\b", "\\bone or the other\\b", "\\bdepending on\\b", "\\bwhichever\\b", "\\binstead\\b",
  "\\botherwise\\b", "\\bnot both\\b", "\\b\\w+ed,? or \\w+ed\\b", "\\bor\\b[^.]*\\bbut not\\b"];
export const PARALLEL_CUES = ["\\bat the same time\\b", "\\bsimultaneous", "\\bin parallel\\b", "\\bconcurrent", "\\bmeanwhile\\b",
  "\\bboth\\b[^.]{0,60}\\band\\b", "\\bwhile\\b[^.]{0,60}\\balso\\b", "\\bat once\\b"];
export const VERBS = new Set(`accept add apply approve assign authenticate book browse buy calculate cancel change check checkout
choose close collect compare complete confirm create delete deliver deposit download edit enroll enter export file
fill find generate get give handle identify import issue log login logout look make manage monitor notify open order
pay place post prepare print process purchase read receive record register reject remove renew report request reserve
reset resolve retrieve return review run save schedule search select send set ship sign start submit subscribe
track transfer update upload validate verify view vote withdraw write`.split(/\s+/));

const subset = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Python str.split() with no separator. */
const words = (s: string): string[] => (s.trim() === "" ? [] : s.trim().split(/\s+/));
const truthy = (v: unknown): boolean => !!v;

export function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function cue(patterns: string[], text: string | null | undefined): string[] {
  const t = (text || "").toLowerCase();
  return patterns.filter((p) => new RegExp(p).test(t));
}

interface AddOpts { conf?: Confidence; umlOnly?: boolean; strictSev?: Severity | null; nodes?: unknown[]; edges?: unknown[] }

/** The node and edge ids a finding is about. Not part of the reviewer's output (it locates by label, which is
 * ambiguous when two elements share a name); kept beside the findings so the tool can point at the right one. */
export interface FindingRefs { nodes: string[]; edges: string[] }

// ---------------------------------------------------------------- review core
export class Review {
  d: ReviewDiagram;
  nodes = new Map<string, ReviewNode>();
  edges: ReviewEdge[];
  profile: string;
  claimed: string;
  narr: string;
  findings: Finding[] = [];
  /** refs[i] belongs to findings[i] */
  refs: FindingRefs[] = [];
  out = new Map<string, ReviewEdge[]>();
  inc = new Map<string, ReviewEdge[]>();
  inferred = "sketch";

  constructor(dg: ReviewDiagram) {
    this.d = dg;
    for (const n of dg.nodes ?? []) if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    else this.nodes.set(n.id, n);
    this.edges = [...(dg.edges ?? [])];
    this.profile = dg.notation_profile || "uml-inspired";
    this.claimed = (dg.claimed_diagram_type || "unknown").toLowerCase();
    this.narr = dg.narration_excerpt || "";
    for (const e of this.edges) {
      push(this.out, String(e.from), e);
      push(this.inc, String(e.to), e);
    }
  }

  // severity tuned by profile: strict raises, general-diagram suppresses UML-only rules
  add(sev: Severity, rule: string, loc: string, problem: string, why: string, fix: string, o: AddOpts = {}): void {
    const { conf = "high", umlOnly = false, strictSev = null } = o;
    if (umlOnly && this.profile === "general-diagram") return;
    if (this.profile === "strict-uml" && strictSev) sev = strictSev;
    this.findings.push({ severity: sev, rule_id: rule, location: loc, problem, rationale: why, minimal_fix: fix, confidence: conf });
    const ids = (xs: unknown[] | undefined) => [...new Set((xs ?? []).filter((x) => x != null).map(String))];
    this.refs.push({ nodes: ids(o.nodes), edges: ids(o.edges) });
  }

  label(nid: unknown): string {
    const n = this.nodes.get(nid as string);
    return n ? (n.label || (nid as string)) : String(nid);
  }

  kind(nid: unknown): string | null | undefined {
    const n = this.nodes.get(nid as string);
    return n ? n.kind : null;
  }

  edgeKind(e: ReviewEdge): string {
    const k = e.kind || "arrow";
    if (k === "arrow") return ARROW_MEANING[this.claimed] ?? "control";
    return k;
  }

  // ---------- family identification (before grading)
  inferFamily(): [string, Map<string, number>] {
    const votes = new Map<string, number>();
    const vote = (f: string, n: number) => votes.set(f, (votes.get(f) ?? 0) + n);
    for (const n of this.nodes.values()) {
      const f = FAMILY_OF_NODE[n.kind ?? ""];
      if (f) vote(f, 1);
    }
    const kinds = new Set(this.edges.map((e) => this.edgeKind(e)));
    if (kinds.has("include") || kinds.has("extend")) vote("use-case", 2);
    if (kinds.has("relationship")) vote("data", 2);
    if (kinds.has("data-flow") && truthy(votes.get("dfd"))) vote("dfd", 1);
    if (kinds.has("message") && truthy(votes.get("sequence"))) vote("sequence", 1);
    let formal = 0;
    for (const v of votes.values()) formal += v;
    if (formal === 0 || (this.nodes.size <= 3 && subset(new Set(votes.keys()), new Set(["concept"])))) return ["sketch", votes];
    // a use-case-looking diagram whose links are a chronological, branching flow is a flow
    const ucChain = this.edges.filter((e) => this.kind(e.from) === "use-case" && this.kind(e.to) === "use-case" &&
      ["control", "arrow", "association"].includes(this.edgeKind(e)) && (e.directed ?? true));
    const branchy = this.edges.some((e) => ["yes", "no", "approved", "rejected", "true", "false"].includes(norm(e.label)) ||
      (e.label || "").startsWith("["));
    if (truthy(votes.get("use-case")) && (truthy(votes.get("flow")) || (ucChain.length > 0 && branchy))) {
      if ((votes.get("flow") ?? 0) + ucChain.length >= votes.get("use-case")! || branchy) return ["flow", votes];
    }
    let best: string | null = null, bestV = -Infinity;
    for (const [f, v] of votes) if (v > bestV) { best = f; bestV = v; }
    return [best!, votes];
  }

  // ---------- generic structure
  checkStructure(): void {
    for (const e of this.edges) {
      for (const end of ["from", "to"] as const) {
        if (!this.nodes.has(e[end] as string)) {
          this.add("major", "STRUCT-DANGLING-EDGE", `edge ${e.id}`,
            `The ${end} end of this connector is not attached to any diagram element (${pyRepr(e[end])}).`,
            "A connector that starts or ends nowhere leaves the relationship unreadable.",
            "Attach it to the element it refers to, or remove it.", { conf: "medium", edges: [e.id] });
        }
      }
    }
    const linked = new Set<unknown>();
    for (const e of this.edges) { linked.add(e.from); linked.add(e.to); }
    if (this.edges.length > 0) {
      for (const [nid, n] of this.nodes) {
        if (NEUTRAL_NODES.has(n.kind ?? "") || linked.has(nid)) continue;
        if (["initial", "final", "terminator"].includes(n.kind ?? "") && this.nodes.size <= 2) continue;
        this.add("minor", "STRUCT-ISOLATED", `${n.kind} '${this.label(nid)}'`,
          "This element is not connected to anything.",
          "Unconnected parts invite the viewer to guess how they relate.",
          "Connect it, or move it off this diagram if the narration does not use it.", { conf: "medium", nodes: [nid] });
      }
    }
  }

  checkMeaningsWithin(): void {
    const byStyle = new Map<string, Set<string>>();
    for (const e of this.edges) {
      const st = e.style;
      if (st) {
        if (!byStyle.has(st)) byStyle.set(st, new Set());
        byStyle.get(st)!.add(MEANING_CLASS[e.meaning || this.edgeKind(e)] ?? "other");
      }
    }
    if (truthy(this.d.legend)) return;
    for (const [st, ms] of byStyle) {
      if (ms.size > 1) {
        this.add("major", "XDIAG-ARROW-MEANING", `connectors drawn as '${st}'`,
          `The same connector style carries different meanings here (${[...ms].sort().join(", ")}).`,
          "A viewer reads one shape as one meaning; mixing them without a legend misleads.",
          "Give each meaning its own stroke (solid vs dashed, labeled) or add a one-line legend.", { edges: this.edges.filter((e) => e.style === st).map((e) => e.id) });
      }
    }
  }

  // ---------- family: use case
  checkUseCase(): void {
    const boundaries = [...this.nodes.values()].filter((n) => n.kind === "boundary");
    const assoc = new Map<string, Set<string>>();
    const has = (uc: unknown) => (assoc.get(uc as string)?.size ?? 0) > 0;
    for (const e of this.edges) {
      const a = e.from, b = e.to;
      if ((this.kind(a) === "actor" && this.kind(b) === "use-case") || (this.kind(b) === "actor" && this.kind(a) === "use-case")) {
        const [actor, uc] = this.kind(a) === "actor" ? [a, b] : [b, a];
        if (!assoc.has(uc as string)) assoc.set(uc as string, new Set());
        assoc.get(uc as string)!.add(actor as string);
        if (truthy(e.directed) && ["control", "association", "arrow"].includes(this.edgeKind(e))) {
          this.add("minor", "UC-ASSOC-DIRECTED", `${this.label(a)} -> ${this.label(b)}`,
            "The actor link is drawn as a directed arrow.",
            "Actor-use case associations are plain lines; an arrowhead reads as a step in a sequence.",
            "Draw a plain line (no arrowhead).", { umlOnly: true, strictSev: "major", nodes: [a, b], edges: [e.id] });
        }
      }
    }
    for (const n of this.nodes.values()) {
      const inside = n.inside;
      if (n.kind === "actor" && truthy(inside)) {
        this.add("major", "UC-ACTOR-INSIDE", `actor '${this.label(n.id)}'`,
          "The actor is drawn inside the system boundary.",
          "Actors are roles outside the subject; inside the box they read as part of the system.",
          "Move the actor outside the boundary.", { nodes: [n.id] });
      }
      if (n.kind === "use-case" && boundaries.length > 0 && !truthy(inside)) {
        this.add("minor", "UC-OUTSIDE-BOUNDARY", `use case '${this.label(n.id)}'`,
          "This use case sits outside the system boundary.",
          "Use cases are services of the subject, so they belong inside its box.",
          "Move it inside the boundary (or draw a second subject if it belongs to another system).", { nodes: [n.id] });
      }
      const nw = words(norm(n.label));
      if (n.kind === "use-case" && words(n.label || "").length === 1 && nw.length > 0 && !VERBS.has(nw[0])) {
        this.add("suggestion", "UC-LABEL-VERB", `use case '${this.label(n.id)}'`,
          "A one-word, non-verb label reads as a thing, not a goal.",
          "Use cases name something the actor wants done.",
          'Use a verb phrase ("place order", not "orders").', { conf: "medium", nodes: [n.id] });
      }
    }
    for (const e of this.edges) {
      const k = this.edgeKind(e);
      const a = e.from, b = e.to;
      if (this.kind(a) === "use-case" && this.kind(b) === "use-case" && ["control", "arrow"].includes(k) && (e.directed ?? true)) {
        this.add("major", "UC-SEQUENCE-ARROW", `${this.label(a)} -> ${this.label(b)}`,
          "Two use cases are joined by a control-flow arrow.",
          "Use-case diagrams have no time order; an arrow between goals reads as 'then'.",
          "Use «include»/«extend» if one reuses the other; if the point is order, use an activity diagram.", { nodes: [a, b], edges: [e.id] });
      }
      if (k !== "include" && k !== "extend") continue;
      if ((truthy(e.style) && e.style !== "dashed-arrow") || !(e.directed ?? true)) {
        this.add("minor", "UC-DEPENDENCY-STYLE", `«${k}» ${this.label(a)} -> ${this.label(b)}`,
          `«${k}» is not drawn as a dashed arrow.`,
          "The dashed dependency arrow is what distinguishes «include»/«extend» from an association.",
          `Draw it dashed with an open arrowhead and the «${k}» label.`, { umlOnly: true, nodes: [a, b], edges: [e.id] });
      }
      // direction: narration first (high confidence), then structure (medium)
      let rev: Confidence | false | null = this.narratedDirection(k, a, b);
      if (rev === null) {
        if (k === "include" && has(b) && !has(a)) rev = "medium";
        if (k === "extend" && has(a) && !has(b)) rev = "medium";
      }
      if (rev) {
        if (k === "include") {
          this.add("major", "UC-INCLUDE-DIRECTION", `«include» ${this.label(a)} -> ${this.label(b)}`,
            `The «include» arrow appears reversed: it points from '${this.label(a)}' to '${this.label(b)}'.`,
            "«include» points from the including (base) use case to the included, reused one. " +
            "Reversed, it says the reused fragment depends on the base.",
            `Reverse it: arrow from '${this.label(b)}' to '${this.label(a)}'.`, { conf: rev, nodes: [a, b], edges: [e.id] });
        } else {
          this.add("major", "UC-EXTEND-DIRECTION", `«extend» ${this.label(a)} -> ${this.label(b)}`,
            `The «extend» arrow appears reversed: it points from '${this.label(a)}' to '${this.label(b)}'.`,
            "«extend» points from the optional extension to the base use case it extends.",
            `Reverse it: arrow from '${this.label(b)}' to '${this.label(a)}'.`, { conf: rev, nodes: [a, b], edges: [e.id] });
        }
      }
    }
  }

  /** "high" if the narration states the opposite direction, false if it confirms, null if silent. */
  narratedDirection(k: string, a: unknown, b: unknown): "high" | false | null {
    const t = norm(this.narr);
    const la = norm(this.label(a)), lb = norm(this.label(b));
    if (!la || !lb) return null;
    const verb = k === "include" ? "includes" : "extends";
    if (new RegExp(`${escapeRe(la)}\\s+(always\\s+)?${verb}\\s+${escapeRe(lb)}`).test(t)) return false;
    if (new RegExp(`${escapeRe(lb)}\\s+(always\\s+)?${verb}\\s+${escapeRe(la)}`).test(t)) return "high";
    return null;
  }

  // ---------- family: activity / flowchart
  checkFlow(): void {
    const isFlowchart = this.claimed === "flowchart" || (this.claimed !== "activity" && this.profile === "general-diagram");
    const pfx = isFlowchart ? "FLOW" : "ACTIVITY";
    const exclusive = cue(EXCLUSIVE_CUES, this.narr), parallel = cue(PARALLEL_CUES, this.narr);
    const guard = (e: ReviewEdge) => e.label || e.guard;
    for (const [nid, n] of this.nodes) {
      const k = n.kind;
      const outs = this.out.get(nid) ?? [], ins = this.inc.get(nid) ?? [];
      if (k === "decision") {
        if (outs.length >= 2) {
          const unl = outs.filter((e) => !truthy(guard(e)));
          if (unl.length > 0) {
            this.add("major", `${pfx}-DECISION-GUARD`, `decision '${this.label(nid)}'`,
              `${unl.length} of ${outs.length} outgoing branches are unlabeled.`,
              "The viewer cannot tell which path is which outcome.",
              `Label each branch where it leaves the diamond (${isFlowchart ? "Yes / No" : "[approved] / [rejected]"}).`, { nodes: [nid] });
          }
          const labels = outs.filter((e) => truthy(guard(e))).map((e) => norm(guard(e)));
          if (labels.length !== new Set(labels).size) {
            this.add("major", `${pfx}-DUPLICATE-GUARD`, `decision '${this.label(nid)}'`,
              "Two branches carry the same label.",
              "Branches of one decision must be distinguishable outcomes.",
              "Give each branch its own outcome label.", { nodes: [nid] });
          }
          const targets = outs.map((e) => e.to);
          if (new Set(targets).size < targets.length) {
            this.add("major", `${pfx}-BRANCH-SAME-TARGET`, `decision '${this.label(nid)}'`,
              "Two branches lead to the same next step.",
              "If every outcome goes to the same place, the decision changes nothing on the slide.",
              "Route each branch to the step that outcome actually leads to.", { conf: "medium", nodes: [nid] });
          }
        } else if (outs.length === 1 && ins.length >= 2) {
          this.add("suggestion", `${pfx}-MERGE-AS-DECISION`, `diamond '${this.label(nid)}'`,
            "This diamond only joins paths (several in, one out).",
            "That is a merge, not a decision; a question inside it suggests a choice that isn't there.",
            "Leave the merge diamond empty, or drop it and join the arrows.", { umlOnly: true, nodes: [nid] });
        } else {
          this.add("major", `${pfx}-DECISION-ONE-EXIT`, `decision '${this.label(nid)}'`,
            `This decision has ${outs.length} way out.`,
            "A decision with one exit is not a choice.",
            "Draw and label each outcome branch, or make it a plain step.", { nodes: [nid] });
        }
      }
      if (k === "fork" || k === "join") {
        if ((k === "fork" && outs.length < 2) || (k === "join" && ins.length < 2)) {
          this.add("major", `ACTIVITY-${k.toUpperCase()}-STRUCTURE`, `${k} bar`,
            `A ${k} bar needs at least two ${k === "fork" ? "outgoing" : "incoming"} paths; this one has ${k === "fork" ? outs.length : ins.length}.`,
            "The bar's whole meaning is splitting into, or waiting for, concurrent paths.",
            "Add the concurrent paths, or remove the bar.", { nodes: [nid] });
        }
        if (k === "fork" && outs.some((e) => truthy(guard(e)))) {
          this.add("major", "ACTIVITY-GUARDED-FORK", "fork bar",
            "Paths leaving the fork carry guards/labels.",
            "Guards mean only one path is taken; a fork means all are.",
            "If only one path runs, use a decision diamond; if all run, remove the guards.", { nodes: [nid] });
        }
      }
      const hasEnd = [...this.nodes.keys()].some((x) => ["final", "terminator", "flow-final"].includes(this.kind(x) ?? ""));
      if (STEP_KINDS.has(k ?? "") && outs.length === 0 && ins.length > 0 && hasEnd) {
        this.add("minor", `${pfx}-DEAD-END`, `step '${this.label(nid)}'`,
          "The flow stops here without an end marker.",
          "A viewer can't tell if the process ends or the drawing is unfinished.",
          `Continue the arrow or add an end (${isFlowchart ? "terminator" : "final node"}).`, { conf: "medium", nodes: [nid] });
      }
    }
    const forks = [...this.nodes.values()].filter((n) => n.kind === "fork");
    const decisions = [...this.nodes.values()].filter((n) => n.kind === "decision");
    if (forks.length > 0 && exclusive.length > 0 && parallel.length === 0) {
      const m = new RegExp(exclusive[0]).exec(this.narr.toLowerCase());
      this.add("major", "ACTIVITY-PARALLEL-VS-EXCLUSIVE", "fork bar",
        `The narration describes a choice ("${m ? m[0] : ""}") but the diagram forks into concurrent paths.`,
        "A fork bar teaches that every path runs at the same time.",
        "Replace the fork with a decision diamond and label each outcome.", { conf: "medium", nodes: forks.map((n) => n.id) });
    }
    if (decisions.length > 0 && parallel.length > 0 && exclusive.length === 0 && forks.length === 0) {
      this.add("major", "ACTIVITY-EXCLUSIVE-VS-PARALLEL", `decision '${this.label(decisions[0].id)}'`,
        "The narration describes concurrent work but the diagram uses a decision (one path taken).",
        "A decision teaches that only one branch happens.",
        "Use a fork bar to split into concurrent paths and a join bar where they meet.", { conf: "medium", nodes: [decisions[0].id] });
    }
    if (this.claimed === "activity") {
      if (![...this.nodes.values()].some((n) => n.kind === "initial")) {
        this.add("suggestion", "ACTIVITY-NO-INITIAL", "diagram",
          "No initial node.", "In UML the filled dot shows where the activity starts.",
          "Add a small filled dot before the first action.", { umlOnly: true, strictSev: "minor" });
      }
      if (![...this.nodes.values()].some((n) => n.kind === "final" || n.kind === "flow-final")) {
        this.add("suggestion", "ACTIVITY-NO-FINAL", "diagram",
          "No activity final node.", "The bullseye shows where the whole activity ends.",
          "Add a bullseye after the last action.", { umlOnly: true, strictSev: "minor" });
      }
    }
    if (this.claimed === "flowchart" && this.profile === "strict-uml") {
      this.add("minor", "PROFILE-MISMATCH", "diagram", "A flowchart is reviewed under strict-uml.",
        "Flowcharts are not UML; strict UML rules would be misapplied.",
        "Use profile general-diagram for flowcharts, or redraw as a UML activity diagram.");
    }
  }

  // ---------- family: data models
  checkErd(): void {
    const physical = [...this.nodes.values()].some((n) => n.kind === "entity" && (n.rows || []).some((r) => truthy(r.key))) ||
      this.d.level === "physical";
    for (const e of this.edges) {
      if (this.edgeKind(e) !== "relationship") continue;
      const a = e.from, b = e.to;
      const ca = e.card_from, cb = e.card_to;
      const loc = `relationship ${this.label(a)} - ${this.label(b)}`;
      if (!ca || !cb) {
        this.add("major", "ERD-CARDINALITY-MISSING", loc, `Cardinality is missing on ${!ca && !cb ? "both" : "one"} end.`,
          "Without both ends the viewer can't tell one-to-many from many-to-many.",
          "Mark both ends (crow's foot for many, bar for one, circle for optional).", { nodes: [a, b], edges: [e.id] });
        continue;
      }
      if (ca.includes("many") && cb.includes("many") && physical) {
        this.add("major", "ERD-MN-NEEDS-JUNCTION", loc,
          "Two tables are related many-to-many directly.",
          "Relational tables can't store M:N without a junction table; drawn as tables, this teaches a schema that can't exist.",
          "Insert a junction table with both foreign keys, one-to-many on each side.", { nodes: [a, b], edges: [e.id] });
      } else if (ca.includes("many") && cb.includes("many")) {
        this.add("suggestion", "ERD-MN-CONCEPTUAL", loc, "Many-to-many at the conceptual level.",
          "Fine in a conceptual ERD; say so if the lesson later turns it into tables.",
          "Optionally note 'resolved by a junction table' when the lesson gets there.", { conf: "medium", nodes: [a, b], edges: [e.id] });
      }
    }
    for (const [nid, n] of this.nodes) {
      if (n.kind !== "entity" || !(n.rows && n.rows.length > 0)) continue;
      const keys = n.rows.map((r) => r.key || "");
      if (physical && !keys.some((k) => k.toUpperCase().includes("PK"))) {
        this.add("minor", "ERD-PK-MISSING", `table '${this.label(nid)}'`, "No primary key is marked.",
          "Every table in a physical model has one; leaving it off hides how rows are identified.",
          "Mark the key column(s) PK.", { nodes: [nid] });
      }
      const fks = keys.filter((k) => k.toUpperCase().includes("FK"));
      if (fks.length >= 2) {
        for (const e of this.edges) {
          if (this.edgeKind(e) !== "relationship") continue;
          const end = e.from === nid ? "card_from" : e.to === nid ? "card_to" : null;
          if (end && !(e[end] || "").includes("many")) {
            this.add("major", "ERD-JUNCTION-SIDE", `junction '${this.label(nid)}'`,
              "The junction table is on the 'one' side of a relationship.",
              "Each row of a junction table references one parent row; many junction rows per parent.",
              "Put the crow's foot (many) at the junction end.", { nodes: [nid], edges: [e.id] });
          }
        }
      }
    }
  }

  checkClass(): void {
    for (const e of this.edges) {
      const k = this.edgeKind(e);
      if (k === "generalization" && truthy(e.style) && e.style !== "hollow-triangle") {
        this.add("minor", "CLASS-GENERALIZATION-STYLE", `${this.label(e.from)} -> ${this.label(e.to)}`,
          "Inheritance is not drawn with a hollow triangle.", "That head is what says 'is a kind of'.",
          "Use a hollow triangle pointing at the parent.", { umlOnly: true, nodes: [e.from, e.to], edges: [e.id] });
      }
      if (k === "association" && this.claimed === "class" && !(truthy(e.card_from) && truthy(e.card_to))) {
        this.add("minor", "CLASS-MULTIPLICITY", `${this.label(e.from)} - ${this.label(e.to)}`,
          "Association without multiplicities.", "The story usually depends on how many.",
          "Add multiplicities (1, 0..1, *, 1..*) at both ends if the narration relies on them.",
          { conf: "medium", strictSev: "major", nodes: [e.from, e.to], edges: [e.id] });
      }
    }
  }

  checkSequence(): void {
    const msgs = this.edges.filter((e) => ["message", "return"].includes(this.edgeKind(e)));
    const orders = msgs.map((e) => e.order ?? null);
    if (msgs.length > 0 && (orders.includes(null) || new Set(orders).size !== orders.length)) {
      this.add("major", "SEQ-MESSAGE-ORDER", "messages",
        "Messages have no unambiguous top-to-bottom order.",
        "In a sequence diagram, time runs down the lifelines; order is the content.",
        "Stack messages one per row in the order they happen.", { edges: msgs.map((e) => e.id) });
    }
    for (const e of msgs) {
      if (this.kind(e.from) !== "lifeline" || this.kind(e.to) !== "lifeline") {
        this.add("major", "SEQ-NOT-LIFELINE", `message ${e.id}`,
          "A message does not run between two lifelines.",
          "Messages are sent between participants' lifelines.",
          "Attach both ends to lifelines.", { conf: "medium", nodes: [e.from, e.to], edges: [e.id] });
      }
    }
  }

  checkState(): void {
    for (const e of this.edges) {
      if (this.edgeKind(e) === "transition" && !truthy(e.label)) {
        this.add("minor", "STATE-TRANSITION-EVENT", `${this.label(e.from)} -> ${this.label(e.to)}`,
          "Transition without an event.", "A state change happens because of something.",
          "Label it with the event (and [guard] if any).", { strictSev: "major", umlOnly: true, nodes: [e.from, e.to], edges: [e.id] });
      }
    }
    for (const n of this.nodes.values()) {
      const nw = words(norm(n.label));
      if (n.kind === "state" && nw.length > 0 && VERBS.has(nw[0])) {
        this.add("suggestion", "STATE-NAMED-AS-ACTION", `state '${this.label(n.id)}'`,
          "This state is named like an action.", "States are situations (Submitted, Approved).",
          "Rename to a condition or past participle.", { conf: "medium", nodes: [n.id] });
      }
    }
  }

  checkDfd(): void {
    for (const [nid, n] of this.nodes) {
      const k = n.kind;
      const ins = (this.inc.get(nid) ?? []).filter((e) => this.edgeKind(e) === "data-flow");
      const outs = (this.out.get(nid) ?? []).filter((e) => this.edgeKind(e) === "data-flow");
      if (["dfd-process", "process", "action", "step"].includes(k ?? "")) {
        if (ins.length > 0 && outs.length === 0) {
          this.add("major", "DFD-BLACK-HOLE", `process '${this.label(nid)}'`, "Data goes in, nothing comes out.",
            "A process transforms inputs into outputs.", "Add the output flow, or explain it is a sink.", { nodes: [nid] });
        }
        if (outs.length > 0 && ins.length === 0) {
          this.add("major", "DFD-MIRACLE", `process '${this.label(nid)}'`, "Data comes out of nothing.",
            "A process cannot produce data without input.", "Add the input flow.", { nodes: [nid] });
        }
      }
    }
    for (const e of this.edges) {
      if (this.edgeKind(e) !== "data-flow") continue;
      const ka = this.kind(e.from), kb = this.kind(e.to);
      const loc = `${this.label(e.from)} -> ${this.label(e.to)}`;
      if (ka === "data-store" && kb === "data-store") {
        this.add("major", "DFD-STORE-TO-STORE", loc, "Data flows store to store with no process.",
          "Something has to move it; that something is a process.", "Put a process between the stores.", { nodes: [e.from, e.to], edges: [e.id] });
      }
      if ((ka === "external-entity" && kb === "data-store") || (ka === "data-store" && kb === "external-entity")) {
        this.add("major", "DFD-EXTERNAL-TO-STORE", loc, "An external entity touches a data store directly.",
          "Outsiders reach stored data only through a process.", "Route the flow through a process.", { nodes: [e.from, e.to], edges: [e.id] });
      }
      if (ka === "external-entity" && kb === "external-entity") {
        this.add("major", "DFD-EXTERNAL-TO-EXTERNAL", loc, "Flow between two external entities.",
          "That exchange is outside the system and doesn't belong on its DFD.", "Remove it or add the process.", { nodes: [e.from, e.to], edges: [e.id] });
      }
      if (!truthy(e.label)) {
        this.add("minor", "DFD-UNLABELED-FLOW", loc, "Data flow has no label.", "Each flow names the data that moves.",
          'Label it with the data ("order details").', { nodes: [e.from, e.to], edges: [e.id] });
      }
    }
  }

  checkCausal(): void {
    for (const e of this.edges) {
      if (this.edgeKind(e) === "influence" && !(truthy(e.label) || truthy(e.polarity))) {
        this.add("minor", "CAUSAL-UNLABELED", `${this.label(e.from)} -> ${this.label(e.to)}`,
          "Influence arrow without a sign or verb.",
          "Whether more A means more or less B is the whole claim.",
          "Label + / - (or a short verb like 'increases').", { nodes: [e.from, e.to], edges: [e.id] });
      }
    }
  }

  // ---------- run
  run(): Finding[] {
    const [fam, votes] = this.inferFamily();
    this.inferred = fam;
    const want = TYPE_FAMILY[this.claimed] ?? null;
    if (this.claimed === "use-case" && fam === "flow") {
      this.add("critical", "FAMILY-USECASE-IS-FLOW", "diagram",
        "Called a use-case diagram, but it shows a chronological flow with branches.",
        "Use-case diagrams show who uses the system for which goals; they have no order or decisions. " +
        "Re-shaping boxes into ovals would not fix this.",
        "Redraw as an activity diagram (or a flowchart): steps, a decision with labeled outcomes. " +
        "Keep a use-case diagram only if the lesson is about actors and goals.");
    } else if (want && fam !== "sketch" && want !== fam && !COMPATIBLE.some((c) => subset(new Set([want, fam]), c))) {
      this.add("major", "FAMILY-MISMATCH", "diagram",
        `Claimed ${this.claimed}, but the structure reads as ${fam}.`,
        "Grading against the wrong family produces wrong fixes and teaches the wrong notation.",
        "Either change the claim/title to what it is, or redraw in the claimed notation.", { conf: "medium" });
    }
    if (UML_TYPES.has(this.claimed) && this.profile === "general-diagram") {
      this.add("suggestion", "PROFILE-MISMATCH", "diagram", "A UML diagram type reviewed as general-diagram.",
        "UML conventions will not be checked.", "Use uml-inspired (default) or strict-uml.");
    }
    const fams = [...votes].filter(([f, v]) => v >= 2 && f !== "concept").map(([f]) => f);
    if (fams.length > 1 && !truthy(this.d.legend) && !(this.claimed === "use-case" && fam === "flow")) {
      if (!COMPATIBLE.some((c) => subset(new Set(fams), c))) {
        this.add("major", "XDIAG-NOTATION-MIX", "diagram",
          `Mixes notations from different diagram families (${[...fams].sort().join(", ")}) without explanation.`,
          "Shapes borrowed from another notation carry that notation's meaning.",
          "Pick one family for this diagram, or split it into two slides.", { conf: "medium" });
      }
    }
    this.checkStructure();
    this.checkMeaningsWithin();
    const byFam: Record<string, string> = {
      flow: "flowchart", "use-case": "use-case", data: "erd", class: "class", sequence: "sequence",
      state: "state", dfd: "dfd", concept: "causal",
    };
    const grade = this.claimed !== "unknown" ? this.claimed : (byFam[fam] ?? "sketch");
    if (grade === "activity" || grade === "flowchart" || fam === "flow") this.checkFlow();
    if (grade === "use-case" && fam !== "flow") this.checkUseCase();
    if (grade === "erd" || fam === "data") this.checkErd();
    if (grade === "class") this.checkClass();
    if (grade === "sequence") this.checkSequence();
    if (grade === "state") this.checkState();
    if (grade === "dfd") this.checkDfd();
    if (grade === "causal" || grade === "concept") this.checkCausal();
    return this.findings;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export function statusFor(findings: Finding[], inferred: string, claimed: string): LintStatus {
  const open = findings.filter((f) => !(f as { exception?: unknown }).exception);
  const sev = new Set(open.map((f) => f.severity));
  if (sev.has("critical")) return "blocked";
  if (sev.has("major")) return "changes-required";
  if (sev.has("unverified")) return "unverified";
  if (inferred === "sketch" && ["sketch", "unknown", "concept"].includes(claimed) && open.length === 0) return "not-a-diagram";
  if (findings.length > 0) return "pass-with-notes";
  return "pass";
}

/** Review a parsed diagram (or any contract 1.0 spec). Never throws. */
export function lint(d: Diagram | ReviewDiagram): LintResult {
  return lintWithRefs(d).result;
}

/** lint(), plus the ids each finding is about (refs[i] for findings[i]). */
export function lintWithRefs(d: Diagram | ReviewDiagram): { result: LintResult; refs: FindingRefs[] } {
  const rv = new Review(d as ReviewDiagram);
  const findings = rv.run();
  return { result: { inferred_family: rv.inferred, status: statusFor(findings, rv.inferred, rv.claimed), findings }, refs: rv.refs };
}

/** The status in plain words for the panel title. */
export function statusWords(status: string): string {
  return ({
    pass: "pass", "pass-with-notes": "pass with notes", "changes-required": "needs changes", blocked: "blocked",
    unverified: "unverified", "not-a-diagram": "not a diagram",
  } as Record<string, string>)[status] ?? status;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor", "suggestion", "unverified"];

/** Findings worst first, stable within a severity. */
export function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

export function severityCounts(fs: Finding[]): { critical: number; major: number; minor: number; suggestion: number } {
  const c = { critical: 0, major: 0, minor: 0, suggestion: 0 };
  for (const f of fs) if (f.severity in c) c[f.severity as keyof typeof c] += 1;
  return c;
}
