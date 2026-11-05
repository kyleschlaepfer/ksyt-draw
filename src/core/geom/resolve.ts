/**
 * Document -> resolved geometry: every shape's box, every line's path, every label's place, in inches
 * in the document's own coordinates (nothing is re-centered, so the draw view's canvas is stable).
 *
 * This is the one answer to "where is everything" that the embed, the write preview, the draw canvas
 * and every export share. It knows nothing about pens, fonts beyond their metrics, or the DOM.
 */
import type { ChalkDoc, DocEdge, EdgeKind, EdgeStyle, Side } from "../doc/types";
import { CONTAINERS } from "../doc/types";
import { LINE, NODE_PX, PX, SMALL_PX, type Measurer } from "../measure";
import { catmull } from "../pen";
import { layoutNodes } from "./layout";
import { pathLength, pointAt, routeEdge, type RouteInput, type TakenRoute } from "./route";
import { ACTOR_H, CLASS_PAD_X, boxOf, contains, type NodeGeom, type Pt } from "./shape";

export type TextRole = "ink" | "ink-2" | "accent" | "accent-strong" | "terra";

/** A piece of text, by the center of its box. The looks turn it into a baseline in their own font. */
export interface TextSpec {
  name: string;
  s: string;
  /** the anchor's x: the middle of the text, or its left edge when anchor is "start" */
  x: number;
  cy: number;
  /** ink box in the handwriting font, inches (the looks re-measure for their own font) */
  w: number;
  h: number;
  size: "node" | "small";
  weight: 300 | 400;
  role: TextRole;
  anchor: "middle" | "start";
  step: number;
  /** the element this text belongs to (its outline may touch it) */
  owner: string;
  /** centered on its own ink rather than on the line box (labels that stand alone beside a line) */
  tight?: boolean;
  underline?: boolean;
}

export interface EdgeGeom {
  uid: string;
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  points: Pt[];
  /** drawn as one curve through the points (a use-case line swinging around a shape) */
  smooth: boolean;
  routeKind: "straight" | "elbow";
  /** the author bent or pinned this route */
  manual: boolean;
  fromSide: Side;
  toSide: Side;
  /** the router found no clear path */
  blocked: boolean;
  step: number;
  directed: boolean;
  dashed: boolean;
  style?: EdgeStyle;
}

export interface Geometry {
  type: ChalkDoc["meta"]["type"];
  id: string;
  direction: "down" | "right";
  /** by node id */
  nodes: Map<string, NodeGeom>;
  /** drawing order: containers, then the rest, as declared */
  order: string[];
  edges: EdgeGeom[];
  texts: TextSpec[];
  /** everything's box: [x0, y0, x1, y1], inches (strokes may reach a hair outside) */
  bounds: [number, number, number, number];
}

export interface ResolveOptions {
  /** force the flow direction (phone layouts use "down") */
  direction?: "down" | "right";
  /**
   * A drag in progress: route only the lines that touch these node ids again and keep the others as
   * they were in `from`. The result is what a full pass gives except for lines that would now detour
   * around a moved shape; those catch up when the drag ends.
   */
  partial?: { from: Geometry; moved: Set<string> };
}

export const DASHED: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["include", "extend", "dependency", "realization"]);
export const isDashed = (e: Pick<DocEdge, "kind" | "meaning">): boolean => DASHED.has(e.kind) || e.meaning === "proposed";

/** How far a line's ends stop short of the outlines, by what is drawn there. */
export function gaps(kind: EdgeKind): [number, number] {
  switch (kind) {
    case "arrow": return [0.06, 0.06];
    case "association": return [0, 0.02];
    case "include": case "extend": case "dependency": return [0.02, 0.05];
    case "generalization": case "realization": return [0, 0.03];
    case "aggregation": case "composition": return [0.03, 0];
  }
}

const LH = (px: number): number => (px * LINE) / PX;

