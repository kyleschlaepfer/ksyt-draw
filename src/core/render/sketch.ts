/**
 * The sketch look: every shape and line drawn by pen.ts, in the style of the videos. Stroke recipes
 * for the v1 shapes follow reference/diagrams.py (spec/rendering.md §3, §4); the pen itself stays a
 * bit-compatible port. Each element is one Sketch seeded from "<diagram id>:<element id>", so adding
 * a shape never changes how another one wobbles.
 */
import { BG, CH, DKG, GR, GREEN, TERRA, WASH, Sketch, catmull, type Poly } from "../pen";
import { seedFor } from "../pyrandom";
import type { EdgeGeom } from "../geom/resolve";
import { ACTOR_H, IO_SKEW, type NodeGeom, type Pt } from "../geom/shape";
import type { Paint, PaintContext, Role } from "./scene";
import { weightOf } from "./scene";

const ROLE: Record<string, Role> = {
  [CH]: "ink", [GR]: "ink-2", [GREEN]: "accent", [DKG]: "accent-strong", [WASH]: "wash", [TERRA]: "terra", [BG]: "page",
};
const HEX: Record<string, string> = { ink: CH, "ink-2": GR, accent: GREEN, "accent-strong": DKG, terra: TERRA };

export function sketchFor(diagramId: string, id: string): Sketch {
  return new Sketch(seedFor(`${diagramId}:${id}`));
}

const paintsOf = (k: Sketch): Paint[] => k.items.map(([poly, color]) => ({ t: "poly" as const, pts: poly, fill: ROLE[color] ?? "ink" }));

function sideStrokes(k: Sketch, pts: Pt[], color: string, width: number): void {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    k.pen([
      [p[0] + (q[0] - p[0]) * -0.02, p[1] + (q[1] - p[1]) * -0.02],
      [(p[0] + q[0]) / 2 + 0.01, (p[1] + q[1]) / 2 - 0.01],
      [q[0] + (q[0] - p[0]) * 0.02, q[1] + (q[1] - p[1]) * 0.02],
    ], { color, width });
  }
}

