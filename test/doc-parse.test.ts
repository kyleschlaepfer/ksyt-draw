import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse as parseV1, ParseError as V1Error } from "../src/core/parse";
import { adoptUids, firstError, parseDoc, parseMember, parseSource, ParseError } from "../src/core/doc/parse";
import { toContract } from "../src/core/doc/contract";

const V1 = new URL("../fixtures/diagrams/", import.meta.url);
const V2 = new URL("../fixtures/v2/", import.meta.url);
const v1Files = readdirSync(V1).filter((f) => f.endsWith(".ksd")).sort();
const v2Files = readdirSync(V2).filter((f) => f.endsWith(".ksd")).sort();
const read = (dir: URL, f: string) => readFileSync(new URL(f, dir), "utf8");

describe("the v2 parser reads every v1 file exactly as the reference parser does", () => {
  for (const f of v1Files) {
    it(f, () => {
      const src = read(V1, f);
      const want = JSON.parse(read(V1, f.replace(/\.ksd$/, ".json")));
      expect(toContract(parseDoc(src))).toEqual(want);
      expect(toContract(parseDoc(src))).toEqual(parseV1(src));
    });
  }
});

describe("the v2 parser fails where v1 fails, on the same line", () => {
  const cases: Array<{ source: string; line: number; message: string }> = JSON.parse(readFileSync(new URL("../fixtures/parse-errors.json", import.meta.url), "utf8"));
  for (const c of cases) {
    it(c.message, () => {
      const first = firstError(parseSource(c.source));
      expect(first).not.toBeNull();
      expect(first!.line).toBe(c.line);
      // two messages name the diagram types, and v2 has one more
      if (/diagram type|first line must be/.test(c.message)) expect(first!.message).toContain("class");
      else expect(first!.message).toBe(c.message);
      // and the frozen v1 port agrees on the line
      let v1: unknown = null;
      try { parseV1(c.source); } catch (e) { v1 = e; }
      expect((v1 as V1Error).line).toBe(first!.line);
    });
  }
  it("empty input", () => {
    expect(() => parseDoc("")).toThrow(/empty diagram/);
    expect(() => parseDoc("# only a comment\n\n")).toThrow(/empty diagram/);
  });
  it("other header and body mistakes", () => {
    expect(() => parseDoc("diagram flowchart\ndiagram activity\ntitle t")).toThrow(/line 2: diagram declared twice/);
    expect(() => parseDoc("diagram flowchart\nprofile loose\ntitle t")).toThrow(/line 2: unknown profile 'loose'/);
    expect(() => parseDoc("diagram flowchart\ndirection up\ntitle t")).toThrow(/line 2: direction is down or right/);
    expect(() => parseDoc("diagram flowchart\ntitle t\nstep two")).toThrow(/line 3: step takes a whole number/);
    expect(() => parseDoc("diagram flowchart\ntitle t\nprocess a top")).toThrow(/line 3: unknown option 'top'/);
    expect(() => parseDoc("diagram flowchart\nid not a slug\ntitle t")).toThrow(/line 2: id must be a slug/);
    expect(() => parseDoc("diagram flowchart\ntitle t\n??? what")).toThrow(/line 3: can't read this line/);
    expect(() => parseDoc("diagram flowchart\ntitle t\n??? what")).toThrow(ParseError);
  });
});

describe("error recovery and ranges", () => {
  it("reports every bad line, not only the first, with a column range", () => {
    const p = parseSource("diagram flowchart\ntitle t\nwidget a\nprocess ok\nprocess ok\nok -> nowhere\n");
    const errors = p.diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((e) => e.line)).toEqual([3, 5]);
    expect(p.doc).toBeNull();
    expect(errors[0].at).toEqual({ line: 3, col: 0, endCol: 6 });
    expect(errors[1].at).toEqual({ line: 5, col: 8, endCol: 10 });
  });
  it("whole-file problems point at a real line for the editor while keeping v1's line 0", () => {
    const p = parseSource("diagram use-case\ntitle t\nboundary b \"B\" {\nuse-case u\n");
    const e = firstError(p)!;
    expect(e.line).toBe(0);
    expect(e.at.line).toBe(3);
  });
  it("a loose end is a warning with the edge's identity, and the document still parses", () => {
    const p = parseSource("diagram flowchart\ntitle t\nprocess a\na -> ghost\n");
    expect(p.doc).not.toBeNull();
    const w = p.diagnostics.find((d) => d.code === "PARSE-UNKNOWN-NODE")!;
    expect(w.severity).toBe("warning");
    expect(w.at).toEqual({ line: 4, col: 5, endCol: 10 });
    expect(w.ref).toBe(p.doc!.edges[0].uid);
  });
});