/** The text a node carries, placed. */
export function nodeTexts(m: Measurer, g: NodeGeom): TextSpec[] {
  const out: TextSpec[] = [];
  const hxg = (px: number, wt: number): number => { const t = m.measure("Hxg", px, wt); return (t.bot - t.top) / PX; };
  const centered = (lines: string[], px: number, weight: 300 | 400, role: TextRole, cx: number, cy: number, suffix: string, size: "node" | "small"): void => {
    lines.forEach((s, i) => {
      if (!s) return;
      out.push({
        name: `${g.id}:${suffix}${i === 0 ? "" : String(i + 1)}`, s, x: cx, cy: cy + (i - (lines.length - 1) / 2) * LH(px),
        w: m.measure(s, px, weight).adv / PX, h: hxg(px, weight), size, weight, role, anchor: "middle", step: g.step, owner: g.id,
      });
    });
  };
  const x0 = g.cx - g.w / 2, y0 = g.cy - g.h / 2;
  const ink: TextRole = g.style?.color ?? "ink";
  switch (g.shape) {
    case "box": case "pill": case "io": case "ellipse":
      centered(g.lines, NODE_PX, 400, ink, g.cx, g.cy, "label", "node");
      break;
    case "diamond":
      if (g.kind === "decision") centered(g.lines, NODE_PX, 400, ink, g.cx, g.cy, "label", "node");
      break;
    case "text":
      centered(g.lines, SMALL_PX, 300, g.style?.color ?? "ink-2", g.cx, g.cy, "label", "small");
      break;
    case "actor": {
      const sl = SMALL_PX / PX;
      const top = y0 + (g.figH ?? ACTOR_H) + 0.3 * sl;
      centered(g.lines, SMALL_PX, 400, ink, g.cx, top + (g.lines.length * LH(SMALL_PX)) / 2, "role", "small");
      break;
    }
    case "container":
      if (g.label) {
        out.push({
          name: `${g.id}:title`, s: g.label, x: x0 + 0.2, cy: y0 + 0.95 * (SMALL_PX / PX), w: m.measure(g.label, SMALL_PX, 300).adv / PX, h: hxg(SMALL_PX, 300),
          size: "small", weight: 300, role: "ink-2", anchor: "start", step: g.step, owner: g.id,
        });
      }
      break;
    case "lane":
      if (g.label) {
        const hd = g.header ?? 0;
        centered([g.label], SMALL_PX, 400, "ink", g.horizontal ? x0 + hd / 2 : g.cx, g.horizontal ? g.cy : y0 + hd / 2, "title", "small");
      }
      break;
    case "class":
      for (const r of g.cls?.rows ?? []) {
        const px = r.role === "name" ? NODE_PX : SMALL_PX;
        const weight: 300 | 400 = r.role === "stereotype" || r.role === "note" ? 300 : 400;
        const member = r.role === "member";
        out.push({
          name: member ? `${g.id}:m${r.index}` : `${g.id}:${r.role}${r.role === "name" && out.some((t) => t.name === `${g.id}:name`) ? out.length : ""}`,
          s: r.text, x: member ? x0 + CLASS_PAD_X : g.cx, cy: y0 + r.cy, w: m.measure(r.text, px, weight).adv / PX, h: hxg(px, weight),
          size: r.role === "name" ? "node" : "small", weight, role: r.role === "stereotype" || r.role === "note" ? "ink-2" : ink,
          anchor: member ? "start" : "middle", step: g.step, owner: g.id, ...(r.static ? { underline: true } : {}),
        });
      }
      break;
    default:
      break;
  }
  return out;
}

type Rect = [number, number, number, number];
export const textRect = (t: TextSpec, pad = 0): Rect => {
  const x0 = t.anchor === "middle" ? t.x - t.w / 2 : t.x;
  return [x0 - pad, t.cy - t.h / 2 - pad, x0 + t.w + pad, t.cy + t.h / 2 + pad];
};
const rectsOverlap = (a: Rect, b: Rect): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dy, a[1] - r[1]], [dy, r[3] - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const k = q / p;
    if (p < 0) { if (k > t1) return false; if (k > t0) t0 = k; }
    else { if (k < t0) return false; if (k < t1) t1 = k; }
  }
  return t0 <= t1;
}

/** The line as it is drawn: a smooth route sampled along its curve. */
export function drawnPath(e: Pick<EdgeGeom, "points" | "smooth">): Pt[] {
  return e.smooth && e.points.length > 2 ? catmull(e.points, 0.04) : e.points;
}