export function sketchNode(g: NodeGeom, ctx: PaintContext): Paint[] {
  const k = sketchFor(ctx.diagramId, g.id);
  const { cx, cy } = g;
  const x0 = cx - g.w / 2, y0 = cy - g.h / 2, x1 = cx + g.w / 2, y1 = cy + g.h / 2;
  const rect: Poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const col = HEX[g.style?.color ?? "ink"];
  const wm = weightOf(g.style?.weight);
  const fillKind = g.style?.fill ?? "page";
  const ground = (poly: Poly): void => { if (fillKind !== "none") k.fill(poly, fillKind === "wash" ? WASH : BG); };
  switch (g.kind) {
    case "process":
      ground(rect);
      k.looseRect(x0, y0, x1, y1, { color: col, width: 0.032 * wm });
      break;
    case "action":
      ground(rect);
      k.roundedRect(x0, y0, x1, y1, { r: Math.min(0.18, g.h / 3), step: 0.16, color: col, width: 0.032 * wm });
      break;
    case "terminator":
      ground(rect);
      k.roundedRect(x0, y0, x1, y1, { r: g.h / 2 - 0.01, step: 0.14, color: col, width: 0.032 * wm });
      break;
    case "io": {
      const pts: Pt[] = [[x0 + IO_SKEW, y0], [x1, y0], [x1 - IO_SKEW, y1], [x0, y1]];
      ground(pts);
      sideStrokes(k, pts, col, 0.03 * wm);
      break;
    }
    case "decision":
    case "merge": {
      const pts: Pt[] = [[cx, y0], [x1, cy], [cx, y1], [x0, cy]];
      ground(pts);
      sideStrokes(k, pts, col, 0.03 * wm);
      break;
    }
    case "initial":
      k.dot(cx, cy, g.w / 2, { color: col });
      break;
    case "final": {
      const r = g.w / 2;
      k.looseCircle(cx, cy, r, r, { color: col, width: 0.028 * wm });
      k.dot(cx, cy, r * 0.55, { color: col });
      break;
    }
    case "flow-final": {
      const r = g.w / 2;
      k.looseCircle(cx, cy, r, r, { color: col, width: 0.028 * wm });
      const o = r * 0.62;
      k.pen([[cx - o, cy - o], [cx + o, cy + o]], { color: col, width: 0.026 * wm, taperIn: 0, taperOut: 0 });
      k.pen([[cx + o, cy - o], [cx - o, cy + o]], { color: col, width: 0.026 * wm, taperIn: 0, taperOut: 0 });
      break;
    }
    case "fork":
    case "join":
      k.blob([[x0, y0 + 0.004], [(x0 + x1) / 2, y0 - 0.006], [x1, y0], [x1 + 0.006, (y0 + y1) / 2], [x1, y1],
        [(x0 + x1) / 2, y1 + 0.005], [x0, y1], [x0 - 0.005, (y0 + y1) / 2]], col);
      break;
    case "actor": {
      const h = g.figH ?? ACTOR_H, top = y0;
      const r = h * 0.14, hy = top + r;
      k.looseCircle(cx, hy, r, r, { color: col, width: 0.026 * wm });
      const neck = hy + r, hip = top + h * 0.62;
      k.pen([[cx, neck], [cx + 0.004, (neck + hip) / 2], [cx, hip]], { color: col, width: 0.028 * wm });
      k.pen([[cx - h * 0.26, neck + h * 0.16], [cx, neck + h * 0.12], [cx + h * 0.26, neck + h * 0.15]], { color: col, width: 0.026 * wm });
      k.pen([[cx, hip], [cx - h * 0.22, top + h]], { color: col, width: 0.027 * wm });
      k.pen([[cx, hip], [cx + h * 0.21, top + h - 0.01]], { color: col, width: 0.027 * wm });
      break;
    }
    case "use-case": {
      const rx = g.w / 2, ry = g.h / 2;
      const poly: Poly = [];
      for (let t = 0; t < 12; t++) poly.push([cx + rx * Math.cos((t / 12) * 2 * Math.PI), cy + ry * Math.sin((t / 12) * 2 * Math.PI)]);
      ground(poly);
      k.looseCircle(cx, cy, rx, ry, { color: col, width: 0.028 * wm });
      break;
    }
    case "class":
    case "interface":
      ground(rect);
      k.looseRect(x0, y0, x1, y1, { color: col, width: 0.03 * wm });
      for (const dy of g.cls?.dividers ?? []) {
        k.pen([[x0 + 0.01, y0 + dy], [cx, y0 + dy + 0.006], [x1 - 0.01, y0 + dy - 0.002]], { color: col, width: 0.022 * wm, taperIn: 0.04, taperOut: 0.06 });
      }
      break;
    case "note":
      break;
    case "boundary":
      k.looseRect(x0, y0, x1, y1, { color: g.style?.color ? col : GR, width: 0.026 * wm });
      break;
    case "partition": {
      // lanes share their dividers: each draws its top, bottom, far side and header rule; the first adds the near side
      const c = g.style?.color ? col : GR, w = 0.026 * wm;
      const line = (a: Pt, b: Pt): void => {
        const mid: Pt = [(a[0] + b[0]) / 2 + (a[0] === b[0] ? 0.008 : 0), (a[1] + b[1]) / 2 + (a[1] === b[1] ? -0.008 : 0)];
        k.pen([a, mid, b], { color: c, width: w, taperIn: 0.02, taperOut: 0.03 });
      };
      const hd = g.header ?? 0;
      if (g.horizontal) {
        line([x0, y0], [x0, y1]); line([x1, y0], [x1, y1]); line([x0, y1], [x1, y1]);
        if (ctx.firstLane.has(g.id)) line([x0, y0], [x1, y0]);
        line([x0 + hd, y0], [x0 + hd, y1]);
      } else {
        line([x0, y0], [x1, y0]); line([x0, y1], [x1, y1]); line([x1, y0], [x1, y1]);
        if (ctx.firstLane.has(g.id)) line([x0, y0], [x0, y1]);
        line([x0, y0 + hd], [x1, y0 + hd]);
      }
      break;
    }
  }
  return paintsOf(k);
}

