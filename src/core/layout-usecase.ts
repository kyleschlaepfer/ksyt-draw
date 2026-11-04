/**
 * Use-case layout (spec/rendering.md §6): use cases in two columns inside the boundary, actors
 * outside at the sides, every edge straight.
 */
import type { Diagram, DiagramNode } from "./model";
import type { Measurer } from "./measure";
import { nodeSize, type NodeGeom } from "./shapes";
import type { Layout, Route } from "./layout-flow";

const COL_GAP = 1.1;
const ROW_GAP = 0.45;
/** when a connector runs between rows of one column it needs 0.5 in plus its end gaps */
const ROW_GAP_LINKED = 0.65;
const ACTOR_X = 1.2;
const ACTOR_GAP = 0.35;

interface Column { items: NodeGeom[]; rows: Map<number, NodeGeom> }

export function layoutUseCase(d: Diagram, m: Measurer): Layout {
  const nodes = new Map<string, NodeGeom>();
  const src = new Map<string, DiagramNode>();
  for (const n of d.nodes) {
    nodes.set(n.id, nodeSize(m, n));
    src.set(n.id, n);
  }
  const kindOf = (id: string) => src.get(id)?.kind;
  const edges = d.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  const linkedToActor = new Set<string>();
  const ucPeers = new Map<string, string[]>();
  for (const e of edges) {
    if (kindOf(e.from) === "actor" && kindOf(e.to) === "use-case") linkedToActor.add(e.to);
    if (kindOf(e.to) === "actor" && kindOf(e.from) === "use-case") linkedToActor.add(e.from);
    if (kindOf(e.from) === "use-case" && kindOf(e.to) === "use-case") {
      push(ucPeers, e.from, e.to);
      push(ucPeers, e.to, e.from);
    }
  }
  const onlyDependency = (id: string) =>
    !linkedToActor.has(id) && edges.some((e) => e.from === id || e.to === id) &&
    edges.filter((e) => e.from === id || e.to === id).every((e) => e.kind === "include" || e.kind === "extend");

  const boundaries = d.nodes.filter((n) => n.kind === "boundary");
  const boundaryGeoms: NodeGeom[] = [];
  const placedRow = new Map<string, number>();
  let cursorX = 0;

  const placeColumns = (members: DiagramNode[], x0: number): { x1: number; y1: number } => {
    const colA: Column = { items: [], rows: new Map() };
    const colB: Column = { items: [], rows: new Map() };
    for (const n of members) {
      const g = nodes.get(n.id)!;
      if (n.kind === "use-case" && onlyDependency(n.id)) colB.items.push(g);
      else {
        colA.items.push(g);
        colA.rows.set(colA.items.length - 1, g);
        placedRow.set(n.id, colA.items.length - 1);
      }
    }
    // column B: the row of the first use case it connects to, pushed down if taken
    for (const g of colB.items) {
      const peers = ucPeers.get(g.id) ?? [];
      let row = 0;
      for (const p of peers) {
        if (placedRow.has(p)) { row = placedRow.get(p)!; break; }
      }
      while (colB.rows.has(row)) row++;
      colB.rows.set(row, g);
      placedRow.set(g.id, row);
    }
    const all = [...colA.items, ...colB.items];
    const colOf = new Map<string, Column>();
    for (const g of colA.items) colOf.set(g.id, colA);
    for (const g of colB.items) colOf.set(g.id, colB);
    const linkedRows = edges.some((e) => colOf.has(e.from) && colOf.has(e.to) && colOf.get(e.from) === colOf.get(e.to));
    const pitch = (all.length ? Math.max(...all.map((g) => g.h)) : 0.6) + (linkedRows ? ROW_GAP_LINKED : ROW_GAP);
    const widest = (c: Column) => (c.items.length ? Math.max(...c.items.map((g) => g.w)) : 0);
    const wA = widest(colA), wB = widest(colB);
    const cxA = x0 + wA / 2;
    const cxB = x0 + wA + COL_GAP + wB / 2;
    let maxRow = -1;
    for (const [row, g] of colA.rows) { g.cx = cxA; g.cy = row * pitch; maxRow = Math.max(maxRow, row); }
    for (const [row, g] of colB.rows) { g.cx = cxB; g.cy = row * pitch; maxRow = Math.max(maxRow, row); }
    const x1 = colB.items.length ? x0 + wA + COL_GAP + wB : x0 + wA;
    return { x1, y1: all.length ? maxRow * pitch + pitch / 2 : 0 };
  };

  let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
  if (boundaries.length) {
    for (const b of boundaries) {
      const members = d.nodes.filter((n) => n.inside === b.id);
      const g = nodes.get(b.id)!;
      const x0 = cursorX + 0.4;
      const { x1 } = placeColumns(members, x0);
      const inside = members.map((n) => nodes.get(n.id)!);
      if (inside.length) {
        const minX = Math.min(...inside.map((n) => n.cx - n.w / 2)), maxX = Math.max(...inside.map((n) => n.cx + n.w / 2));
        const minY = Math.min(...inside.map((n) => n.cy - n.h / 2)), maxY = Math.max(...inside.map((n) => n.cy + n.h / 2));
        g.cx = (minX + maxX) / 2;
        g.w = maxX - minX + 0.8;
        g.h = maxY - minY + 1.0;
        g.cy = minY - 0.6 + g.h / 2;
      } else {
        g.w = 2; g.h = 1.5; g.cx = x0 + 1; g.cy = 0;
      }
      boundaryGeoms.push(g);
      cursorX = Math.max(x1, g.cx + g.w / 2) + COL_GAP;
    }
    bx0 = Math.min(...boundaryGeoms.map((g) => g.cx - g.w / 2));
    bx1 = Math.max(...boundaryGeoms.map((g) => g.cx + g.w / 2));
    by0 = Math.min(...boundaryGeoms.map((g) => g.cy - g.h / 2));
    by1 = Math.max(...boundaryGeoms.map((g) => g.cy + g.h / 2));
    // use cases (and notes) outside any boundary: a column 1.1 in right of the boundary
    const loose = d.nodes.filter((n) => !n.inside && n.kind !== "actor" && n.kind !== "boundary");
    if (loose.length) placeColumns(loose, bx1 + COL_GAP);
  } else {
    const members = d.nodes.filter((n) => n.kind !== "actor" && n.kind !== "boundary");
    const r = placeColumns(members, 0);
    const inside = members.map((n) => nodes.get(n.id)!);
    bx0 = inside.length ? Math.min(...inside.map((n) => n.cx - n.w / 2)) : 0;
    bx1 = inside.length ? Math.max(...inside.map((n) => n.cx + n.w / 2)) : r.x1;
    by0 = inside.length ? Math.min(...inside.map((n) => n.cy - n.h / 2)) : 0;
    by1 = inside.length ? Math.max(...inside.map((n) => n.cy + n.h / 2)) : 0;
  }

  // actors outside: left or right, centered on the mean y of their use cases, pushed apart
  const actors = d.nodes.filter((n) => n.kind === "actor" && !n.inside);
  for (const side of ["left", "right"] as const) {
    const group = actors.filter((n) => (n.side ?? "left") === side);
    for (const n of group) {
      const g = nodes.get(n.id)!;
      const ys: number[] = [];
      for (const e of edges) {
        const other = e.from === n.id ? e.to : e.to === n.id ? e.from : null;
        if (other && kindOf(other) === "use-case") ys.push(nodes.get(other)!.cy);
      }
      g.cx = side === "left" ? bx0 - ACTOR_X : bx1 + ACTOR_X;
      g.cy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : (by0 + by1) / 2;
    }
    const placed = group.map((n) => nodes.get(n.id)!).sort((a, b) => a.cy - b.cy);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1], cur = placed[i];
      const minY = prev.cy + prev.h / 2 + ACTOR_GAP + cur.h / 2;
      if (cur.cy < minY) cur.cy = minY;
    }
  }

  // pinned nodes override everything
  for (const n of d.nodes) {
    if (!n.at) continue;
    const g = nodes.get(n.id)!;
    g.cx = n.at[0];
    g.cy = n.at[1];
  }

  const routes: Route[] = edges.map((e) => ({ edge: e, from: nodes.get(e.from)!, to: nodes.get(e.to)!, interior: [] }));
  for (const b of boundaries) nodes.delete(b.id);
  return { nodes, routes, boundaries: boundaryGeoms, direction: "down" };
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
