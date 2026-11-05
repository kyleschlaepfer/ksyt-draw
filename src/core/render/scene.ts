/**
 * Geometry -> Scene: a display list of paints and text, in one of two looks.
 *
 *   sketch     the pen style of the videos: every stroke is a filled polygon from pen.ts, seeded by
 *              the element's name, so a shape wobbles the same way everywhere it appears
 *   precision  crisp technical linework: real strokes, exact corners, the prose font
 *
 * Both looks paint the same geometry, so positions, sizes, routes and labels are identical; only the
 * ink differs. The scene is what svg.ts writes, what qa.ts checks and what the draw canvas shows.
 */
import type { ChalkDoc, Look } from "../doc/types";
import { maxStep } from "../doc/types";
import { NODE_PX, PRECISION_SCALE, PX, SMALL_PX, type FontFamily, type Measurer } from "../measure";
import type { EdgeGeom, Geometry, TextSpec } from "../geom/resolve";
import type { NodeGeom, Pt } from "../geom/shape";
import { describeText } from "../describe";
import { sketchEdge, sketchNode } from "./sketch";
import { precisionEdge, precisionNode } from "./precision";

export type Role = "ink" | "ink-2" | "accent" | "accent-strong" | "wash" | "terra" | "page";

export type Paint =
  /** a filled polygon: pen ink, a knockout (page), a wash */
  | { t: "poly"; pts: Pt[]; fill: Role }
  /** a stroked polyline or polygon, optionally filled, dashed, with rounded corners (radius r, inches) */
  | { t: "line"; pts: Pt[]; closed?: boolean; stroke: Role; sw: number; fill?: Role; dash?: [number, number]; r?: number }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; stroke?: Role; sw?: number; fill?: Role };

export interface Element {
  name: string;
  kind: "container" | "edge" | "node";
  step: number;
  paints: Paint[];
}

export interface TextEl {
  name: string;
  s: string;
  /** anchor x, inches */
  x: number;
  /** baseline, inches */
  y: number;
  /** px */
  size: number;
  role: Role;
  weight: 300 | 400 | 700;
  family: FontFamily;
  anchor: "start" | "middle" | "end";
  step: number;
  /** ink box in px: [x0, y0, x1, y1] */
  box: [number, number, number, number];
  /** measured advance, px (written as textLength in portable exports) */
  adv: number;
  /** the element whose outline this label sits inside or belongs to */
  owner?: string;
  underline?: boolean;
}

export interface Scene {
  id: string;
  title: string;
  desc: string;
  look: Look;
  /** frame, inches */
  w: number;
  h: number;
  elements: Element[];
  texts: TextEl[];
  /** node boxes in scene coordinates */
  nodes: NodeGeom[];
  edges: EdgeGeom[];
  steps: number;
  direction: "down" | "right";
  /** pairs ("a|b") allowed to touch */
  overlaps: Set<string>;
  /** the translation from document coordinates to scene coordinates */
  offset: [number, number];
}

export const MARGIN = 0.2;

export interface SceneOptions {
  look?: Look;
  /** space around the ink, inches (default 0.2) */
  margin?: number;
  /** false: keep document coordinates (the draw canvas); default true: frame the ink tightly at (margin, margin) */
  frame?: boolean;
  /** leave out the page-colored fills that hide lines behind shapes (transparent exports) */
  knockouts?: boolean;
}

export interface PaintContext { diagramId: string; firstLane: Set<string>; knockouts: boolean }

/** Stroke width multiplier for a style weight. */
export const weightOf = (w: string | undefined): number => (w === "thin" ? 0.68 : w === "bold" ? 1.6 : 1);

