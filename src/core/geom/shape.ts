/**
 * Node geometry: how big each shape is, where its outline is, and where a line may attach to it.
 * Pure math in inches, shared by the layout, the router, both looks, the canvas and the exports.
 * Sizes follow spec/rendering.md §3 (from the slide skill's diagrams.py, pt/72 converted to px/96).
 */
import type { DocNode, Member, NodeKind, NodeStyle, Side } from "../doc/types";
import { printMember } from "../doc/print";
import { LINE, NODE_PX, PX, SMALL_PX, wrapText, type Measurer } from "../measure";

export type Pt = [number, number];
export type Shape = "box" | "pill" | "io" | "diamond" | "ellipse" | "circle" | "bar" | "actor" | "text" | "container" | "lane" | "class";

export interface ClassRow { text: string; role: "stereotype" | "name" | "note" | "member"; cy: number; index?: number; static?: boolean; abstract?: boolean }
export interface ClassLayout {
  rows: ClassRow[];
  /** y of each divider line, relative to the box top */
  dividers: number[];
}

export interface NodeGeom {
  uid: string;
  id: string;
  kind: NodeKind;
  label: string | null;
  /** the label as drawn: wrapped to the shape when the author fixed its width */
  lines: string[];
  step: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  shape: Shape;
  /** the smallest box that still holds the text */
  minW: number;
  minH: number;
  /** fork/join: runs top to bottom */
  vertical?: boolean;
  /** actor: the figure's own height (the box also holds the role label) */
  figH?: number;
  tw: number;
  th: number;
  parent?: string;
  style?: NodeStyle;
  /** was the position (size) chosen by the author rather than the engine? */
  placed: boolean;
  sized: boolean;
  cls?: ClassLayout;
  /** container: thickness of the title band; lane: laid out as a row */
  header?: number;
  horizontal?: boolean;
}

export const BAR_T = 0.075;
export const IO_SKEW = 0.18;
export const ACTOR_H = 0.85;
export const LANE_HEADER = 0.46;
export const CLASS_PAD_X = 0.14;
export const CLASS_PAD_Y = 0.07;
export const CLASS_ROW = (SMALL_PX * 1.3) / PX;
const S = NODE_PX / PX;

const FIXED: ReadonlySet<string> = new Set(["initial", "final", "flow-final", "merge", "actor"]);
/** Can the author resize this kind of shape? */
export const resizable = (kind: NodeKind): boolean => !FIXED.has(kind) && kind !== "partition";

/** Lines of text inside a shape, and the room they need. */
function fit(m: Measurer, text: string, px: number, weight: number, inner: number | null): { lines: string[]; tw: number; th: number; word: number } {
  const lines = inner === null ? text.split("\n") : wrapText(m, text, px, weight, Math.max(0.2, inner));
  const tw = Math.max(0, ...lines.map((l) => m.measure(l, px, weight).adv)) / PX;
  const word = Math.max(0, ...text.split(/\s+/).map((w) => m.measure(w, px, weight).adv)) / PX;
  return { lines, tw, th: (lines.length * px * LINE) / PX, word };
}

export function classLayout(m: Measurer, n: DocNode): { cls: ClassLayout; w: number; h: number } {
  const rows: ClassRow[] = [];
  const dividers: number[] = [];
  const widths: number[] = [];
  let y = CLASS_PAD_Y;
  const add = (text: string, role: ClassRow["role"], px: number, weight: number, extra: Partial<ClassRow> = {}) => {
    const hgt = (px * 1.3) / PX;
    rows.push({ text, role, cy: y + hgt / 2, ...extra });
    widths.push(m.measure(text, px, weight).adv / PX);
    y += hgt;
  };
  const stereo = n.kind === "interface" ? "interface" : n.stereotype;
  if (stereo) add(`«${stereo}»`, "stereotype", SMALL_PX, 300);
  for (const line of (n.label ?? n.id).split("\n")) add(line, "name", NODE_PX, 400);
  if (n.abstract) add("{abstract}", "note", SMALL_PX, 300);
  y += CLASS_PAD_Y;
  const members = n.members ?? [];
  const attrs = members.map((mm, i) => [mm, i] as [Member, number]).filter(([mm]) => mm.kind === "attribute");
  const ops = members.map((mm, i) => [mm, i] as [Member, number]).filter(([mm]) => mm.kind === "operation");
  if (members.length) {
    for (const group of [attrs, ops]) {
      dividers.push(y);
      y += CLASS_PAD_Y;
      for (const [mm, i] of group) {
        const text = printMember({ ...mm, static: false, abstract: false }) + (mm.abstract ? " {abstract}" : "");
        add(text, "member", SMALL_PX, 400, { index: i, ...(mm.static ? { static: true } : {}), ...(mm.abstract ? { abstract: true } : {}) });
      }
      if (!group.length) y += CLASS_ROW * 0.45;
      y += CLASS_PAD_Y;
    }
  }
  return { cls: { rows, dividers }, w: Math.max(1.3, Math.max(0, ...widths) + 2 * CLASS_PAD_X), h: y };
}

