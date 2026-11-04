/**
 * Node and edge shapes (spec/rendering.md §3, §4): one named Sketch per element, in the slide style.
 * Geometry follows reference/diagrams.py with its pt/72 sizes converted to px/96. Everything is
 * predefined; the pen only renders.
 */
import { CH, GR, Sketch, type Pt, type Poly } from "./pen";
import { seedFor } from "./pyrandom";
import type { DiagramNode, NodeKind } from "./model";
import { PX, textBlock, type Measurer } from "./measure";

export type Role = "ink" | "ink-2" | "accent" | "accent-strong" | "wash" | "terra" | "page";
export type Shape = "box" | "pill" | "io" | "diamond" | "ellipse" | "circle" | "bar" | "actor" | "text" | "none";

export interface TextEl {
  name: string;
  s: string;
  x: number; // inches
  y: number; // baseline, inches
  size: number; // px
  role: Role;
  weight: 300 | 400;
  anchor: "start" | "middle" | "end";
  step: number;
  /** ink box in px: [x0, y0, x1, y1] */
  box: [number, number, number, number];
  /** the node whose outline this label sits inside, if any */
  owner?: string;
}

export interface NodeGeom {
  id: string;
  kind: NodeKind;
  label: string | null;
  step: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  shape: Shape;
  /** fork/join: runs top to bottom (direction right layouts) */
  vertical?: boolean;
  /** actor: the figure's own height (the box also holds the role label) */
  figH?: number;
  tw: number;
  th: number;
}

export const NODE_PX = 22;
export const SMALL_PX = 20;
export const BAR_T = 0.075;
export const IO_SKEW = 0.18;

export function sketchFor(diagramId: string, id: string): Sketch {
  return new Sketch(seedFor(`${diagramId}:${id}`));
}

/** Measure a node's label block (size and weight by kind). */
function labelBlock(m: Measurer, n: DiagramNode): { tw: number; th: number; px: number; weight: 300 | 400 } {
  if (n.kind === "note") {
    const b = textBlock(m, n.label ?? "", SMALL_PX, 300);
    return { ...b, px: SMALL_PX, weight: 300 };
  }
  if (n.kind === "actor") {
    const b = textBlock(m, n.label ?? "", SMALL_PX, 400);
    return { ...b, px: SMALL_PX, weight: 400 };
  }
  if (n.label === null || n.label === "") return { tw: 0, th: 0, px: NODE_PX, weight: 400 };
  const b = textBlock(m, n.label, NODE_PX, 400);
  return { ...b, px: NODE_PX, weight: 400 };
}

/** The size a node will have, before layout. Bars get a provisional length. */
export function nodeSize(m: Measurer, n: DiagramNode, vertical = false): NodeGeom {
  const { tw, th } = labelBlock(m, n);
  const s = NODE_PX / PX;
  const base = { id: n.id, kind: n.kind, label: n.label, step: n.step, cx: 0, cy: 0, tw, th };
  switch (n.kind) {
    case "process":
    case "action":
      return { ...base, w: Math.max(tw + 0.6, 1.0), h: Math.max(1.9 * s, th + 0.3), shape: "box" };
    case "terminator":
      return { ...base, w: tw + 0.7, h: Math.max(1.8 * s, th + 0.28), shape: "pill" };
    case "io":
      return { ...base, w: tw + 0.6 + 2 * IO_SKEW, h: Math.max(1.9 * s, th + 0.3), shape: "io" };
    case "decision": {
      const hh = Math.max(1.45 * s, th / 2 + 0.22);
      let hw = tw / 2 + 0.55;
      const fx = tw / 2 + 0.06, fy = th / 2 + 0.04;
      if (fx / hw + fy / hh > 1) hw = fx / (1 - fy / hh);
      return { ...base, w: 2 * hw, h: 2 * hh, shape: "diamond" };
    }
    case "merge":
      return { ...base, w: 0.52, h: 0.52, shape: "diamond", tw: 0, th: 0 };
    case "initial":
      return { ...base, w: 0.2, h: 0.2, shape: "circle" };
    case "final":
    case "flow-final":
      return { ...base, w: 0.3, h: 0.3, shape: "circle" };
    case "fork":
    case "join":
      return vertical
        ? { ...base, w: BAR_T, h: 1.2, shape: "bar", vertical: true }
        : { ...base, w: 1.2, h: BAR_T, shape: "bar", vertical: false };
    case "actor": {
      const h = 0.85, sl = SMALL_PX / PX;
      return { ...base, w: 2 * Math.max(h * 0.3, tw / 2), h: h + 1.3 * sl, shape: "actor", figH: h };
    }
    case "use-case":
      return { ...base, w: 2 * (tw / 2 + 0.36), h: 2 * Math.max(0.3, th / 2 + 0.17), shape: "ellipse" };
    case "note":
      return { ...base, w: tw, h: th, shape: "text" };
    case "boundary":
      return { ...base, w: 2, h: 1.5, shape: "none" };
  }
}