export function textEl(m: Measurer, t: TextSpec, look: Look): TextEl {
  const precise = look === "precision";
  const family: FontFamily = precise ? "body" : "hand";
  const base = t.size === "node" ? NODE_PX : SMALL_PX;
  const size = precise ? Math.round(base * PRECISION_SCALE * 10) / 10 : base;
  const weight: 300 | 400 | 700 = precise ? (t.name.endsWith(":name") ? 700 : 400) : t.weight;
  const { adv, top, bot } = m.measure(t.s, size, weight, family);
  const ref = m.measure("Hxg", size, weight, family);
  // a label inside a shape sits on the common line box so its lines share baselines; one beside a line centers its own ink
  const y = t.tight ? t.cy * PX - (top + bot) / 2 : t.cy * PX - (ref.top + ref.bot) / 2;
  const x0 = t.anchor === "middle" ? t.x * PX - adv / 2 : t.x * PX;
  const out: TextEl = {
    name: t.name, s: t.s, x: t.x, y: y / PX, size, role: t.role, weight, family, anchor: t.anchor, step: t.step,
    box: [x0, y + top, x0 + adv, y + bot], adv,
  };
  // text inside a shape may touch that shape's outline; a label beside a line must stay clear of its own line too
  if (!t.tight) out.owner = t.owner;
  if (t.underline) out.underline = true;
  return out;
}

/** Every point a paint reaches, for framing: [x0, y0, x1, y1]. */
export function paintBounds(p: Paint): [number, number, number, number] {
  if (p.t === "ellipse") {
    const s = (p.sw ?? 0) / 2;
    return [p.cx - p.rx - s, p.cy - p.ry - s, p.cx + p.rx + s, p.cy + p.ry + s];
  }
  const s = p.t === "line" ? p.sw / 2 : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - s, y0 - s, x1 + s, y1 + s];
}

function shiftPaint(p: Paint, dx: number, dy: number): Paint {
  if (p.t === "ellipse") return { ...p, cx: p.cx + dx, cy: p.cy + dy };
  return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
}

/** Paint one node or edge (the draw canvas repaints single elements while dragging). */
export function paintNode(g: NodeGeom, look: Look, ctx: PaintContext): Paint[] {
  const paints = look === "precision" ? precisionNode(g, ctx) : sketchNode(g, ctx);
  return ctx.knockouts ? paints : paints.filter((p) => !(p.t === "poly" && p.fill === "page")).map((p) => (p.t !== "poly" && p.fill === "page" ? { ...p, fill: undefined } : p));
}
export function paintEdge(e: EdgeGeom, look: Look, ctx: PaintContext): Paint[] {
  const paints = look === "precision" ? precisionEdge(e, ctx) : sketchEdge(e, ctx);
  return ctx.knockouts ? paints : paints.filter((p) => !(p.t === "poly" && p.fill === "page")).map((p) => (p.t !== "poly" && p.fill === "page" ? { ...p, fill: undefined } : p));
}

export function paintContext(geo: Geometry, knockouts = true): PaintContext {
  const lanes = [...geo.nodes.values()].filter((g) => g.shape === "lane");
  const firstLane = new Set<string>();
  if (lanes.length) {
    const key = (g: NodeGeom): number => (g.horizontal ? g.cy : g.cx);
    const min = Math.min(...lanes.map(key));
    for (const g of lanes) if (key(g) - min < 1e-6) firstLane.add(g.id);
  }
  return { diagramId: geo.id, firstLane, knockouts };
}