// ---------------------------------------------------------------- lines

function unit(a: Pt, b: Pt): { ux: number; uy: number; L: number } {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { ux: (b[0] - a[0]) / L, uy: (b[1] - a[1]) / L, L };
}

/** Pen control points for an elbow line: straight runs, corners rounded the way a hand takes them. */
export function elbowCtrl(pts: Pt[]): Pt[] {
  if (pts.length === 2) return [pts[0], [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], pts[1]];
  const out: Pt[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const { ux, uy, L } = unit(a, b);
    const r = Math.min(0.09, L / 3);
    const s0 = i === 0 ? 0 : r, s1 = i + 2 === pts.length ? 0 : r;
    const add = (t: number): void => { out.push([a[0] + ux * t, a[1] + uy * t]); };
    if (i > 0) add(s0);
    // evenly spaced points keep the run straight: the pen's spline swings wide when a long gap follows a short one
    const span = L - s0 - s1;
    const n = Math.max(2, Math.ceil(span / 0.14));
    for (let j = 1; j < n; j++) add(s0 + (span * j) / n);
    if (s1) add(L - s1);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Cut `len` off the end (or start) of a polyline. */
export function trim(pts: Pt[], len: number, end: "start" | "end"): Pt[] {
  if (len <= 0) return pts;
  const p = end === "end" ? [...pts] : [...pts].reverse();
  let left = len;
  while (p.length > 1) {
    const a = p[p.length - 2], b = p[p.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > left + 1e-9) {
      p[p.length - 1] = [b[0] - ((b[0] - a[0]) / L) * left, b[1] - ((b[1] - a[1]) / L) * left];
      break;
    }
    if (p.length === 2) { p[p.length - 1] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; break; }
    left -= L;
    p.pop();
  }
  return end === "end" ? p : p.reverse();
}

/** The pieces of a dashed line along a path: `on` long, `off` apart, starting `lead` in and stopping `tail` short. */
export function dashPieces(path: Pt[], on: number, off: number, lead: number, tail: number): Pt[][] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (s: number): Pt => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
  };
  const out: Pt[][] = [];
  let t = lead;
  while (t < total - tail - on * 0.4) {
    const e = Math.min(t + on, total - tail);
    const piece: Pt[] = [at(t)];
    // keep the corners a dash runs around
    for (let i = 1; i < cum.length - 1; i++) if (cum[i] > t + 1e-6 && cum[i] < e - 1e-6) piece.push(path[i]);
    piece.push(at(e));
    out.push(piece);
    t = e + off;
  }
  return out;
}

/** The direction a line arrives from at its end (or leaves in at its start). */
export function endDir(pts: Pt[], end: "start" | "end"): Pt {
  const n = pts.length;
  const [a, b] = end === "end" ? [pts[n - 2], pts[n - 1]] : [pts[1], pts[0]];
  const { ux, uy } = unit(a, b);
  return [ux, uy];
}

