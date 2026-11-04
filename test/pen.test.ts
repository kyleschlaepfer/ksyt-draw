import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Sketch, ellipsePts, CH, GR, type Pt } from "../src/core/pen";

// Mirrors fixtures/generate.py CASES one for one (fixtures/pen/_index.json has the Python source lines).
const CASES: Record<string, (k: Sketch) => unknown> = {
  "pen-straight": (k) => k.pen([[0.5, 0.5], [2.5, 0.6]]),
  "pen-curve-blunt": (k) => k.pen([[0.5, 1.0], [1.2, 0.6], [2.0, 1.1], [2.6, 0.7]], { taperIn: 0, taperOut: 0 }),
  "pen-pieces": (k) => k.pen(ellipsePts(1.5, 1.0, 0.8, 0.4, { start: 180, sweep: 395, n: 10, seed: 7 }), { pieces: 2 }),
  arrow: (k) => k.arrow([[0.4, 1.0], [1.5, 0.85], [2.6, 1.0]], { head: 0.17 }),
  "loose-rect": (k) => k.looseRect(0.5, 0.5, 2.5, 1.3),
  "rounded-rect": (k) => k.roundedRect(0.5, 0.5, 2.7, 1.2, { r: 0.18, step: 0.16 }),
  pill: (k) => k.roundedRect(0.5, 0.5, 2.3, 1.1, { r: 0.29, step: 0.14 }),
  "loose-circle": (k) => k.looseCircle(1.5, 1.0, 1.0, 0.36, { color: CH, width: 0.028 }),
  dot: (k) => k.dot(1.0, 1.0, 0.13),
  "blob-bar": (k) => k.blob([[0.3, 0.96], [1.5, 0.95], [2.7, 0.96], [2.706, 1.0], [2.7, 1.04], [1.5, 1.045], [0.3, 1.04], [0.295, 1.0]]),
  "dashed-loop": (k) => k.dashedLoop([[0.4, 0.4], [2.0, 0.35], [3.6, 0.45], [3.65, 1.5], [2.0, 1.6], [0.35, 1.5]], { color: GR }),
  underline: (k) => k.underline(0.5, 2.0, 1.0),
  check: (k) => k.check(1.0, 1.0),
  xmark: (k) => k.xmark(1.0, 1.0),
  wash: (k) => k.wash(0.5, 0.6, 2.5, 1.2),
  knockout: (k) => k.knockout([[0.5, 0.5], [2.5, 0.5], [2.5, 1.3], [0.5, 1.3]]),
  hatch: (k) => k.hatch([[0.5, 0.5], [1.6, 0.5], [1.6, 1.2], [0.5, 1.2]]),
  "seeded-by-name": (k) => k.looseCircle(1.5, 1.0, 0.9, 0.34, { color: CH, width: 0.028 }),
};

const FIX = new URL("../fixtures/pen/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("_index.json", FIX), "utf8"));

describe("pen.ts reproduces pen.py", () => {
  it("covers every fixture", () => expect(Object.keys(CASES).sort()).toEqual(index.cases.map((c: any) => c.case).sort()));
  for (const c of index.cases) {
    it(c.case, () => {
      const g = JSON.parse(readFileSync(new URL(c.case + ".json", FIX), "utf8"));
      const k = new Sketch(g.sketch_seed);
      CASES[c.case](k);
      expect(k.ops).toEqual(g.ops);
      expect(k.items.length).toBe(g.items.length);
      let worst = 0;
      k.items.forEach(([poly, color], i) => {
        expect(color).toBe(g.items[i].color);
        expect(poly.length).toBe(g.items[i].poly.length);
        poly.forEach((p: Pt, j: number) => {
          worst = Math.max(worst, Math.abs(p[0] - g.items[i].poly[j][0]), Math.abs(p[1] - g.items[i].poly[j][1]));
        });
      });
      expect(worst).toBeLessThan(1e-9);
    });
  }
});
