import { describe, expect, it } from "vitest";
import { parseDoc } from "../src/core/doc/parse";
import { stubMeasurer } from "../src/core/measure";
import { resolve } from "../src/core/geom/resolve";
import { buildScene, textEl, type Scene } from "../src/core/render/scene";
import { checkScene } from "../src/core/qa";

const scene = (text: string, look: "sketch" | "precision" = "sketch"): Scene => {
  const d = parseDoc(text);
  return buildScene(d, resolve(d, stubMeasurer), stubMeasurer, { look });
};
const ONE = 'diagram flowchart\ntitle t\nprocess a "hello"';

describe("qa.ts", () => {
  for (const look of ["sketch", "precision"] as const) {
    it(`catches a stroke through a label and lets a later shape's fill hide one (${look})`, () => {
      const sc = scene(ONE, look);
      sc.elements.push({ name: "stray", kind: "edge", step: 0, paints: [{ t: "line", pts: [[0.1, sc.h / 2], [sc.w - 0.1, sc.h / 2]], stroke: "ink", sw: 0.03 }] });
      expect(checkScene(sc).errors).toEqual(["LINE_THROUGH_TEXT stray crosses or touches 'hello'"]);
      // the same stroke drawn before the box is hidden by the box's fill
      sc.elements.unshift(sc.elements.pop()!);
      expect(checkScene(sc).errors).toEqual([]);
    });
  }
  it("a dashed line only counts where it has ink", () => {
    const sc = scene(ONE, "precision");
    const y = sc.h / 2;
    // one short dash at the left edge, then a gap longer than the figure: the label sits in the gap
    sc.elements.push({ name: "dashes", kind: "edge", step: 0, paints: [{ t: "line", pts: [[0.02, y], [sc.w - 0.02, y]], stroke: "ink", sw: 0.02, dash: [0.04, 9] }] });
    expect(checkScene(sc).errors).toEqual([]);
  });
  it("catches overlapping labels, clipping and small or phone-illegible text", () => {
    const sc = scene(ONE);
    const spec = (name: string, s: string, x: number, size: "node" | "small") => textEl(stubMeasurer, { name, s, x, cy: sc.h / 2, w: 0.5, h: 0.2, size, weight: 400, role: "ink", anchor: "middle", step: 0, owner: name.split(":")[0] }, "sketch");
    const small = spec("x:label", "world", sc.w / 2, "small");
    small.size = 16;
    sc.texts.push(small, spec("far:label", "out", sc.w + 1, "node"));
    const r = checkScene(sc, { minDisplayPx: 50 });
    expect(r.errors).toContain("TEXT_OVERLAP 'hello' and 'world'");
    expect(r.errors).toContain("CLIP far:label: label outside the frame");
    expect(r.warnings.some((w) => w.startsWith("SMALL_KALAM 'world' at 16px"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("PHONE_LEGIBILITY 'hello'"))).toBe(true);
    // the handwriting floor is not for the precision look, whose small text is 17.2 px Atkinson by design
    expect(checkScene({ ...sc, look: "precision" }, { minDisplayPx: 50 }).warnings.some((w) => w.startsWith("SMALL_KALAM"))).toBe(false);
  });
  it("ink outside the frame is a clip", () => {
    const sc = scene(ONE);
    sc.elements.push({ name: "out", kind: "node", step: 0, paints: [{ t: "ellipse", cx: sc.w, cy: 0.3, rx: 0.2, ry: 0.2, stroke: "ink", sw: 0.02 }] });
    expect(checkScene(sc).errors.some((e) => e.startsWith("CLIP out: ink outside the frame"))).toBe(true);
  });
  it("a label a hand placed on top of a line is caught", () => {
    const base = "diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b : go\n";
    expect(checkScene(scene(base)).errors).toEqual([]);
    const bad = checkScene(scene(base + "layout {\n  label a -> b 0.5 0 0\n}\n")).errors;
    expect(bad.some((e) => e.startsWith("LINE_THROUGH_TEXT") && e.includes("'go'"))).toBe(true);
  });
});
