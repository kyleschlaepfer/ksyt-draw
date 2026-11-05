import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Session } from "../src/core/doc/session";
import * as cmd from "../src/core/doc/commands";
import { openFile, toProject, sanitizeDoc, ProjectError, PROJECT_FORMAT } from "../src/core/doc/project";
import { parseSource } from "../src/core/doc/parse";
import { stubMeasurer } from "../src/core/measure";
import type { ChalkDoc } from "../src/core/doc/types";

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const FLOW = "# a comment that must survive\ndiagram flowchart\ntitle t\n\nstart begin\nprocess a \"first\"\nprocess b \"second\"\nend done\n\nbegin -> a\na -> b\nb -> done\n";
const uid = (s: Session, id: string): string => s.doc!.nodes.find((n) => n.id === id)!.uid;
const at = (s: Session, id: string): [number, number] => { const g = s.geometry!.nodes.get(id)!; return [g.cx, g.cy]; };
let clock = 0;
const session = (text: string): Session => new Session(text, stubMeasurer, () => clock);

describe("draw edits go through the session", () => {
  it("a move places only the moved shape; the text gains one layout line and keeps its comment", () => {
    const s = session(FLOW);
    const before = Object.fromEntries(["begin", "b", "done"].map((id) => [id, at(s, id)]));
    const r = s.edit("move", (d) => cmd.moveNode(d, uid(s, "a"), 4, 2));
    expect(r).toEqual({ ok: true, held: 0 });
    expect(at(s, "a")).toEqual([4, 2]);
    for (const id of ["begin", "b", "done"]) expect(at(s, id)).toEqual(before[id]);
    expect(s.text).toContain("# a comment that must survive");
    expect(s.text).toContain("layout {\n  place a 4 2\n}");
    expect(s.doc!.nodes.filter((n) => n.place).map((n) => n.id)).toEqual(["a"]);
  });
  it("an edit that would shift other shapes holds them where they are, and says how many", () => {
    const s = session(FLOW);
    const before = Object.fromEntries(s.doc!.nodes.map((n) => [n.id, at(s, n.id)]));
    // a much longer label makes the box wider and taller: the ranks below would move
    const r = s.edit("edit text", (d) => cmd.setLabel(d, uid(s, "a"), "a very much longer first step\nwith a second line\nand a third"));
    expect(r.ok).toBe(true);
    expect(r.held).toBeGreaterThan(0);
    for (const n of s.doc!.nodes) { expect(at(s, n.id)[0], n.id).toBeCloseTo(before[n.id][0], 3); expect(at(s, n.id)[1], n.id).toBeCloseTo(before[n.id][1], 3); }
    // the shapes above the edited one did not have to be pinned: only what would have moved was
    expect(s.doc!.nodes.find((n) => n.id === "b")!.place).toBeDefined();
  });
  it("adding a shape at a point moves nothing else", () => {
    const s = session(FLOW);
    const before = Object.fromEntries(s.doc!.nodes.map((n) => [n.id, at(s, n.id)]));
    let made = "";
    s.edit("add", (d) => { made = cmd.addNode(d, { kind: "process", at: { x: 5, y: 1 } }).id; });
    expect(at(s, made)).toEqual([5, 1]);
    for (const id of Object.keys(before)) { expect(at(s, id)[0], id).toBeCloseTo(before[id][0], 3); expect(at(s, id)[1], id).toBeCloseTo(before[id][1], 3); }
  });
  it("hold: false lets a deliberate re-layout move things", () => {
    const s = session(FLOW);
    s.edit("move", (d) => cmd.moveNode(d, uid(s, "a"), 4, 2));
    const r = s.edit("tidy", (d) => { for (const n of d.nodes) delete n.place; }, { hold: false });
    expect(r.ok).toBe(true);
    expect(s.text).toBe(FLOW);
  });
  it("a refused command changes nothing and reports why", () => {
    const s = session(FLOW);
    const r = s.edit("rename", (d) => cmd.renameId(d, uid(s, "a"), "b"));
    expect(r).toEqual({ ok: false, message: "b is already taken", held: 0 });
    expect(s.text).toBe(FLOW);
    expect(s.canUndo).toBe(false);
    expect(s.edit("label", (d) => cmd.setLabel(d, uid(s, "a"), "x — y")).message).toBe("no em dashes (house rule)");
  });
  it("identities survive every edit, so a selection stays on the same shape through a rename", () => {
    const s = session(FLOW);
    const a = uid(s, "a");
    s.edit("rename", (d) => cmd.renameId(d, a, "review"), { select: [a] });
    expect(uid(s, "review")).toBe(a);
    expect(s.selection).toEqual([a]);
    expect(s.text).toContain("begin -> review\nreview -> b");
  });
});

