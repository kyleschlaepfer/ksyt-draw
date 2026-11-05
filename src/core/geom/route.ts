/**
 * The router: where a line runs between two shapes. One implementation for automatic layout, for
 * routes the author bent by hand, and for the live preview while dragging in the draw view.
 *
 * Straight lines are clipped to the outlines. Elbow lines are orthogonal: the router tries the short
 * patterns (straight, one corner, a step through the middle) for every pair of sides, scores them by
 * length, corners and what they would run through, and falls back to an A* search on a sparse grid
 * around the obstacles when every pattern is blocked. Everything is deterministic.
 */
import type { Side } from "../doc/types";
import { NORMAL, SIDES, boxOf, contains, edgePoint, sideAnchor, sideToward, slideRoom, type NodeGeom, type Pt } from "./shape";

export interface RouteInput {
  from: NodeGeom;
  to: NodeGeom;
  kind: "straight" | "elbow";
  fromSide?: Side;
  toSide?: Side;
  /** the author's waypoints (elbow: the corners) */
  via?: Pt[];
  gapFrom: number;
  gapTo: number;
  /** shapes a line should not run through (containers excluded) */
  obstacles: NodeGeom[];
  /** which way work flows, for side preferences; "none" for structure diagrams */
  flow: "down" | "right" | "none";
  /** soft side preferences */
  prefer?: { from?: Side; to?: Side };
  /** extra cost for a side: a side that already takes arriving lines is a poor place to leave from, and the reverse */
  sideCost?: { from?: Partial<Record<Side, number>>; to?: Partial<Record<Side, number>> };
  /** 0 for the only line between two shapes; ±1, ±2 for parallel ones, which are spread apart */
  lateral?: number;
}

export interface RouteResult { points: Pt[]; fromSide: Side; toSide: Side; blocked: boolean }

const STUB = 0.22;
const BEND = 0.35;
const PAD = 0.07;
const SPREAD = 0.17;

const same = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** Drop repeated points and the middles of straight runs. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  let i = 1;
  while (i < out.length - 1) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < 1e-9 && dot > 0) out.splice(i, 1);
    else i++;
  }
  return out;
}

export function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** The point a fraction t (0..1) of the way along a polyline, and the direction of travel there. */
export function pointAt(pts: Pt[], t: number): { p: Pt; dir: Pt; seg: number } {
  const total = pathLength(pts) || 1;
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= L || i === pts.length - 1) {
      const u = L ? Math.min(1, want / L) : 0;
      return {
        p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u],
        dir: L ? [(pts[i][0] - pts[i - 1][0]) / L, (pts[i][1] - pts[i - 1][1]) / L] : [1, 0], seg: i - 1,
      };
    }
    want -= L;
  }
  return { p: pts[0], dir: [1, 0], seg: 0 };
}

/** The fraction along a polyline nearest to a point, with the distance to it. */
export function nearestT(pts: Pt[], q: Pt): { t: number; d: number; seg: number } {
  const total = pathLength(pts) || 1;
  let best = { t: 0, d: Infinity, seg: 0 }, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0] - ax, by = pts[i][1] - ay;
    const L2 = bx * bx + by * by;
    const u = L2 ? Math.max(0, Math.min(1, ((q[0] - ax) * bx + (q[1] - ay) * by) / L2)) : 0;
    const d = Math.hypot(q[0] - (ax + bx * u), q[1] - (ay + by * u));
    const L = Math.sqrt(L2);
    if (d < best.d) best = { t: (run + L * u) / total, d, seg: i - 1 };
    run += L;
  }
  return best;
}

/** How many obstacles does this polyline run through? */
export function hits(pts: Pt[], obstacles: NodeGeom[], ends: { from?: NodeGeom; to?: NodeGeom } = {}): number {
  let n = 0;
  for (const g of obstacles) {
    const own = g === ends.from || g === ends.to;
    // an actor is joined at its figure, which sits inside the box that also holds its name
    if (own && g.shape === "actor") continue;
    const pad = own ? -0.01 : PAD;
    const [x0, y0, x1, y1] = boxOf(g);
    let hit = false;
    for (let i = 1; i < pts.length && !hit; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.max(a[0], b[0]) < x0 - pad || Math.min(a[0], b[0]) > x1 + pad || Math.max(a[1], b[1]) < y0 - pad || Math.min(a[1], b[1]) > y1 + pad) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(L / 0.04));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps, y = a[1] + ((b[1] - a[1]) * k) / steps;
        if (contains(g, x, y, pad)) { hit = true; break; }
      }
    }
    if (hit) n++;
  }
  return n;
}