/** What a label might land on. Shapes, lines and other text are hard obstacles; a container outline is a soft one. */
class Obstacles {
  rects: Rect[] = [];
  paths: Pt[][] = [];
  soft: Pt[][] = [];
  constructor(private nodes: NodeGeom[]) {}
  /** 0 when the rectangle is clear; otherwise 10 per hard obstacle and 1 per soft one */
  cost(r: Rect): number {
    let c = 0;
    for (const o of this.rects) if (rectsOverlap(r, o)) c += 10;
    for (const p of this.paths) {
      for (let i = 1; i < p.length; i++) if (segHitsRect(p[i - 1], p[i], r)) { c += 10; break; }
    }
    for (const p of this.soft) {
      for (let i = 1; i < p.length; i++) if (segHitsRect(p[i - 1], p[i], r)) { c += 1; break; }
    }
    for (const g of this.nodes) {
      const b = boxOf(g);
      if (!rectsOverlap(r, [b[0] - 0.07, b[1] - 0.07, b[2] + 0.07, b[3] + 0.07])) continue;
      // sample the label's outline against the real shape (a diamond's corners are empty)
      const nx = Math.max(2, Math.ceil((r[2] - r[0]) / 0.05)), ny = Math.max(2, Math.ceil((r[3] - r[1]) / 0.05));
      let hit = g.cx > r[0] && g.cx < r[2] && g.cy > r[1] && g.cy < r[3];
      for (let i = 0; i <= nx && !hit; i++) for (let j = 0; j <= ny && !hit; j++) {
        if (i > 0 && i < nx && j > 0 && j < ny) continue;
        // a little clear of the outline: a pen-drawn box overshoots its corners
        if (contains(g, r[0] + ((r[2] - r[0]) * i) / nx, r[1] + ((r[3] - r[1]) * j) / ny, 0.07)) hit = true;
      }
      if (hit) c += 10;
    }
    return c;
  }
}

/** The label center beside a point on a line, on one side of the direction of travel (diagrams.flow's offset formula). */
function besideAt(p: Pt, dir: Pt, w: number, h: number, side: 1 | -1, clear = 0.12): Pt {
  const nx = -dir[1] * side, ny = dir[0] * side;
  const off = (w / 2) * Math.abs(nx) + (h / 2) * Math.abs(ny) + clear;
  return [p[0] + nx * off, p[1] + ny * off];
}

/** The side of a line a label prefers when nothing else decides: above a level line, right of an upright one. */
function upperSide(dir: Pt): 1 | -1 {
  const ny = dir[0], nx = -dir[1];
  if (Math.abs(ny) > 1e-6) return ny < 0 ? 1 : -1;
  return nx > 0 ? 1 : -1;
}

