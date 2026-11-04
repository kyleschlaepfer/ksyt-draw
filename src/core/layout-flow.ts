/**
 * Flow layout for flowcharts and activity diagrams (spec/rendering.md §5): dagre places the nodes,
 * then bars are sized to their branches, pinned nodes are moved, and routes are trimmed to real outlines.
 */
import * as D from "@dagrejs/dagre";
import type { Diagram, DiagramEdge } from "./model";
import type { Pt } from "./pen";
import { PX, type Measurer } from "./measure";
import { nodeSize, type NodeGeom } from "./shapes";

const dagre = (D as unknown as { default?: typeof D }).default ?? D;

export interface Route {
  edge: DiagramEdge;
  from: NodeGeom;
  to: NodeGeom;
  /** interior route points, inches */
  interior: Pt[];
  /** fixed end points (bars); otherwise computed from the outlines */
  p0?: Pt;
  p1?: Pt;
}

export interface Layout {
  nodes: Map<string, NodeGeom>;
  routes: Route[];
  /** boundaries drawn behind everything (use-case only) */
  boundaries: NodeGeom[];
  direction: "down" | "right";
}

export function layoutFlow(d: Diagram, m: Measurer, direction: "down" | "right" = d.web.direction): Layout {
  const vertical = direction === "right";
  const nodes = new Map<string, NodeGeom>();
  for (const n of d.nodes) if (n.kind !== "boundary") nodes.set(n.id, nodeSize(m, n, vertical));
  const edges = d.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  const hasLabels = edges.some((e) => e.label);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: vertical ? "LR" : "TB", nodesep: 48, ranksep: hasLabels ? 82 : 72, edgesep: 24, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, n] of nodes) g.setNode(id, { width: n.w * PX, height: n.h * PX });
  // dagre orders siblings by its DFS over successors in insertion order, which comes out mirrored;
  // inserting the edges last-to-first keeps the author's file order left to right
  for (const e of [...edges].reverse()) g.setEdge(e.from, e.to, {}, e.id);
  dagre.layout(g);
  for (const [id, n] of nodes) {
    const p = g.node(id);
    n.cx = p.x / PX;
    n.cy = p.y / PX;
  }

  // fork and join bars span their neighbours (plus 0.5 in), centered where dagre put them
  for (const n of nodes.values()) {
    if (n.shape !== "bar") continue;
    const coords: number[] = [];
    for (const e of edges) {
      if (e.from === n.id) coords.push(vertical ? nodes.get(e.to)!.cy : nodes.get(e.to)!.cx);
      if (e.to === n.id) coords.push(vertical ? nodes.get(e.from)!.cy : nodes.get(e.from)!.cx);
    }
    const span = coords.length ? Math.max(...coords) - Math.min(...coords) : 0;
    const len = Math.max(1.0, span + 0.5);
    const mid = coords.length ? (Math.max(...coords) + Math.min(...coords)) / 2 : (vertical ? n.cy : n.cx);
    if (vertical) { n.h = len; n.cy = mid; } else { n.w = len; n.cx = mid; }
  }

  // pinned nodes override dagre
  const pinned = new Set<string>();
  for (const src of d.nodes) {
    if (!src.at) continue;
    const n = nodes.get(src.id);
    if (!n) continue;
    n.cx = src.at[0];
    n.cy = src.at[1];
    pinned.add(src.id);
  }

  const routes: Route[] = [];
  for (const e of edges) {
    const from = nodes.get(e.from)!, to = nodes.get(e.to)!;
    const r: Route = { edge: e, from, to, interior: [] };
    if (from.shape === "bar" || to.shape === "bar") {
      // straight and perpendicular to the bar, at the neighbour's cross-axis coordinate
      if (from.shape === "bar") {
        r.p0 = vertical ? [from.cx + from.w / 2 + 0.06, to.cy] : [to.cx, from.cy + from.h / 2 + 0.06];
        if (vertical && to.cx < from.cx) r.p0 = [from.cx - from.w / 2 - 0.06, to.cy];
        if (!vertical && to.cy < from.cy) r.p0 = [to.cx, from.cy - from.h / 2 - 0.06];
      }
      if (to.shape === "bar") {
        r.p1 = vertical ? [to.cx - to.w / 2 - 0.06, from.cy] : [from.cx, to.cy - to.h / 2 - 0.06];
        if (vertical && from.cx > to.cx) r.p1 = [to.cx + to.w / 2 + 0.06, from.cy];
        if (!vertical && from.cy > to.cy) r.p1 = [from.cx, to.cy + to.h / 2 + 0.06];
      }
    } else if (!pinned.has(e.from) && !pinned.has(e.to)) {
      const pts = (g.edge({ v: e.from, w: e.to, name: e.id }).points as Array<{ x: number; y: number }>)
        .map((p) => [p.x / PX, p.y / PX] as Pt);
      const first = pts[0], last = pts[pts.length - 1];
      r.interior = pts.slice(1, -1).filter((p) => Math.hypot(p[0] - first[0], p[1] - first[1]) >= 0.15 &&
        Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.15);
    }
    routes.push(r);
  }
  return { nodes, routes, boundaries: [], direction };
}
