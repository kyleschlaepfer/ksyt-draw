/**
 * Everything that can be said about a document, in one list with one shape.
 *
 * Findings come from four places, kept apart by `source`:
 *   syntax      the parser (doc/parse.ts): the text can't be read
 *   reference   the parser: a line names something that isn't declared
 *   notation    the reviewer's rules (lint.ts, a port) plus the v2 rules below for the features the
 *               reviewer doesn't cover yet (partitions, class members, use-case descriptions)
 *   layout      qa.ts: ink through text, overlaps, clipping, legibility
 *
 * Each issue names the elements it is about and, when the text has them, the lines to underline, so
 * the write view can underline a range and the draw view can select a shape.
 */
import type { Confidence, Finding, LintResult, Severity } from "./model";
import type { ChalkDoc, DocEdge } from "./doc/types";
import { CLASSIFIERS } from "./doc/types";
import { toContract } from "./doc/contract";
import { printMember } from "./doc/print";
import type { Diagnostic, ParsedSource } from "./doc/parse";
import { lint, statusFor } from "./lint";
import type { QaReport } from "./qa";

export type IssueSource = "syntax" | "reference" | "notation" | "layout" | "accessibility" | "practice";

export interface Issue {
  source: IssueSource;
  severity: Severity | "error" | "warning";
  rule_id: string;
  problem: string;
  rationale?: string;
  fix?: string;
  /** node ids */
  nodes: string[];
  /** edge uids */
  edges: string[];
  /** where the write view underlines it: 1-based line, 0-based columns */
  at?: { line: number; col: number; endCol: number };
}

/** A finding from the v2 rules: the reviewer's shape, plus the elements it is about. */
export interface RuleFinding extends Finding { nodes?: string[]; edges?: string[] }

interface AddOpts { conf?: Confidence; umlOnly?: boolean; strictSev?: Severity; nodes?: string[]; edges?: string[] }

/**
 * Rules for what v2 added. They follow the reviewer's conventions (ids, severities, a problem, why
 * it matters, the smallest fix; UML-only rules stay quiet under general-diagram; strict-uml may raise
 * a severity) so they can move into the reviewer itself later.
 */
