/**
 * Where shapes go. dagre ranks flows, activity diagrams and class diagrams; partitions then pull each
 * node into its lane; use-case diagrams use their own columns (spec/rendering.md §5, §6).
 *
 * Every node takes part in the automatic layout, including ones the author placed by hand: a placed
 * node keeps its slot and is then moved to where the author put it. That makes the result a pure
 * function of the document, so dragging one shape never shifts another, and a saved file reopens
 * exactly as it looked.
 */
import * as D from "@dagrejs/dagre";
import type { ChalkDoc, DocEdge, DocNode } from "../doc/types";
import { CONTAINERS } from "../doc/types";
import { PX, SMALL_PX, type Measurer } from "../measure";
import { LANE_HEADER, boxOf, nodeSize, type NodeGeom, type Pt } from "./shape";
import { catmull } from "../pen";

const dagre = (D as unknown as { default?: typeof D }).default ?? D;

export interface Placement {
  /** by node id, containers included */
  nodes: Map<string, NodeGeom>;
  direction: "down" | "right";
  /** use-case lines that swing around a shape they don't join: edge uid -> the point they pass through */
  bends: Map<string, Pt>;
}

let ranked: { sig: string; at: Map<string, [number, number]> } | null = null;

export const LANE_PAD = 0.35;
export const LANE_GAP = 0.4;
export const LANE_MIN = 1.8;
/** how far past a decision's corner its answer must stand for the line to leave the corner and turn once */
const CORNER_REACH = 0.3;
/** Added to the width and height the ranking sees for a shape that has a line back to itself. */
const LOOP_ROOM = 0.5;

const place = (g: NodeGeom, n: DocNode): void => { if (n.place) { g.cx = n.place.x; g.cy = n.place.y; } };

export function layoutNodes(d: ChalkDoc, m: Measurer, direction: "down" | "right" = d.meta.direction): Placement {
  if (d.meta.type === "use-case") return layoutUseCase(d, m);
  return layoutFlow(d, m, direction);
}