describe("one history for both views", () => {
  it("undo and redo walk draw edits and write edits in the order they happened", () => {
    const s = session(FLOW);
    clock = 0;
    s.edit("move", (d) => cmd.moveNode(d, uid(s, "a"), 4, 2));
    const afterMove = s.text;
    clock = 10_000;
    s.setText(afterMove.replace('"first"', '"first step"'));
    const afterType = s.text;
    s.edit("delete", (d) => { cmd.removeElements(d, [uid(s, "b")]); });
    expect(s.doc!.nodes.some((n) => n.id === "b")).toBe(false);
    expect(s.undo()).toBe(true);
    expect(s.text).toBe(afterType);
    expect(s.undo()).toBe(true);
    expect(s.text).toBe(afterMove);
    expect(s.undo()).toBe(true);
    expect(s.text).toBe(FLOW);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true);
    expect(s.text).toBe(afterMove);
    expect(s.redo()).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.doc!.nodes.some((n) => n.id === "b")).toBe(false);
    expect(s.redo()).toBe(false);
  });
  it("typing in quick succession is one step; a pause starts a new one; a new edit drops the redo", () => {
    const s = session(FLOW);
    clock = 100;
    s.setText(FLOW + "#");
    clock = 300;
    s.setText(FLOW + "# x");
    clock = 500;
    s.setText(FLOW + "# xy");
    clock = 5000;
    s.setText(FLOW + "# xyz");
    expect(s.undo()).toBe(true);
    expect(s.text).toBe(FLOW + "# xy");
    expect(s.undo()).toBe(true);
    expect(s.text).toBe(FLOW);
    expect(s.canRedo).toBe(true);
    s.setText(FLOW + "# other", "paste");
    expect(s.canRedo).toBe(false);
  });
  it("undo restores the selection that went with each state", () => {
    const s = session(FLOW);
    const a = uid(s, "a"), b = uid(s, "b");
    s.selection = [a];
    s.edit("move", (d) => cmd.moveNode(d, b, 3, 3), { select: [b] });
    expect(s.selection).toEqual([b]);
    s.undo();
    expect(s.selection).toEqual([a]);
    s.redo();
    expect(s.selection).toEqual([b]);
  });
});