export function rulesV2(d: ChalkDoc): RuleFinding[] {
  const out: RuleFinding[] = [];
  const profile = d.meta.profile;
  const add = (sev: Severity, rule: string, loc: string, problem: string, why: string, fix: string, o: AddOpts = {}): void => {
    if (o.umlOnly && profile === "general-diagram") return;
    if (profile === "strict-uml" && o.strictSev) sev = o.strictSev;
    out.push({
      severity: sev, rule_id: rule, location: loc, problem, rationale: why, minimal_fix: fix, confidence: o.conf ?? "high",
      ...(o.nodes ? { nodes: o.nodes } : {}), ...(o.edges ? { edges: o.edges } : {}),
    });
  };
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const name = (id: string): string => (byId.get(id)?.label ?? id).replace(/\n/g, " ");

  for (const e of d.edges) {
    if (e.from === e.to && byId.has(e.from)) {
      add("minor", "STRUCT-SELF-LINE", `${name(e.from)} -> ${name(e.to)}`, "This line joins a shape to itself, and Chalk doesn't draw those yet.",
        "A relationship that isn't drawn can't be read.", "Leave it out, or show the repeat with a decision that loops back.", { nodes: [e.from], edges: [e.uid] });
    }
  }

  // ---- activity partitions
  const lanes = d.nodes.filter((n) => n.kind === "partition");
  if (lanes.length) {
    const laneIds = new Set(lanes.map((l) => l.id));
    const loose = d.nodes.filter((n) => n.kind !== "partition" && n.kind !== "note" && n.kind !== "boundary" && !(n.parent && laneIds.has(n.parent)));
    if (loose.length) {
      add("minor", "ACT-PARTITION-OUTSIDE", loose.map((n) => `${n.kind} '${n.label ?? n.id}'`).join(", "),
        `${loose.length === 1 ? "A node sits" : `${loose.length} nodes sit`} outside every partition.`,
        "Partitions say who does each thing; a node outside them has no owner.",
        "Put each node in the partition of whoever does it.", { umlOnly: true, strictSev: "major", nodes: loose.map((n) => n.id) });
    }
    for (const l of lanes) {
      if (!d.nodes.some((n) => n.parent === l.id)) {
        add("suggestion", "ACT-PARTITION-EMPTY", `partition '${l.label ?? l.id}'`, "This partition has nothing in it.",
          "An empty lane reads as a participant who does nothing.", "Remove it, or move in the actions this participant does.", { nodes: [l.id] });
      }
    }
    if (lanes.length === 1) {
      add("suggestion", "ACT-PARTITION-SINGLE", `partition '${lanes[0].label ?? lanes[0].id}'`, "There is only one partition.",
        "Partitions earn their space by showing a hand-off between participants.", "Add the other participants, or drop the partition.", { nodes: [lanes[0].id] });
    }
  }

  // ---- classes
  if (d.meta.type === "class") {
    const parents = new Map<string, string[]>();
    for (const e of d.edges) if (e.kind === "generalization") parents.set(e.from, [...(parents.get(e.from) ?? []), e.to]);
    const reported = new Set<string>();
    for (const start of parents.keys()) {
      const stack: Array<[string, string[]]> = [[start, [start]]];
      while (stack.length) {
        const [at, path] = stack.pop()!;
        for (const p of parents.get(at) ?? []) {
          if (p === start) {
            const key = [...path].sort().join("|");
            if (!reported.has(key)) {
              reported.add(key);
              add("major", "CLASS-GENERALIZATION-CYCLE", path.map(name).join(" -> ") + ` -> ${name(start)}`, "These classes inherit from each other in a circle.",
                "A class can't be a kind of its own descendant.", "Turn one of the triangles around, or make one of the lines an association.", { nodes: path });
            }
          } else if (!path.includes(p) && path.length < 50) stack.push([p, [...path, p]]);
        }
      }
    }
    for (const e of d.edges) {
      const from = byId.get(e.from), to = byId.get(e.to);
      if (!from || !to) continue;
      if (e.kind === "realization" && to.kind !== "interface") {
        add("minor", "CLASS-REALIZATION-TARGET", `${name(e.from)} -> ${name(e.to)}`, "A realization points at something that isn't an interface.",
          "The dashed line with a hollow triangle means 'implements this interface'.", `Make ${name(e.to)} an interface, or use a solid line (generalization) if it is a parent class.`,
          { umlOnly: true, strictSev: "major", nodes: [e.from, e.to], edges: [e.uid] });
      }
      if (e.kind === "generalization" && from.kind !== to.kind && CLASSIFIERS.has(from.kind) && CLASSIFIERS.has(to.kind) && to.kind === "interface") {
        add("minor", "CLASS-GENERALIZATION-INTERFACE", `${name(e.from)} -> ${name(e.to)}`, "A class inherits from an interface with a solid line.",
          "A class implements an interface; that is a realization, drawn dashed.", "Use ..|> for this line.", { umlOnly: true, nodes: [e.from, e.to], edges: [e.uid] });
      }
    }
    for (const n of d.nodes) {
      if (!CLASSIFIERS.has(n.kind)) continue;
      const seen = new Set<string>();
      for (const m of n.members ?? []) {
        const sig = printMember({ ...m, visibility: undefined, static: false, abstract: false });
        if (seen.has(sig)) {
          add("minor", "CLASS-DUPLICATE-MEMBER", `class '${name(n.id)}'`, `${sig} is listed twice.`,
            "A repeated member makes the reader look for a difference that isn't there.", "Remove one of them.", { nodes: [n.id] });
        }
        seen.add(sig);
        if (m.abstract && n.kind === "class" && !n.abstract) {
          add("minor", "CLASS-ABSTRACT-OPERATION", `class '${name(n.id)}'`, `${m.name} is abstract, but the class is not.`,
            "A class with an abstract operation can't be instantiated, so it is abstract too.", "Mark the class abstract, or give the operation a body.",
            { umlOnly: true, strictSev: "major", nodes: [n.id] });
        }
      }
    }
  }

  // ---- use-case descriptions
  for (const n of d.nodes) {
    const u = n.describe;
    if (!u) continue;
    const loc = `use case '${name(n.id)}'`;
    if (u.primary) {
      const actor = d.nodes.find((a) => a.kind === "actor" && (a.id === u.primary || (a.label ?? "").toLowerCase() === u.primary!.toLowerCase()));
      if (!actor) {
        add("minor", "UC-DESCRIBE-PRIMARY", loc, `The description's primary actor, ${u.primary}, is not an actor in this diagram.`,
          "The description and the picture should name the same people.", "Add the actor, or correct the name.", { conf: "medium", nodes: [n.id] });
      } else if (!d.edges.some((e) => (e.from === actor.id && e.to === n.id) || (e.to === actor.id && e.from === n.id))) {
        add("minor", "UC-DESCRIBE-PRIMARY", loc, `${actor.label ?? actor.id} is the primary actor in the description but isn't linked to this use case.`,
          "The primary actor is the one who starts the use case; the diagram should show that association.", "Draw the association.", { conf: "medium", nodes: [n.id, actor.id] });
      }
    }
    if (!u.main || !u.main.length) {
      add("suggestion", "UC-DESCRIBE-MAIN", loc, "The description has no main success scenario.",
        "The numbered steps are what a reader comes to a use-case description for.", "Add the steps as main lines.", { nodes: [n.id] });
    }
    if (u.trigger && u.pre?.some((p) => p.trim().toLowerCase() === u.trigger!.trim().toLowerCase())) {
      add("minor", "UC-DESCRIBE-TRIGGER", loc, "The trigger is also listed as a precondition.",
        "A trigger is the event that starts the use case; a precondition is a state that already holds.", "Keep it as the trigger only.", { nodes: [n.id] });
    }
  }
  return out;
}