function placeEdgeTexts(m: Measurer, e: DocEdge, g: EdgeGeom, from: NodeGeom, obs: Obstacles, texts: TextSpec[]): void {
  const path = drawnPath(g);
  const total = pathLength(path) || 1;
  // the layout check wants 0.03 in plus 6% of the text size clear of any ink; a little more covers the line's own width
  const pad = 0.03 + (0.06 * SMALL_PX) / PX + 0.03;
  const spec = (name: string, s: string, c: Pt, weight: 300 | 400): TextSpec => {
    const t = m.measure(s, SMALL_PX, weight);
    return {
      name, s, x: c[0], cy: c[1], w: t.adv / PX, h: (t.bot - t.top) / PX, size: "small", weight, role: g.style?.color ?? "ink-2", anchor: "middle",
      step: g.step, owner: g.id, tight: true,
    };
  };
  const size = (s: string, weight: number): [number, number] => { const t = m.measure(s, SMALL_PX, weight); return [t.adv / PX, (t.bot - t.top) / PX]; };
  const rectAt = (c: Pt, w: number, h: number): Rect => [c[0] - w / 2 - pad, c[1] - h / 2 - pad, c[0] + w / 2 + pad, c[1] + h / 2 + pad];
  const commit = (t: TextSpec): void => { texts.push(t); obs.rects.push(textRect(t, 0.02)); };
  /** Try spots along the line (as distances from its start), both sides, and take the clearest; earlier spots win ties. */
  const best = (w: number, h: number, dists: number[], prefer: (dir: Pt, p: Pt) => 1 | -1, clear = 0.1): Pt => {
    let pick: Pt | null = null, pickCost = Infinity;
    dists.forEach((dist, i) => {
      const { p, dir } = pointAt(path, Math.max(0, Math.min(1, dist / total)));
      const first = prefer(dir, p);
      // beside the line, or a little farther out when an arrowhead or a neighbour is in the way
      for (const [extra, fee] of [[0, 0], [0.1, 0.3]]) {
        for (const side of [first, -first as 1 | -1]) {
          const c = besideAt(p, dir, w, h, side, clear + extra);
          const cost = obs.cost(rectAt(c, w, h)) + i * 0.02 + (side === first ? 0 : 0.01) + fee;
          if (cost < pickCost - 1e-9) { pick = c; pickCost = cost; }
        }
      }
    });
    return pick ?? besideAt(path[0], [1, 0], w, h, 1, clear);
  };
  /** The middle of each straight run, longest first, as distances from the start. */
  const runMiddles = (): number[] => {
    const runs: Array<[number, number]> = [];
    let acc = 0;
    for (let i = 1; i < g.points.length; i++) {
      const L = Math.hypot(g.points[i][0] - g.points[i - 1][0], g.points[i][1] - g.points[i - 1][1]);
      runs.push([acc + L / 2, L]);
      acc += L;
    }
    const scale = total / (acc || 1);
    return runs.sort((a, b) => b[1] - a[1]).map(([mid]) => mid * scale);
  };

  // the path is its own obstacle while its labels are placed
  obs.paths.push(path);

  // «include» / «extend»: above the middle of the line (outside a bend)
  if (e.kind === "include" || e.kind === "extend") {
    const s = `«${e.kind}»`;
    const [w, h] = size(s, 300);
    let c: Pt;
    if (g.smooth && g.points.length === 3) {
      const a = g.points[0], b = g.points[2], mid = g.points[1], chord: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const L = Math.hypot(mid[0] - chord[0], mid[1] - chord[1]) || 1;
      const nx = (mid[0] - chord[0]) / L, ny = (mid[1] - chord[1]) / L;
      const off = (w / 2) * Math.abs(nx) + (h / 2) * Math.abs(ny) + 0.1;
      c = [mid[0] + nx * off, mid[1] + ny * off];
    } else {
      const mids = runMiddles();
      c = best(w, h, [mids[0], mids[0] - 0.2, mids[0] + 0.2, mids[0] - 0.4, mids[0] + 0.4, ...mids.slice(1)], (dir) => upperSide(dir));
    }
    commit(spec(`${g.id}:stereotype`, s, c, 300));
  }

  // the line's own label
  if (e.label) {
    const [w, h] = size(e.label, 400);
    let c: Pt;
    if (e.labelPos) {
      const at = pointAt(path, e.labelPos.t).p;
      c = [at[0] + e.labelPos.dx, at[1] + e.labelPos.dy];
    } else {
      // a guard reads near the decision it leaves; any other label beside the longest run
      const guard = from.kind === "decision" || from.kind === "merge" || g.routeKind === "straight";
      const dist = (q: Pt): number => Math.hypot(q[0] - from.cx, q[1] - from.cy);
      const away = (dir: Pt, p: Pt): 1 | -1 => {
        const plus = besideAt(p, dir, w, h, 1), minus = besideAt(p, dir, w, h, -1);
        const gap = dist(minus) - dist(plus);
        return Math.abs(gap) < 0.05 ? upperSide(dir) : gap > 0 ? -1 : 1;
      };
      if (guard) {
        const firstRun = Math.hypot(g.points[1][0] - g.points[0][0], g.points[1][1] - g.points[0][1]) * (total / (pathLength(g.points) || 1));
        const d0 = g.routeKind === "straight" ? firstRun / 2 : Math.min(firstRun / 2, 0.3 + Math.max(w, h) / 2);
        const steps = [d0, d0 + 0.15, d0 + 0.3, d0 + 0.5, d0 + 0.75, d0 + 1.0, d0 + 1.3, d0 - 0.12, total * 0.5];
        c = best(w, h, steps.filter((s) => s > 0.05 && s < total - 0.05), away);
      } else {
        const mids = runMiddles();
        c = best(w, h, [mids[0], mids[0] - 0.25, mids[0] + 0.25, ...mids.slice(1)], (dir) => upperSide(dir));
      }
    }
    commit(spec(`${g.id}:label`, e.label, c, 400));
  }

  // multiplicities and role names at the ends
  for (const end of ["from", "to"] as const) {
    const ad = e.ends?.[end];
    if (!ad) continue;
    // a diamond or an arrowhead sits at this end: the text stands beside it, a little farther from the line
    const marker = (end === "from" && (e.kind === "aggregation" || e.kind === "composition")) || (end === "to" && (e.directed || e.kind === "generalization"));
    const items: Array<[string, string, 1 | -1]> = [];
    if (ad.mult) items.push(["mult", ad.mult, 1]);
    if (ad.role) items.push(["role", ad.role, -1]);
    for (const [what, s, side] of items) {
      const [w, h] = size(s, 400);
      const endDir = pointAt(path, end === "from" ? 0.001 : 0.999).dir;
      const along = (Math.abs(endDir[0]) * w) / 2 + (Math.abs(endDir[1]) * h) / 2;
      const dAlong = Math.min(total * 0.42, 0.09 + along);
      const t = end === "from" ? dAlong / total : 1 - dAlong / total;
      const { p, dir } = pointAt(path, t);
      const clear = marker ? 0.17 : 0.1;
      // the same side of the line at both ends, seen from the page: mirror the travel direction at the far end
      const sd: 1 | -1 = end === "from" ? side : (-side as 1 | -1);
      let c = besideAt(p, dir, w, h, sd, clear);
      if (obs.cost(rectAt(c, w, h)) > 0) {
        const alt = besideAt(p, dir, w, h, -sd as 1 | -1, clear);
        if (obs.cost(rectAt(alt, w, h)) < obs.cost(rectAt(c, w, h))) c = alt;
      }
      commit(spec(`${g.id}:${end}-${what}`, s, c, 400));
    }
  }
  obs.paths.pop();
}

