/**
 * The canonical document model (schema version 2). Write and Draw both edit this; the .ksd text is a
 * lossless projection of it (doc/parse.ts reads, doc/print.ts and doc/sync.ts write), and the reviewer's
 * contract 1.0 is another projection (doc/contract.ts) that the notation check reads.
 *
 * Layers, kept apart on purpose:
 *   semantics      kind, label, from/to, members, containment, guards, multiplicities
 *   geometry       place, size, route, labelPos, pool: only what the author fixed by hand; the rest is automatic
 *   presentation   style (theme roles, never hex), look
 *   authoring      uid (stable identity), id (the name people type), step, describe, inline flags
 *   persistence    format, version, docId, ext
 */

export const DOC_FORMAT = "chalk-doc";
export const DOC_VERSION = 2;

export type DiagramType = "flowchart" | "activity" | "use-case" | "class";
export type Profile = "strict-uml" | "uml-inspired" | "general-diagram";
export type Direction = "down" | "right";
export type Look = "sketch" | "precision";
export type Side = "top" | "right" | "bottom" | "left";

export type NodeKind =
  | "action" | "process" | "decision" | "merge" | "fork" | "join" | "initial" | "final" | "flow-final"
  | "terminator" | "io" | "actor" | "use-case" | "note" | "boundary" | "partition" | "class" | "interface";

export type EdgeKind =
  | "arrow" | "association" | "include" | "extend"
  | "generalization" | "realization" | "dependency" | "aggregation" | "composition";

/** Theme roles a shape or line may be colored with. Never hex: the page maps roles to the theme. */
export type ColorRole = "ink" | "ink-2" | "accent" | "accent-strong" | "terra";
export type FillRole = "none" | "page" | "wash";
export type Weight = "thin" | "normal" | "bold";

export interface NodeStyle { fill?: FillRole; color?: ColorRole; weight?: Weight }
export interface EdgeStyle { color?: ColorRole; weight?: Weight }

export type Visibility = "+" | "-" | "#" | "~";
export interface Member {
  /** attribute or operation (an operation has a parameter list) */
  kind: "attribute" | "operation";
  visibility?: Visibility;
  name: string;
  /** operations: the text between the parentheses, as written */
  params?: string;
  /** attribute type or operation return type */
  type?: string;
  static?: boolean;
  abstract?: boolean;
}

/** A structured use-case description (all optional, nothing invented). */
export interface UseCaseDoc {
  goal?: string;
  primary?: string;
  supporting?: string[];
  trigger?: string;
  pre?: string[];
  main?: string[];
  alt?: string[];
  post?: string[];
  related?: string[];
}
export const DESCRIBE_FIELDS = ["goal", "primary", "supporting", "trigger", "pre", "main", "alt", "post", "related"] as const;
export type DescribeField = (typeof DESCRIBE_FIELDS)[number];
export const DESCRIBE_LIST: ReadonlySet<string> = new Set(["supporting", "pre", "main", "alt", "post", "related"]);

export interface DocNode {
  /** stable internal identity: survives renames and re-parses; never shown, never typed */
  uid: string;
  /** the name people type in .ksd and see in findings */
  id: string;
  kind: NodeKind;
  label: string | null;
  step: number;
  /** id of the boundary or partition this node sits inside */
  parent?: string;
  /** which side an actor stands on (use-case) */
  side?: "left" | "right";
  /** explicit center, inches. Absent: the layout engine owns the position. */
  place?: { x: number; y: number };
  /** explicit size, inches. Absent: sized to the text. */
  size?: { w: number; h: number };
  /** partition only: explicit thickness across the flow, inches */
  thickness?: number;
  style?: NodeStyle;
  /** class, interface */
  stereotype?: string;
  abstract?: boolean;
  members?: Member[];
  /** use-case */
  describe?: UseCaseDoc;
  /** the place (and size) are written on the node's own line (`at X Y`), as v1 files do */
  inline?: boolean;
}

export interface EdgeEnd { mult?: string; role?: string }

