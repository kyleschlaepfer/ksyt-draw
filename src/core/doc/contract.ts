/**
 * The canonical document as the reviewer's contract 1.0 (../model.ts), which is what the notation
 * check reads. For a v1 file this is exactly what reference/ksd_parse.py produces.
 */
import type { Diagram, DiagramEdge, DiagramNode, EdgeStyle, ParseWarning } from "../model";
import type { ChalkDoc, DocEdge } from "./types";

function styleOf(e: DocEdge): string {
  switch (e.kind) {
    case "arrow": return e.meaning === "proposed" ? "dashed-arrow" : "solid-arrow";
    case "association": return e.navigable ? "solid-arrow" : "plain-line";
    case "include": case "extend": case "dependency": return "dashed-arrow";
    case "generalization": return "hollow-triangle";
    case "realization": return "dashed-hollow-triangle";
    case "aggregation": return "hollow-diamond";
    case "composition": return "filled-diamond";
  }
}

export function toContract(d: ChalkDoc): Diagram {
  const ids = new Set(d.nodes.map((n) => n.id));
  const nodes: DiagramNode[] = d.nodes.map((n) => {
    // partitions are neutral containers to the reviewer, like boundaries; interfaces are classifiers
    const kind = n.kind === "partition" ? "boundary" : n.kind === "interface" ? "class" : n.kind;
    const out: DiagramNode = { id: n.id, kind: kind as DiagramNode["kind"], label: n.label, step: n.step };
    if (n.side) out.side = n.side;
    if (n.place) out.at = [n.place.x, n.place.y];
    if (n.parent) out.inside = n.parent;
    return out;
  });
  const warnings: ParseWarning[] = [];
  const edges: DiagramEdge[] = d.edges.map((e) => {
    const out = {
      id: e.id, kind: e.kind, from: e.from, to: e.to, label: e.label, style: styleOf(e) as EdgeStyle, directed: e.directed, step: e.step,
    } as DiagramEdge & { card_from?: string; card_to?: string };
    if (e.meaning !== undefined) out.meaning = e.meaning;
    if (e.ends?.from?.mult) out.card_from = e.ends.from.mult;
    if (e.ends?.to?.mult) out.card_to = e.ends.to.mult;
    return out;
  });
  for (const e of d.edges) {
    for (const end of ["from", "to"] as const) {
      if (!ids.has(e[end])) warnings.push({ code: "PARSE-UNKNOWN-NODE", edge: e.id, end, node: e[end] });
    }
  }
  return {
    contract_version: "1.0", diagram_id: d.meta.id, claimed_diagram_type: d.meta.type as Diagram["claimed_diagram_type"],
    notation_profile: d.meta.profile, narration_excerpt: d.meta.narration, legend: d.meta.legend, nodes, edges,
    web: { title: d.meta.title, desc: d.meta.desc, direction: d.meta.direction, warnings },
  };
}
