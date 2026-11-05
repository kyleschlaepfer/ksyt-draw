/**
 * Diagram model -> .ksd text, the inverse of parse.ts. The editor edits the model and writes the text
 * back, so the text stays the source of truth. parse(serialize(parse(x))) equals parse(x) for every fixture.
 */
import type { Diagram, DiagramEdge, DiagramNode } from "./model";

const DEFAULT_PROFILE: Record<string, string> = { flowchart: "general-diagram", activity: "uml-inspired", "use-case": "uml-inspired" };
const UNLABELED = new Set(["initial", "final", "flow-final", "fork", "join", "merge"]);

export function quote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

/** Inches with up to three decimals, no trailing zeros. */
export function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

function operator(e: DiagramEdge): string {
  if (e.kind === "include") return "-include->";
  if (e.kind === "extend") return "-extend->";
  if (e.kind === "association") return "--";
  if (e.style === "dashed-arrow") return "..>";
  return "->";
}

function nodeLine(n: DiagramNode, type: string): string {
  let kind: string = n.kind;
  let label = n.label;
  if (type === "flowchart" && n.kind === "terminator" && (n.label === "start" || n.label === "end")) { kind = n.label; label = null; }
  else if (type === "activity" && n.kind === "initial") kind = "start";
  else if (type === "activity" && n.kind === "final") kind = "end";
  let line = `${kind} ${n.id}`;
  if (label !== null && !UNLABELED.has(n.kind)) line += ` ${quote(label)}`;
  if (n.side) line += ` ${n.side}`;
  if (n.at) line += ` at ${num(n.at[0])} ${num(n.at[1])}`;
  return line;
}

export function serialize(d: Diagram): string {
  const out: string[] = [`diagram ${d.claimed_diagram_type}`];
  if (d.diagram_id !== "diagram") out.push(`id ${d.diagram_id}`);
  out.push(`title ${d.web.title}`);
  if (d.notation_profile !== DEFAULT_PROFILE[d.claimed_diagram_type]) out.push(`profile ${d.notation_profile}`);
  if (d.web.desc) out.push(`desc ${d.web.desc}`);
  if (d.narration_excerpt) out.push(`narration ${d.narration_excerpt}`);
  if (d.web.direction !== "down") out.push(`direction ${d.web.direction}`);
  if (d.legend) out.push(`legend ${d.legend}`);
  out.push("");
  let step = 0;
  let open: string | null = null;
  const indent = () => (open ? "  " : "");
  for (const n of d.nodes) {
    if (open && n.inside !== open) { out.push("}"); open = null; }
    if (n.step !== step) { step = n.step; out.push(`${indent()}step ${step}`); }
    if (n.kind === "boundary") {
      out.push(`boundary ${n.id} ${quote(n.label ?? "")} {`);
      open = n.id;
      continue;
    }
    out.push(indent() + nodeLine(n, d.claimed_diagram_type));
  }
  if (open) out.push("}");
  if (d.edges.length) out.push("");
  for (const e of d.edges) {
    if (e.step !== step) { step = e.step; out.push(`step ${step}`); }
    out.push(`${e.from} ${operator(e)} ${e.to}${e.label ? ` : ${e.label}` : ""}`);
  }
  return out.join("\n") + "\n";
}