describe("v2 syntax", () => {
  for (const f of v2Files) {
    it(`${f} parses clean`, () => {
      const p = parseSource(read(V2, f));
      expect(p.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      expect(p.doc).not.toBeNull();
    });
  }
  it("partitions give their nodes a parent and the reviewer sees them as neutral containers", () => {
    const d = parseDoc(read(V2, "activity-lanes.ksd"));
    const lanes = d.nodes.filter((n) => n.kind === "partition");
    expect(lanes.map((n) => n.label)).toEqual(["Customer", "Sales", "Warehouse"]);
    expect(d.nodes.find((n) => n.id === "check")!.parent).toBe("sales");
    const c = toContract(d);
    expect(c.nodes.find((n) => n.id === "sales")!.kind).toBe("boundary");
    expect(c.nodes.find((n) => n.id === "check")!.inside).toBe("sales");
  });
  it("partitions don't belong in use-case or class diagrams, and can't nest", () => {
    expect(() => parseDoc('diagram use-case\ntitle t\npartition p "P" {\n}')).toThrow(/line 3: partitions belong to activity/);
    expect(() => parseDoc('diagram activity\ntitle t\npartition p "P" {\npartition q "Q" {\n}\n}')).toThrow(/line 4: partitions can't nest/);
  });
  it("classes carry structured members, stereotypes and abstractness", () => {
    const d = parseDoc(read(V2, "class-shapes.ksd"));
    const shape = d.nodes.find((n) => n.id === "Shape")!;
    expect(shape.kind).toBe("class");
    expect(shape.abstract).toBe(true);
    expect(shape.members).toEqual([
      { kind: "attribute", visibility: "#", name: "origin", type: "Point" },
      { kind: "operation", visibility: "+", name: "area", params: "", type: "float", abstract: true },
      { kind: "operation", visibility: "+", name: "moveTo", params: "p: Point", type: "void" },
    ]);
    expect(d.nodes.find((n) => n.id === "Drawable")!.kind).toBe("interface");
    expect(d.nodes.find((n) => n.id === "Square")!.members).toBeUndefined();
    const st = parseDoc('diagram class\ntitle t\nclass Repo "Order repository" <<service>> at 1 2 size 3 1.5');
    expect(st.nodes[0]).toMatchObject({ label: "Order repository", stereotype: "service", place: { x: 1, y: 2 }, size: { w: 3, h: 1.5 }, inline: true });
  });
  it("member lines", () => {
    expect(parseMember("+ name : String")).toEqual({ kind: "attribute", visibility: "+", name: "name", type: "String" });
    expect(parseMember("count")).toEqual({ kind: "attribute", name: "count" });
    expect(parseMember("-total(): Money {static}")).toEqual({ kind: "operation", visibility: "-", name: "total", params: "", type: "Money", static: true });
    expect(parseMember("~run(a: A, b: B)")).toEqual({ kind: "operation", visibility: "~", name: "run", params: "a: A, b: B" });
    expect(parseMember("two words")).toBeNull();
    expect(parseMember("broken(")).toBeNull();
  });
  it("class relationships: kinds, direction, multiplicities and role names", () => {
    const d = parseDoc(read(V2, "class-orders.ksd"));
    const [places, contains, isFor, lists] = d.edges;
    expect(places).toMatchObject({ kind: "association", from: "Customer", to: "Order", label: "places", directed: false, ends: { from: { mult: "1" }, to: { mult: "0..*" } } });
    expect(contains).toMatchObject({ kind: "composition", from: "Order", to: "LineItem" });
    expect(isFor).toMatchObject({ kind: "association", navigable: true, directed: true });
    expect(lists).toMatchObject({ kind: "aggregation", from: "Catalog", to: "Product" });
    const c = toContract(d);
    expect(c.edges[0]).toMatchObject({ card_from: "1", card_to: "0..*", style: "plain-line" });
    const rev = parseDoc('diagram class\ntitle t\nclass A\nclass B\nA <|-- B\nA "1 owner" --* "0..* parts" B');
    expect(rev.edges[0]).toMatchObject({ kind: "generalization", from: "B", to: "A" });
    expect(rev.edges[1]).toMatchObject({ kind: "composition", from: "B", to: "A", ends: { from: { mult: "0..*", role: "parts" }, to: { mult: "1", role: "owner" } } });
  });
  it("operators keep their diagram type", () => {
    expect(() => parseDoc("diagram flowchart\ntitle t\nprocess a\nprocess b\na --|> b")).toThrow(/line 5: --\|> belongs to class diagrams/);
    expect(() => parseDoc("diagram class\ntitle t\nclass A\nclass B\nA -include-> B")).toThrow(/line 5: -include-> belongs to use-case diagrams/);
    expect(() => parseDoc('diagram flowchart\ntitle t\nprocess a\nprocess b\na "1" -> b')).toThrow(/line 5: multiplicities/);
    expect(parseDoc("diagram class\ntitle t\nclass A\nclass B\nA ..> B").edges[0].kind).toBe("dependency");
    expect(parseDoc("diagram flowchart\ntitle t\nprocess a\nprocess b\na ..> b").edges[0]).toMatchObject({ kind: "arrow", meaning: "proposed" });
  });
  it("describe blocks attach a structured description to a use case", () => {
    const d = parseDoc(read(V2, "usecase-described.ksd"));
    const u = d.nodes.find((n) => n.id === "borrow")!.describe!;
    expect(u.goal).toBe("Take a book home for the loan period");
    expect(u.primary).toBe("member");
    expect(u.trigger).toBe("The member brings a book to the desk");
    expect(u.pre).toEqual(["The member has a library card"]);
    expect(u.main).toHaveLength(3);
    expect(u.alt).toEqual(["2a. The membership has lapsed: the loan is refused"]);
    expect(u.related).toEqual(["membership (include)", "fine (extend)"]);
    expect(() => parseDoc("diagram use-case\ntitle t\nactor a\ndescribe a {\n}")).toThrow(/line 4: a is not a use case/);
    expect(() => parseDoc("diagram use-case\ntitle t\nuse-case u\ndescribe u {\nmood happy\n}")).toThrow(/line 5: unknown description field 'mood'/);
  });
  it("the layout block sets places, sizes, routes, label positions and styles", () => {
    const d = parseDoc(read(V2, "manual-layout.ksd"));
    const publish = d.nodes.find((n) => n.id === "publish")!;
    expect(publish.place).toEqual({ x: 3.4, y: 3.2 });
    expect(publish.size).toEqual({ w: 1.8, h: 0.7 });
    expect(publish.inline).toBeUndefined();
    expect(publish.style).toEqual({ fill: "wash" });
    const back = d.edges.find((e) => e.from === "ok" && e.to === "draft")!;
    expect(back.route).toEqual({ kind: "elbow", from: "left", to: "left", via: [[-0.9, 3.03], [-0.9, 1.6]] });
    expect(d.edges.find((e) => e.to === "publish")!.style).toEqual({ color: "accent", weight: "bold" });
  });
  it("a layout line that names nothing is kept with a warning, never an error", () => {
    const p = parseSource("diagram flowchart\ntitle t\nprocess a\nlayout {\n  place ghost 1 2\n  route a -> ghost straight\n}\n");
    expect(p.doc).not.toBeNull();
    expect(p.diagnostics.map((d) => [d.code, d.severity, d.line])).toEqual([["LAYOUT-UNKNOWN-REF", "warning", 5], ["LAYOUT-UNKNOWN-REF", "warning", 6]]);
  });
  it("layout lines point at the n-th of several lines between the same shapes", () => {
    const d = parseDoc("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b\na -> b\nlayout {\n  route a -> b #2 straight\n  label a -> b 0.25 0.1 -0.2\n}\n");
    expect(d.edges[0].route).toBeUndefined();
    expect(d.edges[1].route).toEqual({ kind: "straight" });
    expect(d.edges[0].labelPos).toEqual({ t: 0.25, dx: 0.1, dy: -0.2 });
  });
  it("header additions: lanes and look", () => {
    const d = parseDoc("diagram activity\ntitle t\nlanes horizontal\nlook precision\nstart s\n");
    expect(d.meta.lanes).toBe("horizontal");
    expect(d.meta.look).toBe("precision");
  });
});

describe("identity", () => {
  it("every node and edge gets a uid that a re-parse keeps, through edits elsewhere", () => {
    const a = parseSource("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b\na -> b : again\n");
    const b = adoptUids(parseSource("diagram flowchart\ntitle changed\n# a comment\nprocess z\nprocess a\nprocess b\na -> b\nz -> a\na -> b : again\n"), a.doc);
    const uid = (p: typeof a, id: string) => p.doc!.nodes.find((n) => n.id === id)!.uid;
    expect(uid(b, "a")).toBe(uid(a, "a"));
    expect(uid(b, "b")).toBe(uid(a, "b"));
    expect(new Set(b.doc!.nodes.map((n) => n.uid)).size).toBe(3);
    expect(b.doc!.edges[0].uid).toBe(a.doc!.edges[0].uid);
    expect(b.doc!.edges[2].uid).toBe(a.doc!.edges[1].uid);
    expect(b.stmts.find((s) => s.kind === "edge" && s.line === 8)!.owner).toBe(a.doc!.edges[1].uid);
  });
});
