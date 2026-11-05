/**
 * Diagram + layout -> Scene (spec/rendering.md §4, §7): every element drawn as a named Sketch,
 * branch labels placed beside their lines, the frame cut tight to the ink, build-up steps tagged.
 */
import type { Diagram } from "./model";
import { maxStep } from "./model";
import { BG, WASH, Sketch, type Poly, type Pt } from "./pen";
import { PX, type Measurer } from "./measure";
import { layoutFlow, type Layout, type Route } from "./layout-flow";
import { layoutUseCase } from "./layout-usecase";
import {
  besideSegment, drawArrow, drawAssociation, drawDashedArrow, drawDependency, drawNode, edgePoint, sketchFor, textEl,
  SMALL_PX, type NodeGeom, type TextEl,
} from "./shapes";
import { describeText } from "./describe";

export interface Element { name: string; sketch: Sketch; step: number }

export interface Scene {
  id: string;
  title: string;
  desc: string;
  /** frame, inches */
  w: number;
  h: number;
  elements: Element[];
  texts: TextEl[];
  nodes: NodeGeom[];
  steps: number;
  direction: "down" | "right";
  /** pairs ("a|b") allowed to touch */
  overlaps: Set<string>;
  /** the translation from layout coordinates to scene coordinates (so `at` = scene - offset) */
  offset: [number, number];
}

export const MARGIN = 0.2;

export interface SceneOptions {
  /** force the flow direction (phone layouts use "down") */
  direction?: "down" | "right";
}

export function buildScene(d: Diagram, m: Measurer, o: SceneOptions = {}): Scene {
  const layout: Layout = d.claimed_diagram_type === "use-case" ? layoutUseCase(d, m) : layoutFlow(d, m, o.direction ?? d.web.direction);
  const id = d.diagram_id;
  const texts: TextEl[] = [];
  const nodeEls: Element[] = [];
  const edgeEls: Element[] = [];
  const boundaryEls: Element[] = [];

  for (const b of layout.boundaries) {
    const { sketch, texts: ts } = drawNode(m, id, b);
    boundaryEls.push({ name: b.id, sketch, step: b.step });
    texts.push(...ts);
  }
  for (const n of layout.nodes.values()) {
    const { sketch, texts: ts } = drawNode(m, id, n);
    nodeEls.push({ name: n.id, sketch, step: n.step });
    texts.push(...ts);
  }

  // obstacles for label placement: node strokes, then each edge as it is drawn, plus all text so far
  const obstaclePolys: Poly[] = [];
  for (const el of nodeEls) for (const [poly, color] of el.sketch.items) if (color !== BG && color !== WASH) obstaclePolys.push(poly);

  for (const r of layout.routes) {
    const e = r.edge;
    const k = sketchFor(id, e.id);
    const stepOf = e.step;
    const label = e.label;
    if (e.kind === "association") {
      const p0 = r.p0 ?? edgePoint(r.from, aimOf(r, "from"), 0);
      const p1 = r.p1 ?? edgePoint(r.to, aimOf(r, "to"), 0);
      drawAssociation(k, p0, p1, r.interior);
      if (label) placeLabel(m, texts, obstaclePolys, k, e.id, label, p0, r.interior[0] ?? p1, r.from, stepOf);
    } else if (e.kind === "include" || e.kind === "extend") {
      const p0 = r.p0 ?? edgePoint(r.from, aimOf(r, "from"), 0);
      const p1 = r.p1 ?? edgePoint(r.to, aimOf(r, "to"), 0);
      texts.push(drawDependency(m, k, e.id, p0, p1, e.kind, stepOf, r.interior));
    } else {
      const p0 = r.p0 ?? edgePoint(r.from, aimOf(r, "from"), 0.06);
      const p1 = r.p1 ?? edgePoint(r.to, aimOf(r, "to"), 0.06);
      const route: Pt[] = [p0, ...r.interior, p1];
      if (e.style === "dashed-arrow") drawDashedArrow(k, route);
      else drawArrow(k, route);
      if (label) placeLabel(m, texts, obstaclePolys, k, e.id, label, p0, route[1], r.from, stepOf);
    }
    for (const [poly, color] of k.items) if (color !== BG && color !== WASH) obstaclePolys.push(poly);
    edgeEls.push({ name: e.id, sketch: k, step: stepOf });
  }

  const elements = [...boundaryEls, ...edgeEls, ...nodeEls];
  // frame: all ink and text boxes, plus the margin, translated to start at (0, 0)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of elements) {
    if (!el.sketch.items.length) continue;
    const [a, b, c, dd] = el.sketch.bbox();
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, dd);
  }
  for (const t of texts) {
    x0 = Math.min(x0, t.box[0] / PX); y0 = Math.min(y0, t.box[1] / PX);
    x1 = Math.max(x1, t.box[2] / PX); y1 = Math.max(y1, t.box[3] / PX);
  }
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const dx = MARGIN - x0, dy = MARGIN - y0;
  const shifted = elements.map((el) => ({ ...el, sketch: el.sketch.transformed(dx, dy, 0, [0, 0]) }));
  for (const t of texts) {
    t.x += dx; t.y += dy;
    t.box = [t.box[0] + dx * PX, t.box[1] + dy * PX, t.box[2] + dx * PX, t.box[3] + dy * PX];
  }
  const nodes = [...layout.boundaries, ...layout.nodes.values()].map((n) => ({ ...n, cx: n.cx + dx, cy: n.cy + dy }));
  return {
    id, title: d.web.title, desc: describeText(d), w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN,
    elements: shifted, texts, nodes, steps: maxStep(d), direction: layout.direction, overlaps: new Set(), offset: [dx, dy],
  };
}