function bends(pts: Pt[]): number {
  return Math.max(0, pts.length - 2);
}

/** A penalty for runs too short to read as a deliberate step. */
function jogs(pts: Pt[]): number {
  let p = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts.length < 3) break;
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L < 0.3) p += 0.6 * (1 - L / 0.3) + 0.2;
  }
  return p;
}

/** A bar takes every line square-on, at the other shape's position along it. */
function barSlide(bar: NodeGeom, other: Pt): number {
  return bar.vertical ? other[1] - bar.cy : other[0] - bar.cx;
}

function straight(inp: RouteInput): RouteResult {
  const { from, to, via = [] } = inp;
  const off = (inp.lateral ?? 0) * SPREAD;
  let aimF: Pt = via[0] ?? [to.cx, to.cy], aimT: Pt = via[via.length - 1] ?? [from.cx, from.cy];
  let p0: Pt, p1: Pt;
  const perp = (a: Pt, b: Pt): Pt => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  };
  const end = (g: NodeGeom, side: Side | undefined, aim: Pt, gap: number, other: NodeGeom): Pt => {
    if (side) return sideAnchor(g, side, 0, gap);
    if (g.shape === "bar") {
      const s = sideToward(g, aim);
      const useSide: Side = g.vertical ? (s === "left" || s === "right" ? s : aim[0] < g.cx ? "left" : "right") : (s === "top" || s === "bottom" ? s : aim[1] < g.cy ? "top" : "bottom");
      return sideAnchor(g, useSide, barSlide(g, via.length ? aim : [other.cx, other.cy]), gap);
    }
    return edgePoint(g, aim, gap);
  };
  if (off && !via.length) {
    const n = perp([from.cx, from.cy], [to.cx, to.cy]);
    aimF = [to.cx + n[0] * off, to.cy + n[1] * off];
    aimT = [from.cx + n[0] * off, from.cy + n[1] * off];
    const fg = { ...from, cx: from.cx + n[0] * off, cy: from.cy + n[1] * off };
    const tg = { ...to, cx: to.cx + n[0] * off, cy: to.cy + n[1] * off };
    // slide the whole line sideways, then clip it against the real outlines
    p0 = clip(from, [fg.cx, fg.cy], aimF, inp.gapFrom);
    p1 = clip(to, [tg.cx, tg.cy], aimT, inp.gapTo);
  } else {
    p0 = end(from, inp.fromSide, aimF, inp.gapFrom, to);
    p1 = end(to, inp.toSide, aimT, inp.gapTo, from);
    // a line that meets a bar square-on stays square: the other end slides to match when it can
    if (!via.length && from.shape === "bar" && to.shape !== "bar" && !inp.toSide) p1 = edgePoint(to, p0, inp.gapTo);
    if (!via.length && to.shape === "bar" && from.shape !== "bar" && !inp.fromSide) p0 = edgePoint(from, p1, inp.gapFrom);
  }
  const points = [p0, ...via, p1];
  return { points, fromSide: inp.fromSide ?? sideToward(from, points[1]), toSide: inp.toSide ?? sideToward(to, points[points.length - 2]), blocked: false };
}

/** Where the segment from `inside` toward `toward` leaves the shape (by bisection), plus the gap. */
function clip(g: NodeGeom, inside: Pt, toward: Pt, gap: number): Pt {
  if (!contains({ ...g, shape: g.shape === "actor" ? "box" : g.shape }, inside[0], inside[1])) return edgePoint(g, toward, gap);
  let lo = 0, hi = 1;
  const at = (t: number): Pt => [inside[0] + (toward[0] - inside[0]) * t, inside[1] + (toward[1] - inside[1]) * t];
  if (contains(g, toward[0], toward[1])) return edgePoint(g, toward, gap);
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (contains(g, p[0], p[1])) lo = mid; else hi = mid;
  }
  const p = at(hi);
  const L = Math.hypot(toward[0] - inside[0], toward[1] - inside[1]) || 1;
  return [p[0] + ((toward[0] - inside[0]) / L) * gap, p[1] + ((toward[1] - inside[1]) / L) * gap];
}

interface Cand { pts: Pt[]; fromSide: Side; toSide: Side; score: number; blocked: boolean }

