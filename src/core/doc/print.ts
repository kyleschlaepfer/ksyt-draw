/**
 * The canonical document -> .ksd text. Each statement has one printer, shared by three callers:
 * printDoc (a whole file), sync.ts (the one line a draw edit changes) and formatSource (tidy a
 * file in place, keeping its comments and order).
 */
import {
  CLASSIFIERS, DEFAULT_PROFILE, DESCRIBE_FIELDS, DESCRIBE_LIST, UNLABELED, defaultLabel, edgeOp,
  type ChalkDoc, type DocEdge, type DocMeta, type DocNode, type EdgeEnd, type Member, type UseCaseDoc,
} from "./types";
import { edgeKey } from "./parse";

export function quote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

/** Inches with up to three decimals, no trailing zeros. */
export function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

export const META_ORDER = ["diagram", "id", "title", "profile", "desc", "narration", "direction", "legend", "lanes", "look"] as const;
export type MetaKey = (typeof META_ORDER)[number];

/** One header line, or null when the value is the default and the line is left out. */
export function printMeta(m: DocMeta, key: MetaKey): string | null {
  switch (key) {
    case "diagram": return `diagram ${m.type}`;
    case "id": return m.id !== "diagram" ? `id ${m.id}` : null;
    case "title": return `title ${m.title}`;
    case "profile": return m.profile !== DEFAULT_PROFILE[m.type] ? `profile ${m.profile}` : null;
    case "desc": return m.desc ? `desc ${m.desc}` : null;
    case "narration": return m.narration ? `narration ${m.narration}` : null;
    case "direction": return m.direction !== "down" ? `direction ${m.direction}` : null;
    case "legend": return m.legend ? `legend ${m.legend}` : null;
    case "lanes": return m.lanes ? `lanes ${m.lanes}` : null;
    case "look": return m.look ? `look ${m.look}` : null;
  }
}

export function printMember(m: Member): string {
  let s = m.visibility ?? "";
  s += m.name;
  if (m.kind === "operation") s += `(${m.params ?? ""})`;
  if (m.type) s += `: ${m.type}`;
  if (m.static) s += " {static}";
  if (m.abstract) s += " {abstract}";
  return s;
}

/** Does this node's declaration open a `{ }` block? */
export function opensBlock(n: DocNode): boolean {
  if (n.kind === "boundary" || n.kind === "partition") return true;
  return CLASSIFIERS.has(n.kind) && !!n.members && n.members.length > 0;
}

/** The node's own line (without indentation). Containers and classes with members end in `{`. */
export function printDecl(n: DocNode, type: ChalkDoc["meta"]["type"]): string {
  if (n.kind === "boundary" || n.kind === "partition") return `${n.kind} ${n.id} ${quote(n.label ?? "")} {`;
  const inline = n.inline ? `${n.place ? ` at ${num(n.place.x)} ${num(n.place.y)}` : ""}${n.size ? ` size ${num(n.size.w)} ${num(n.size.h)}` : ""}` : "";
  if (CLASSIFIERS.has(n.kind)) {
    let line = `${n.abstract ? "abstract " : ""}${n.kind} ${n.id}`;
    if (n.label !== null && n.label !== n.id) line += ` ${quote(n.label)}`;
    if (n.stereotype) line += ` <<${n.stereotype}>>`;
    line += inline;
    if (opensBlock(n)) line += " {";
    return line;
  }
  let kind: string = n.kind;
  let label = n.label;
  if (type === "flowchart" && n.kind === "terminator" && (n.label === "start" || n.label === "end")) { kind = n.label; label = null; }
  else if (type === "activity" && n.kind === "initial") kind = "start";
  else if (type === "activity" && n.kind === "final") kind = "end";
  let line = `${kind} ${n.id}`;
  // a fork, a merge or a start draws no label, but one the author wrote stays in the text
  if (label !== null && label !== defaultLabel(n.kind, n.id)) line += ` ${quote(label)}`;
  if (n.side) line += ` ${n.side}`;
  return line + inline;
}

const printEnd = (e: EdgeEnd | undefined): string => (e && (e.mult || e.role) ? `${quote([e.mult, e.role].filter(Boolean).join(" "))} ` : "");

export function printEdge(e: DocEdge, type: ChalkDoc["meta"]["type"]): string {
  return `${e.from} ${printEnd(e.ends?.from)}${edgeOp(e, type)} ${printEnd(e.ends?.to)}${e.to}${e.label ? ` : ${e.label}` : ""}`;
}

/** How a layout line names an edge: `a -> b`, with `#n` for the n-th of several between the same ends. */
export function edgeRef(d: ChalkDoc, e: DocEdge): string {
  const same = d.edges.filter((x) => edgeKey(x) === edgeKey(e));
  const n = same.indexOf(e) + 1;
  return `${e.from} ${edgeOp(e, d.meta.type)} ${e.to}${n > 1 ? ` #${n}` : ""}`;
}

export type LayoutFacet = "place" | "size" | "lane" | "style" | "route" | "labelpos";