export function buildScene(d: ChalkDoc, geo: Geometry, m: Measurer, o: SceneOptions = {}): Scene {
  const look: Look = o.look ?? d.meta.look ?? "sketch";
  const margin = o.margin ?? MARGIN;
  const ctx = paintContext(geo, o.knockouts ?? true);
  const containers: Element[] = [], nodeEls: Element[] = [];
  for (const id of geo.order) {
    const g = geo.nodes.get(id)!;
    const el: Element = { name: g.id, kind: g.shape === "container" || g.shape === "lane" ? "container" : "node", step: g.step, paints: paintNode(g, look, ctx) };
    (el.kind === "container" ? containers : nodeEls).push(el);
  }
  const edgeEls: Element[] = geo.edges.map((e) => ({ name: e.id, kind: "edge" as const, step: e.step, paints: paintEdge(e, look, ctx) }));
  // stacking: containers, then lines, then shapes (a shape's fill hides any line under it), then text
  let elements = [...containers, ...edgeEls, ...nodeEls];
  let texts = geo.texts.map((t) => textEl(m, t, look));

  let dx = 0, dy = 0, w = 0, h = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of elements) for (const p of el.paints) {
    const b = paintBounds(p);
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  for (const t of texts) {
    x0 = Math.min(x0, t.box[0] / PX); y0 = Math.min(y0, t.box[1] / PX);
    x1 = Math.max(x1, t.box[2] / PX); y1 = Math.max(y1, t.box[3] / PX);
  }
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  if (o.frame ?? true) {
    dx = margin - x0; dy = margin - y0;
    elements = elements.map((el) => ({ ...el, paints: el.paints.map((p) => shiftPaint(p, dx, dy)) }));
    texts = texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy, box: [t.box[0] + dx * PX, t.box[1] + dy * PX, t.box[2] + dx * PX, t.box[3] + dy * PX] }));
  }
  w = x1 - x0 + 2 * margin; h = y1 - y0 + 2 * margin;
  const nodes = geo.order.map((id) => geo.nodes.get(id)!).map((n) => ({ ...n, cx: n.cx + dx, cy: n.cy + dy }));
  const edges = geo.edges.map((e) => ({ ...e, points: e.points.map(([x, y]) => [x + dx, y + dy] as Pt) }));
  return {
    id: d.meta.id, title: d.meta.title, desc: describeText(d), look, w, h, elements, texts, nodes, edges,
    steps: maxStep(d), direction: geo.direction, overlaps: new Set(), offset: [dx, dy],
  };
}

/**
 * A paint as polygons, for the raster checks in qa.ts: strokes become thin quads, so a precise line
 * is tested exactly like a sketched one. `ink` is false for fills that hide what is under them.
 */
export function paintPolys(p: Paint): Array<{ poly: Pt[]; ink: boolean; knock: boolean }> {
  const out: Array<{ poly: Pt[]; ink: boolean; knock: boolean }> = [];
  const quads = (pts: Pt[], sw: number, closed: boolean): void => {
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const nx = (-(b[1] - a[1]) / L) * (sw / 2), ny = ((b[0] - a[0]) / L) * (sw / 2);
      out.push({ poly: [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], ink: true, knock: false });
    }
  };
  if (p.t === "poly") {
    const hides = p.fill === "page" || p.fill === "wash";
    out.push({ poly: p.pts, ink: !hides, knock: p.fill === "page" });
  } else if (p.t === "line") {
    if (p.fill && p.closed) out.push({ poly: p.pts, ink: p.fill !== "page" && p.fill !== "wash", knock: p.fill === "page" });
    if (p.dash) {
      // walk the dashes so a dashed line only counts where it has ink
      const [on, off] = p.dash;
      let run = 0, draw = true, left = on;
      const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let t = 0;
        while (t < L - 1e-9) {
          const step = Math.min(left, L - t);
          if (draw) {
            const s: Pt = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L];
            const e: Pt = [a[0] + ((b[0] - a[0]) * (t + step)) / L, a[1] + ((b[1] - a[1]) * (t + step)) / L];
            quads([s, e], p.sw, false);
          }
          t += step; left -= step; run += step;
          if (left <= 1e-9) { draw = !draw; left = draw ? on : off; }
        }
      }
    } else quads(p.pts, p.sw, !!p.closed);
  } else {
    const ring: Pt[] = [];
    for (let i = 0; i < 40; i++) ring.push([p.cx + p.rx * Math.cos((i / 40) * 2 * Math.PI), p.cy + p.ry * Math.sin((i / 40) * 2 * Math.PI)]);
    if (p.fill) out.push({ poly: ring, ink: p.fill !== "page" && p.fill !== "wash", knock: p.fill === "page" });
    if (p.stroke && p.sw) quads(ring, p.sw, true);
  }
  return out;
}