function layoutFlow(d: ChalkDoc, m: Measurer, dirIn: "down" | "right"): Placement {
  const lanes = d.nodes.filter((n) => n.kind === "partition");
  const horizontal = lanes.length > 0 && (d.meta.lanes ? d.meta.lanes === "horizontal" : dirIn === "right");
  // partitions run along the flow, so they decide its direction
  const direction: "down" | "right" = lanes.length ? (horizontal ? "right" : "down") : dirIn;
  const vertical = direction === "right";
  const nodes = new Map<string, NodeGeom>();
  const real = d.nodes.filter((n) => !CONTAINERS.has(n.kind));
  for (const n of real) nodes.set(n.id, nodeSize(m, n, vertical));
  const edges = d.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));

  if (real.some((n) => !n.place)) {
    const hasLabels = edges.some((e) => e.label);
    // multiplicities and role names need room at both ends of a line
    const hasEnds = edges.some((e) => e.ends);
    // the ranking depends only on sizes and links, not on where the author placed things: remember the last
    // answer, so dragging a shape (which re-resolves on every frame) never pays for dagre again
    const ranksep = hasEnds ? 104 : hasLabels ? 82 : 72;
    const sig = [vertical ? "LR" : "TB", ranksep, ...[...nodes].map(([id, n]) => id + ":" + n.w.toFixed(3) + "x" + n.h.toFixed(3)),
      ...edges.map((e) => e.from + ">" + e.to + (e.kind === "generalization" || e.kind === "realization" ? "^" : ""))].join("|");
    if (ranked?.sig !== sig) {
      const rank = (room: Map<string, number>): Map<string, [number, number]> => {
        const g = new dagre.graphlib.Graph({ multigraph: true });
        g.setGraph({ rankdir: vertical ? "LR" : "TB", nodesep: 48, ranksep, edgesep: 24, marginx: 0, marginy: 0 });
        g.setDefaultEdgeLabel(() => ({}));
        for (const [id, n] of nodes) {
          const extra = room.get(id) ?? 0;
          // a shape with a line back to itself needs room round it for the loop
          const loop = edges.some((e) => e.from === id && e.to === id) ? LOOP_ROOM : 0;
          g.setNode(id, { width: (n.w + loop + (vertical ? 0 : extra)) * PX, height: (n.h + loop + (vertical ? extra : 0)) * PX });
        }
        // dagre orders siblings by its DFS over successors in insertion order, which comes out mirrored;
        // inserting the edges last-to-first keeps the author's file order left to right
        for (const e of [...edges].reverse()) {
          if (e.from === e.to) continue;
          // a parent sits above its children whichever way the line was written
          const up = e.kind === "generalization" || e.kind === "realization";
          g.setEdge(up ? e.to : e.from, up ? e.from : e.to, {}, e.uid);
        }
        dagre.layout(g);
        const at = new Map<string, [number, number]>();
        for (const id of nodes.keys()) { const p = g.node(id); at.set(id, [p.x / PX, p.y / PX]); }
        return at;
      };
      let at = rank(new Map());
      // lanes set their own spacing across the flow
      const room = lanes.length ? new Map<string, number>() : answerRoom(d, nodes, edges, at, vertical);
      if (room.size) at = rank(room);
      ranked = { sig, at };
    }
    for (const [id, n] of nodes) {
      const p = ranked.at.get(id)!;
      n.cx = p[0];
      n.cy = p[1];
    }
  }

  if (lanes.length) layoutLanes(d, m, nodes, lanes, horizontal);

  // pinned nodes override the engine
  for (const n of real) place(nodes.get(n.id)!, n);

  // fork and join bars span their neighbours (plus 0.5 in), centered on them, unless the author sized them
  for (const n of nodes.values()) {
    if (n.shape !== "bar" || n.sized) continue;
    const coords: number[] = [];
    for (const e of edges) {
      if (e.from === n.id) coords.push(vertical ? nodes.get(e.to)!.cy : nodes.get(e.to)!.cx);
      if (e.to === n.id) coords.push(vertical ? nodes.get(e.from)!.cy : nodes.get(e.from)!.cx);
    }
    const span = coords.length ? Math.max(...coords) - Math.min(...coords) : 0;
    const len = Math.max(1.0, span + 0.5);
    const mid = coords.length ? (Math.max(...coords) + Math.min(...coords)) / 2 : (vertical ? n.cy : n.cx);
    if (vertical) { n.h = len; if (!n.placed) n.cy = mid; } else { n.w = len; if (!n.placed) n.cx = mid; }
  }

  if (lanes.length) frameLanes(d, m, nodes, lanes, horizontal);
  return { nodes, direction, bends: new Map() };
}

/**
 * A decision's answers leave from its corners. That only works when the shapes they go to stand
 * beyond those corners; when two answers on the next rank sit under a wide diamond instead, the
 * lines have to hook back in from its point. This asks for the extra width that moves them out.
 */
function answerRoom(d: ChalkDoc, nodes: Map<string, NodeGeom>, edges: DocEdge[], at: Map<string, [number, number]>, vertical: boolean): Map<string, number> {
  const room = new Map<string, number>();
  const u = (id: string): number => at.get(id)![vertical ? 1 : 0], v = (id: string): number => at.get(id)![vertical ? 0 : 1];
  for (const n of d.nodes) {
    if (n.kind !== "decision" || !nodes.has(n.id)) continue;
    const ahead = [...new Set(edges.filter((e) => e.from === n.id && e.to !== n.id && !e.route).map((e) => e.to))].filter((id) => v(id) > v(n.id) + 0.01);
    // the answers on the nearest rank, side by side
    const near = Math.min(...ahead.map(v));
    const row = ahead.filter((id) => v(id) - near < 0.01).sort((a, b) => u(a) - u(b));
    if (row.length < 2) continue;
    const g = nodes.get(n.id)!;
    const want = (vertical ? g.h : g.w) + 2 * CORNER_REACH;
    const have = u(row[row.length - 1]) - u(row[0]);
    if (have >= want - 1e-6) continue;
    const each = (want - have) / (row.length - 1);
    for (const id of row) room.set(id, Math.max(room.get(id) ?? 0, each));
  }
  return room;
}

