/**
 * The parsed diagram: diagram-semantics-reviewer contract 1.0 plus the web-only fields the reviewer
 * ignores (spec/diagram-text.md "Output shape"). parse.ts produces it, lint.ts and the layouts read it.
 */

export type DiagramType = "flowchart" | "activity" | "use-case";
export type Profile = "strict-uml" | "uml-inspired" | "general-diagram";
export type Direction = "down" | "right";

export type NodeKind =
  | "action" | "process" | "decision" | "merge" | "fork" | "join" | "initial" | "final" | "flow-final"
  | "terminator" | "io" | "actor" | "use-case" | "note" | "boundary";

export type EdgeKind = "arrow" | "association" | "include" | "extend";
export type EdgeStyle = "solid-arrow" | "dashed-arrow" | "plain-line";

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  label: string | null;
  step: number;
  /** which side an actor stands on (use-case only) */
  side?: "left" | "right";
  /** pinned center in inches */
  at?: [number, number];
  /** id of the boundary this node sits inside */
  inside?: string;
}

export interface DiagramEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  label: string | null;
  style: EdgeStyle;
  directed: boolean;
  step: number;
  /** only on `..>` edges */
  meaning?: string;
}

export interface ParseWarning {
  code: "PARSE-UNKNOWN-NODE";
  edge: string;
  end: "from" | "to";
  node: string;
}

export interface Diagram {
  contract_version: "1.0";
  diagram_id: string;
  claimed_diagram_type: DiagramType;
  notation_profile: Profile;
  narration_excerpt: string;
  legend: string | null;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  web: {
    title: string;
    desc: string;
    direction: Direction;
    warnings: ParseWarning[];
  };
}

export type Severity = "critical" | "major" | "minor" | "suggestion" | "unverified";
export type Confidence = "high" | "medium" | "low";

export interface Finding {
  severity: Severity;
  rule_id: string;
  location: string;
  problem: string;
  rationale: string;
  minimal_fix: string;
  confidence: Confidence;
}

export type LintStatus = "pass" | "pass-with-notes" | "changes-required" | "blocked" | "unverified" | "not-a-diagram";

export interface LintResult {
  inferred_family: string;
  status: LintStatus;
  findings: Finding[];
}

/** Highest step number used by any node or edge (0 when the diagram has no steps). */
export function maxStep(d: Diagram): number {
  let m = 0;
  for (const n of d.nodes) m = Math.max(m, n.step);
  for (const e of d.edges) m = Math.max(m, e.step);
  return m;
}