/** Point where the ray from the node's center toward `toward` leaves its outline, plus `gap`. */
export function edgePoint(g: NodeGeom, toward: Pt, gap = 0.06): Pt {
  const dx = toward[0] - g.cx, dy = toward[1] - g.cy;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const hw = g.w / 2, hh = g.h / 2;
  let t: number;
  if (g.shape === "actor") {
    const h = g.figH ?? 0.85;
    const top = g.cy - hh;
    let a: Pt;
    if (Math.abs(ux) >= Math.abs(uy)) a = [g.cx + Math.sign(ux || 1) * 0.3 * h, top + 0.45 * h];
    else if (uy < 0) a = [g.cx, top];
    else a = [g.cx, g.cy + hh + 0.05]; // below the role label, outside its clearance
    return [a[0] + ux * gap, a[1] + uy * gap];
  }
  if (g.shape === "diamond") t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  else if (g.shape === "ellipse") t = 1 / Math.sqrt((ux / hw) ** 2 + (uy / hh) ** 2);
  else if (g.shape === "circle") t = hw;
  else t = Math.min(ux ? hw / Math.abs(ux) : 1e9, uy ? hh / Math.abs(uy) : 1e9);
  t += gap;
  return [g.cx + ux * t, g.cy + uy * t];
}

/** Centered label, "\n" breaks lines, exactly like figure.Figure._label_in. */
export function labelIn(m: Measurer, name: string, cx: number, cy: number, text: string, px: number,
  o: { role?: Role; weight?: 300 | 400; step?: number; owner?: string } = {}): TextEl[] {
  const { role = "ink", weight = 400, step = 0, owner } = o;
  const lines = text.split("\n");
  const lh = px * 1.25;
  const { top, bot } = m.measure("Hxg", px, weight);
  const first = cy * PX - ((lines.length - 1) * lh) / 2 - (top + bot) / 2;
  return lines.map((ln, i) =>
    textEl(m, name + ":label" + (i === 0 ? "" : String(i + 1)), ln, cx, (first + i * lh) / PX, px, { role, weight, anchor: "middle", step, owner }),
  );
}

export function textEl(m: Measurer, name: string, s: string, x: number, y: number, size: number,
  o: { role?: Role; weight?: 300 | 400; anchor?: "start" | "middle" | "end"; step?: number; owner?: string } = {}): TextEl {
  const { role = "ink", weight = 400, anchor = "start", step = 0, owner } = o;
  const { adv, top, bot } = m.measure(s, size, weight);
  const xPx = x * PX - (anchor === "start" ? 0 : anchor === "middle" ? adv / 2 : adv);
  const t: TextEl = { name, s, x, y, size, role, weight, anchor, step, box: [xPx, y * PX + top, xPx + adv, y * PX + bot] };
  if (owner) t.owner = owner;
  return t;
}

function diamondStrokes(k: Sketch, pts: Pt[], color: string): void {
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    k.pen([
      [p[0] + (q[0] - p[0]) * -0.02, p[1] + (q[1] - p[1]) * -0.02],
      [(p[0] + q[0]) / 2 + 0.01, (p[1] + q[1]) / 2 - 0.01],
      [q[0] + (q[0] - p[0]) * 0.02, q[1] + (q[1] - p[1]) * 0.02],
    ], { color, width: 0.03 });
  }
}