/** Pull each automatic node into its lane: its rank along the flow stays, its place across the flow is the lane's. */
function layoutLanes(d: ChalkDoc, m: Measurer, nodes: Map<string, NodeGeom>, lanes: DocNode[], horizontal: boolean): void {
  const U = (g: NodeGeom): number => (horizontal ? g.cy : g.cx);
  const V = (g: NodeGeom): number => (horizontal ? g.cx : g.cy);
  const extU = (g: NodeGeom): number => (horizontal ? g.h : g.w);
  const setU = (g: NodeGeom, u: number): void => { if (horizontal) g.cy = u; else g.cx = u; };
  const laneIds = new Set(lanes.map((l) => l.id));
  const groups: Array<{ lane: DocNode | null; members: DocNode[] }> = [];
  const loose = d.nodes.filter((n) => !CONTAINERS.has(n.kind) && !(n.parent && laneIds.has(n.parent)));
  if (loose.length) groups.push({ lane: null, members: loose });
  for (const l of lanes) groups.push({ lane: l, members: d.nodes.filter((n) => n.parent === l.id && !CONTAINERS.has(n.kind)) });

  let u0 = (horizontal ? d.pool?.y : d.pool?.x) ?? 0;
  // loose nodes sit before the pool, so the pool's fixed origin stays the first lane's edge
  if (groups[0] && groups[0].lane === null) {
    const rows = rowsOf(groups[0].members.filter((n) => !n.place).map((n) => nodes.get(n.id)!), V, U);
    const t = Math.max(...rows.map((r) => r.reduce((s, g) => s + extU(g), 0) + LANE_GAP * (r.length - 1)), 0) + 2 * LANE_PAD;
    for (const r of rows) spread(r, u0 - t / 2, extU, setU);
  }
  for (const grp of groups) {
    if (!grp.lane) continue;
    const auto = grp.members.filter((n) => !n.place).map((n) => nodes.get(n.id)!);
    const rows = rowsOf(auto, V, U);
    const lg = nodeSize(m, grp.lane);
    let need = Math.max(...rows.map((r) => r.reduce((s, g) => s + extU(g), 0) + LANE_GAP * (r.length - 1)), 0) + 2 * LANE_PAD;
    if (!horizontal) need = Math.max(need, lg.tw + 0.4);
    // a decision's side exits carry guards: leave room for the longest one beside the line that leaves it
    for (const n of grp.members) {
      if (n.kind !== "decision" || n.place) continue;
      const guards = d.edges.filter((e) => e.from === n.id && e.label).map((e) => m.measure(e.label!, SMALL_PX, 400).adv / PX);
      if (guards.length > 1) need = Math.max(need, extU(nodes.get(n.id)!) + 2 * (Math.max(...guards) + 0.55));
    }
    // a placed member the lane must still hold
    for (const n of grp.members) if (n.place) need = Math.max(need, (horizontal ? n.place.y : n.place.x) + extU(nodes.get(n.id)!) / 2 + LANE_PAD - u0);
    const t = grp.lane.thickness ?? Math.max(LANE_MIN, need);
    for (const r of rows) spread(r, u0 + t / 2, extU, setU);
    lg.w = horizontal ? 0 : t;
    lg.h = horizontal ? t : 0;
    if (horizontal) lg.cy = u0 + t / 2; else lg.cx = u0 + t / 2;
    lg.horizontal = horizontal;
    nodes.set(grp.lane.id, lg);
    u0 += t;
  }
}

/** Group nodes into rows that share a rank, each row in its order across the flow. */
function rowsOf(gs: NodeGeom[], V: (g: NodeGeom) => number, U: (g: NodeGeom) => number): NodeGeom[][] {
  const byRank = new Map<number, NodeGeom[]>();
  for (const g of gs) {
    const k = Math.round(V(g) * 100);
    const a = byRank.get(k) ?? [];
    a.push(g);
    byRank.set(k, a);
  }
  return [...byRank.values()].map((r) => r.sort((a, b) => U(a) - U(b)));
}

function spread(row: NodeGeom[], center: number, ext: (g: NodeGeom) => number, set: (g: NodeGeom, u: number) => void): void {
  const total = row.reduce((s, g) => s + ext(g), 0) + LANE_GAP * (row.length - 1);
  let u = center - total / 2;
  for (const g of row) { set(g, u + ext(g) / 2); u += ext(g) + LANE_GAP; }
}