function aimOf(r: Route, end: "from" | "to"): Pt {
  if (end === "from") return r.interior[0] ?? r.p1 ?? [r.to.cx, r.to.cy];
  return r.interior[r.interior.length - 1] ?? r.p0 ?? [r.from.cx, r.from.cy];
}

/** Branch label beside the first segment: farther side from the source node, flipped or slid if it collides. */
function placeLabel(m: Measurer, texts: TextEl[], obstacles: Poly[], own: Sketch, edgeId: string, label: string,
  p0: Pt, p1: Pt, from: NodeGeom, step: number): void {
  const { adv, top, bot } = m.measure(label, SMALL_PX, 400);
  const w = adv / PX, h = (bot - top) / PX;
  const pad = 0.03 + (0.06 * SMALL_PX) / PX;
  const dist = (c: Pt) => Math.hypot(c[0] - from.cx, c[1] - from.cy);
  const cPlus = besideSegment(p0, p1, w, h, 1), cMinus = besideSegment(p0, p1, w, h, -1);
  const preferred: 1 | -1 = dist(cMinus) > dist(cPlus) + 1e-9 ? -1 : 1;
  const polys = [...obstacles, ...own.items.filter(([, c]) => c !== BG && c !== WASH).map(([p]) => p)];
  const tryAt = (side: 1 | -1, along: number): Pt | null => {
    const c = besideSegment(p0, p1, w, h, side, along);
    const rect: [number, number, number, number] = [c[0] - w / 2 - pad, c[1] - h / 2 - pad, c[0] + w / 2 + pad, c[1] + h / 2 + pad];
    if (polys.some((p) => rectHitsPoly(rect, p))) return null;
    if (texts.some((t) => rectsOverlap(rect, [t.box[0] / PX, t.box[1] / PX, t.box[2] / PX, t.box[3] / PX]))) return null;
    return c;
  };
  const flipped: 1 | -1 = preferred === 1 ? -1 : 1;
  // spec order first (preferred, flipped, 60%); then further along the segment before giving up
  let c: Pt | null = null;
  for (const along of [0.5, 0.6, 0.35, 0.25, 0.75]) {
    c = tryAt(preferred, along) ?? tryAt(flipped, along);
    if (c) break;
  }
  c = c ?? besideSegment(p0, p1, w, h, preferred);
  texts.push(textEl(m, edgeId + ":label", label, c[0], c[1] + h / 2 - bot / PX, SMALL_PX, { role: "ink-2", anchor: "middle", step }));
}

export function rectsOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Does a polygon's outline (sampled every 0.02 in) enter the rectangle? */
export function rectHitsPoly(rect: [number, number, number, number], poly: Poly, stepIn = 0.02): boolean {
  let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
  for (const [x, y] of poly) { px0 = Math.min(px0, x); py0 = Math.min(py0, y); px1 = Math.max(px1, x); py1 = Math.max(py1, y); }
  if (!rectsOverlap(rect, [px0, py0, px1, py1])) return false;
  const inside = (x: number, y: number) => x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a[0], a[1])) return true;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(L / stepIn);
    for (let j = 1; j < n; j++) {
      const t = j / n;
      if (inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true;
    }
  }
  return false;
}
