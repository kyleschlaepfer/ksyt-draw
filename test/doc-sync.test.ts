import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { adoptUids, parseDoc, parseSource } from "../src/core/doc/parse";
import { printDoc } from "../src/core/doc/print";
import { formatSource, syncSource } from "../src/core/doc/sync";
import { cloneDoc, type ChalkDoc } from "../src/core/doc/types";
import * as cmd from "../src/core/doc/commands";

const dirs = [new URL("../fixtures/diagrams/", import.meta.url), new URL("../fixtures/v2/", import.meta.url)];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ksd")).sort().map((f) => [f, readFileSync(new URL(f, d), "utf8").replace(/\r\n/g, "\n")] as const));
const fixture = (name: string): string => files.find(([f]) => f === name)![1];

/** A document without the things a save and reload may change: identities, derived ids, list order. */
function essence(d: ChalkDoc, o: { steps?: boolean } = {}): unknown {
  const strip = (x: Record<string, unknown>) => {
    const { uid: _u, inline: _i, ...rest } = x;
    if (o.steps === false) delete rest.step;
    return rest;
  };
  return {
    meta: d.meta, pool: d.pool ?? null,
    nodes: d.nodes.map((n) => strip(n as unknown as Record<string, unknown>)).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    edges: d.edges.map((e) => { const { id: _id, ...rest } = strip(e as unknown as Record<string, unknown>); return rest; })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

/** Run an edit the way the session does and check the text and the model agree afterwards. */
function edit(src: string, f: (d: ChalkDoc) => void, o: { steps?: boolean } = {}): string {
  const prev = parseSource(src);
  expect(prev.doc, "the starting text must be valid").not.toBeNull();
  const next = cloneDoc(prev.doc!);
  f(next);
  const text = syncSource(prev, next);
  const again = adoptUids(parseSource(text), next);
  expect(again.diagnostics.filter((d) => d.severity === "error"), text).toEqual([]);
  expect(essence(again.doc!, o), text).toEqual(essence(next, o));
  // identities survive the round trip
  for (const n of next.nodes) expect(again.doc!.nodes.find((m) => m.id === n.id)!.uid).toBe(n.uid);
  return text;
}
const uidOf = (d: ChalkDoc, id: string): string => d.nodes.find((n) => n.id === id)!.uid;
const edgeUid = (d: ChalkDoc, from: string, to: string): string => d.edges.find((e) => e.from === from && e.to === to)!.uid;

describe("printDoc", () => {
  for (const [f, src] of files) {
    it(`${f}: print then parse gives the same document`, () => {
      const d = parseDoc(src);
      const printed = printDoc(d);
      expect(essence(parseDoc(printed))).toEqual(essence(d));
      // printing is stable
      expect(printDoc(parseDoc(printed))).toBe(printed);
      expect(printed).not.toContain("—");
    });
  }
});

describe("syncSource leaves untouched text alone", () => {
  for (const [f, src] of files) {
    it(`${f}: an edit that changes nothing returns the text unchanged`, () => {
      expect(edit(src, () => {})).toBe(src.endsWith("\n") ? src : src + "\n");
    });
  }
});

const FLOW = `# top comment
diagram flowchart
id approval
title After review,   a request takes one of two paths

# the steps
start begin
process submit   "submit request"
decision ok "approved?"   # not a comment: v1 has no trailing comments, so this line is odd on purpose
`.replace(/   # not a comment.*\n/, "\n") + `process schedule "schedule the work"
end done

# the lines
begin -> submit
submit -> ok
ok -> schedule : yes
schedule -> done
`;

describe("targeted edits", () => {
  it("moving a shape adds one layout line and touches nothing else", () => {
    const out = edit(FLOW, (d) => cmd.moveNode(d, uidOf(d, "submit"), 2.5, 1.25));
    expect(out.startsWith(FLOW)).toBe(true);
    expect(out.slice(FLOW.length)).toBe("\n# layout: written by the draw view. Delete a line to hand that part back to automatic layout.\nlayout {\n  place submit 2.5 1.25\n}\n");
  });
  it("moving it again rewrites that one line; releasing it removes the block and its note", () => {
    const once = edit(FLOW, (d) => cmd.moveNode(d, uidOf(d, "submit"), 2.5, 1.25));
    const twice = edit(once, (d) => cmd.moveNode(d, uidOf(d, "submit"), 3, 4));
    expect(twice).toBe(once.replace("place submit 2.5 1.25", "place submit 3 4"));
    expect(edit(twice, (d) => cmd.releaseNode(d, uidOf(d, "submit")))).toBe(FLOW);
  });
  it("a v1 file's inline `at` is updated where it is", () => {
    const src = 'diagram flowchart\ntitle t\nprocess a "A" at 1 2\nprocess b\n';
    const out = edit(src, (d) => cmd.moveNode(d, uidOf(d, "a"), 3, 4.5));
    expect(out).toBe('diagram flowchart\ntitle t\nprocess a "A" at 3 4.5\nprocess b\n');
  });
  it("editing a label rewrites only that line and keeps comments and the author's spacing elsewhere", () => {
    const out = edit(FLOW, (d) => cmd.setLabel(d, uidOf(d, "ok"), "is it approved?"));
    expect(out).toBe(FLOW.replace('decision ok "approved?"', 'decision ok "is it approved?"'));
    expect(out).toContain("title After review,   a request takes one of two paths");
    expect(out).toContain('process submit   "submit request"');
  });
  it("multi-line labels and quotes survive", () => {
    const out = edit(FLOW, (d) => cmd.setLabel(d, uidOf(d, "ok"), 'say "yes"\nor no'));
    expect(out).toContain('decision ok "say \\"yes\\"\\nor no"');
  });
  it("an edge label", () => {
    const out = edit(FLOW, (d) => cmd.setLabel(d, edgeUid(d, "ok", "schedule"), "[approved]"));
    expect(out).toBe(FLOW.replace("ok -> schedule : yes", "ok -> schedule : [approved]"));
    expect(edit(out, (d) => cmd.setLabel(d, edgeUid(d, "ok", "schedule"), ""))).toBe(FLOW.replace("ok -> schedule : yes", "ok -> schedule"));
  });
  it("renaming an id follows through every line that names it", () => {
    const withLayout = edit(FLOW, (d) => { cmd.moveNode(d, uidOf(d, "ok"), 1, 2); cmd.patchEdge(d, edgeUid(d, "ok", "schedule"), { style: { color: "accent" } }); });
    const out = edit(withLayout, (d) => cmd.renameId(d, uidOf(d, "ok"), "approved"));
    expect(out).toContain('decision approved "approved?"');
    expect(out).toContain("submit -> approved\napproved -> schedule : yes");
    expect(out).toContain("  place approved 1 2\n  style approved -> schedule color accent");
    expect(out).not.toMatch(/\bok\b/);
  });
  it("a new shape lands after the last shape, a new line after the last line", () => {
    const out = edit(FLOW, (d) => {
      const n = cmd.addNode(d, { kind: "process", at: { x: 4, y: 2 } });
      cmd.addEdge(d, { from: uidOf(d, "ok"), to: n.uid, label: "no" });
    }, { steps: false });
    expect(out).toContain('end done\nprocess process1 "process 1"\n\n# the lines');
    expect(out).toContain("schedule -> done\nok -> process1 : no\n");
    expect(out).toContain("layout {\n  place process1 4 2\n}");
  });
  it("deleting a shape removes its line, its edges and its layout lines, and nothing else", () => {
    const placed = edit(FLOW, (d) => cmd.moveNode(d, uidOf(d, "schedule"), 1, 1));
    const out = edit(placed, (d) => { cmd.removeElements(d, [uidOf(d, "schedule")]); });
    expect(out).toBe(FLOW.replace('process schedule "schedule the work"\n', "").replace("ok -> schedule : yes\nschedule -> done\n", ""));
  });
  it("deleting one of two lines between the same shapes re-points the layout line of the other", () => {
    const src = "diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b\na -> b : again\nlayout {\n  route a -> b #2 straight\n}\n";
    const out = edit(src, (d) => { cmd.removeElements(d, [d.edges[0].uid]); });
    expect(out).toBe("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b : again\nlayout {\n  route a -> b straight\n}\n");
  });
  it("header changes: title, type, direction", () => {
    const out = edit(FLOW, (d) => cmd.patchMeta(d, { title: "A new claim", direction: "right" }));
    expect(out).toContain("id approval\ntitle A new claim\ndirection right\n");
    expect(edit(out, (d) => cmd.patchMeta(d, { direction: "down" }))).toBe(FLOW.replace("title After review,   a request takes one of two paths", "title A new claim"));
  });
});

describe("containers", () => {
  const UC = fixture("usecase-permit.ksd");
  it("a new use case joins its boundary's block, indented like its neighbours", () => {
    const out = edit(UC, (d) => { cmd.addNode(d, { kind: "use-case", parent: "portal" }); });
    expect(out).toContain('  use-case waiver "request fee waiver"\n  use-case usecase1 "use case 1"\n}');
  });
  it("moving a shape out of a boundary and back moves its line", () => {
    const out = edit(UC, (d) => cmd.setParent(d, uidOf(d, "track"), undefined));
    expect(out).toMatch(/\n}\nuse-case track "track status"\n/);
    expect(out).not.toContain('  use-case track "track status"');
    const back = edit(out, (d) => cmd.setParent(d, uidOf(d, "track"), "portal"));
    expect(back).toContain('  use-case track "track status"\n}');
  });
  it("deleting a boundary frees its use cases and dedents them", () => {
    const out = edit(UC, (d) => { expect(cmd.removeElements(d, [uidOf(d, "portal")]).freed).toBe(5); });
    expect(out).not.toContain("boundary");
    expect(out).toContain('\nuse-case apply "apply for permit"\nuse-case track "track status"\n');
    expect(out).not.toMatch(/^}$/m);
  });
  it("a new partition arrives as a block, and a shape dropped in it joins the block", () => {
    const LANES = fixture("activity-lanes.ksd");
    const out = edit(LANES, (d) => {
      const lane = cmd.addNode(d, { kind: "partition", label: "Courier" });
      cmd.addNode(d, { kind: "action", parent: lane.id, at: { x: 9, y: 2 }, label: "deliver" });
    }, { steps: false });
    expect(out).toContain('partition lane1 "Courier" {\n  action action1 "deliver"\n}\n');
    const moved = edit(out, (d) => cmd.setParent(d, uidOf(d, "ship"), "lane1"));
    expect(moved).toContain('partition lane1 "Courier" {\n  action action1 "deliver"\n  action ship "ship order"\n}');
    expect(moved).not.toContain('  action pack "pack order"\n  action ship "ship order"');
  });
});

describe("reordering partitions", () => {
  it("moves whole blocks, with their contents and comments, and touches nothing else", () => {
    const src = 'diagram activity\ntitle t\n\n# first\npartition a "A" {\n  start s\n  # inside a\n  action x\n}\n# between\npartition b "B" {\n  action y\n}\npartition c "C" {\n  end e\n}\n\ns -> x\nx -> y\ny -> e\n';
    const out = edit(src, (d) => { cmd.movePartition(d, uidOf(d, "c"), -1); });
    expect(out).toBe('diagram activity\ntitle t\n\n# first\npartition a "A" {\n  start s\n  # inside a\n  action x\n}\n# between\npartition c "C" {\n  end e\n}\npartition b "B" {\n  action y\n}\n\ns -> x\nx -> y\ny -> e\n');
    const twice = edit(out, (d) => { cmd.movePartition(d, uidOf(d, "a"), 1); });
    expect(twice).toContain('# first\npartition c "C" {\n  end e\n}\n# between\npartition a "A" {\n  start s\n  # inside a\n  action x\n}\npartition b');
    expect(parseDoc(twice).nodes.filter((n) => n.kind === "partition").map((n) => n.id)).toEqual(["c", "a", "b"]);
  });
});

describe("classes and descriptions", () => {
  const CLS = fixture("class-shapes.ksd");
  it("changing one member rewrites one line", () => {
    const out = edit(CLS, (d) => {
      const n = d.nodes.find((x) => x.id === "Circle")!;
      cmd.patchNode(d, n.uid, { members: [{ ...n.members![0], name: "r" }, n.members![1]] });
    });
    expect(out).toBe(CLS.replace("  -radius: float", "  -r: float"));
  });
  it("giving a bare class its first member opens a block; removing the last closes it", () => {
    const out = edit(CLS, (d) => cmd.patchNode(d, uidOf(d, "Square"), { members: [{ kind: "attribute", visibility: "-", name: "side", type: "float" }] }));
    expect(out).toContain("class Square {\n  -side: float\n}\n");
    expect(edit(out, (d) => cmd.patchNode(d, uidOf(d, "Square"), { members: [] }))).toBe(CLS);
  });
  it("adding a member to a class with members", () => {
    const out = edit(CLS, (d) => {
      const n = d.nodes.find((x) => x.id === "Circle")!;
      cmd.patchNode(d, n.uid, { members: [...n.members!, { kind: "operation", visibility: "+", name: "diameter", params: "", type: "float" }] });
    });
    expect(out).toContain("class Circle {\n  -radius: float\n  +area(): float\n  +diameter(): float\n}");
  });
  it("multiplicities are written at the line's ends", () => {
    const out = edit(fixture("class-orders.ksd"), (d) => cmd.patchEdge(d, edgeUid(d, "Customer", "Order"), { ends: { from: { mult: "1", role: "buyer" }, to: { mult: "*" } } }));
    expect(out).toContain('Customer "1 buyer" -- "*" Order : places');
  });
  it("a use-case description is written as a block and edited in place", () => {
    const UC = fixture("usecase-permit.ksd");
    const out = edit(UC, (d) => cmd.patchNode(d, uidOf(d, "apply"), { describe: { goal: "Get a permit", pre: ["Has an account"], main: ["1. Open the form", "2. Send it"] } }));
    expect(out).toContain("\ndescribe apply {\n  goal Get a permit\n  pre Has an account\n  main 1. Open the form\n  main 2. Send it\n}\n");
    const again = edit(out, (d) => cmd.patchNode(d, uidOf(d, "apply"), { describe: { goal: "Get a permit quickly" } }));
    expect(again).toContain("describe apply {\n  goal Get a permit quickly\n}\n");
    expect(edit(again, (d) => cmd.patchNode(d, uidOf(d, "apply"), { describe: null }))).toBe(UC);
  });
});

describe("formatSource", () => {
  it("tidies spelling and indentation and keeps comments, blank lines and order", () => {
    const messy = '# c\ndiagram use-case\ntitle t\nactor   a   "A"\nboundary b "B" {\nuse-case   u\n      # inner\n}\n\na   --   u\n';
    expect(formatSource(parseSource(messy))).toBe('# c\ndiagram use-case\ntitle t\nactor a "A"\nboundary b "B" {\n  use-case u\n  # inner\n}\n\na -- u\n');
  });
  it("a file with a mistake is only re-indented", () => {
    expect(formatSource(parseSource("diagram flowchart\ntitle t\n   widget x\n"))).toBe("diagram flowchart\ntitle t\nwidget x\n");
  });
});