export function sketchEdge(e: EdgeGeom, ctx: PaintContext): Paint[] {
  const k = sketchFor(ctx.diagramId, e.id);
  const col = HEX[e.style?.color ?? "ink"];
  const wm = weightOf(e.style?.weight);
  const path: Pt[] = e.smooth ? catmull(e.points, 0.02) : e.points;
  const tipTo = e.points[e.points.length - 1], tipFrom = e.points[0];
  const dTo = endDir(path, "end"), dFrom = endDir(path, "start");
  const ctrl = (pts: Pt[]): Pt[] => (e.smooth ? pts : elbowCtrl(pts));
  const plain = (pts: Pt[], width: number): void => { k.pen(ctrl(pts), { color: col, width, taperIn: 0, taperOut: 0 }); };
  const dashed = (pts: Pt[], on: number, off: number, width: number, lead = 0.04, tail = 0.04): void => {
    for (const piece of dashPieces(pts, on, off, lead, tail)) k.pen(piece.length === 2 ? piece : piece, { color: col, width, taperIn: 0, taperOut: 0 });
  };
  const openHead = (tip: Pt, dir: Pt, len: number, spread: number, width: number): void => {
    for (const s of [-1, 1]) {
      const ang = Math.atan2(dir[1], dir[0]) + Math.PI + (s * spread * Math.PI) / 180;
      k.pen([[tip[0] + len * Math.cos(ang), tip[1] + len * Math.sin(ang)], tip], { color: col, width, taperIn: 0.2, taperOut: 0.05 });
    }
  };
  const triangle = (tip: Pt, dir: Pt): number => {
    const len = 0.19, half = 0.1;
    const base: Pt = [tip[0] - dir[0] * len, tip[1] - dir[1] * len];
    const a: Pt = [base[0] - dir[1] * half, base[1] + dir[0] * half], b: Pt = [base[0] + dir[1] * half, base[1] - dir[0] * half];
    k.knockout([tip, a, b]);
    sideStrokes(k, [tip, a, b], col, 0.024 * wm);
    return len;
  };
  const diamond = (tip: Pt, dir: Pt, filled: boolean): number => {
    const len = 0.26, half = 0.075;
    const mid: Pt = [tip[0] + dir[0] * (len / 2), tip[1] + dir[1] * (len / 2)], far: Pt = [tip[0] + dir[0] * len, tip[1] + dir[1] * len];
    const a: Pt = [mid[0] - dir[1] * half, mid[1] + dir[0] * half], b: Pt = [mid[0] + dir[1] * half, mid[1] - dir[0] * half];
    if (filled) k.fill([tip, a, far, b], col);
    else { k.knockout([tip, a, far, b]); }
    sideStrokes(k, [tip, a, far, b], col, 0.022 * wm);
    return len;
  };

  switch (e.kind) {
    case "arrow":
      if (e.dashed) {
        dashed(path, 0.17, 0.1, 0.028 * wm, 0, 0.1);
        openHead(tipTo, dTo, 0.17, 27, 0.028 * wm);
      } else k.arrow(ctrl(e.points), { color: col, width: 0.03 * wm, head: 0.17 });
      break;
    case "association":
      if (e.points.length === 2 && !e.smooth) {
        const a = e.points[0], b = e.points[1];
        k.pen([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.01], b], { color: col, width: 0.026 * wm, taperIn: 0, taperOut: 0 });
      } else plain(e.points, 0.026 * wm);
      if (e.directed) openHead(tipTo, dTo, 0.17, 27, 0.026 * wm);
      break;
    case "include":
    case "extend":
    case "dependency":
      dashed(path, 0.16, 0.1, 0.022 * wm, 0.04, 0.06);
      openHead(tipTo, dTo, 0.2, 28, 0.024 * wm);
      break;
    case "generalization": {
      const len = triangle(tipTo, dTo);
      plain(trim(e.points, len, "end"), 0.026 * wm);
      break;
    }
    case "realization": {
      const len = triangle(tipTo, dTo);
      dashed(trim(path, len, "end"), 0.16, 0.1, 0.022 * wm, 0.04, 0.02);
      break;
    }
    case "aggregation":
    case "composition": {
      // the diamond sits on the whole, which is where the line starts
      const out: Pt = [-dFrom[0], -dFrom[1]];
      const len = diamond(tipFrom, out, e.kind === "composition");
      plain(trim(e.points, len, "start"), 0.026 * wm);
      break;
    }
  }
  return paintsOf(k);
}