describe("text with a mistake in it", () => {
  it("keeps the draft, keeps the last good document on screen, and recovers when fixed", () => {
    const s = session(FLOW);
    const good = s.doc, geo = s.geometry;
    clock = 50_000;
    s.setText(FLOW + "widget x\n");
    expect(s.inSync).toBe(false);
    expect(s.text).toBe(FLOW + "widget x\n");
    expect(s.doc).toBe(good);
    expect(s.geometry).toBe(geo);
    expect(s.parsed.diagnostics[0]).toMatchObject({ severity: "error", line: 13 });
    clock = 90_000;
    s.setText(FLOW + "process x\n");
    expect(s.inSync).toBe(true);
    expect(s.doc!.nodes.map((n) => n.id)).toContain("x");
    // the shapes that were already there kept their identities through the bad patch
    expect(uid(s, "a")).toBe(good!.nodes.find((n) => n.id === "a")!.uid);
  });
  it("draw can't write over a draft that is newer than the picture", () => {
    const s = session(FLOW);
    s.setText(FLOW + "widget x\n");
    const r = s.edit("move", (d) => cmd.moveNode(d, d.nodes[0].uid, 1, 1));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/fix the text first/);
    expect(s.text).toBe(FLOW + "widget x\n");
  });
  it("a session that starts with broken text has no document until it is fixed", () => {
    const s = session("diagram flowchart\n");
    expect(s.doc).toBeNull();
    expect(s.edit("x", () => {}).ok).toBe(false);
    s.setText("diagram flowchart\ntitle t\nprocess a\n");
    expect(s.doc!.nodes.length).toBe(1);
  });
});

describe("holding still never breaks the picture", () => {
  const box = (s: Session, id: string) => s.geometry!.nodes.get(id)!;
  const gap = (s: Session, a: string, b: string): number => {
    const p = box(s, a), q = box(s, b);
    return Math.max(Math.abs(p.cx - q.cx) - (p.w + q.w) / 2, Math.abs(p.cy - q.cy) - (p.h + q.h) / 2);
  };
  it("a class that grows pushes the class it would grow into, and no farther than it needs", () => {
    const s = session("diagram class\ntitle t\n\nclass Customer\nclass Account\nclass Ledger\n\nCustomer -- Account\nAccount -- Ledger\n");
    const customer = at(s, "Customer");
    let pushed = 0;
    for (let i = 1; i <= 8; i++) {
      const members = Array.from({ length: i }, (_, k) => ({ kind: "attribute" as const, visibility: "+" as const, name: `field${k}`, type: "String" }));
      const r = s.edit("add attribute", (d) => cmd.patchNode(d, uid(s, "Account"), { members }), { select: [uid(s, "Account")] });
      expect(r.ok).toBe(true);
      pushed += r.nudged ?? 0;
      // a bare line needs 0.3 in between the shapes it joins
      expect(gap(s, "Customer", "Account"), `${i} members`).toBeGreaterThan(0.29);
      expect(gap(s, "Account", "Ledger"), `${i} members`).toBeGreaterThan(0.29);
    }
    expect(pushed).toBeGreaterThan(0);
    // the edited class and the one above it are where they were; only what was in the way moved
    expect(at(s, "Customer")[0]).toBeCloseTo(customer[0], 3);
    expect(s.undo()).toBe(true);
  });
  it("a new line with words on it gets room between two shapes that sat close", () => {
    const s = session("diagram use-case\ntitle t\n\nactor a\nuse-case one \"apply for a permit\"\nuse-case two \"pay the fee\"\n\na -- one\na -- two\n");
    const before = gap(s, "one", "two");
    const r = s.edit("connect", (d) => { cmd.addEdge(d, { from: uid(s, "one"), to: uid(s, "two"), op: "-include->" }); });
    expect(r.ok).toBe(true);
    if (before < 0.55) expect(r.nudged).toBeGreaterThan(0);
    expect(gap(s, "one", "two")).toBeGreaterThan(0.54);
  });
  it("what the author arranges is left exactly as arranged, however close", () => {
    const s = session(FLOW);
    const b = box(s, "b");
    const r = s.edit("move", (d) => cmd.moveNode(d, uid(s, "a"), b.cx, b.cy - b.h - 0.02));
    expect(r.nudged).toBeUndefined();
    expect(at(s, "b")).toEqual([b.cx, b.cy]);
    // and a later edit elsewhere does not start tidying that pair
    const r2 = s.edit("edit text", (d) => cmd.setLabel(d, uid(s, "begin"), null));
    expect(r2.nudged).toBeUndefined();
    expect(gap(s, "a", "b")).toBeLessThan(0.05);
  });
});