/** Give the lanes their common extent along the flow, once every member is where it will be drawn. */
function frameLanes(d: ChalkDoc, m: Measurer, nodes: Map<string, NodeGeom>, lanes: DocNode[], horizontal: boolean): void {
  const laneIds = new Set(lanes.map((l) => l.id));
  const members = d.nodes.filter((n) => n.parent && laneIds.has(n.parent) && nodes.has(n.id)).map((n) => nodes.get(n.id)!);
  let header = LANE_HEADER;
  if (horizontal) for (const l of lanes) header = Math.max(header, nodes.get(l.id)!.tw + 0.3);
  const starts = members.map((g) => (horizontal ? g.cx - g.w / 2 : g.cy - g.h / 2));
  const ends = members.map((g) => (horizontal ? g.cx + g.w / 2 : g.cy + g.h / 2));
  const fixed = horizontal ? d.pool?.x : d.pool?.y;
  let v0 = members.length ? Math.min(...starts) - LANE_PAD - header : 0;
  if (fixed !== undefined) v0 = Math.min(fixed, v0);
  let v1 = members.length ? Math.max(...ends) + LANE_PAD : v0 + header + 2;
  if (d.pool?.length !== undefined) v1 = Math.max(v1, v0 + d.pool.length);
  for (const l of lanes) {
    const g = nodes.get(l.id)!;
    g.header = header;
    if (horizontal) { g.w = v1 - v0; g.cx = (v0 + v1) / 2; } else { g.h = v1 - v0; g.cy = (v0 + v1) / 2; }
  }
}

// ---------------------------------------------------------------- use case

const COL_GAP = 1.1;
const ROW_GAP = 0.45;
/** when a connector runs between rows of one column it needs 0.5 in plus its end gaps */
const ROW_GAP_LINKED = 0.65;
const ACTOR_X = 1.0;
const ACTOR_GAP = 0.35;

interface Column { items: NodeGeom[]; rows: Map<number, NodeGeom> }