export interface DocEdge {
  uid: string;
  /** contract id: e1, e2, ... in file order (derived; the reviewer's findings use it) */
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  label: string | null;
  directed: boolean;
  step: number;
  /** `..>` in a flow or use-case diagram: a proposed path */
  meaning?: string;
  /** class associations: navigable toward `to` */
  navigable?: boolean;
  ends?: { from?: EdgeEnd; to?: EdgeEnd };
  /** manual routing. Absent: the router owns the path. */
  route?: { kind: "straight" | "elbow"; via?: Array<[number, number]>; from?: Side; to?: Side };
  /** manual label position: t along the path (0..1), then an offset in inches */
  labelPos?: { t: number; dx: number; dy: number };
  style?: EdgeStyle;
}

export interface DocMeta {
  id: string;
  type: DiagramType;
  profile: Profile;
  title: string;
  desc: string;
  narration: string;
  legend: string | null;
  direction: Direction;
  /** activity partitions: columns (vertical) or rows (horizontal). Default follows the direction. */
  lanes?: "vertical" | "horizontal";
  look?: Look;
}

export interface ChalkDoc {
  format: typeof DOC_FORMAT;
  version: typeof DOC_VERSION;
  meta: DocMeta;
  nodes: DocNode[];
  edges: DocEdge[];
  /** the partition pool's fixed origin and length along the flow (each optional) */
  pool?: { x?: number; y?: number; length?: number };
  /** safe extension point: unknown keys survive a save and reload untouched */
  ext?: Record<string, unknown>;
}

export const DEFAULT_PROFILE: Record<DiagramType, Profile> = {
  flowchart: "general-diagram", activity: "uml-inspired", "use-case": "uml-inspired", class: "uml-inspired",
};
export const TYPES: readonly DiagramType[] = ["flowchart", "activity", "use-case", "class"];
export const PROFILES: readonly Profile[] = ["strict-uml", "uml-inspired", "general-diagram"];
export const UNLABELED: ReadonlySet<string> = new Set(["initial", "final", "flow-final", "fork", "join", "merge"]);
export const CONTAINERS: ReadonlySet<string> = new Set(["boundary", "partition"]);
export const CLASSIFIERS: ReadonlySet<string> = new Set(["class", "interface"]);

/** Node kinds each diagram type offers (the palette and autocomplete read this). */
export const KINDS_FOR: Record<DiagramType, readonly NodeKind[]> = {
  flowchart: ["terminator", "process", "decision", "io", "merge", "note"],
  activity: ["initial", "action", "decision", "merge", "fork", "join", "flow-final", "final", "partition", "note"],
  "use-case": ["actor", "use-case", "boundary", "note"],
  class: ["class", "interface", "note"],
};

let counter = 0;
/** A fresh internal identity. Unique within the session and unlikely to collide across sessions. */
export function newUid(prefix: "n" | "e" = "n"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0")}`;
}

export const isContainer = (n: DocNode): boolean => CONTAINERS.has(n.kind);
export const nodeById = (d: ChalkDoc, id: string): DocNode | undefined => d.nodes.find((n) => n.id === id);
export const nodeByUid = (d: ChalkDoc, uid: string): DocNode | undefined => d.nodes.find((n) => n.uid === uid);
export const edgeByUid = (d: ChalkDoc, uid: string): DocEdge | undefined => d.edges.find((e) => e.uid === uid);

/** Highest build-up step used by any node or edge. */
export function maxStep(d: ChalkDoc): number {
  let m = 0;
  for (const n of d.nodes) m = Math.max(m, n.step);
  for (const e of d.edges) m = Math.max(m, e.step);
  return m;
}

/** The default label a node gets when none is written: its id as words. */
export function defaultLabel(kind: NodeKind, id: string): string | null {
  if (UNLABELED.has(kind)) return null;
  if (CLASSIFIERS.has(kind)) return id;
  return id.replace(/[-_]+/g, " ");
}

/** The word that names an edge's two ends in text and in layout lines: `a -> b`. */
export function edgeOp(e: Pick<DocEdge, "kind" | "meaning" | "navigable">, type: DiagramType): string {
  switch (e.kind) {
    case "include": return "-include->";
    case "extend": return "-extend->";
    case "association": return e.navigable ? "-->" : "--";
    case "generalization": return "--|>";
    case "realization": return "..|>";
    case "dependency": return "..>";
    case "aggregation": return "o--";
    case "composition": return "*--";
    case "arrow": return e.meaning === "proposed" ? "..>" : "->";
  }
  return type === "class" ? "--" : "->";
}

export function cloneDoc(d: ChalkDoc): ChalkDoc {
  return JSON.parse(JSON.stringify(d)) as ChalkDoc;
}