/** A node's geometry before layout: its size from its text (or from the author), centered at the origin. */
export function nodeSize(m: Measurer, n: DocNode, vertical = false): NodeGeom {
  const base = {
    uid: n.uid, id: n.id, kind: n.kind, label: n.label, step: n.step, cx: 0, cy: 0,
    placed: !!n.place, sized: !!n.size && resizable(n.kind),
    ...(n.parent ? { parent: n.parent } : {}), ...(n.style ? { style: n.style } : {}),
  };
  const want = base.sized ? n.size! : null;
  const label = n.label ?? "";
  const size = (minW: number, minH: number): { w: number; h: number; minW: number; minH: number } =>
    ({ w: want ? Math.max(want.w, minW) : minW, h: want ? Math.max(want.h, minH) : minH, minW, minH });
  switch (n.kind) {
    case "process":
    case "action": {
      const t = fit(m, label, NODE_PX, 400, want ? want.w - 0.6 : null);
      return { ...base, ...t, ...size(Math.max(want ? t.word + 0.6 : t.tw + 0.6, 1.0), Math.max(1.9 * S, t.th + 0.3)), shape: "box" };
    }
    case "terminator": {
      const t = fit(m, label, NODE_PX, 400, want ? want.w - 0.7 : null);
      return { ...base, ...t, ...size(want ? Math.max(t.word + 0.7, 0.9) : t.tw + 0.7, Math.max(1.8 * S, t.th + 0.28)), shape: "pill" };
    }
    case "io": {
      const t = fit(m, label, NODE_PX, 400, want ? want.w - 0.6 - 2 * IO_SKEW : null);
      return { ...base, ...t, ...size((want ? t.word : t.tw) + 0.6 + 2 * IO_SKEW, Math.max(1.9 * S, t.th + 0.3)), shape: "io" };
    }
    case "decision": {
      const t = fit(m, label, NODE_PX, 400, want ? want.w * 0.5 : null);
      const hh = Math.max(1.45 * S, t.th / 2 + 0.22);
      let hw = t.tw / 2 + 0.55;
      const fx = t.tw / 2 + 0.06, fy = t.th / 2 + 0.04;
      if (fx / hw + fy / hh > 1) hw = fx / (1 - fy / hh);
      if (!want) return { ...base, ...t, w: 2 * hw, h: 2 * hh, minW: 2 * hw, minH: 2 * hh, shape: "diamond" };
      // a wider diamond may be flatter; keep the text corners inside the sides
      const w = Math.max(want.w, 2 * (t.word / 2 + 0.3));
      const need = 2 * (fy / Math.max(0.05, 1 - fx / (w / 2)));
      const h = Math.max(want.h, fx / (w / 2) < 1 ? need : 2 * hh, 2 * 1.2 * S);
      return { ...base, ...t, w, h, minW: 2 * (t.word / 2 + 0.3), minH: 2 * 1.2 * S, shape: "diamond" };
    }
    case "merge":
      return { ...base, lines: [], w: 0.52, h: 0.52, minW: 0.52, minH: 0.52, shape: "diamond", tw: 0, th: 0 };
    case "initial":
      return { ...base, lines: [], w: 0.2, h: 0.2, minW: 0.2, minH: 0.2, shape: "circle", tw: 0, th: 0 };
    case "final":
    case "flow-final":
      return { ...base, lines: [], w: 0.3, h: 0.3, minW: 0.3, minH: 0.3, shape: "circle", tw: 0, th: 0 };
    case "fork":
    case "join": {
      const len = want ? Math.max(0.6, vertical ? want.h : want.w) : 1.2;
      return vertical
        ? { ...base, lines: [], w: BAR_T, h: len, minW: BAR_T, minH: 0.6, shape: "bar", vertical: true, tw: 0, th: 0 }
        : { ...base, lines: [], w: len, h: BAR_T, minW: 0.6, minH: BAR_T, shape: "bar", vertical: false, tw: 0, th: 0 };
    }
    case "actor": {
      const t = fit(m, label, SMALL_PX, 400, null);
      const sl = SMALL_PX / PX;
      const w = 2 * Math.max(ACTOR_H * 0.3, t.tw / 2), h = ACTOR_H + 0.3 * sl + t.th;
      return { ...base, ...t, w, h, minW: w, minH: h, shape: "actor", figH: ACTOR_H };
    }
    case "use-case": {
      const t = fit(m, label, NODE_PX, 400, want ? want.w - 0.72 : null);
      return { ...base, ...t, ...size(2 * ((want ? t.word : t.tw) / 2 + 0.36), 2 * Math.max(0.3, t.th / 2 + 0.17)), shape: "ellipse" };
    }
    case "note": {
      const t = fit(m, label, SMALL_PX, 300, want ? want.w : null);
      return { ...base, ...t, ...size(want ? t.word : t.tw, t.th), shape: "text" };
    }
    case "class":
    case "interface": {
      const c = classLayout(m, n);
      return { ...base, lines: [], tw: c.w - 2 * CLASS_PAD_X, th: c.h, ...size(c.w, c.h), shape: "class", cls: c.cls };
    }
    case "boundary": {
      const t = fit(m, label, SMALL_PX, 300, null);
      return { ...base, ...t, w: want?.w ?? 2, h: want?.h ?? 1.5, minW: Math.max(1.2, t.tw + 0.5), minH: 0.9, shape: "container", header: 1.6 * (SMALL_PX / PX) };
    }
    case "partition": {
      const t = fit(m, label, SMALL_PX, 400, null);
      return { ...base, ...t, w: 2, h: 3, minW: Math.max(1.2, t.tw + 0.4), minH: 1, shape: "lane", header: LANE_HEADER, sized: false };
    }
  }
}