function layoutUseCase(d: ChalkDoc, m: Measurer): Placement {
  const nodes = new Map<string, NodeGeom>();
  const src = new Map<string, DocNode>();
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

  // a use case that only right-hand actors use stands in the far column, next to them
  const actorSide = (id: string): "left" | "right" => (src.get(id)?.side === "right" ? "right" : "left");
  const rightOnly = (id: string): boolean => {
    const sides = edges.flatMap((e) => (e.from === id && kindOf(e.to) === "actor" ? [actorSide(e.to)] : e.to === id && kindOf(e.from) === "actor" ? [actorSide(e.from)] : []));
    return sides.length > 0 && sides.every((sd) => sd === "right");
  };

  const boundaries = d.nodes.filter((n) => n.kind === "boundary");
  const placedRow = new Map<string, number>();
  let cursorX = 0;

  const placeColumns = (members: DocNode[], x0: number): { x1: number } => {
    const colA: Column = { items: [], rows: new Map() };
    const colB: Column = { items: [], rows: new Map() };
    const far: NodeGeom[] = [];
    // the far column is only worth having when something stays in the near one
    const split = members.some((n) => n.kind === "use-case" && !onlyDependency(n.id) && !rightOnly(n.id));
    for (const n of members) {
      const g = nodes.get(n.id)!;
      if (n.kind === "use-case" && onlyDependency(n.id)) colB.items.push(g);
      else if (n.kind === "use-case" && split && rightOnly(n.id)) far.push(g);
      else {
        colA.items.push(g);
        colA.rows.set(colA.items.length - 1, g);
        placedRow.set(n.id, colA.items.length - 1);
      }
    }
    // column B: the row of the first use case it connects to, pushed down if taken
    const seat = (g: NodeGeom, anyRow: boolean): boolean => {
      const peers = ucPeers.get(g.id) ?? [];
      let row = anyRow ? 0 : -1;
      for (const p of peers) {
        if (placedRow.has(p)) { row = placedRow.get(p)!; break; }
      }
      if (row < 0) return false;
      while (colB.rows.has(row)) row++;
      colB.rows.set(row, g);
      placedRow.set(g.id, row);
      return true;
    };
    const waiting = colB.items.filter((g) => !seat(g, false));
    // then the right-hand actors' own use cases, in the rows left free, and whatever hangs off those
    for (const g of far) { colB.items.push(g); seat(g, true); }
    for (const g of waiting) seat(g, true);
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
        const lw = m.measure(`«${e.kind}»`, SMALL_PX, 300).adv / PX;
        gap = Math.max(gap, lw + 0.6);
      }
    }
    const cxA = x0 + wA / 2;
    const cxB = x0 + wA + gap + wB / 2;
    for (const [row, g] of colA.rows) { g.cx = cxA; g.cy = row * pitch; }
    for (const [row, g] of colB.rows) { g.cx = cxB; g.cy = row * pitch; }
    return { x1: colB.items.length ? x0 + wA + gap + wB : x0 + wA };
  };

  // a straight connector that would pass through a node it doesn't join bends around it
  const bends = new Map<string, Pt>();
  const bendsFor = (ids: string[]): Pt[] => {
    const out: Pt[] = [];
    const set = new Set(ids);
    for (const e of edges) {
      if (!set.has(e.from) || !set.has(e.to) || e.route) continue;
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      const blockers = ids.filter((id) => id !== e.from && id !== e.to).map((id) => nodes.get(id)!)
        .filter((n) => segmentHitsBox([a.cx, a.cy], [b.cx, b.cy], n, 0.1));
      if (!blockers.length) continue;
      const L = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
      const nx = -(b.cy - a.cy) / L, ny = (b.cx - a.cx) / L;
      const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
      let best: Pt | null = null, bestScore = Infinity;
      const others = ids.map((id) => nodes.get(id)!).filter((n) => n !== a && n !== b);
      const actors = d.nodes.filter((n) => n.kind === "actor").map((n) => nodes.get(n.id)!);
      // prefer the side that crosses fewer other connectors, then the one farther from the actors
      const score = (p: Pt): number => {
        let crossings = 0;
        for (const o of edges) {
          if (o === e) continue;
          const oa = nodes.get(o.from)!, ob = nodes.get(o.to)!;
          if (segmentsCross([a.cx, a.cy], p, [oa.cx, oa.cy], [ob.cx, ob.cy]) || segmentsCross(p, [b.cx, b.cy], [oa.cx, oa.cy], [ob.cx, ob.cy])) crossings++;
        }
        const near = actors.length ? Math.min(...actors.map((t) => Math.hypot(t.cx - p[0], t.cy - p[1]))) : 10;
        return crossings * 100 - Math.min(near, 10);
      };
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
            const sc = score(p) + off;
            if (sc < bestScore) { best = p; bestScore = sc; }
            break;
          }
        }
      }
      if (best) {
        bends.set(e.uid, best);
        out.push(best);
        if (e.kind === "include" || e.kind === "extend") {
          // the «include» label sits outside the bend; keep it inside the boundary too
          const { adv, top, bot } = m.measure(`«${e.kind}»`, SMALL_PX, 300);
          const w = adv / PX, h = (bot - top) / PX;
          const ox = best[0] - mx, oy = best[1] - my;
          const oL = Math.hypot(ox, oy) || 1;
          const nx2 = ox / oL, ny2 = oy / oL;
          const off = (w / 2) * Math.abs(nx2) + (h / 2) * Math.abs(ny2) + 0.1;
          const cx = best[0] + nx2 * off, cy = best[1] + ny2 * off;
          out.push([cx - w / 2 - 0.1, cy - h / 2 - 0.1], [cx + w / 2 + 0.1, cy + h / 2 + 0.1]);
        }
      }
    }
    return out;
  };

  const extra = new Map<string, Pt[]>();
  if (boundaries.length) {
    for (const b of boundaries) {
      const members = d.nodes.filter((n) => n.parent === b.id);
      const x0 = cursorX + 0.4;
      const { x1 } = placeColumns(members, x0);
      extra.set(b.id, bendsFor(members.map((n) => n.id)));
      const g = nodes.get(b.id)!;
      fitBoundary(g, members.map((n) => nodes.get(n.id)!), extra.get(b.id)!, x0);
      cursorX = Math.max(x1, g.cx + g.w / 2) + COL_GAP;
    }
    const bg = boundaries.map((b) => nodes.get(b.id)!);
    const bx1 = Math.max(...bg.map((g) => g.cx + g.w / 2));
    // use cases (and notes) outside any boundary: a column 1.1 in right of the boundary
    const loose = d.nodes.filter((n) => !n.parent && n.kind !== "actor" && n.kind !== "boundary");
    if (loose.length) placeColumns(loose, bx1 + COL_GAP);
  } else {
    const members = d.nodes.filter((n) => n.kind !== "actor" && n.kind !== "boundary");
    placeColumns(members, 0);
    bendsFor(members.map((n) => n.id));
  }

  // pinned nodes override the engine; a boundary then fits what is really inside it
  for (const n of d.nodes) if (n.kind !== "boundary") place(nodes.get(n.id)!, n);
  for (const b of boundaries) {
    const g = nodes.get(b.id)!;
    const members = d.nodes.filter((n) => n.parent === b.id);
    if (b.place && b.size) { g.cx = b.place.x; g.cy = b.place.y; g.w = Math.max(b.size.w, g.minW); g.h = Math.max(b.size.h, g.minH); g.placed = true; g.sized = true; }
    else if (members.some((n) => n.place)) fitBoundary(g, members.map((n) => nodes.get(n.id)!), extra.get(b.id) ?? [], g.cx - g.w / 2 + 0.4);
    else { g.placed = false; g.sized = false; }
  }

  // actors outside: left or right of everything in the system, centered on their use cases, pushed apart
  const inner = d.nodes.filter((n) => n.kind !== "actor" || n.parent).map((n) => nodes.get(n.id)!);
  const bx0 = inner.length ? Math.min(...inner.map((g) => g.cx - g.w / 2)) : 0;
  const bx1 = inner.length ? Math.max(...inner.map((g) => g.cx + g.w / 2)) : 0;
  const by0 = inner.length ? Math.min(...inner.map((g) => g.cy - g.h / 2)) : 0;
  const by1 = inner.length ? Math.max(...inner.map((g) => g.cy + g.h / 2)) : 0;
  const actors = d.nodes.filter((n) => n.kind === "actor" && !n.parent);
  for (const side of ["left", "right"] as const) {
    const group = actors.filter((n) => (n.side ?? "left") === side && !n.place);
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

  // a bend was planned for the engine's positions; a line with a moved end runs straight again
  for (const e of edges) if (bends.has(e.uid) && (src.get(e.from)?.place || src.get(e.to)?.place)) bends.delete(e.uid);
  return { nodes, direction: "down", bends };
}