function sidePenalty(inp: RouteInput, fs: Side, ts: Side): number {
  const { from, to, flow, prefer } = inp;
  let p = (inp.sideCost?.from?.[fs] ?? 0) + (inp.sideCost?.to?.[ts] ?? 0);
  if (prefer?.from && prefer.from !== fs) p += 0.9;
  if (prefer?.to && prefer.to !== ts) p += 0.9;
  if (flow === "none") return p;
  const fwd: Side = flow === "down" ? "bottom" : "right", back: Side = flow === "down" ? "top" : "left";
  const ahead = flow === "down" ? to.cy - from.cy : to.cx - from.cx;
  const clear = flow === "down" ? (from.h + to.h) / 2 : (from.w + to.w) / 2;
  if (ahead > clear * 0.6) {
    // forward: don't leave against the flow or arrive from beyond the target
    if (fs === back) p += 1.5;
    if (ts === fwd) p += 1.5;
    // leaving ahead and arriving from behind reads best
    if (fs !== fwd && fs !== back && !prefer?.from) p += 0.4;
    if (ts !== fwd && ts !== back) p += 0.15;
  } else if (ahead < -clear * 0.6) {
    // a loop back: go around the side, not straight up the way the work came down
    if (fs === back && ts === fwd) p += 1.6;
    if (fs === fwd) p += 0.4;
  }
  return p;
}

function candidates(inp: RouteInput, fs: Side, ts: Side, slideF: number, slideT: number): Pt[][] {
  const S = sideAnchor(inp.from, fs, slideF, inp.gapFrom), T = sideAnchor(inp.to, ts, slideT, inp.gapTo);
  const nf = NORMAL[fs], nt = NORMAL[ts];
  const S1: Pt = [S[0] + nf[0] * STUB, S[1] + nf[1] * STUB], T1: Pt = [T[0] + nt[0] * STUB, T[1] + nt[1] * STUB];
  const mx = (S1[0] + T1[0]) / 2, my = (S1[1] + T1[1]) / 2;
  const raw: Pt[][] = [
    [S, S1, T1, T],
    [S, S1, [S1[0], T1[1]], T1, T],
    [S, S1, [T1[0], S1[1]], T1, T],
    [S, S1, [mx, S1[1]], [mx, T1[1]], T1, T],
    [S, S1, [S1[0], my], [T1[0], my], T1, T],
  ];
  const out: Pt[][] = [];
  for (const r of raw) {
    const pts = simplify(r);
    if (pts.length < 2) continue;
    let ok = true;
    for (let i = 1; i < pts.length && ok; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) ok = false; // not orthogonal (the direct pattern when unaligned)
      if (i > 1) {
        const px = pts[i - 1][0] - pts[i - 2][0], py = pts[i - 1][1] - pts[i - 2][1];
        if (dx * px + dy * py < -1e-9) ok = false; // doubles back on itself
      }
    }
    if (!ok) continue;
    const first: Pt = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], last: Pt = [pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]];
    if (first[0] * nf[0] + first[1] * nf[1] <= 1e-9) continue; // must leave along the side's normal
    if (last[0] * nt[0] + last[1] * nt[1] >= -1e-9) continue; // and arrive against the target's
    out.push(pts);
  }
  return out;
}

function slides(g: NodeGeom, side: Side, other: NodeGeom, lateral: number): number[] {
  const horizontalSide = side === "top" || side === "bottom";
  const align = horizontalSide ? other.cx - g.cx : other.cy - g.cy;
  if (g.shape === "bar") return [align];
  const room = slideRoom(g, side);
  const base = lateral * SPREAD;
  if (room <= 0) return [0];
  const a = Math.max(-room, Math.min(room, align + base));
  return Math.abs(a - base) < 1e-6 ? [base] : [base, a];
}