/** The notation check for a document: the reviewer's rules on its contract form, plus the v2 rules. */
export function review(d: ChalkDoc): LintResult & { findings: RuleFinding[] } {
  const base = lint(toContract(d));
  const findings: RuleFinding[] = [...base.findings, ...rulesV2(d)];
  return { inferred_family: base.inferred_family, status: statusFor(findings, base.inferred_family, d.meta.type), findings };
}

/** The elements a finding is about. v2 rules say; for the reviewer's rules it is read from the location. */
export function locate(f: RuleFinding, d: ChalkDoc): { nodes: string[]; edges: string[] } {
  if (f.nodes || f.edges) return { nodes: f.nodes ?? [], edges: f.edges ?? [] };
  const loc = f.location;
  const label = (id: string): string => d.nodes.find((n) => n.id === id)?.label || id;
  const byLabel = (s: string): string[] => d.nodes.filter((n) => (n.label || n.id) === s || n.id === s).map((n) => n.id);
  const em = /^edge (e[0-9]+)$/.exec(loc);
  if (em) {
    const e = d.edges.find((x) => x.id === em[1]);
    return { nodes: [], edges: e ? [e.uid] : [] };
  }
  for (const sep of [" -> ", " - "]) {
    const i = loc.indexOf(sep);
    if (i < 0) continue;
    const a = loc.replace(/^relationship /, "").split(sep);
    if (a.length !== 2) continue;
    const hits = d.edges.filter((e: DocEdge) => (label(e.from) === a[0] && label(e.to) === a[1]) || (label(e.from) === a[1] && label(e.to) === a[0]));
    if (hits.length) return { nodes: [...new Set(hits.flatMap((e) => [e.from, e.to]))], edges: hits.map((e) => e.uid) };
  }
  const q = /'((?:[^'\\]|\\.)*)'/.exec(loc);
  if (q) {
    const ids = byLabel(q[1].replace(/\\'/g, "'").replace(/\\n/g, "\n"));
    if (ids.length) return { nodes: ids, edges: [] };
  }
  const named = d.nodes.filter((n) => n.label && n.label.length > 2 && loc.includes(n.label)).map((n) => n.id);
  return { nodes: named, edges: [] };
}

/** The line of the statement that declares a node or edge (1-based), if the text has one. */
export function lineOf(p: ParsedSource, owner: string): number | null {
  const s = p.stmts.find((x) => x.owner === owner && (x.kind === "decl" || x.kind === "edge"));
  return s ? s.line + 1 : null;
}

const fromDiag = (dg: Diagnostic): Issue => ({
  source: dg.code === "PARSE" ? "syntax" : "reference", severity: dg.severity === "info" ? "suggestion" : dg.severity, rule_id: dg.code,
  problem: dg.message, nodes: [], edges: dg.ref ? [dg.ref] : [], at: dg.at,
});

/** One list for the UI: the parser's diagnostics, the notation findings, the layout findings. */
export function allIssues(p: ParsedSource, r: (LintResult & { findings: RuleFinding[] }) | null, qa: QaReport | null): Issue[] {
  const out: Issue[] = p.diagnostics.map(fromDiag);
  const d = p.doc;
  if (d && r) {
    for (const f of r.findings) {
      const refs = locate(f, d);
      const owner = refs.edges[0] ?? d.nodes.find((n) => n.id === refs.nodes[0])?.uid;
      const line = owner ? lineOf(p, owner) : null;
      const raw = line ? p.lines[line - 1] : "";
      out.push({
        source: "notation", severity: f.severity, rule_id: f.rule_id, problem: f.problem, rationale: f.rationale, fix: f.minimal_fix,
        nodes: refs.nodes, edges: refs.edges,
        ...(line ? { at: { line, col: raw.length - raw.trimStart().length, endCol: Math.max(1, raw.trimEnd().length) } } : {}),
      });
    }
  }
  if (d && qa) {
    for (const [list, sev] of [[qa.errors, "error"], [qa.warnings, "warning"]] as const) {
      for (const s of list) {
        const [code, ...rest] = s.split(" ");
        out.push({ source: "layout", severity: sev, rule_id: code, problem: rest.join(" "), nodes: [], edges: [] });
      }
    }
  }
  return out;
}