const sgn = (v: number): number => (v < 0 ? -1 : 1);

/** Point where the ray from the node's center toward `toward` leaves its outline, plus `gap`. */
export function edgePoint(g: NodeGeom, toward: Pt, gap = 0): Pt {
  const dx = toward[0] - g.cx, dy = toward[1] - g.cy;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const hw = g.w / 2, hh = g.h / 2;
  let t: number;
  if (g.shape === "actor") {
    const h = g.figH ?? ACTOR_H;
    const top = g.cy - hh;
    let a: Pt;
    if (Math.abs(ux) >= Math.abs(uy)) a = [g.cx + sgn(ux) * 0.3 * h, top + 0.45 * h];
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

export const NORMAL: Record<Side, Pt> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
export const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** How far a line's attachment may slide along this side from its middle (0: it can't). */
export function slideRoom(g: NodeGeom, side: Side): number {
  const along = side === "top" || side === "bottom" ? g.w / 2 : g.h / 2;
  switch (g.shape) {
    case "box": case "class": case "text": case "container": return Math.max(0, along - 0.14);
    case "io": return side === "top" || side === "bottom" ? Math.max(0, along - IO_SKEW - 0.1) : 0;
    case "pill": return side === "top" || side === "bottom" ? Math.max(0, along - g.h / 2) : 0;
    case "bar": return (g.vertical ? side === "left" || side === "right" : side === "top" || side === "bottom") ? Math.max(0, along - 0.04) : 0;
    default: return 0;
  }
}

/**
 * The point on a side where a line attaches: the middle, slid by `slide` inches along the side when
 * the shape allows it, then pushed out by `gap`.
 */
export function sideAnchor(g: NodeGeom, side: Side, slide = 0, gap = 0): Pt {
  const [nx, ny] = NORMAL[side];
  const room = slideRoom(g, side);
  const s = Math.max(-room, Math.min(room, slide));
  if (g.shape === "actor") {
    const h = g.figH ?? ACTOR_H, top = g.cy - g.h / 2;
    const p: Pt = side === "top" ? [g.cx, top] : side === "bottom" ? [g.cx, g.cy + g.h / 2 + 0.05] : [g.cx + nx * 0.3 * h, top + 0.45 * h];
    return [p[0] + nx * gap, p[1] + ny * gap];
  }
  let px = g.cx + nx * (g.w / 2), py = g.cy + ny * (g.h / 2);
  if (side === "top" || side === "bottom") px += s; else py += s;
  if (g.shape === "io" && (side === "left" || side === "right")) px -= nx * (IO_SKEW / 2);
  return [px + nx * gap, py + ny * gap];
}

/** Is the point inside the shape grown by `pad`? (Containers count only as their outline band: lines may cross them.) */
export function contains(g: NodeGeom, x: number, y: number, pad = 0): boolean {
  const dx = x - g.cx, dy = y - g.cy;
  const hw = g.w / 2 + pad, hh = g.h / 2 + pad;
  if (Math.abs(dx) > hw || Math.abs(dy) > hh) return false;
  if (g.shape === "diamond") return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
  if (g.shape === "ellipse" || g.shape === "circle") return (dx / hw) ** 2 + (dy / hh) ** 2 <= 1;
  if (g.shape === "container" || g.shape === "lane") return false;
  return true;
}

/** The side of a shape that faces a point. */
export function sideToward(g: NodeGeom, p: Pt): Side {
  const dx = p[0] - g.cx, dy = p[1] - g.cy;
  const inX = Math.abs(dx) <= g.w / 2, inY = Math.abs(dy) <= g.h / 2;
  if (inX && !inY) return dy < 0 ? "top" : "bottom";
  if (inY && !inX) return dx < 0 ? "left" : "right";
  return Math.abs(dx) * g.h >= Math.abs(dy) * g.w ? (dx < 0 ? "left" : "right") : (dy < 0 ? "top" : "bottom");
}

export const boxOf = (g: NodeGeom): [number, number, number, number] => [g.cx - g.w / 2, g.cy - g.h / 2, g.cx + g.w / 2, g.cy + g.h / 2];