function elbowAuto(inp: RouteInput): RouteResult {
  const { from, to } = inp;
  const lateral = inp.lateral ?? 0;
  let best: Cand | null = null;
  for (const fs of inp.fromSide ? [inp.fromSide] : SIDES) {
    for (const ts of inp.toSide ? [inp.toSide] : SIDES) {
      const pen = sidePenalty(inp, fs, ts);
      for (const sf of slides(from, fs, to, lateral)) {
        for (const st of slides(to, ts, from, lateral)) {
          const slid = (from.shape !== "bar" && Math.abs(sf - lateral * SPREAD) > 1e-6) || (to.shape !== "bar" && Math.abs(st - lateral * SPREAD) > 1e-6);
          for (const pts of candidates(inp, fs, ts, sf, st)) {
            // an attachment only leaves the middle of its side to make the line perfectly straight
            if (slid && pts.length > 2) continue;
            const h = hits(pts, inp.obstacles, { from, to });
            const off = slid ? Math.abs(sf - lateral * SPREAD) + Math.abs(st - lateral * SPREAD) : 0;
            const score = pathLength(pts) + BEND * bends(pts) + pen + 0.12 * off + jogs(pts) + 1000 * h;
            if (!best || score < best.score - 1e-9) best = { pts, fromSide: fs, toSide: ts, score, blocked: h > 0 };
          }
        }
      }
    }
  }
  if (best && !best.blocked) return { points: best.pts, fromSide: best.fromSide, toSide: best.toSide, blocked: false };
  // every pattern runs through something: search around the obstacles
  let found: Cand | null = null;
  for (const fs of inp.fromSide ? [inp.fromSide] : SIDES) {
    for (const ts of inp.toSide ? [inp.toSide] : SIDES) {
      const sf = slides(from, fs, to, lateral)[0], st = slides(to, ts, from, lateral)[0];
      const S = sideAnchor(from, fs, sf, inp.gapFrom), T = sideAnchor(to, ts, st, inp.gapTo);
      const nf = NORMAL[fs], nt = NORMAL[ts];
      const S1: Pt = [S[0] + nf[0] * STUB, S[1] + nf[1] * STUB], T1: Pt = [T[0] + nt[0] * STUB, T[1] + nt[1] * STUB];
      const mid = search(S1, nf, T1, [-nt[0], -nt[1]], inp.obstacles);
      if (!mid) continue;
      const pts = simplify([S, ...mid, T]);
      const h = hits(pts, inp.obstacles, { from, to });
      const score = pathLength(pts) + BEND * bends(pts) + sidePenalty(inp, fs, ts) + 1000 * h;
      if (!found || score < found.score) found = { pts, fromSide: fs, toSide: ts, score, blocked: h > 0 };
    }
  }
  const pick = found && (!best || found.score < best.score) ? found : best;
  if (pick) return { points: pick.pts, fromSide: pick.fromSide, toSide: pick.toSide, blocked: pick.blocked };
  return { ...straight({ ...inp, kind: "straight" }), blocked: true };
}

/** A* over the grid made by the obstacles' edges: shortest orthogonal path with few corners. */
function search(start: Pt, startDir: Pt, goal: Pt, goalDir: Pt, obstacles: NodeGeom[]): Pt[] | null {
  const M = 0.14, REACH = 1.4;
  const rx0 = Math.min(start[0], goal[0]) - REACH, rx1 = Math.max(start[0], goal[0]) + REACH;
  const ry0 = Math.min(start[1], goal[1]) - REACH, ry1 = Math.max(start[1], goal[1]) + REACH;
  const boxes = obstacles.map(boxOf).filter(([x0, y0, x1, y1]) => x1 + M > rx0 && x0 - M < rx1 && y1 + M > ry0 && y0 - M < ry1)
    .map(([x0, y0, x1, y1]) => [x0 - M, y0 - M, x1 + M, y1 + M] as [number, number, number, number]);
  const uniq = (a: number[]): number[] => [...new Set(a.map((v) => Math.round(v * 1e4) / 1e4))].sort((p, q) => p - q);
  const xs = uniq([start[0], goal[0], rx0, rx1, (start[0] + goal[0]) / 2, ...boxes.flatMap((b) => [b[0], b[2]])]);
  const ys = uniq([start[1], goal[1], ry0, ry1, (start[1] + goal[1]) / 2, ...boxes.flatMap((b) => [b[1], b[3]])]);
  const eps = 1e-3;
  const inside = (x: number, y: number): boolean => boxes.some((b) => x > b[0] + eps && x < b[2] - eps && y > b[1] + eps && y < b[3] - eps);
  const ix = (v: number): number => xs.indexOf(Math.round(v * 1e4) / 1e4), iy = (v: number): number => ys.indexOf(Math.round(v * 1e4) / 1e4);
  const si = ix(start[0]), sj = iy(start[1]), gi = ix(goal[0]), gj = iy(goal[1]);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null;
  const DIRS: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const dirIndex = (d: Pt): number => DIRS.findIndex((v) => v[0] === Math.sign(d[0]) && v[1] === Math.sign(d[1]));
  const W = xs.length, H = ys.length;
  const key = (i: number, j: number, d: number): number => (j * W + i) * 4 + d;
  const cost = new Float64Array(W * H * 4).fill(Infinity);
  const prev = new Int32Array(W * H * 4).fill(-1);
  const heap: Array<[number, number]> = [];
  const pushH = (f: number, k: number): void => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const popH = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]];
        p = m;
      }
    }
    return top;
  };
  const hEst = (i: number, j: number): number => Math.abs(xs[i] - goal[0]) + Math.abs(ys[j] - goal[1]);
  const sd = dirIndex(startDir), gd = dirIndex(goalDir);
  const k0 = key(si, sj, sd);
  cost[k0] = 0;
  pushH(hEst(si, sj), k0);
  let end = -1;
  while (heap.length) {
    const [, k] = popH();
    const d = k % 4, cell = (k - d) / 4, i = cell % W, j = (cell - i) / W;
    if (i === gi && j === gj) { end = k; break; }
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === d) continue; // no reversing
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const mx = (xs[i] + xs[ni]) / 2, my = (ys[j] + ys[nj]) / 2;
      if (inside(mx, my) || inside(xs[ni], ys[nj])) continue;
      let c = cost[k] + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : BEND);
      if (ni === gi && nj === gj && nd !== gd) c += (nd + 2) % 4 === gd ? 1e6 : BEND;
      const nk = key(ni, nj, nd);
      if (c < cost[nk] - 1e-9) { cost[nk] = c; prev[nk] = k; pushH(c + hEst(ni, nj), nk); }
    }
  }
  if (end < 0) return null;
  const out: Pt[] = [];
  for (let k = end; k >= 0; k = prev[k]) {
    const d = k % 4, cell = (k - d) / 4, i = cell % W, j = (cell - i) / W;
    out.push([xs[i], ys[j]]);
  }
  return out.reverse();
}