/** Draw a node at its final geometry. */
export function drawNode(m: Measurer, diagramId: string, g: NodeGeom): { sketch: Sketch; texts: TextEl[] } {
  const k = sketchFor(diagramId, g.id);
  const texts: TextEl[] = [];
  const { cx, cy } = g;
  const x0 = cx - g.w / 2, y0 = cy - g.h / 2, x1 = cx + g.w / 2, y1 = cy + g.h / 2;
  const rect: Poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const label = g.label ?? "";
  switch (g.kind) {
    case "process":
      k.knockout(rect);
      k.looseRect(x0, y0, x1, y1);
      texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    case "action":
      k.knockout(rect);
      k.roundedRect(x0, y0, x1, y1, { r: Math.min(0.18, g.h / 3), step: 0.16 });
      texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    case "terminator":
      k.knockout(rect);
      k.roundedRect(x0, y0, x1, y1, { r: g.h / 2 - 0.01, step: 0.14 });
      texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    case "io": {
      const kx = IO_SKEW;
      const pts: Pt[] = [[x0 + kx, y0], [x1, y0], [x1 - kx, y1], [x0, y1]];
      k.knockout(pts);
      diamondStrokes(k, pts, CH);
      texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    }
    case "decision":
    case "merge": {
      const hw = g.w / 2, hh = g.h / 2;
      const pts: Pt[] = [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];
      k.knockout(pts);
      diamondStrokes(k, pts, CH);
      if (g.kind === "decision" && label) texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    }
    case "initial":
      k.dot(cx, cy, g.w / 2);
      break;
    case "final": {
      const r = g.w / 2;
      k.looseCircle(cx, cy, r, r, { color: CH, width: 0.028 });
      k.dot(cx, cy, r * 0.55);
      break;
    }
    case "flow-final": {
      const r = g.w / 2;
      k.looseCircle(cx, cy, r, r, { color: CH, width: 0.028 });
      const o = r * 0.62;
      k.pen([[cx - o, cy - o], [cx + o, cy + o]], { color: CH, width: 0.026, taperIn: 0, taperOut: 0 });
      k.pen([[cx + o, cy - o], [cx - o, cy + o]], { color: CH, width: 0.026, taperIn: 0, taperOut: 0 });
      break;
    }
    case "fork":
    case "join":
      k.blob([[x0, y0 + 0.004], [(x0 + x1) / 2, y0 - 0.006], [x1, y0], [x1 + 0.006, (y0 + y1) / 2], [x1, y1],
        [(x0 + x1) / 2, y1 + 0.005], [x0, y1], [x0 - 0.005, (y0 + y1) / 2]], CH);
      break;
    case "actor": {
      const h = g.figH ?? 0.85, top = y0;
      const r = h * 0.14, hy = top + r;
      k.looseCircle(cx, hy, r, r, { color: CH, width: 0.026 });
      const neck = hy + r, hip = top + h * 0.62;
      k.pen([[cx, neck], [cx + 0.004, (neck + hip) / 2], [cx, hip]], { color: CH, width: 0.028 });
      k.pen([[cx - h * 0.26, neck + h * 0.16], [cx, neck + h * 0.12], [cx + h * 0.26, neck + h * 0.15]], { color: CH, width: 0.026 });
      k.pen([[cx, hip], [cx - h * 0.22, top + h]], { color: CH, width: 0.027 });
      k.pen([[cx, hip], [cx + h * 0.21, top + h - 0.01]], { color: CH, width: 0.027 });
      texts.push(textEl(m, g.id + ":role", label, cx, top + h + 1.05 * (SMALL_PX / PX), SMALL_PX, { anchor: "middle", step: g.step, owner: g.id }));
      break;
    }
    case "use-case": {
      const rx = g.w / 2, ry = g.h / 2;
      const poly: Poly = [];
      for (let t = 0; t < 12; t++) poly.push([cx + rx * Math.cos((t / 12) * 2 * Math.PI), cy + ry * Math.sin((t / 12) * 2 * Math.PI)]);
      k.knockout(poly);
      k.looseCircle(cx, cy, rx, ry, { color: CH, width: 0.028 });
      texts.push(...labelIn(m, g.id, cx, cy, label, NODE_PX, { step: g.step, owner: g.id }));
      break;
    }
    case "note":
      texts.push(...labelIn(m, g.id, cx, cy, label, SMALL_PX, { role: "ink-2", weight: 300, step: g.step, owner: g.id }));
      break;
    case "boundary":
      k.looseRect(x0, y0, x1, y1, { color: GR, width: 0.026 });
      texts.push(textEl(m, g.id + ":title", label, x0 + 0.2, y0 + 1.25 * (SMALL_PX / PX), SMALL_PX, { role: "ink-2", weight: 300, step: g.step, owner: g.id }));
      break;
  }
  return { sketch: k, texts };
}