export function resolve(d: ChalkDoc, m: Measurer, o: ResolveOptions = {}): Geometry {
  const placement = layoutNodes(d, m, o.direction ?? d.meta.direction);
  const nodes = placement.nodes;
  const order = [
    ...d.nodes.filter((n) => CONTAINERS.has(n.kind) && nodes.has(n.id)).map((n) => n.id),
    ...d.nodes.filter((n) => !CONTAINERS.has(n.kind) && nodes.has(n.id)).map((n) => n.id),
  ];
  const solid = order.map((id) => nodes.get(id)!).filter((g) => g.shape !== "container" && g.shape !== "lane");
  const texts: TextSpec[] = [];
  for (const id of order) texts.push(...nodeTexts(m, nodes.get(id)!));

  let edges: EdgeGeom[];
  if (o.partial) {
    const known = new Map(o.partial.from.edges.map((e) => [e.uid, e]));
    const only = new Set(d.edges.filter((e) => o.partial!.moved.has(e.from) || o.partial!.moved.has(e.to) || !known.has(e.uid)).map((e) => e.uid));
    const fresh = new Map(routeAll(d, nodes, solid, placement.bends, placement.direction, only, known).map((e) => [e.uid, e]));
    edges = d.edges.map((e) => fresh.get(e.uid) ?? known.get(e.uid)).filter((e): e is EdgeGeom => !!e && nodes.has(e.from) && nodes.has(e.to));
  } else edges = routeAll(d, nodes, solid, placement.bends, placement.direction);
  const obs = new Obstacles(solid);
  for (const t of texts) obs.rects.push(textRect(t, 0.02));
  // a label never sits on a container's outline or a lane's header rule
  for (const g of nodes.values()) {
    if (g.shape !== "container" && g.shape !== "lane") continue;
    const [bx0, by0, bx1, by1] = boxOf(g);
    obs.soft.push([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1], [bx0, by0]]);
    if (g.shape === "lane") obs.soft.push(g.horizontal ? [[bx0 + (g.header ?? 0), by0], [bx0 + (g.header ?? 0), by1]] : [[bx0, by0 + (g.header ?? 0)], [bx1, by0 + (g.header ?? 0)]]);
  }
  const drawn = edges.map(drawnPath);
  // arrowheads, triangles and diamonds are ink too: keep labels off them
  const heads: Pt[][] = [];
  for (const g of edges) {
    const path = drawnPath(g), n = path.length;
    const wings = (tip: Pt, toward: Pt, len: number, half: number): void => {
      const L = Math.hypot(toward[0] - tip[0], toward[1] - tip[1]) || 1;
      const ux = (toward[0] - tip[0]) / L, uy = (toward[1] - tip[1]) / L;
      const back: Pt = [tip[0] + ux * len, tip[1] + uy * len];
      heads.push([[back[0] - uy * half, back[1] + ux * half], tip, [back[0] + uy * half, back[1] - ux * half]]);
    };
    if (g.kind === "generalization" || g.kind === "realization") wings(path[n - 1], path[n - 2], 0.2, 0.11);
    else if (g.directed) wings(path[n - 1], path[n - 2], 0.2, 0.1);
    if (g.kind === "aggregation" || g.kind === "composition") wings(path[0], path[1], 0.14, 0.085);
  }
  edges.forEach((g, i) => {
    const e = d.edges.find((x) => x.uid === g.uid)!;
    // every other line is in the way; this one is added by the placer itself
    obs.paths = [...drawn.filter((_, j) => j !== i), ...heads];
    placeEdgeTexts(m, e, g, nodes.get(g.from)!, obs, texts);
  });

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (a: number, b: number, c: number, dd: number): void => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, dd); };
  for (const g of nodes.values()) grow(...boxOf(g));
  for (const e of edges) for (const p of drawnPath(e)) grow(p[0], p[1], p[0], p[1]);
  for (const t of texts) grow(...textRect(t));
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  return { type: d.meta.type, id: d.meta.id, direction: placement.direction, nodes, order, edges, texts, bounds: [x0, y0, x1, y1] };
}