/** One line of the layout block for a node facet, or null when the node has none (or keeps it inline). */
export function printNodeLayout(n: DocNode, facet: LayoutFacet): string | null {
  if (facet === "place") return n.place && !n.inline ? `place ${n.id} ${num(n.place.x)} ${num(n.place.y)}` : null;
  if (facet === "size") return n.size && !n.inline ? `size ${n.id} ${num(n.size.w)} ${num(n.size.h)}` : null;
  if (facet === "lane") return n.kind === "partition" && n.thickness ? `lane ${n.id} ${num(n.thickness)}` : null;
  if (facet === "style") {
    const s = n.style;
    if (!s || !(s.fill || s.color || s.weight)) return null;
    return `style ${n.id}${s.fill ? ` fill ${s.fill}` : ""}${s.color ? ` color ${s.color}` : ""}${s.weight ? ` weight ${s.weight}` : ""}`;
  }
  return null;
}

export function printEdgeLayout(d: ChalkDoc, e: DocEdge, facet: LayoutFacet): string | null {
  const ref = edgeRef(d, e);
  if (facet === "route") {
    const r = e.route;
    if (!r) return null;
    const via = r.via && r.via.length ? ` via ${r.via.map(([x, y]) => `${num(x)} ${num(y)}`).join(", ")}` : "";
    return `route ${ref} ${r.kind}${r.from ? ` from ${r.from}` : ""}${r.to ? ` to ${r.to}` : ""}${via}`;
  }
  if (facet === "labelpos") return e.labelPos ? `label ${ref} ${num(e.labelPos.t)} ${num(e.labelPos.dx)} ${num(e.labelPos.dy)}` : null;
  if (facet === "style") {
    const s = e.style;
    if (!s || !(s.color || s.weight)) return null;
    return `style ${ref}${s.color ? ` color ${s.color}` : ""}${s.weight ? ` weight ${s.weight}` : ""}`;
  }
  return null;
}

export function printPool(d: ChalkDoc): string | null {
  const p = d.pool;
  if (!p || (p.x === undefined && p.length === undefined)) return null;
  return `pool${p.x !== undefined ? ` at ${num(p.x)} ${num(p.y ?? 0)}` : ""}${p.length !== undefined ? ` length ${num(p.length)}` : ""}`;
}

/** The lines inside `describe <id> { }`, one per field entry, in the standard order. */
export function printDescribe(u: UseCaseDoc): string[] {
  const out: string[] = [];
  for (const f of DESCRIBE_FIELDS) {
    const v = u[f];
    if (v === undefined) continue;
    if (DESCRIBE_LIST.has(f)) for (const item of v as string[]) out.push(`${f} ${item}`);
    else if (v) out.push(`${f} ${v as string}`);
  }
  return out;
}

export const NODE_FACETS: readonly LayoutFacet[] = ["place", "size", "lane", "style"];
export const EDGE_FACETS: readonly LayoutFacet[] = ["route", "labelpos", "style"];

/** Every layout line the document needs, in a stable order. */
export function printLayoutLines(d: ChalkDoc): string[] {
  const out: string[] = [];
  const pool = printPool(d);
  if (pool) out.push(pool);
  for (const n of d.nodes) for (const f of NODE_FACETS) { const s = printNodeLayout(n, f); if (s) out.push(s); }
  for (const e of d.edges) for (const f of EDGE_FACETS) { const s = printEdgeLayout(d, e, f); if (s) out.push(s); }
  return out;
}

export const LAYOUT_NOTE = "# layout: written by the draw view. Delete a line to hand that part back to automatic layout.";

/** A whole file in canonical form. */
export function printDoc(d: ChalkDoc): string {
  const type = d.meta.type;
  const out: string[] = [];
  for (const k of META_ORDER) { const s = printMeta(d.meta, k); if (s !== null) out.push(s); }
  out.push("");
  let step = 0;
  const stepLine = (s: number, indent: string) => { if (s !== step) { step = s; out.push(`${indent}step ${step}`); } };
  const printNode = (n: DocNode, indent: string) => {
    stepLine(n.step, indent);
    out.push(indent + printDecl(n, type));
    if (CLASSIFIERS.has(n.kind) && opensBlock(n)) {
      for (const m of n.members ?? []) out.push(`${indent}  ${printMember(m)}`);
      out.push(`${indent}}`);
    }
  };
  const hasParent = (n: DocNode) => !!n.parent && d.nodes.some((p) => p.id === n.parent && p !== n);
  for (const n of d.nodes) {
    if (hasParent(n)) continue;
    if (n.kind === "boundary" || n.kind === "partition") {
      stepLine(n.step, "");
      out.push(printDecl(n, type));
      for (const c of d.nodes) if (c.parent === n.id) printNode(c, "  ");
      out.push("}");
    } else printNode(n, "");
  }
  if (d.edges.length) out.push("");
  for (const e of d.edges) { stepLine(e.step, ""); out.push(printEdge(e, type)); }
  for (const n of d.nodes) {
    if (!n.describe) continue;
    const body = printDescribe(n.describe);
    if (!body.length) continue;
    out.push("", `describe ${n.id} {`, ...body.map((s) => "  " + s), "}");
  }
  const layout = printLayoutLines(d);
  if (layout.length) out.push("", LAYOUT_NOTE, "layout {", ...layout.map((s) => "  " + s), "}");
  return out.join("\n") + "\n";
}