// ---------------- edges ----------------
function unit(a: Pt, b: Pt): { ux: number; uy: number; L: number } {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { ux: (b[0] - a[0]) / L, uy: (b[1] - a[1]) / L, L };
}

/** Solid control-flow arrow along a route (ends already include their gaps). */
export function drawArrow(k: Sketch, route: Pt[]): Sketch {
  const ctrl: Pt[] = route.length === 2
    ? [route[0], [(route[0][0] + route[1][0]) / 2, (route[0][1] + route[1][1]) / 2], route[1]]
    : route;
  return k.arrow(ctrl, { width: 0.03, head: 0.17 });
}

/** The dashed branch of diagrams.flow: straight dashes 0.17 long, 0.1 gaps, a two-stroke head. */
export function drawDashedArrow(k: Sketch, route: Pt[]): Sketch {
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1];
    const last = i + 2 === route.length;
    const { ux, uy, L } = unit(a, b);
    const end = last ? L - 0.14 : L;
    let t = 0;
    while (t < end) {
      const e = Math.min(t + 0.17, last ? L - 0.06 : L);
      k.pen([[a[0] + ux * t, a[1] + uy * t], [a[0] + ux * e, a[1] + uy * e]], { color: CH, width: 0.028, taperIn: 0, taperOut: 0 });
      t = e + 0.1;
    }
    if (last) {
      const tip = b;
      for (const sgn of [-1, 1]) {
        const ang = Math.atan2(uy, ux) + Math.PI + sgn * (27 * Math.PI) / 180;
        k.pen([[tip[0] + 0.17 * Math.cos(ang), tip[1] + 0.17 * Math.sin(ang)], tip], { color: CH, width: 0.028, taperIn: 0.25, taperOut: 0.05 });
      }
    }
  }
  return k;
}

/** diagrams.association: one plain stroke from a to b, no head. */
export function drawAssociation(k: Sketch, a: Pt, b: Pt): Sketch {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.01];
  return k.pen([a, mid, b], { color: CH, width: 0.026, taperIn: 0, taperOut: 0 });
}

/** diagrams.dependency: dashed open-headed arrow from a to b (outline points) with the «stereotype» label above the line. */
export function drawDependency(m: Measurer, k: Sketch, name: string, a: Pt, b: Pt, stereotype: "include" | "extend", step: number): TextEl {
  const { ux, uy, L } = unit(a, b);
  let t = 0.06;
  while (t < L - 0.12) {
    const e = Math.min(t + 0.16, L - 0.06);
    k.pen([[a[0] + ux * t, a[1] + uy * t], [a[0] + ux * e, a[1] + uy * e]], { color: CH, width: 0.022, taperIn: 0, taperOut: 0 });
    t = e + 0.1;
  }
  const tip: Pt = [b[0] - ux * 0.06, b[1] - uy * 0.06];
  for (const sgn of [-1, 1]) {
    const ang = Math.atan2(uy, ux) + Math.PI + sgn * (28 * Math.PI) / 180;
    k.pen([[tip[0] + 0.2 * Math.cos(ang), tip[1] + 0.2 * Math.sin(ang)], tip], { color: CH, width: 0.024, taperIn: 0, taperOut: 0 });
  }
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const txt = `«${stereotype}»`;
  let nx = -uy, ny = ux;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const { adv, top, bot } = m.measure(txt, SMALL_PX, 300);
  const w = adv / PX, h = (bot - top) / PX;
  const off = (w / 2) * Math.abs(nx) + (h / 2) * Math.abs(ny) + 0.1;
  const cx = mid[0] + nx * off, cy = mid[1] + ny * off;
  return textEl(m, name + ":label", txt, cx, cy + h / 2 - bot / PX, SMALL_PX, { role: "ink-2", weight: 300, anchor: "middle", step });
}

/** The label center beside a segment on one side, by diagrams.flow's offset formula. */
export function besideSegment(p0: Pt, p1: Pt, w: number, h: number, side: 1 | -1, along = 0.5): Pt {
  const { ux, uy } = unit(p0, p1);
  const nx = -uy * side, ny = ux * side;
  const off = (w / 2) * Math.abs(nx) + (h / 2) * Math.abs(ny) + 0.1;
  const px = p0[0] + (p1[0] - p0[0]) * along, py = p0[1] + (p1[1] - p0[1]) * along;
  return [px + nx * off, py + ny * off];
}
