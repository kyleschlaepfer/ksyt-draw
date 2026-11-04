/**
 * Use-case layout (spec/rendering.md §6): use cases in two columns inside the boundary, actors
 * outside at the sides, every edge straight.
 */
import type { Diagram, DiagramNode } from "./model";
import { catmull, type Pt } from "./pen";
import { PX, type Measurer } from "./measure";
import { nodeSize, SMALL_PX, type NodeGeom } from "./shapes";
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
    // a «include»/«extend» label between the columns needs its width plus clearance
    let gap = COL_GAP;
    for (const e of edges) {
      if (e.kind !== "include" && e.kind !== "extend") continue;
      if (colOf.get(e.from) !== colOf.get(e.to)) {
        const lw = m.measure(`\u00ab${e.kind}\u00bb`, SMALL_PX, 300).adv / PX;
        gap = Math.max(gap, lw + 0.35);
      }
    }
    const cxA = x0 + wA / 2;
    const cxB = x0 + wA + gap + wB / 2;
    let maxRow = -1;
    for (const [row, g] of colA.rows) { g.cx = cxA; g.cy = row * pitch; maxRow = Math.max(maxRow, row); }
    for (const [row, g] of colB.rows) { g.cx = cxB; g.cy = row * pitch; maxRow = Math.max(maxRow, row); }
    const x1 = colB.items.length ? x0 + wA + gap + wB : x0 + wA;
    return { x1, y1: all.length ? maxRow * pitch + pitch / 2 : 0 };
  };

  // a straight connector that would pass through a node it doesn't join bends around it
  const bends = new Map<string, Pt>();
  const bendsFor = (ids: string[]): Pt[] => {
    const out: Pt[] = [];
    const set = new Set(ids);
    for (const e of edges) {
      if (!set.has(e.from) || !set.has(e.to)) continue;
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      const blockers = ids.filter((id) => id !== e.from && id !== e.to).map((id) => nodes.get(id)!)
        .filter((n) => segmentHitsBox([a.cx, a.cy], [b.cx, b.cy], n, 0.1));
      if (!blockers.length) continue;
      const L = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
      const nx = -(b.cy - a.cy) / L, ny = (b.cx - a.cx) / L;
      const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
      let best: Pt | null = null;
      const others = ids.map((id) => nodes.get(id)!).filter((n) => n !== a && n !== b);
      for (const side of [1, -1]) {
        // start just past the widest blocker, then widen until the curve clears every node
        let off = 0;
        for (const n of blockers) {
          const proj = (n.cx - mx) * nx * side + (n.cy - my) * ny * side;
          off = Math.max(off, proj + Math.hypot((n.w / 2) * nx, (n.h / 2) * ny) + 0.4);
        }
        for (let tries = 0; tries < 6; tries++, off += 0.2) {
          const p: Pt = [mx + nx * side * off, my + ny * side * off];
          if (curveClear([a.cx, a.cy], p, [b.cx, b.cy], others)) {
            if (!best || off < Math.hypot(best[0] - mx, best[1] - my)) best = p;
            break;
          }
        }
      }
      if (best) { bends.set(e.id, best); out.push(best); }
    }
    return out;
  };

  let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
  if (boundaries.length) {
    for (const b of boundaries) {
      const members = d.nodes.filter((n) => n.inside === b.id);
      const g = nodes.get(b.id)!;
      const x0 = cursorX + 0.4;
      const { x1 } = placeColumns(members, x0);
      const inside = members.map((n) => nodes.get(n.id)!);
      const bendPts = bendsFor(members.map((n) => n.id));
      if (inside.length) {
        const minX = Math.min(...inside.map((n) => n.cx - n.w / 2), ...bendPts.map((p) => p[0] - 0.1));
        const maxX = Math.max(...inside.map((n) => n.cx + n.w / 2), ...bendPts.map((p) => p[0] + 0.1));
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
    bendsFor(members.map((n) => n.id));
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

  const routes: Route[] = edges.map((e) => ({
    edge: e, from: nodes.get(e.from)!, to: nodes.get(e.to)!,
    interior: bends.has(e.id) && !src.get(e.from)?.at && !src.get(e.to)?.at ? [bends.get(e.id)!] : [],
  }));
  for (const b of boundaries) nodes.delete(b.id);
  return { nodes, routes, boundaries: boundaryGeoms, direction: "down" };
}

/** Does the smoothed curve through a, p, b stay 0.1 in clear of every node's outline? */
function curveClear(a: Pt, p: Pt, b: Pt, nodes: NodeGeom[]): boolean {
  const pts = catmull([a, p, b], 0.02);
  for (const n of nodes) {
    const rx = n.w / 2 + 0.1, ry = n.h / 2 + 0.1;
    for (const [x, y] of pts) {
      const dx = x - n.cx, dy = y - n.cy;
      const hit = n.shape === "ellipse" ? (dx / rx) ** 2 + (dy / ry) ** 2 < 1 : Math.abs(dx) < rx && Math.abs(dy) < ry;
      if (hit) return false;
    }
  }
  return true;
}

/** Does the segment a-b cross the node's box (grown by pad)? */
function segmentHitsBox(a: Pt, b: Pt, n: NodeGeom, pad: number): boolean {
  const x0 = n.cx - n.w / 2 - pad, x1 = n.cx + n.w / 2 + pad, y0 = n.cy - n.h / 2 - pad, y1 = n.cy + n.h / 2 + pad;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
