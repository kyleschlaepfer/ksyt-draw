import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "../src/core/parse";
import { serialize, quote, num } from "../src/core/serialize";

const DIR = new URL("../fixtures/diagrams/", import.meta.url);
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".ksd")).sort();

describe("serialize.ts", () => {
  for (const f of fixtures) {
    it(`${f} round-trips`, () => {
      const d = parse(readFileSync(new URL(f, DIR), "utf8"));
      expect(parse(serialize(d))).toEqual(d);
    });
  }
  it("keeps steps, boundaries, options, escapes and the dashed and plain operators", () => {
    const src = 'diagram use-case\nid x\ntitle t\nprofile strict-uml\ndesc d\nnarration n\nlegend l\nactor a "Say \\"hi\\"\\nnow" right at 1.5 -2\nboundary b "Box" {\nstep 2\nuse-case u\n}\nnote k "aside" at 0 0.333\nstep 0\na -- u : goes\nu ..> k\nu -> k\nu --> k';
    const d = parse(src);
    const text = serialize(d);
    expect(parse(text)).toEqual(d);
    expect(text).toContain('actor a "Say \\"hi\\"\\nnow" right at 1.5 -2');
    expect(text).toContain("note k \"aside\" at 0 0.333");
    expect(text).toContain("u ..> k");
    expect(text).toContain("a -- u : goes");
    expect(text).toContain("profile strict-uml");
  });
  it("writes start and end back as keywords", () => {
    const flow = serialize(parse("diagram flowchart\ntitle t\nstart s\nend e\nterminator t \"halt\"\ns -> e"));
    expect(flow).toContain("start s\nend e\nterminator t \"halt\"");
    const act = serialize(parse("diagram activity\ntitle t\nstart s\nend e\nflow-final f"));
    expect(act).toContain("start s\nend e\nflow-final f");
  });
  it("helpers", () => {
    expect(quote('a "b"\nc\\d')).toBe('"a \\"b\\"\\nc\\\\d"');
    expect(num(1.0004)).toBe("1");
    expect(num(-0.0)).toBe("0");
    expect(num(2.5)).toBe("2.5");
  });
});
