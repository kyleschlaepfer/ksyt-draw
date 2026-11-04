/**
 * The text alternative (spec/rendering.md §10): the structure in words, in reading order.
 * `describeItems` gives the list for the "describe this figure" details; `describeText` joins it
 * into sentences for the SVG <desc> when the author gave no `desc` line.
 */
import type { Diagram, DiagramEdge, DiagramNode } from "./model";

export interface Described {
  /** "Flowchart." / "Use-case diagram for Permit portal." */
  intro: string;
  items: string[];
  ordered: boolean;
}

const TYPE_NAME: Record<string, string> = { flowchart: "Flowchart", activity: "Activity diagram", "use-case": "Use-case diagram" };

function lab(n: DiagramNode | undefined, id: string): string {
  if (!n) return id;
  if (n.label) return n.label.replace(/\n/g, " ");
  switch (n.kind) {
    case "initial": return "start";
    case "final": return "end";
    case "flow-final": return "end of this path";
    case "merge": return "the paths merge";
    case "fork": return "a fork";
    case "join": return "a join";
    default: return id;
  }
}

export function describeItems(d: Diagram): Described {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const name = (id: string) => lab(byId.get(id), id);
  if (d.claimed_diagram_type === "use-case") return describeUseCase(d, byId, name);

  const outs = new Map<string, DiagramEdge[]>();
  for (const e of d.edges) {
    if (!byId.has(e.to)) continue;
    const a = outs.get(e.from) ?? [];
    a.push(e);
    outs.set(e.from, a);
  }
  const hasIn = new Set(d.edges.map((e) => e.to));
  const start = d.nodes.find((n) => n.kind === "initial" || (n.kind === "terminator" && !hasIn.has(n.id)))
    ?? d.nodes.find((n) => n.kind !== "boundary" && n.kind !== "note" && !hasIn.has(n.id)) ?? d.nodes[0];
  // pass 1: the reading order, walking the edges in file order from the start
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of outs.get(id) ?? []) if (!seen.has(e.to)) queue.push(e.to);
  }
  for (const n of d.nodes) if (!seen.has(n.id) && n.kind !== "boundary") { seen.add(n.id); order.push(n.id); }
  // pass 2: one item per node that is a step; targets of a fork or join are folded into its item
  const folded = new Set<string>();
  for (const id of order) {
    const n = byId.get(id)!;
    if (n.kind === "fork" || n.kind === "join") for (const e of outs.get(id) ?? []) folded.add(e.to);
  }
  const listed = order.filter((id) => {
    const k = byId.get(id)!.kind;
    return k !== "merge" && k !== "note" && !folded.has(id);
  });
  const index = new Map(listed.map((id, i) => [id, i + 1]));
  const ref = (id: string) => (index.has(id) ? `${name(id)} (step ${index.get(id)})` : name(id));
  const items: string[] = [];
  for (const id of listed) {
    const n = byId.get(id)!;
    const es = outs.get(id) ?? [];
    const targets = es.map((e) => e.to);
    const connected = es.length > 0 || hasIn.has(id);
    if (n.kind === "decision") {
      items.push(`${name(id)} ${es.map((e) => `${e.label ?? "unlabeled"}: ${ref(e.to)}`).join(". ")}`.trim());
    } else if (n.kind === "fork") {
      items.push(`at the same time: ${targets.map((t) => name(t)).join("; ")}`);
    } else if (n.kind === "join") {
      items.push(`when both are done: ${targets.map((t) => name(t)).join("; ")}`);
    } else {
      items.push(connected ? name(id) : `${name(id)} (not connected)`);
    }
  }
  for (const n of d.nodes) if (n.kind === "note") items.push(`note: ${name(n.id)}`);
  return { intro: `${TYPE_NAME[d.claimed_diagram_type] ?? "Diagram"}.`, items, ordered: true };
}

function describeUseCase(d: Diagram, byId: Map<string, DiagramNode>, name: (id: string) => string): Described {
  const boundary = d.nodes.find((n) => n.kind === "boundary");
  const intro = boundary ? `Use-case diagram for ${name(boundary.id)}.` : "Use-case diagram.";
  const items: string[] = [];
  for (const a of d.nodes.filter((n) => n.kind === "actor")) {
    const ucs: string[] = [];
    for (const e of d.edges) {
      const other = e.from === a.id ? e.to : e.to === a.id ? e.from : null;
      if (other && byId.get(other)?.kind === "use-case" && !ucs.includes(name(other))) ucs.push(name(other));
    }
    items.push(ucs.length ? `${name(a.id)}: ${ucs.join(", ")}` : `${name(a.id)}: no use cases`);
  }
  for (const e of d.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.kind === "include") items.push(`${name(e.from)} always includes ${name(e.to)}`);
    else if (e.kind === "extend") items.push(`${name(e.from)} sometimes extends ${name(e.to)}`);
    else if (byId.get(e.from)?.kind === "use-case" && byId.get(e.to)?.kind === "use-case") {
      items.push(`${name(e.from)} ${e.directed ? "leads to" : "is linked to"} ${name(e.to)}${e.label ? ` (${e.label})` : ""}`);
    }
  }
  for (const n of d.nodes) if (n.kind === "note") items.push(`note: ${name(n.id)}`);
  return { intro, items, ordered: false };
}

/** The desc line when given, else the structure as sentences. */
export function describeText(d: Diagram): string {
  if (d.web.desc) return d.web.desc;
  const { intro, items } = describeItems(d);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [intro, ...items.map((s) => cap(s) + ".")].join(" ");
}
