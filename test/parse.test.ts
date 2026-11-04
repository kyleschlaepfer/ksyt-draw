import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse, ParseError } from "../src/core/parse";

const DIR = new URL("../fixtures/diagrams/", import.meta.url);
const ksdFiles = readdirSync(DIR).filter((f) => f.endsWith(".ksd")).sort();

describe("parse.ts reproduces ksd_parse.py", () => {
  it("has the nine fixtures", () => expect(ksdFiles.length).toBe(9));
  for (const f of ksdFiles) {
    it(f, () => {
      const src = readFileSync(new URL(f, DIR), "utf8");
      const want = JSON.parse(readFileSync(new URL(f.replace(/\.ksd$/, ".json"), DIR), "utf8"));
      expect(parse(src)).toEqual(want);
    });
  }
});

describe("parse errors", () => {
  const cases: Array<{ source: string; line: number; message: string }> =
    JSON.parse(readFileSync(new URL("../fixtures/parse-errors.json", import.meta.url), "utf8"));
  it("has eleven cases", () => expect(cases.length).toBe(11));
  for (const c of cases) {
    it(c.message, () => {
      let err: unknown = null;
      try {
        parse(c.source);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParseError);
      const pe = err as ParseError;
      expect(pe.line).toBe(c.line);
      expect(pe.msg).toBe(c.message);
      expect(pe.message).toBe(`line ${c.line}: ${c.message}`);
    });
  }
  it("rejects a diagram with nothing in it", () => {
    expect(() => parse("")).toThrow(/empty diagram/);
    expect(() => parse("# only a comment\n\n")).toThrow(/empty diagram/);
  });
  it("rejects a second diagram line, bad profile, bad direction, bad step, stray option", () => {
    expect(() => parse("diagram flowchart\ndiagram activity\ntitle t")).toThrow(/line 2: diagram declared twice/);
    expect(() => parse("diagram flowchart\nprofile loose\ntitle t")).toThrow(/line 2: unknown profile 'loose'/);
    expect(() => parse("diagram flowchart\ndirection up\ntitle t")).toThrow(/line 2: direction is down or right/);
    expect(() => parse("diagram flowchart\ntitle t\nstep two")).toThrow(/line 3: step takes a whole number/);
    expect(() => parse("diagram flowchart\ntitle t\nprocess a top")).toThrow(/line 3: unknown option 'top'/);
    expect(() => parse("diagram flowchart\nid not a slug\ntitle t")).toThrow(/line 2: id must be a slug/);
    expect(() => parse("diagram flowchart\ntitle t\n??? what")).toThrow(/line 3: can't read this line/);
  });
});

describe("parse details", () => {
  it("unquotes labels and keeps step, side, at, inside", () => {
    const d = parse(
      'diagram use-case\ntitle t\nactor a "Say \\"hi\\"\\nnow" right at 1.5 -2\nboundary b "Box" {\nstep 2\nuse-case u\n}\na -- u : goes',
    );
    expect(d.nodes[0]).toEqual({ id: "a", kind: "actor", label: 'Say "hi"\nnow', step: 0, side: "right", at: [1.5, -2] });
    expect(d.nodes[1]).toEqual({ id: "b", kind: "boundary", label: "Box", step: 0 });
    expect(d.nodes[2]).toEqual({ id: "u", kind: "use-case", label: "u", step: 2, inside: "b" });
    expect(d.edges[0]).toEqual({
      id: "e1", kind: "association", from: "a", to: "u", label: "goes", style: "plain-line", directed: false, step: 2,
    });
  });
  it("gives every operator its contract kind", () => {
    const d = parse("diagram use-case\ntitle t\nuse-case a\nuse-case b\na -> b\na --> b\na -- b\na -include-> b\na -extend-> b\na ..> b");
    expect(d.edges.map((e) => [e.kind, e.style, e.directed, e.meaning])).toEqual([
      ["arrow", "solid-arrow", true, undefined],
      ["arrow", "solid-arrow", true, undefined],
      ["association", "plain-line", false, undefined],
      ["include", "dashed-arrow", true, undefined],
      ["extend", "dashed-arrow", true, undefined],
      ["arrow", "dashed-arrow", true, "proposed"],
    ]);
    expect("meaning" in d.edges[0]).toBe(false);
  });
  it("maps start/end by diagram type and usecase alias", () => {
    const f = parse("diagram flowchart\ntitle t\nstart s\nend e");
    expect(f.nodes.map((n) => [n.kind, n.label])).toEqual([["terminator", "start"], ["terminator", "end"]]);
    const a = parse("diagram activity\ntitle t\nstart s\nend e\nusecase u");
    expect(a.nodes.map((n) => [n.kind, n.label])).toEqual([["initial", null], ["final", null], ["use-case", "u"]]);
  });
  it("joins narration lines and applies default profiles", () => {
    const d = parse("diagram activity\ntitle t\nnarration one\nnarration two\naction a");
    expect(d.narration_excerpt).toBe("one two");
    expect(d.notation_profile).toBe("uml-inspired");
    expect(parse("diagram flowchart\ntitle t").notation_profile).toBe("general-diagram");
  });
  it("rejects em dashes in every text field", () => {
    expect(() => parse("diagram flowchart\ntitle t\nprocess a \"x — y\"")).toThrow(/line 3: em dash/);
    expect(() => parse("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b : x — y")).toThrow(/line 5: em dash/);
    expect(() => parse("diagram flowchart\nnarration a — b\ntitle t")).toThrow(/line 2: em dash/);
    expect(() => parse("diagram flowchart\nlegend a — b\ntitle t")).toThrow(/line 2: em dash/);
    expect(() => parse("diagram use-case\ntitle t\nboundary b \"a — b\" {\n}")).toThrow(/line 3: em dash/);
  });
  it("treats header words after the body as nodes", () => {
    expect(() => parse("diagram flowchart\ntitle t\nprocess a\ntitle again")).toThrow(/line 4: unknown kind 'title'/);
  });
});