/** Sides a decision's exits prefer, so two answers leave from two corners instead of sharing one. */
function decisionSides(d: ChalkDoc, nodes: Map<string, NodeGeom>, flow: "down" | "right"): Map<string, Side> {
  const out = new Map<string, Side>();
  for (const n of d.nodes) {
    if (n.kind !== "decision") continue;
    const g = nodes.get(n.id);
    if (!g) continue;
    const exits = d.edges.filter((e) => e.from === n.id && nodes.has(e.to) && !e.route);
    if (exits.length < 2) continue;
    const cross = (e: DocEdge): number => (flow === "down" ? nodes.get(e.to)!.cx - g.cx : nodes.get(e.to)!.cy - g.cy);
    const ahead = (e: DocEdge): number => (flow === "down" ? nodes.get(e.to)!.cy - g.cy : nodes.get(e.to)!.cx - g.cx);
    const lo: Side = flow === "down" ? "left" : "top", hi: Side = flow === "down" ? "right" : "bottom", fwd: Side = flow === "down" ? "bottom" : "right";
    const sorted = [...exits].sort((a, b) => cross(a) - cross(b));
    const taken = new Set<Side>();
    sorted.forEach((e, i) => {
      const c = cross(e);
      let side: Side | null = null;
      if (ahead(e) < -0.2) side = c < 0 ? lo : hi; // a loop back leaves from a side
      else if (Math.abs(c) < 0.3) side = fwd;
      else if (i === 0 && c < 0) side = lo;
      else if (i === sorted.length - 1 && c > 0) side = hi;
      else side = fwd;
      if (side && taken.has(side)) side = [fwd, c < 0 ? lo : hi, c < 0 ? hi : lo].find((s) => !taken.has(s)) ?? null;
      if (side) { taken.add(side); out.set(e.uid, side); }
    });
  }
  return out;
}

/**
 * Route every line, in file order. With `only`, just those lines are routed again (a drag in the draw view) and
 * `known` supplies where the others already run, so the result matches a full pass.
 */