describe("the project file", () => {
  it("saves the text, the model and the workspace, and reopens to the same text and identities", () => {
    const text = fixture("v2/manual-layout.ksd");
    const parsed = parseSource(text);
    const file = toProject(parsed, { view: { x: 10, y: 20, zoom: 1.5 }, export: { format: "png", scale: 2 } }, "2026-11-04T00:00:00.000Z");
    expect(file).toMatchObject({ format: PROJECT_FORMAT, version: 2, source: text });
    const opened = openFile(JSON.stringify(file));
    expect(opened.kind).toBe("project");
    expect(opened.source).toBe(text);
    expect(opened.workspace).toEqual({ view: { x: 10, y: 20, zoom: 1.5 }, export: { format: "png", scale: 2 } });
    expect(opened.notes).toEqual([]);
    // opened over some other diagram, every shape and line has the uid it was saved with
    const s = session(fixture("v2/class-orders.ksd"));
    s.setText(opened.source, "open", opened.identities);
    expect(s.doc!.nodes.map((n) => n.uid)).toEqual(parsed.doc!.nodes.map((n) => n.uid));
    expect(s.doc!.edges.map((e) => e.uid)).toEqual(parsed.doc!.edges.map((e) => e.uid));
  });
  it("identities from a file are kept only when they look like identities and are not shared", () => {
    const parsed = parseSource("diagram flowchart\ntitle t\nprocess a\nprocess b\nprocess c\na -> b\n");
    const file = JSON.parse(JSON.stringify(toProject(parsed))) as { model: { nodes: Array<{ uid: unknown }> } };
    file.model.nodes[0].uid = 'x" onload="alert(1)';
    file.model.nodes[1].uid = "same";
    file.model.nodes[2].uid = "same";
    const got = openFile(JSON.stringify(file)).identities!.nodes.map((n) => n.uid);
    expect(got[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(got[1]).toBe("same");
    expect(got[2]).not.toBe("same");
    expect(new Set(got).size).toBe(3);
  });
  it("every fixture survives save, reload and a further edit without losing anything", () => {
    for (const name of ["v2/activity-lanes.ksd", "v2/class-orders.ksd", "v2/usecase-described.ksd", "v2/manual-layout.ksd", "diagrams/usecase-permit.ksd"]) {
      const s = session(fixture(name));
      const first = s.doc!.nodes.find((n) => n.kind !== "boundary" && n.kind !== "partition")!;
      s.edit("move", (d) => cmd.moveNode(d, first.uid, 7.25, 3.5));
      const opened = openFile(JSON.stringify(toProject(s.parsed)));
      const again = session(opened.source);
      expect(again.text, name).toBe(s.text);
      expect(JSON.stringify(strip(again.doc!)), name).toBe(JSON.stringify(strip(s.doc!)));
      expect([...again.geometry!.nodes.values()].map((g) => [g.id, g.cx, g.cy, g.w, g.h]), name).toEqual([...s.geometry!.nodes.values()].map((g) => [g.id, g.cx, g.cy, g.w, g.h]));
    }
  });
  it("a plain .ksd file opens as text, with Windows line endings and a byte-order mark tidied", () => {
    const o = openFile("﻿diagram flowchart\r\ntitle t\r\nprocess a\r\n");
    expect(o).toMatchObject({ kind: "ksd", source: "diagram flowchart\ntitle t\nprocess a\n" });
  });
  it("a project whose text is missing or broken is rebuilt from its model, and says so", () => {
    const parsed = parseSource(fixture("v2/class-shapes.ksd"));
    const file = toProject(parsed) as unknown as Record<string, unknown>;
    const noText = openFile(JSON.stringify({ ...file, source: undefined }));
    expect(noText.notes).toEqual(["this project had no text; it was rebuilt from the saved model"]);
    expect(parseSource(noText.source).doc!.nodes.map((n) => n.id)).toEqual(parsed.doc!.nodes.map((n) => n.id));
    const broken = openFile(JSON.stringify({ ...file, source: "diagram class\nwidget x\n" }));
    expect(broken.notes[0]).toMatch(/mistake/);
    expect(parseSource(broken.source).doc!.nodes.find((n) => n.id === "Shape")!.members!.length).toBe(3);
  });
  it("refuses what isn't a diagram, with a reason a person can read", () => {
    expect(() => openFile("{ not json")).toThrow(ProjectError);
    expect(() => openFile('{"a":1}')).toThrow(/isn't a Chalk project/);
    // anything that isn't JSON is read as diagram text, where the parser says what is wrong with it
    expect(openFile("[1,2,3]").kind).toBe("ksd");
    expect(() => openFile('{"format":"something-else"}')).toThrow(/isn't a Chalk project/);
    expect(() => openFile('{"format":"chalk-project","version":2,"model":{"meta":{}}}')).toThrow(/doesn't hold a diagram/);
  });
  it("a hostile model is cut down to valid fields before anything reads it", () => {
    const doc = sanitizeDoc({
      meta: { type: "class", title: "t", id: "<script>", direction: "sideways", look: "neon" },
      nodes: [
        { id: "ok", kind: "process", label: "<img src=x onerror=alert(1)>", place: { x: 1, y: "2" }, size: { w: -1, h: 5 }, style: { fill: "url(javascript:1)", color: "#f00" }, step: -4 },
        { id: "bad id", kind: "process" }, { id: "x", kind: "teapot" }, { id: "ok", kind: "process" }, null, 7,
        { id: "c", kind: "class", members: [{ kind: "attribute", name: "two words" }, { kind: "operation", name: "run", params: "a\nb" }], stereotype: "a>>b" },
      ],
      edges: [
        { kind: "association", from: "ok", to: "c", label: "  go  \n now ", route: { kind: "elbow", via: [[1, 2], ["x", 3], [4, 5, 6]], from: "diagonal" }, labelPos: { t: 9, dx: Infinity } },
        { kind: "teleport", from: "ok", to: "c" }, { kind: "arrow", from: "no pe", to: "c" },
      ],
      pool: { x: "0", length: -3 },
    });
    expect(doc.meta).toMatchObject({ id: "diagram", direction: "down" });
    expect(doc.meta.look).toBeUndefined();
    expect(doc.nodes.map((n) => n.id)).toEqual(["ok", "c"]);
    const ok = doc.nodes[0];
    expect(ok.label).toBe("<img src=x onerror=alert(1)>"); // kept as text; the SVG writer escapes it
    expect(ok.place).toBeUndefined();
    expect(ok.size).toBeUndefined();
    expect(ok.style).toBeUndefined();
    expect(ok.step).toBe(0);
    expect(doc.nodes[1].members).toEqual([{ kind: "operation", name: "run", params: "a b" }]);
    expect(doc.nodes[1].stereotype).toBeUndefined();
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0]).toMatchObject({ label: "go now", route: { kind: "elbow", via: [[1, 2]] }, labelPos: { t: 1, dx: 0, dy: 0 } });
    expect(doc.pool).toBeUndefined();
    // and it prints to text the parser accepts
    const rebuilt = openFile(JSON.stringify({ format: "chalk-project", version: 2, model: doc }));
    expect(parseSource(rebuilt.source).doc).not.toBeNull();
  });
  it("a project from a newer version opens, with a note", () => {
    const file = { ...toProject(parseSource("diagram flowchart\ntitle t\nprocess a\n")), version: 9, future: { anything: true } };
    expect(openFile(JSON.stringify(file)).notes[0]).toMatch(/newer Chalk/);
  });
});

function strip(d: ChalkDoc): unknown {
  return JSON.parse(JSON.stringify(d, (k, v) => (k === "uid" ? undefined : v)));
}