/** A boundary's box: everything inside it, plus 0.4 in at the sides and bottom and 0.6 in on top for the title. */
function fitBoundary(g: NodeGeom, inside: NodeGeom[], extra: Pt[], x0: number): void {
  if (!inside.length) { g.w = Math.max(2, g.minW); g.h = 1.5; g.cx = x0 + g.w / 2 - 0.4; g.cy = 0; return; }
  const boxes = inside.map(boxOf);
  const minX = Math.min(...boxes.map((b) => b[0]), ...extra.map((p) => p[0] - 0.1));
  const maxX = Math.max(...boxes.map((b) => b[2]), ...extra.map((p) => p[0] + 0.1));
  const minY = Math.min(...boxes.map((b) => b[1]), ...extra.map((p) => p[1] - 0.1));
  const maxY = Math.max(...boxes.map((b) => b[3]), ...extra.map((p) => p[1] + 0.1));
  g.w = Math.max(maxX - minX + 0.8, g.minW);
  g.cx = (minX + maxX) / 2;
  g.h = maxY - minY + 1.0;
  g.cy = minY - 0.6 + g.h / 2;
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

/** Do segments p1-p2 and p3-p4 cross (sharing an endpoint doesn't count)? */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const dd = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const same = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
  if (same(p1, p3) || same(p1, p4) || same(p2, p3) || same(p2, p4)) return false;
  const d1 = dd(p3, p4, p1), d2 = dd(p3, p4, p2), d3 = dd(p1, p2, p3), d4 = dd(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the segment a-b cross the node's box (grown by pad)? */
export function segmentHitsBox(a: Pt, b: Pt, n: NodeGeom, pad: number): boolean {
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

function push(mp: Map<string, string[]>, k: string, v: string): void {
  const a = mp.get(k);
  if (a) a.push(v);
  else mp.set(k, [v]);
}

export type { DocEdge };