/** An elbow route through the author's corners: the ends attach square-on, with a jog when a side can't slide. */
function elbowVia(inp: RouteInput): RouteResult {
  const via = inp.via!;
  const end = (g: NodeGeom, side: Side | undefined, toward: Pt, gap: number): { pts: Pt[]; side: Side } => {
    const s = side ?? sideToward(g, toward);
    const horizontalSide = s === "top" || s === "bottom";
    const want = g.shape === "bar" ? (horizontalSide ? toward[0] - g.cx : toward[1] - g.cy) : horizontalSide ? toward[0] - g.cx : toward[1] - g.cy;
    const a = sideAnchor(g, s, want, gap);
    const aligned = horizontalSide ? Math.abs(a[0] - toward[0]) < 1e-6 : Math.abs(a[1] - toward[1]) < 1e-6;
    if (aligned) return { pts: [a], side: s };
    // can't slide far enough: leave square, then jog over
    return { pts: [a, horizontalSide ? [a[0], toward[1]] : [toward[0], a[1]]], side: s };
  };
  const a = end(inp.from, inp.fromSide, via[0], inp.gapFrom);
  const b = end(inp.to, inp.toSide, via[via.length - 1], inp.gapTo);
  const mid: Pt[] = [];
  for (let i = 0; i < via.length; i++) {
    const p = via[i];
    const q = i ? via[i - 1] : a.pts[a.pts.length - 1];
    // corners the author left diagonal get squared off
    if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) mid.push([p[0], q[1]]);
    mid.push(p);
  }
  const lastVia = mid[mid.length - 1], firstB = b.pts[b.pts.length - 1];
  if (Math.abs(lastVia[0] - firstB[0]) > 1e-6 && Math.abs(lastVia[1] - firstB[1]) > 1e-6) {
    mid.push(b.side === "top" || b.side === "bottom" ? [firstB[0], lastVia[1]] : [lastVia[0], firstB[1]]);
  }
  const points = simplify([...a.pts, ...mid, ...[...b.pts].reverse()]);
  return { points, fromSide: a.side, toSide: b.side, blocked: false };
}

export function routeEdge(inp: RouteInput): RouteResult {
  if (inp.kind === "straight") return straight(inp);
  if (inp.via && inp.via.length) return elbowVia(inp);
  return elbowAuto(inp);
}

/** The interior corners of a route, which is what a hand-bent elbow line stores. */
export const interior = (pts: Pt[]): Pt[] => pts.slice(1, -1);
