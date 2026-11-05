/**
 * Edit operations on the canonical document. Each is a plain function that changes a draft in place;
 * the session (doc/session.ts) wraps one or more of them in a transaction: clone, edit, hold the
 * picture still, write the text, record one undo step.
 *
 * Operations take uids (stable identity) and never renumber anything that already exists.
 */
import {
  CLASSIFIERS, CONTAINERS, DEFAULT_PROFILE, UNLABELED, newUid,
  type ChalkDoc, type DiagramType, type DocEdge, type DocNode, type EdgeKind, type EdgeStyle, type Member, type NodeKind,
  type NodeStyle, type Side, type UseCaseDoc,
} from "./types";
import { ID, opSpec } from "./parse";

const ID_RE = new RegExp(`^(?:${ID})$`);
export const validId = (s: string): boolean => ID_RE.test(s);

export class EditError extends Error {}

const node = (d: ChalkDoc, uid: string): DocNode => {
  const n = d.nodes.find((x) => x.uid === uid);
  if (!n) throw new EditError("that shape is gone");
  return n;
};
const edge = (d: ChalkDoc, uid: string): DocEdge => {
  const e = d.edges.find((x) => x.uid === uid);
  if (!e) throw new EditError("that line is gone");
  return e;
};

/** The first free id of the form base1, base2, ... */
export function freeId(d: ChalkDoc, base: string, taken: Set<string> = new Set()): string {
  const used = new Set([...d.nodes.map((n) => n.id), ...taken]);
  const stem = base.replace(/[^A-Za-z0-9_-]/g, "").replace(/^[^A-Za-z]+/, "") || "node";
  let n = 1;
  while (used.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

const BASE: Partial<Record<NodeKind, string>> = {
  "use-case": "usecase", "flow-final": "flowfinal", terminator: "terminator", initial: "start", final: "end",
  boundary: "system", partition: "lane", class: "Class", interface: "Interface",
};

/** The word a palette item is known by, for flowcharts' start/end pills. */
export type PaletteKind = NodeKind | "start" | "end";

export interface AddNodeInput {
  kind: PaletteKind;
  at?: { x: number; y: number };
  parent?: string;
  label?: string | null;
}

export function addNode(d: ChalkDoc, input: AddNodeInput): DocNode {
  const t = d.meta.type;
  let kind: NodeKind;
  let label: string | null | undefined = input.label;
  let base: string;
  if (input.kind === "start" || input.kind === "end") {
    kind = t === "flowchart" ? "terminator" : input.kind === "start" ? "initial" : "final";
    base = input.kind === "start" ? "start" : "end";
    if (label === undefined) label = t === "flowchart" ? input.kind : null;
  } else {
    kind = input.kind;
    base = BASE[kind] ?? kind;
  }
  const id = freeId(d, base);
  const n = id.slice(base.replace(/[^A-Za-z0-9_-]/g, "").length);
  if (label === undefined) {
    if (UNLABELED.has(kind)) label = null;
    else if (kind === "boundary") label = "System";
    else if (kind === "partition") label = `Lane ${n}`;
    else if (kind === "actor") label = `Actor ${n}`;
    else if (CLASSIFIERS.has(kind)) label = id;
    else if (kind === "use-case") label = `use case ${n}`;
    else if (kind === "io") label = `input ${n}`;
    else label = `${kind} ${n}`;
  }
  const out: DocNode = { uid: newUid(), id, kind, label, step: 0 };
  if (input.at) out.place = { x: input.at.x, y: input.at.y };
  if (input.parent && !CONTAINERS.has(kind)) out.parent = input.parent;
  if (out.parent) {
    // keep a container's children together, after its last child
    let idx = d.nodes.findIndex((m) => m.id === out.parent);
    while (idx + 1 < d.nodes.length && d.nodes[idx + 1].parent === out.parent) idx++;
    d.nodes.splice(idx + 1, 0, out);
  } else if (kind === "partition") {
    // lanes sit together, in the order they were added
    let idx = -1;
    d.nodes.forEach((m, i) => { if (m.kind === "partition" || m.parent && d.nodes.find((p) => p.id === m.parent)?.kind === "partition") idx = i; });
    d.nodes.splice(idx + 1, 0, out);
  } else d.nodes.push(out);
  return out;
}

/** Remove shapes and lines. A removed container frees its children; a removed shape takes its lines with it. */
export function removeElements(d: ChalkDoc, uids: Iterable<string>): { freed: number } {
  const gone = new Set(uids);
  const goneIds = new Set(d.nodes.filter((n) => gone.has(n.uid)).map((n) => n.id));
  let freed = 0;
  for (const n of d.nodes) {
    if (n.parent && goneIds.has(n.parent) && !gone.has(n.uid)) { delete n.parent; freed++; }
  }
  d.nodes = d.nodes.filter((n) => !gone.has(n.uid));
  d.edges = d.edges.filter((e) => !gone.has(e.uid) && !goneIds.has(e.from) && !goneIds.has(e.to));
  return { freed };
}

export function moveNode(d: ChalkDoc, uid: string, x: number, y: number): void {
  const n = node(d, uid);
  n.place = { x: round(x), y: round(y) };
}

export function resizeNode(d: ChalkDoc, uid: string, box: { x: number; y: number; w: number; h: number }): void {
  const n = node(d, uid);
  n.place = { x: round(box.x), y: round(box.y) };
  n.size = { w: round(box.w), h: round(box.h) };
}

/** Hand a shape back to the layout engine (position, size, or both). */
export function releaseNode(d: ChalkDoc, uid: string, what: "place" | "size" | "both" = "both"): void {
  const n = node(d, uid);
  if (what !== "size") delete n.place;
  if (what !== "place") delete n.size;
  if (!n.place && !n.size) delete n.inline;
}

export function setLabel(d: ChalkDoc, uid: string, label: string | null): void {
  const text = label === null ? null : label.replace(/\r/g, "");
  if (text && text.includes("—")) throw new EditError("no em dashes (house rule)");
  const n = d.nodes.find((x) => x.uid === uid);
  if (n) {
    if (UNLABELED.has(n.kind)) throw new EditError("this shape has no text");
    // Empty is meaningful in Draw: the shape exists before its content and must round-trip as "".
    n.label = text === null ? "" : text;
    return;
  }
  const e = edge(d, uid);
  e.label = text === null || text.trim() === "" ? null : text.replace(/\n/g, " ").trim();
}

/** Rename the human-facing id; every line and container that names it follows. */
export function renameId(d: ChalkDoc, uid: string, id: string): void {
  const n = node(d, uid);
  if (id === n.id) return;
  if (!validId(id)) throw new EditError("an id is a letter, then letters, digits, - or _");
  if (d.nodes.some((m) => m.id === id)) throw new EditError(`${id} is already taken`);
  const was = n.id;
  if (CLASSIFIERS.has(n.kind) && n.label === was) n.label = id;
  n.id = id;
  for (const m of d.nodes) if (m.parent === was) m.parent = id;
  for (const e of d.edges) { if (e.from === was) e.from = id; if (e.to === was) e.to = id; }
}

/** Kinds a shape may turn into without losing meaning the author gave it. */
export const KIND_GROUPS: NodeKind[][] = [
  ["action", "process", "io", "terminator", "decision"],
  ["initial", "final", "flow-final"],
  ["fork", "join"],
  ["merge", "decision"],
  ["class", "interface"],
];

export function changeKind(d: ChalkDoc, uid: string, kind: NodeKind): void {
  const n = node(d, uid);
  if (n.kind === kind) return;
  if (!KIND_GROUPS.some((g) => g.includes(n.kind) && g.includes(kind))) throw new EditError(`a ${n.kind} can't become a ${kind}`);
  if (UNLABELED.has(kind)) n.label = null;
  else if (n.label === null) n.label = n.id.replace(/[-_]+/g, " ");
  n.kind = kind;
  delete n.size;
}

export interface NodePatch {
  side?: "left" | "right";
  style?: NodeStyle | null;
  stereotype?: string | null;
  abstract?: boolean;
  members?: Member[];
  describe?: UseCaseDoc | null;
  thickness?: number | null;
}

export function patchNode(d: ChalkDoc, uid: string, p: NodePatch): void {
  const n = node(d, uid);
  if (p.side !== undefined) n.side = p.side;
  if (p.style !== undefined) {
    const s = p.style ? clean(p.style) : null;
    if (s && Object.keys(s).length) n.style = s; else delete n.style;
  }
  if (p.stereotype !== undefined) { if (p.stereotype) n.stereotype = p.stereotype; else delete n.stereotype; }
  if (p.abstract !== undefined) { if (p.abstract) n.abstract = true; else delete n.abstract; }
  if (p.members !== undefined) {
    for (const m of p.members) if (`${m.name}${m.type ?? ""}${m.params ?? ""}`.includes("—")) throw new EditError("no em dashes (house rule)");
    if (p.members.length) n.members = p.members; else delete n.members;
  }
  if (p.describe !== undefined) {
    if (JSON.stringify(p.describe ?? {}).includes("—")) throw new EditError("no em dashes (house rule)");
    const u = p.describe ? clean(p.describe) : null;
    if (u && Object.keys(u).length) n.describe = u; else delete n.describe;
  }
  if (p.thickness !== undefined) { if (p.thickness) n.thickness = round(p.thickness); else delete n.thickness; }
}

/** Move a shape into a container (or out, with undefined). */
/** The build-up step shapes and lines first appear at. 0 is there from the start. */
export function setStep(d: ChalkDoc, uids: Iterable<string>, step: number): void {
  if (!Number.isInteger(step) || step < 0 || step > 99) throw new EditError("a step is a whole number from 0 to 99");
  const ids = new Set(uids);
  for (const n of d.nodes) if (ids.has(n.uid)) n.step = step;
  for (const e of d.edges) if (ids.has(e.uid)) e.step = step;
}

export function setParent(d: ChalkDoc, uid: string, parentId: string | undefined): void {
  const n = node(d, uid);
  if (CONTAINERS.has(n.kind)) return;
  if ((n.parent ?? undefined) === parentId) return;
  d.nodes = d.nodes.filter((m) => m !== n);
  if (parentId) {
    n.parent = parentId;
    let idx = d.nodes.findIndex((m) => m.id === parentId);
    while (idx + 1 < d.nodes.length && d.nodes[idx + 1].parent === parentId) idx++;
    d.nodes.splice(idx + 1, 0, n);
  } else {
    delete n.parent;
    d.nodes.push(n);
  }
}

/** The relationships a diagram type offers, in the order the connect menu lists them. */
export interface RelationOption { op: string; word: string; help: string }
export const RELATIONS: Record<DiagramType, RelationOption[]> = {
  flowchart: [
    { op: "->", word: "then", help: "control passes along the arrow" },
    { op: "..>", word: "proposed path", help: "a path that doesn't exist yet, dashed" },
  ],
  activity: [
    { op: "->", word: "control flow", help: "control passes along the arrow" },
    { op: "..>", word: "proposed path", help: "a path that doesn't exist yet, dashed" },
  ],
  "use-case": [
    { op: "--", word: "association", help: "an actor takes part in a use case" },
    { op: "-include->", word: "include", help: "the base use case always runs the included one" },
    { op: "-extend->", word: "extend", help: "the extension sometimes adds to the base use case" },
    { op: "->", word: "arrow", help: "not use-case notation; the check will flag it" },
  ],
  class: [
    { op: "--", word: "association", help: "instances are linked" },
    { op: "-->", word: "directed association", help: "linked, and navigable toward the arrow" },
    { op: "--|>", word: "generalization", help: "is a kind of; the triangle points at the parent" },
    { op: "..|>", word: "realization", help: "implements the interface the triangle points at" },
    { op: "o--", word: "aggregation", help: "a whole and its parts; the diamond sits on the whole" },
    { op: "*--", word: "composition", help: "parts that live and die with the whole; filled diamond on the whole" },
    { op: "..>", word: "dependency", help: "uses, without holding a link" },
  ],
};

/** The relationship two shapes most likely want, by their kinds. */
export function defaultRelation(d: ChalkDoc, from: DocNode, to: DocNode): string {
  if (d.meta.type === "use-case") {
    if (from.kind === "use-case" && to.kind === "use-case") return "-include->";
    return "--";
  }
  if (d.meta.type === "class") return to.kind === "interface" && from.kind === "class" ? "..|>" : "--";
  return "->";
}

/** Can these stored shapes be endpoints? Notation mistakes are the check's job, not this command. */
export function canConnect(d: ChalkDoc, fromUid: string, toUid: string): { ok: boolean; why?: string } {
  const a = d.nodes.find((n) => n.uid === fromUid), b = d.nodes.find((n) => n.uid === toUid);
  if (!a || !b) return { ok: false, why: "pick two shapes" };
  return { ok: true };
}

export interface AddEdgeInput { from: string; to: string; op?: string; fromSide?: Side; toSide?: Side; label?: string | null }

export function addEdge(d: ChalkDoc, input: AddEdgeInput): DocEdge {
  const a = node(d, input.from), b = node(d, input.to);
  const ok = canConnect(d, a.uid, b.uid);
  if (!ok.ok) throw new EditError(ok.why ?? "can't connect those");
  const op = input.op ?? defaultRelation(d, a, b);
  const spec = opSpec(op, d.meta.type);
  if ((spec.classOnly && d.meta.type !== "class") || (spec.notClass && d.meta.type === "class")) throw new EditError(`${op} doesn't belong in this diagram type`);
  const e: DocEdge = {
    uid: newUid("e"), id: `e${d.edges.length + 1}`, kind: spec.kind, from: spec.flip ? b.id : a.id, to: spec.flip ? a.id : b.id,
    label: input.label ?? null, directed: spec.directed, step: 0,
  };
  if (spec.meaning) e.meaning = spec.meaning;
  if (spec.navigable) e.navigable = true;
  if (input.fromSide || input.toSide) {
    e.route = { kind: "elbow", ...(input.fromSide ? { from: input.fromSide } : {}), ...(input.toSide ? { to: input.toSide } : {}) };
  }
  d.edges.push(e);
  return e;
}

/** Change what a line means. Ends, label, route and style stay; nothing else is inferred from looks. */
export function setRelation(d: ChalkDoc, uid: string, op: string): void {
  const e = edge(d, uid);
  const spec = opSpec(op, d.meta.type);
  if ((spec.classOnly && d.meta.type !== "class") || (spec.notClass && d.meta.type === "class")) throw new EditError(`${op} doesn't belong in this diagram type`);
  e.kind = spec.kind;
  e.directed = spec.directed;
  if (spec.meaning) e.meaning = spec.meaning; else delete e.meaning;
  if (spec.navigable) e.navigable = true; else delete e.navigable;
  if (e.kind !== "association" && e.kind !== "aggregation" && e.kind !== "composition") delete e.ends;
}

export function reconnect(d: ChalkDoc, uid: string, end: "from" | "to", nodeUid: string, side?: Side): void {
  const e = edge(d, uid);
  const target = node(d, nodeUid);
  const other = d.nodes.find((n) => n.id === (end === "from" ? e.to : e.from));
  if (other) {
    const ok = canConnect(d, target.uid, other.uid);
    if (!ok.ok) throw new EditError(ok.why ?? "can't connect those");
  }
  e[end] = target.id;
  // the old route was drawn for the old ends
  if (e.route) {
    const r = { ...e.route };
    delete r.via;
    if (side) r[end] = side; else delete r[end];
    if (!r.from && !r.to && r.kind === "elbow") delete e.route; else e.route = r;
  } else if (side) e.route = { kind: "elbow", [end]: side };
}

export function swapEnds(d: ChalkDoc, uid: string): void {
  const e = edge(d, uid);
  [e.from, e.to] = [e.to, e.from];
  if (e.ends) e.ends = { ...(e.ends.to ? { from: e.ends.to } : {}), ...(e.ends.from ? { to: e.ends.from } : {}) };
  if (e.route) {
    const r = e.route;
    e.route = { kind: r.kind, ...(r.to ? { from: r.to } : {}), ...(r.from ? { to: r.from } : {}), ...(r.via ? { via: [...r.via].reverse() } : {}) };
  }
  if (e.labelPos) e.labelPos = { ...e.labelPos, t: 1 - e.labelPos.t };
}

export interface EdgePatch {
  route?: DocEdge["route"] | null;
  labelPos?: DocEdge["labelPos"] | null;
  style?: EdgeStyle | null;
  ends?: DocEdge["ends"] | null;
}

export function patchEdge(d: ChalkDoc, uid: string, p: EdgePatch): void {
  const e = edge(d, uid);
  if (p.route !== undefined) {
    if (p.route) {
      e.route = { ...p.route, ...(p.route.via ? { via: p.route.via.map(([x, y]) => [round(x), round(y)] as [number, number]) } : {}) };
      if (e.route.via && !e.route.via.length) delete e.route.via;
    } else delete e.route;
  }
  if (p.labelPos !== undefined) {
    if (p.labelPos) e.labelPos = { t: round(p.labelPos.t), dx: round(p.labelPos.dx), dy: round(p.labelPos.dy) }; else delete e.labelPos;
  }
  if (p.style !== undefined) {
    const s = p.style ? clean(p.style) : null;
    if (s && Object.keys(s).length) e.style = s; else delete e.style;
  }
  if (p.ends !== undefined) {
    if (JSON.stringify(p.ends ?? {}).includes("—")) throw new EditError("no em dashes (house rule)");
    const ends = p.ends ? { ...(endOk(p.ends.from) ? { from: clean(p.ends.from!) } : {}), ...(endOk(p.ends.to) ? { to: clean(p.ends.to!) } : {}) } : {};
    if (Object.keys(ends).length) e.ends = ends; else delete e.ends;
  }
}

export interface MetaPatch {
  type?: DiagramType; title?: string; id?: string; direction?: "down" | "right"; desc?: string; narration?: string;
  profile?: ChalkDoc["meta"]["profile"]; lanes?: "vertical" | "horizontal" | null; look?: "sketch" | "precision" | null; legend?: string | null;
}

export function patchMeta(d: ChalkDoc, p: MetaPatch): void {
  const m = d.meta;
  for (const v of [p.title, p.desc, p.narration, p.legend]) if (v && v.includes("—")) throw new EditError("no em dashes (house rule)");
  if (p.title !== undefined) {
    if (!p.title.trim()) throw new EditError("a diagram needs a title");
    m.title = p.title.replace(/\s+/g, " ").trim();
  }
  if (p.id !== undefined) {
    if (!validId(p.id)) throw new EditError("an id is a letter, then letters, digits, - or _");
    m.id = p.id;
  }
  if (p.type !== undefined && p.type !== m.type) {
    const wasDefault = m.profile === DEFAULT_PROFILE[m.type];
    m.type = p.type;
    if (wasDefault) m.profile = DEFAULT_PROFILE[p.type];
  }
  if (p.profile !== undefined) m.profile = p.profile;
  if (p.direction !== undefined) m.direction = p.direction;
  if (p.desc !== undefined) m.desc = p.desc.replace(/\s+/g, " ").trim();
  if (p.narration !== undefined) m.narration = p.narration.replace(/\s+/g, " ").trim();
  if (p.legend !== undefined) m.legend = p.legend ? p.legend.replace(/\s+/g, " ").trim() : null;
  if (p.lanes !== undefined) { if (p.lanes) m.lanes = p.lanes; else delete m.lanes; }
  if (p.look !== undefined) { if (p.look) m.look = p.look; else delete m.look; }
}

/** Reorder a partition among the partitions (its children travel with it in the node list). */
export function movePartition(d: ChalkDoc, uid: string, delta: -1 | 1): boolean {
  const lanes = d.nodes.filter((n) => n.kind === "partition");
  const i = lanes.findIndex((n) => n.uid === uid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lanes.length) return false;
  [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  const rest = d.nodes.filter((n) => n.kind !== "partition" && !lanes.some((l) => l.id === n.parent));
  const firstLane = d.nodes.findIndex((n) => n.kind === "partition");
  const before = d.nodes.slice(0, firstLane).filter((n) => rest.includes(n));
  const after = rest.filter((n) => !before.includes(n));
  d.nodes = [...before, ...lanes.flatMap((l) => [l, ...d.nodes.filter((n) => n.parent === l.id)]), ...after];
  return true;
}

/** A copy of some shapes and the lines among them, ready to paste. */
export interface Fragment { nodes: DocNode[]; edges: DocEdge[] }

export function copyFragment(d: ChalkDoc, uids: Iterable<string>): Fragment {
  const want = new Set(uids);
  // a copied container brings its children
  for (const n of d.nodes) if (want.has(n.uid) && CONTAINERS.has(n.kind)) for (const c of d.nodes) if (c.parent === n.id) want.add(c.uid);
  const nodes = d.nodes.filter((n) => want.has(n.uid));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => want.has(e.uid) || (ids.has(e.from) && ids.has(e.to))).filter((e) => ids.has(e.from) && ids.has(e.to));
  return JSON.parse(JSON.stringify({ nodes, edges })) as Fragment;
}

/**
 * Paste a fragment: every shape gets a fresh id and identity, lines are rewired to the copies, and
 * `positions` (current centers, by old uid) plus the offset say where the copies land.
 */
export function pasteFragment(d: ChalkDoc, f: Fragment, positions: Map<string, { x: number; y: number }>, dx: number, dy: number): { nodes: string[]; edges: string[] } {
  const idMap = new Map<string, string>();
  const taken = new Set<string>();
  const made: string[] = [], madeEdges: string[] = [];
  for (const src of f.nodes) {
    const stem = src.id.replace(/[0-9]+$/, "") || src.id;
    const id = freeId(d, stem, taken);
    taken.add(id);
    idMap.set(src.id, id);
  }
  for (const src of f.nodes) {
    const n: DocNode = { ...(JSON.parse(JSON.stringify(src)) as DocNode), uid: newUid(), id: idMap.get(src.id)!, step: 0 };
    delete n.inline;
    if (CLASSIFIERS.has(n.kind) && src.label === src.id) n.label = n.id;
    const p = positions.get(src.uid) ?? src.place;
    if (p && !CONTAINERS.has(n.kind)) n.place = { x: round(p.x + dx), y: round(p.y + dy) };
    if (n.parent) {
      if (idMap.has(n.parent)) n.parent = idMap.get(n.parent)!;
      else if (!d.nodes.some((m) => m.id === n.parent)) delete n.parent;
    }
    if (n.parent && d.nodes.some((m) => m.id === n.parent)) {
      let idx = d.nodes.findIndex((m) => m.id === n.parent);
      while (idx + 1 < d.nodes.length && d.nodes[idx + 1].parent === n.parent) idx++;
      d.nodes.splice(idx + 1, 0, n);
    } else d.nodes.push(n);
    made.push(n.uid);
  }
  for (const src of f.edges) {
    const e: DocEdge = { ...(JSON.parse(JSON.stringify(src)) as DocEdge), uid: newUid("e"), id: `e${d.edges.length + 1}`, from: idMap.get(src.from)!, to: idMap.get(src.to)!, step: 0 };
    if (e.route?.via) e.route.via = e.route.via.map(([x, y]) => [round(x + dx), round(y + dy)] as [number, number]);
    d.edges.push(e);
    madeEdges.push(e.uid);
  }
  return { nodes: made, edges: madeEdges };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
function clean<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { const a = v.map((s) => String(s).trim()).filter(Boolean); if (a.length) out[k] = a; }
    else out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out as T;
}
const endOk = (e: { mult?: string; role?: string } | undefined): boolean => !!e && !!(e.mult?.trim() || e.role?.trim());

export type { EdgeKind };
