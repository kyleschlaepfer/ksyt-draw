/**
 * Port of whiteboard-lecture-slides' pen.py (reference/pen.py): pen strokes as pure geometry.
 *
 * Same algorithm, same random draws in the same order, so a Sketch built here produces the same
 * polygons as the slide engine (within float noise; test/pen.test.ts checks every fixture to 1e-9 in).
 * Units are inches; the SVG layer multiplies by 96. Colors are hex without "#", like pen.py, and map
 * to theme roles in svg.ts.
 *
 * Keep it a port: if pen.py changes, change this to match and regenerate the fixtures. Don't "improve"
 * the math here, or the web and the videos drift apart.
 */
import { PyRandom, pyRound } from "./pyrandom";

export type Pt = [number, number];
export type Poly = Pt[];

export const CH = "242B27"; // charcoal pen (role: ink)
export const GR = "69736C"; // graphite (role: ink-2)
export const GREEN = "256B4A"; // accent
export const DKG = "184C36"; // accent-strong
export const WASH = "DCEBDF"; // wash
export const TERRA = "C77859"; // terra
export const BG = "FAFAF6"; // page (knockouts)
export const PEN = 0.032;

const hypot = Math.hypot;
const rad = (d: number) => (d * Math.PI) / 180;

// ---------------- geometry helpers ----------------
export function catmull(points: Pt[], step = 0.018): Pt[] {
  if (points.length < 3) {
    const [x0, y0] = points[0];
    const [x1, y1] = points[points.length - 1];
    const n = Math.max(2, Math.trunc(hypot(x1 - x0, y1 - y0) / step));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    return out;
  }
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: Pt[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    const n = Math.max(3, Math.trunc(hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t, t3 = t * t * t;
      const v = (j: 0 | 1) =>
        0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
          (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([v(0), v(1)]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Scale, rotate (degrees, clockwise on screen) then translate. */
export function xf(points: Pt[], dx = 0, dy = 0, s = 1, ang = 0): Pt[] {
  const a = rad(ang), c = Math.cos(a), sn = Math.sin(a);
  return points.map(([x, y]) => [dx + s * (x * c - y * sn), dy + s * (x * sn + y * c)] as Pt);
}

export function rigid(points: Pt[], pivot: Pt, dx: number, dy: number, rot: number): Pt[] {
  const a = rad(rot), c = Math.cos(a), s = Math.sin(a);
  const [px, py] = pivot;
  return points.map(([x, y]) => [px + (x - px) * c - (y - py) * s + dx, py + (x - px) * s + (y - py) * c + dy] as Pt);
}

export function ellipsePts(cx: number, cy: number, rx: number, ry: number,
  o: { start?: number; sweep?: number; n?: number; wobble?: number; seed?: number; rot?: number } = {}): Pt[] {
  const { start = 0, sweep = 380, n = 9, wobble = 0.05, seed = 0, rot = 0 } = o;
  const rng = new PyRandom(seed);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(start + (sweep * i) / n);
    const r = 1 + rng.uniform(-wobble, wobble);
    pts.push([rx * r * Math.cos(a), ry * r * Math.sin(a)]);
  }
  return xf(pts, cx, cy, 1, rot);
}

export function polyInside(pt: Pt, poly: Poly): boolean {
  const [x, y] = pt;
  let inside = false;
  let j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

export function bbox(polys: Poly[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// ---------------- stroke outline ----------------
function profile(seed: number, base: number, taperIn: number | null, taperOut: number | null) {
  const rng = new PyRandom(seed);
  // Draw order matters (Python only draws when the taper is None).
  const tin = taperIn !== null ? taperIn : rng.uniform(0.05, 0.14);
  const tout = taperOut !== null ? taperOut : rng.uniform(0.08, 0.22);
  const s0 = rng.uniform(0.35, 0.6), s1 = rng.uniform(0.25, 0.5);
  const f = rng.uniform(0.8, 2.2), amp = rng.uniform(0.03, 0.09), ph = rng.uniform(0, 6.28);
  const sm = (u: number) => {
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u);
  };
  return (t: number) => {
    let r = 1;
    if (tin > 0 && t < tin) r = s0 + (1 - s0) * sm(t / tin);
    else if (tout > 0 && t > 1 - tout) r = s1 + (1 - s1) * sm((1 - t) / tout);
    return base * r * (1 + amp * Math.sin(2 * Math.PI * f * t + ph));
  };
}

function cap(c: Pt, angFrom: number, w: number, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const a = angFrom - (Math.PI * i) / n;
    out.push([c[0] + (w / 2) * Math.cos(a), c[1] + (w / 2) * Math.sin(a)]);
  }
  return out;
}

export interface StrokeOpts {
  width?: number;
  seed?: number;
  taperIn?: number | null;
  taperOut?: number | null;
  pieces?: number;
  smooth?: boolean;
}

/** Closed outline polygon(s) for one pen stroke (pen.stroke_polys). */
export function strokePolys(ctrl: Pt[], o: StrokeOpts = {}): Poly[] {
  const { width = PEN, seed = 1, taperIn = null, taperOut = null, pieces = 1, smooth = true } = o;
  const c = smooth ? catmull(ctrl) : [...ctrl];
  const L = [0];
  for (let i = 1; i < c.length; i++) L.push(L[i - 1] + hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
  const tot = L[L.length - 1] || 1;
  const wf = profile(seed, width, taperIn, taperOut);
  const left: Pt[] = [], right: Pt[] = [], ws: number[] = [], nang: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const d = hypot(tx, ty) || 1;
    const nx = -ty / d, ny = tx / d;
    const w = wf(L[i] / tot);
    ws.push(w);
    nang.push(Math.atan2(ny, nx));
    left.push([p[0] + (nx * w) / 2, p[1] + (ny * w) / 2]);
    right.push([p[0] - (nx * w) / 2, p[1] - (ny * w) / 2]);
  }
  const n = c.length;
  const cuts: number[] = [];
  for (let k = 0; k <= pieces; k++) cuts.push(pyRound((k * (n - 1)) / pieces));
  const polys: Poly[] = [];
  for (let k = 0; k < pieces; k++) {
    const i0 = cuts[k];
    const i1 = Math.min(n - 1, cuts[k + 1] + (k < pieces - 1 ? 2 : 0));
    polys.push([
      ...left.slice(i0, i1 + 1),
      ...cap(c[i1], nang[i1], ws[i1]),
      ...right.slice(i0, i1 + 1).reverse(),
      ...cap(c[i0], nang[i0] + Math.PI, ws[i0]),
    ]);
  }
  return polys;
}

// ---------------- Sketch ----------------
export interface PenOpts {
  color?: string;
  width?: number;
  seed?: number | null;
  taperIn?: number | null;
  taperOut?: number | null;
  pieces?: number;
}

/** A drawing made of pen strokes. One Sketch = one named element. */
export class Sketch {
  items: Array<[Poly, string]> = [];
  ops: string[] = [];
  tip?: Pt;
  private depth = 0;

  constructor(private seedCounter = 100, public kind: string | null = null) {}

  /** Record the outermost vocabulary call, like pen.py's @_op decorator. Never changes geometry. */
  private op<T>(kind: string, f: () => T): T {
    const top = this.depth === 0;
    this.depth++;
    try {
      return f();
    } finally {
      this.depth--;
      if (top) this.ops.push(kind);
    }
  }

  private next(seed: number | null | undefined): number {
    if (seed !== null && seed !== undefined) return seed;
    this.seedCounter += 1;
    return this.seedCounter;
  }

  /** The current counter (pen.py's self._seed), needed by roundedRect's default. */
  get seedValue(): number {
    return this.seedCounter;
  }

  fill(poly: Poly, color = CH): this {
    return this.op("fill", () => {
      this.items.push([[...poly], color]);
      return this;
    });
  }

  /** Page-colored fill that hides strokes registered earlier (call before the outline). */
  knockout(poly: Poly): this {
    return this.op("knockout", () => this.fill(poly, BG));
  }

  pen(ctrl: Pt[], o: PenOpts = {}): this {
    return this.op("stroke", () => {
      const { color = CH, width = PEN, seed = null, taperIn = null, taperOut = null, pieces = 1 } = o;
      for (const poly of strokePolys(ctrl, { width, seed: this.next(seed), taperIn, taperOut, pieces })) this.fill(poly, color);
      return this;
    });
  }

  merge(other: Sketch): this {
    this.items.push(...other.items);
    this.ops.push(...other.ops);
    return this;
  }

  bbox() {
    return bbox(this.items.map(([p]) => p));
  }

  center(): Pt {
    const [x0, y0, x1, y1] = this.bbox();
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  transformed(dx = 0, dy = 0, rot = 0, pivot?: Pt): Sketch {
    const out = new Sketch(this.seedCounter, this.kind);
    out.ops = [...this.ops];
    const pv = pivot ?? this.center();
    out.items = this.items.map(([p, c]) => [rigid(p, pv, dx, dy, rot), c]);
    return out;
  }

  // ---- vocabulary ----
  /** Shaft plus a two-flick arrowhead. */
  arrow(ctrl: Pt[], o: { color?: string; width?: number; seed?: number | null; head?: number; spread?: number } = {}): this {
    return this.op("arrow", () => {
      const { color = CH, width = 0.03, seed = null, head = 0.2, spread = 27 } = o;
      const sd = this.next(seed);
      const rng = new PyRandom(sd * 7 + 3);
      this.pen(ctrl, { color, width, seed: sd });
      const c = catmull(ctrl);
      const tip = c[c.length - 1];
      const back = c[Math.max(0, c.length - 6)];
      const ang = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
      const sides: Array<[number, number]> = [[0, 1], [1, -1]];
      for (const [side, sgn] of sides) {
        const a = ang + Math.PI + sgn * rad(spread + rng.uniform(-5, 5));
        const ln = head * rng.uniform(0.85, 1.1);
        const end: Pt = [tip[0] + ln * Math.cos(a), tip[1] + ln * Math.sin(a)];
        const mid: Pt = [(tip[0] + end[0]) / 2 + rng.uniform(-0.01, 0.01), (tip[1] + end[1]) / 2 + rng.uniform(-0.01, 0.01)];
        const t2: Pt = [tip[0] + rng.uniform(-0.01, 0.01), tip[1] + rng.uniform(-0.01, 0.01)];
        this.pen([end, mid, t2], { color, width: width * 0.95, seed: sd + 11 + side, taperIn: 0.25, taperOut: 0.05 });
      }
      return this;
    });
  }

  underline(x0: number, x1: number, y: number, o: { color?: string; width?: number; seed?: number | null; rise?: number } = {}): this {
    return this.op("underline", () => {
      const { color = GREEN, width = 0.045, seed = null, rise = 0.08 } = o;
      return this.pen([[x0 - 0.02, y], [(x0 + x1) / 2, y - rise * 0.4], [x1 + 0.1, y - rise]],
        { color, width, seed, taperIn: 0.08, taperOut: 0.3 });
    });
  }

  check(x: number, y: number, o: { s?: number; color?: string; width?: number; seed?: number | null } = {}): this {
    return this.op("check", () => {
      const { s = 1, color = GREEN, width = 0.036, seed = null } = o;
      return this.pen([[x - 0.15 * s, y - 0.13 * s], [x - 0.05 * s, y], [x + 0.18 * s, y - 0.34 * s]], { color, width, seed });
    });
  }

  xmark(x: number, y: number, o: { s?: number; color?: string; width?: number; seed?: number | null } = {}): this {
    return this.op("xmark", () => {
      const { s = 1, color = CH, width = 0.032, seed = null } = o;
      this.pen([[x - 0.13 * s, y - 0.12 * s], [x + 0.02 * s, y + 0.01 * s], [x + 0.13 * s, y + 0.13 * s]], { color, width, seed });
      return this.pen([[x + 0.12 * s, y - 0.13 * s], [x - 0.01 * s, y], [x - 0.13 * s, y + 0.14 * s]], { color, width });
    });
  }

  strike(x0: number, x1: number, y: number, o: { color?: string; width?: number; seed?: number | null } = {}): this {
    return this.op("strike", () => {
      const { color = CH, width = 0.034, seed = null } = o;
      return this.pen([[x0 - 0.08, y + 0.03], [(x0 + x1) / 2, y - 0.02], [x1 + 0.1, y - 0.05]], { color, width, seed });
    });
  }

  brace(x0: number, x1: number, y: number, o: { depth?: number; color?: string; width?: number; seed?: number | null; up?: boolean } = {}): this {
    return this.op("brace", () => {
      const { depth = 0.2, color = GR, width = 0.026, seed = null, up = false } = o;
      const sgn = up ? -1 : 1;
      const m = (x0 + x1) / 2;
      this.pen([[x0, y - sgn * 0.0], [x0 + 0.07, y + sgn * depth * 0.55], [m - 0.08, y + sgn * depth * 0.6], [m, y + sgn * depth],
        [m + 0.08, y + sgn * depth * 0.6], [x1 - 0.07, y + sgn * depth * 0.55], [x1, y]], { color, width, seed });
      this.tip = [m, y + sgn * depth];
      return this;
    });
  }

  /** Box from four separate strokes with small corner overshoots. */
  looseRect(x0: number, y0: number, x1: number, y1: number, o: { color?: string; width?: number; seed?: number | null } = {}): this {
    return this.op("box", () => {
      const { color = CH, width = PEN, seed = null } = o;
      const sd = this.next(seed);
      const rng = new PyRandom(sd);
      const j = () => rng.uniform(-0.015, 0.015);
      const ov = () => rng.uniform(0.03, 0.08);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      // Each point is built left to right, x then y, exactly as Python evaluates the tuples.
      let a: Pt = [x0 - ov(), y0 + j()], b: Pt = [mx, y0 + j()], c: Pt = [x1 + ov(), y0 + j()];
      this.pen([a, b, c], { color, width, seed: sd + 1 });
      a = [x0 - ov(), y1 + j()]; b = [mx, y1 + j()]; c = [x1 + ov(), y1 + j()];
      this.pen([a, b, c], { color, width, seed: sd + 2 });
      a = [x0 + j(), y0 - ov()]; b = [x0 + j(), my]; c = [x0 + j(), y1 + ov()];
      this.pen([a, b, c], { color, width, seed: sd + 3 });
      a = [x1 + j(), y0 - ov()]; b = [x1 + j(), my]; c = [x1 + j(), y1 + ov()];
      this.pen([a, b, c], { color, width, seed: sd + 4 });
      return this;
    });
  }

  /** Rounded rectangle as one loop (actions, pills). */
  roundedRect(x0: number, y0: number, x1: number, y1: number,
    o: { r?: number; color?: string; width?: number; seed?: number | null; step?: number; bow?: number } = {}): this {
    return this.op("box", () => {
      const { r = 0.35, color = CH, width = PEN, seed = null, step = 0.22, bow = 0.03 } = o;
      const rnd = new PyRandom(seed !== null && seed !== undefined ? seed : this.seedCounter + 3);
      const corners: Array<[number, number, number]> = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
      const pts: Pt[] = [];
      for (let ci = 0; ci < 4; ci++) {
        const [cx, cy, a0] = corners[ci];
        for (let j = 0; j < 4; j++) {
          const a = rad(a0 + j * 30);
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        const [nx, ny, na] = corners[(ci + 1) % 4];
        const ex = cx + r * Math.cos(rad(a0 + 90)), ey = cy + r * Math.sin(rad(a0 + 90));
        const sx = nx + r * Math.cos(rad(na)), sy = ny + r * Math.sin(rad(na));
        const n = Math.max(1, Math.trunc(hypot(sx - ex, sy - ey) / step));
        const b = rnd.uniform(-bow, bow);
        for (let j = 1; j < n; j++) {
          const t = j / n;
          let px = ex + (sx - ex) * t, py = ey + (sy - ey) * t;
          const off = b * Math.sin(Math.PI * t);
          if (ci % 2 === 0) px += off;
          else py += off;
          pts.push([px, py]);
        }
      }
      pts.push(pts[0], pts[1]);
      return this.pen(pts, { color, width, seed, pieces: 2 });
    });
  }

  /** Ring around something; overshoots its start. Also the use-case ellipse. */
  looseCircle(cx: number, cy: number, rx: number, ry: number, o: { color?: string; width?: number; seed?: number | null } = {}): this {
    return this.op("ring", () => {
      const { color = GREEN, width = 0.035, seed = null } = o;
      const sd = this.next(seed);
      const start = new PyRandom(sd).uniform(150, 230);
      return this.pen(ellipsePts(cx, cy, rx, ry, { start, sweep: 395, n: 10, seed: sd }), { color, width, seed: sd, pieces: 2 });
    });
  }

  dimension(x0: number, x1: number, y: number, o: { color?: string; width?: number; seed?: number | null; tick?: number } = {}): this {
    return this.op("dimension", () => {
      const { color = GR, width = 0.022, seed = null, tick = 0.09 } = o;
      const sd = this.next(seed);
      this.pen([[x0, y + 0.01], [(x0 + x1) / 2, y - 0.01], [x1, y + 0.005]], { color, width, seed: sd });
      this.pen([[x0 + 0.005, y - tick], [x0, y + tick]], { color, width, seed: sd + 1 });
      this.pen([[x1, y - tick], [x1 + 0.005, y + tick]], { color, width, seed: sd + 2 });
      return this;
    });
  }

  /** Hand hatching clipped to a polygon region. */
  hatch(region: Poly, o: { color?: string; spacing?: number; angle?: number; width?: number; seed?: number | null; inset?: number } = {}): this {
    return this.op("hatch", () => {
      const { color = GR, spacing = 0.12, angle = 58, width = 0.017, seed = null, inset = 0.03 } = o;
      const sd = this.next(seed);
      const rng = new PyRandom(sd);
      const xs = region.map((p) => p[0]), ys = region.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const R = hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const a = rad(angle);
      const d: Pt = [Math.cos(a), Math.sin(a)];
      const nrm: Pt = [-d[1], d[0]];
      let k = -R, i = 0;
      while (k <= R) {
        const segs: Pt[][] = [];
        let cur: Pt[] = [];
        for (let s = 0; s < 401; s++) {
          const t = -R + (2 * R * s) / 400;
          const p: Pt = [cx + nrm[0] * k + d[0] * t, cy + nrm[1] * k + d[1] * t];
          if (polyInside(p, region)) cur.push(p);
          else if (cur.length) {
            segs.push(cur);
            cur = [];
          }
        }
        if (cur.length) segs.push(cur);
        for (const sg of segs) {
          if (sg.length < 4) continue;
          const p0 = sg[0], p1 = sg[sg.length - 1];
          if (hypot(p1[0] - p0[0], p1[1] - p0[1]) < 2.5 * inset) continue;
          const s0 = inset + rng.uniform(-0.01, 0.03), s1 = inset + rng.uniform(-0.01, 0.03);
          const j0 = rng.uniform(-0.012, 0.012), j1 = rng.uniform(-0.012, 0.012);
          let q0: Pt = [p0[0] + d[0] * s0 + nrm[0] * j0, p0[1] + d[1] * s0 + nrm[1] * j0];
          let q1: Pt = [p1[0] - d[0] * s1 + nrm[0] * j1, p1[1] - d[1] * s1 + nrm[1] * j1];
          if (!(polyInside(q0, region) && polyInside(q1, region))) {
            q0 = [p0[0] + d[0] * s0, p0[1] + d[1] * s0];
            q1 = [p1[0] - d[0] * s1, p1[1] - d[1] * s1];
          }
          this.pen([q0, q1], { color, width, seed: sd + 1000 + i, taperIn: 0.1, taperOut: 0.25 });
          i += 1;
        }
        k += spacing * rng.uniform(0.88, 1.12);
      }
      return this;
    });
  }

  /** Uneven pen dashes along a lumpy closed loop: a system boundary. */
  dashedLoop(ctrlClosed: Pt[], o: { color?: string; width?: number; seed?: number | null; dash?: [number, number]; gap?: [number, number] } = {}): this {
    return this.op("boundary", () => {
      const { color = GR, width = 0.026, seed = null, dash = [0.11, 0.3], gap = [0.08, 0.16] } = o;
      const sd = this.next(seed);
      const rng = new PyRandom(sd);
      const c = catmull([...ctrlClosed, ...ctrlClosed.slice(0, 3)], 0.01);
      const L = [0];
      for (let i = 1; i < c.length; i++) L.push(L[i - 1] + hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
      const p0 = ctrlClosed[0];
      let lap = L[L.length - 1];
      for (let i = 0; i < c.length; i++) {
        if (L[i] > 1.0 && hypot(c[i][0] - p0[0], c[i][1] - p0[1]) < 0.02) {
          lap = L[i];
          break;
        }
      }
      let s = 0, j = 0, idx = 0;
      while (s < lap - 0.12) {
        const dl = rng.uniform(dash[0], dash[1]);
        while (idx < c.length && L[idx] < s) idx++;
        const seg: Pt[] = [];
        let k = idx;
        while (k < c.length && L[k] <= Math.min(s + dl, lap - 0.05)) {
          seg.push(c[k]);
          k++;
        }
        if (seg.length >= 3) {
          const pts = seg.length > 6 ? seg.filter((_, q) => q % 2 === 0) : seg;
          this.pen(pts, { color, width, seed: sd + 2000 + j, taperIn: 0.2, taperOut: 0.25 });
        }
        s += dl + rng.uniform(gap[0], gap[1]);
        j++;
      }
      return this;
    });
  }

  /** Highlighter-style fill with slightly uneven edges. */
  wash(x0: number, y0: number, x1: number, y1: number, o: { color?: string; seed?: number | null } = {}): this {
    return this.op("wash", () => {
      const { color = WASH, seed = null } = o;
      const rng = new PyRandom(this.next(seed));
      const top: Pt[] = [];
      for (let i = 0; i < 9; i++) top.push([x0 + ((x1 - x0) * i) / 8, y0 + rng.uniform(0, 0.025)]);
      const bot: Pt[] = [];
      for (let i = 0; i < 9; i++) bot.push([x1 - ((x1 - x0) * i) / 8, y1 - rng.uniform(0, 0.025)]);
      const r: Pt = [x1 - rng.uniform(0, 0.02), (y0 + y1) / 2];
      const l: Pt = [x0 + rng.uniform(0, 0.02), (y0 + y1) / 2];
      return this.fill([...top, r, ...bot, l], color);
    });
  }

  dot(cx: number, cy: number, r: number, o: { color?: string; seed?: number | null } = {}): this {
    return this.op("dot", () => {
      const { color = CH, seed = null } = o;
      const rng = new PyRandom(this.next(seed));
      const pts: Pt[] = [];
      for (let i = 0; i < 14; i++) {
        const x = cx + r * rng.uniform(0.85, 1.1) * Math.cos((2 * Math.PI * i) / 14);
        const y = cy + r * rng.uniform(0.85, 1.1) * Math.sin((2 * Math.PI * i) / 14) * 0.9;
        pts.push([x, y]);
      }
      return this.fill(pts, color);
    });
  }

  /** Small solid shape from a smooth closed outline (fork bars, filled heads). */
  blob(ctrl: Pt[], color = CH): this {
    return this.op("blob", () => this.fill(catmull([...ctrl, ctrl[0]], 0.004), color));
  }
}
