/**
 * Layout QA (spec/rendering.md §8): a port of figure.Figure.check on a raster of the real geometry.
 *
 * The raster is a pure scanline fill (even-odd, pixel centers) at `scale` px per CSS px, so the same
 * check runs in Node tests and in the browser; no canvas is needed. Knockouts of later elements hide
 * the strokes under them, exactly as on the page.
 */
import type { Poly } from "./pen";
import { PX } from "./measure";
import { paintBounds, paintPolys, type Scene } from "./render/scene";

export interface QaReport {
  errors: string[];
  warnings: string[];
}

export interface QaOptions {
  scale?: number;
  /** the narrowest width the figure is shown at, CSS px (PHONE_LEGIBILITY) */
  minDisplayPx?: number;
}

type Zone = [number, number, number, number]; // raster px, [x0, y0, x1, y1)

/** A polygon in raster px with its bounds, worked out once: every label asks about every polygon. */
interface Shape { xs: Float64Array; ys: Float64Array; x0: number; y0: number; x1: number; y1: number }

function shapeOf(poly: Poly, k: number): Shape {
  const n = poly.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < n; i++) {
    xs[i] = poly[i][0] * k;
    ys[i] = poly[i][1] * k;
    if (ys[i] < y0) y0 = ys[i];
    if (ys[i] > y1) y1 = ys[i];
    if (xs[i] < x0) x0 = xs[i];
    if (xs[i] > x1) x1 = xs[i];
  }
  return { xs, ys, x0, y0, x1, y1 };
}

const reaches = (s: Shape, zone: Zone): boolean => !(s.x1 < zone[0] || s.x0 > zone[2] || s.y1 < zone[1] || s.y0 > zone[3]);

function rasterize(mask: Uint8Array, zone: Zone, shape: Shape, value: 0 | 1): void {
  if (!reaches(shape, zone)) return;
  const [zx0, zy0, zx1, zy1] = zone;
  const zw = zx1 - zx0;
  const { xs, ys } = shape;
  const n = xs.length;
  const rowFrom = Math.max(zy0, Math.floor(shape.y0)), rowTo = Math.min(zy1 - 1, Math.ceil(shape.y1));
  const cross: number[] = [];
  for (let y = rowFrom; y <= rowTo; y++) {
    const yc = y + 0.5;
    cross.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ya = ys[i], yb = ys[j];
      if (ya === yb) continue;
      if ((yc >= ya && yc < yb) || (yc >= yb && yc < ya)) cross.push(xs[i] + ((yc - ya) * (xs[j] - xs[i])) / (yb - ya));
    }
    if (cross.length < 2) continue;
    cross.sort((a, b) => a - b);
    const row = (y - zy0) * zw;
    for (let c = 0; c + 1 < cross.length; c += 2) {
      const xa = Math.max(zx0, Math.ceil(cross[c] - 0.5)), xb = Math.min(zx1 - 1, Math.floor(cross[c + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[row + (x - zx0)] = value;
    }
  }
}

const pyRepr = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

export function checkScene(sc: Scene, o: QaOptions = {}): QaReport {
  const scale = o.scale ?? 2;
  const minDisplay = o.minDisplayPx ?? 328;
  const k = PX * scale;
  const W = Math.trunc(sc.w * k), H = Math.trunc(sc.h * k);
  const errors: string[] = [], warnings: string[] = [];
  const allowed = (a: string, b: string) => sc.overlaps.has(a + "|" + b) || sc.overlaps.has(b + "|" + a);

  const EPS = 1e-6;
  for (const el of sc.elements) {
    if (!el.paints.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of el.paints) { const b = paintBounds(p); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    if (x0 < -EPS || y0 < -EPS || x1 > sc.w + EPS || y1 > sc.h + EPS) {
      errors.push(`CLIP ${el.name}: ink outside the frame (${x0.toFixed(2)}, ${y0.toFixed(2)}, ${x1.toFixed(2)}, ${y1.toFixed(2)} in)`);
    }
  }
  const polys = sc.elements.map((el) => el.paints.flatMap(paintPolys));
  const inkOf: Shape[][] = polys.map((ps) => ps.filter((p) => p.ink).map((p) => shapeOf(p.poly, k)));
  const koOf: Shape[][] = polys.map((ps) => ps.filter((p) => p.knock).map((p) => shapeOf(p.poly, k)));

  for (const t of sc.texts) {
    const [bx0, by0, bx1, by1] = t.box;
    if (bx0 < -EPS || by0 < -EPS || bx1 > sc.w * PX + EPS || by1 > sc.h * PX + EPS) errors.push(`CLIP ${t.name}: label outside the frame`);
    const pad = 0.03 * PX + 0.06 * t.size;
    const zone: Zone = [
      Math.max(0, Math.trunc((bx0 - pad) * scale)), Math.max(0, Math.trunc((by0 - pad) * scale)),
      Math.min(W, Math.trunc((bx1 + pad) * scale)), Math.min(H, Math.trunc((by1 + pad) * scale)),
    ];
    const zw = zone[2] - zone[0], zh = zone[3] - zone[1];
    if (zw <= 0 || zh <= 0) continue;
    const owner = t.owner ?? "";
    const mask = new Uint8Array(zw * zh);
    // the knockouts that come anywhere near this label, with the element each belongs to
    const near: Array<[number, Shape]> = [];
    for (let j = 0; j < sc.elements.length; j++) for (const p of koOf[j]) if (reaches(p, zone)) near.push([j, p]);
    for (let i = 0; i < sc.elements.length; i++) {
      const name = sc.elements[i].name;
      if (name === owner || allowed(name, t.name) || allowed(name, owner)) continue;
      const ink = inkOf[i].filter((p) => reaches(p, zone));
      // ink that stays clear of the label's zone can't touch it
      if (!ink.length) continue;
      mask.fill(0);
      for (const p of ink) rasterize(mask, zone, p, 1);
      for (const [j, p] of near) if (j > i) rasterize(mask, zone, p, 0);
      let hits = 0;
      for (let q = 0; q < mask.length; q++) hits += mask[q];
      if (hits > 2 * scale) errors.push(`LINE_THROUGH_TEXT ${name} crosses or touches ${pyRepr(t.s)}`);
    }
    // the floor is for handwriting: the precision look sets its text in Atkinson, which reads well below it
    if (sc.look !== "precision" && t.size < 18) warnings.push(`SMALL_KALAM ${pyRepr(t.s)} at ${t.size}px (floor 18)`);
    const shown = Math.min(1, minDisplay / (sc.w * PX)) * t.size;
    if (shown < 13) {
      warnings.push(`PHONE_LEGIBILITY ${pyRepr(t.s)} renders at ${shown.toFixed(1)}px on a ${minDisplay}px-wide screen; give the figure a ` +
        "narrow variant (stacked layout) or shrink its width");
    }
  }
  for (let i = 0; i < sc.texts.length; i++) {
    const a = sc.texts[i];
    for (let j = i + 1; j < sc.texts.length; j++) {
      const b = sc.texts[j];
      if (allowed(a.name, b.name)) continue;
      if (a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]) {
        errors.push(`TEXT_OVERLAP ${pyRepr(a.s)} and ${pyRepr(b.s)}`);
      }
    }
  }
  return { errors, warnings };
}