export function routeAll(d: ChalkDoc, nodes: Map<string, NodeGeom>, solid: NodeGeom[], bends: Map<string, Pt>, direction: "down" | "right",
  only?: Set<string>, known?: Map<string, EdgeGeom>): EdgeGeom[] {
  const type = d.meta.type;
  const flow: RouteInput["flow"] = type === "flowchart" || type === "activity" ? direction : "none";
  const prefer = flow === "none" ? new Map<string, Side>() : decisionSides(d, nodes, flow);
  // lines that join the same two shapes are spread apart, in file order
  const pairCount = new Map<string, number>(), pairSeen = new Map<string, number>();
  const pairKey = (e: DocEdge): string => (e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`);
  for (const e of d.edges) if (nodes.has(e.from) && nodes.has(e.to)) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
  // which sides lines already leave from and arrive at: mixing the two on one side reads badly
  const leaves = new Map<string, Partial<Record<Side, number>>>(), arrives = new Map<string, Partial<Record<Side, number>>>();
  const note = (mp: Map<string, Partial<Record<Side, number>>>, id: string, side: Side): void => {
    const rec = mp.get(id) ?? {};
    rec[side] = (rec[side] ?? 0) + 1;
    mp.set(id, rec);
  };
  const costs = (mp: Map<string, Partial<Record<Side, number>>>, id: string): Partial<Record<Side, number>> => {
    const out2: Partial<Record<Side, number>> = {};
    for (const [side, n] of Object.entries(mp.get(id) ?? {})) if (n) out2[side as Side] = 0.8;
    return out2;
  };
  const out: EdgeGeom[] = [];
  // where the lines before this one run, so a later line keeps out of their channels
  const taken: TakenRoute[] = [];
  for (const e of d.edges) {
    const from = nodes.get(e.from), to = nodes.get(e.to);
    if (!from || !to || from === to || from.shape === "container" || from.shape === "lane" || to.shape === "container" || to.shape === "lane") continue;
    const k = pairKey(e), n = pairCount.get(k) ?? 1, i = pairSeen.get(k) ?? 0;
    pairSeen.set(k, i + 1);
    if (only && !only.has(e.uid)) {
      const was = known?.get(e.uid);
      if (was) {
        note(leaves, e.from, was.fromSide); note(arrives, e.to, was.toSide);
        if (was.routeKind === "elbow") taken.push({ points: was.points, from: e.from, to: e.to });
      }
      continue;
    }
    // -1, +1 for a pair; -1, 0, +1 for three; mirrored when the line runs the other way
    let lateral = n > 1 ? i - (n - 1) / 2 : 0;
    if (lateral && e.from > e.to) lateral = -lateral;
    const [gapFrom, gapTo] = gaps(e.kind);
    const bend = !e.route ? bends.get(e.uid) : undefined;
    const kind = e.route?.kind ?? (type === "use-case" ? "straight" : "elbow");
    // elbow lines between the same two shapes take different sides instead of running side by side
    if (kind === "elbow") lateral = 0;
    const pf: RouteInput["prefer"] = {};
    if (prefer.has(e.uid)) pf.from = prefer.get(e.uid);
    if (type === "class" && (e.kind === "generalization" || e.kind === "realization") && !e.route) {
      if (to.cy + to.h / 2 < from.cy - from.h / 2) { pf.from = "top"; pf.to = "bottom"; }
      else if (to.cy - to.h / 2 > from.cy + from.h / 2) { pf.from = "bottom"; pf.to = "top"; }
    }
    const r = routeEdge({
      from, to, kind, gapFrom, gapTo, flow, lateral, prefer: pf, taken,
      // bars take lines on both faces by design, and an undirected line has no leaving end
      ...(e.directed ? { sideCost: { from: from.shape === "bar" ? {} : costs(arrives, e.from), to: to.shape === "bar" ? {} : costs(leaves, e.to) } } : {}),
      obstacles: solid,
      ...(e.route?.from ? { fromSide: e.route.from } : {}), ...(e.route?.to ? { toSide: e.route.to } : {}),
      ...(e.route?.via ? { via: e.route.via.map((p) => [p[0], p[1]] as Pt) } : bend ? { via: [bend] } : {}),
    });
    if (e.directed) { note(leaves, e.from, r.fromSide); note(arrives, e.to, r.toSide); }
    if (kind === "elbow") taken.push({ points: r.points, from: e.from, to: e.to });
    out.push({
      uid: e.uid, id: e.id, kind: e.kind, from: e.from, to: e.to, points: r.points, smooth: !!bend, routeKind: kind, manual: !!e.route,
      fromSide: r.fromSide, toSide: r.toSide, blocked: r.blocked, step: e.step, directed: e.directed, dashed: isDashed(e),
      ...(e.style ? { style: e.style } : {}),
    });
  }
  return out;
}
