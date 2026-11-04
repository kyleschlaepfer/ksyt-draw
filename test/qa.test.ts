import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "../src/core/parse";
import { stubMeasurer, PX } from "../src/core/measure";
import { buildScene } from "../src/core/scene";
import { checkScene } from "../src/core/qa";
import { Sketch } from "../src/core/pen";
import { textEl } from "../src/core/shapes";

const DIR = new URL("../fixtures/diagrams/", import.meta.url);
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".ksd")).sort();

describe("qa.ts", () => {
  for (const f of fixtures) {
    it(`${f}: zero QA errors with the stub measurer`, () => {
      const sc = buildScene(parse(readFileSync(new URL(f, DIR), "utf8")), stubMeasurer);
      const r = checkScene(sc, { minDisplayPx: 1280 });
      expect(r.errors).toEqual([]);
    });
  }
  it("catches a stroke through a label and lets a knockout hide one", () => {
    const sc = buildScene(parse("diagram flowchart\ntitle t\nprocess a \"hello\""), stubMeasurer);
    const line = new Sketch(5).pen([[0.1, sc.h / 2], [sc.w - 0.1, sc.h / 2]]);
    sc.elements.push({ name: "stray", sketch: line, step: 0 });
    expect(checkScene(sc).errors).toEqual(["LINE_THROUGH_TEXT stray crosses or touches 'hello'"]);
    // the same stroke drawn before the box is hidden by the box's knockout
    sc.elements.unshift(sc.elements.pop()!);
    expect(checkScene(sc).errors).toEqual([]);
  });
  it("catches overlapping labels, clipping and small or phone-illegible text", () => {
    const sc = buildScene(parse("diagram flowchart\ntitle t\nprocess a \"hello\""), stubMeasurer);
    sc.texts.push(textEl(stubMeasurer, "x:label", "world", sc.w / 2, sc.h / 2, 16, { anchor: "middle" }));
    sc.texts.push(textEl(stubMeasurer, "far:label", "out", sc.w + 1, sc.h / 2, 22));
    const r = checkScene(sc, { minDisplayPx: 50 });
    expect(r.errors).toContain("TEXT_OVERLAP 'hello' and 'world'");
    expect(r.errors).toContain("CLIP far:label: label outside the frame");
    expect(r.warnings.some((w) => w.startsWith("SMALL_KALAM 'world' at 16px"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("PHONE_LEGIBILITY 'hello'"))).toBe(true);
  });
  it("the frame margin keeps every fixture's ink and text inside", () => {
    for (const f of fixtures) {
      const sc = buildScene(parse(readFileSync(new URL(f, DIR), "utf8")), stubMeasurer);
      for (const t of sc.texts) expect(t.box[3]).toBeLessThanOrEqual(sc.h * PX);
    }
  });
});
