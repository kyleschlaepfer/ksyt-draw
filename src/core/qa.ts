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

function rasterize(mask: Uint8Array, zone: Zone, poly: Poly, k: number, value: 0 | 1): void {
  const [zx0, zy0, zx1, zy1] = zone;
  const zw = zx1 - zx0;
  const n = poly.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let py0 = Infinity, py1 = -Infinity, px0 = Infinity, px1 = -Infinity;
  for (let i = 0; i < n; i++) {
    xs[i] = poly[i][0] * k;
    ys[i] = poly[i][1] * k;
    if (ys[i] < py0) py0 = ys[i];
    if (ys[i] > py1) py1 = ys[i];
    if (xs[i] < px0) px0 = xs[i];
    if (xs[i] > px1) px1 = xs[i];
  }
  if (px1 < zx0 || px0 > zx1 || py1 < zy0 || py0 > zy1) return;
  const rowFrom = Math.max(zy0, Math.floor(py0)), rowTo = Math.min(zy1 - 1, Math.ceil(py1));
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
  const inkOf: Poly[][] = polys.map((ps) => ps.filter((p) => p.ink).map((p) => p.poly));
  const koOf: Poly[][] = polys.map((ps) => ps.filter((p) => p.knock).map((p) => p.poly));

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
    for (let i = 0; i < sc.elements.length; i++) {
      const name = sc.elements[i].name;
      if (name === owner || allowed(name, t.name) || allowed(name, owner)) continue;
      if (!inkOf[i].length) continue;
      mask.fill(0);
      for (const p of inkOf[i]) rasterize(mask, zone, p, k, 1);
      for (let j = i + 1; j < sc.elements.length; j++) for (const p of koOf[j]) rasterize(mask, zone, p, k, 0);
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
