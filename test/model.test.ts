import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDoc, parseSource } from "../src/core/doc/parse";
import * as cmd from "../src/core/doc/commands";
import { cloneDoc, type ChalkDoc } from "../src/core/doc/types";
import { align, bounds, distribute, matchSize, snapGrid, snapMove, type Box } from "../src/core/geom/arrange";
import { hits, nearestT, pathLength, pointAt, routeEdge, simplify } from "../src/core/geom/route";
import { nodeSize, sideAnchor, type NodeGeom } from "../src/core/geom/shape";
import { stubMeasurer } from "../src/core/measure";
import { resolve } from "../src/core/geom/resolve";
import { allIssues, locate, review, rulesV2, type RuleFinding } from "../src/core/diagnostics";
import { lint } from "../src/core/lint";
import { toContract } from "../src/core/doc/contract";

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const FLOW = "diagram flowchart\ntitle t\nstart begin\nprocess a\ndecision ok \"ok?\"\nend done\nbegin -> a\na -> ok\nok -> done : yes\n";
const uid = (d: ChalkDoc, id: string): string => d.nodes.find((n) => n.id === id)!.uid;

describe("commands", () => {
  it("new shapes get the first free id, a useful label, and never disturb existing ids", () => {
    const d = parseDoc(FLOW);
    const before = d.nodes.map((n) => [n.uid, n.id]);
    const p1 = cmd.addNode(d, { kind: "process" }), p2 = cmd.addNode(d, { kind: "process" }), dec = cmd.addNode(d, { kind: "decision" });
    expect([p1.id, p1.label, p2.id, dec.id]).toEqual(["process1", "process 1", "process2", "decision1"]);
    expect(cmd.addNode(d, { kind: "start" })).toMatchObject({ kind: "terminator", label: "start", id: "start1" });
    expect(cmd.addNode(parseDoc(FLOW.replace("flowchart", "activity").replace("process a", "action a")), { kind: "end" })).toMatchObject({ kind: "final", label: null });
    expect(d.nodes.slice(0, before.length).map((n) => [n.uid, n.id])).toEqual(before);
  });
  it("deleting a line never renumbers or re-identifies the others", () => {
    const d = parseDoc(FLOW);
    const keep = d.edges.map((e) => e.uid);
    cmd.removeElements(d, [keep[1]]);
    expect(d.edges.map((e) => e.uid)).toEqual([keep[0], keep[2]]);
  });
  it("deleting a shape takes its lines; deleting a container frees its children", () => {
    const d = parseDoc(FLOW);
    cmd.removeElements(d, [uid(d, "ok")]);
    expect(d.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["begin>a"]);
    const uc = parseDoc(fixture("diagrams/usecase-permit.ksd"));
    expect(cmd.removeElements(uc, [uid(uc, "portal")]).freed).toBe(5);
    expect(uc.nodes.some((n) => n.parent)).toBe(false);
  });
  it("connecting picks the usual relationship and stores questionable endpoints for nonblocking review", () => {
    const uc = parseDoc(fixture("diagrams/usecase-permit.ksd"));
    expect(cmd.addEdge(uc, { from: uid(uc, "clerk"), to: uid(uc, "track") }).kind).toBe("association");
    expect(cmd.addEdge(uc, { from: uid(uc, "track"), to: uid(uc, "pay") })).toMatchObject({ kind: "include", directed: true });
    expect(cmd.addEdge(uc, { from: uid(uc, "apply"), to: uid(uc, "apply") })).toMatchObject({ from: "apply", to: "apply" });
    expect(cmd.addEdge(uc, { from: uid(uc, "apply"), to: uid(uc, "portal") })).toMatchObject({ from: "apply", to: "portal" });
    expect(() => cmd.addEdge(uc, { from: uid(uc, "apply"), to: uid(uc, "pay"), op: "--|>" })).toThrow(/doesn't belong/);
    const cls = parseDoc(fixture("v2/class-shapes.ksd"));
    expect(cmd.addEdge(cls, { from: uid(cls, "Square"), to: uid(cls, "Drawable") }).kind).toBe("realization");
  });
  it("changing what a line means is explicit: ends, label, route and style stay, the kind changes", () => {
    const cls = parseDoc(fixture("v2/class-orders.ksd"));
    const e = cls.edges[0];
    cmd.patchEdge(cls, e.uid, { style: { color: "accent", weight: "bold" }, route: { kind: "straight" } });
    cmd.setRelation(cls, e.uid, "*--");
    expect(e).toMatchObject({ kind: "composition", label: "places", ends: { from: { mult: "1" }, to: { mult: "0..*" } }, style: { color: "accent", weight: "bold" }, route: { kind: "straight" } });
    // a style never changes the meaning: making a line bold and green leaves an association an association
    const again = cls.edges[2];
    cmd.patchEdge(cls, again.uid, { style: { weight: "bold" } });
    expect(again.kind).toBe("association");
    // multiplicities only make sense on associations: they go when the line becomes an inheritance
    cmd.setRelation(cls, e.uid, "--|>");
    expect(e.ends).toBeUndefined();
  });
  it("re-attaching an end keeps the label and style and drops the bends drawn for the old ends", () => {
    const d = parseDoc(FLOW);
    const e = d.edges[2];
    cmd.patchEdge(d, e.uid, { route: { kind: "elbow", via: [[1, 1], [2, 1]], from: "left" }, style: { color: "terra" } });
    cmd.reconnect(d, e.uid, "to", uid(d, "begin"), "top");
    expect(e).toMatchObject({ from: "ok", to: "begin", label: "yes", style: { color: "terra" }, route: { kind: "elbow", from: "left", to: "top" } });
    expect(e.route!.via).toBeUndefined();
    cmd.reconnect(d, e.uid, "to", uid(d, "ok"));
    expect(e).toMatchObject({ from: "ok", to: "ok" });
  });
  it("swapping ends swaps everything that belongs to an end", () => {
    const cls = parseDoc('diagram class\ntitle t\nclass A\nclass B\nA "1 owner" --> "0..* parts" B\nlayout {\n  route A --> B elbow from top to left via 1 2, 3 4\n  label A --> B 0.25 0 0\n}\n');
    const e = cls.edges[0];
    cmd.swapEnds(cls, e.uid);
    expect(e).toMatchObject({ from: "B", to: "A", ends: { from: { mult: "0..*", role: "parts" }, to: { mult: "1", role: "owner" } },
      route: { kind: "elbow", from: "left", to: "top", via: [[3, 4], [1, 2]] }, labelPos: { t: 0.75 } });
  });
  it("copy and paste: fresh ids and identities, lines rewired to the copies, placed at an offset", () => {
    const d = parseDoc(FLOW);
    const f = cmd.copyFragment(d, [uid(d, "a"), uid(d, "ok"), uid(d, "done")]);
    expect(f.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["a>ok", "ok>done"]);
    const at = new Map([[uid(d, "a"), { x: 1, y: 1 }], [uid(d, "ok"), { x: 1, y: 2 }], [uid(d, "done"), { x: 1, y: 3 }]]);
    const made = cmd.pasteFragment(d, f, at, 0.3, 0.3);
    const copies = made.nodes.map((u) => d.nodes.find((n) => n.uid === u)!);
    expect(copies.map((n) => n.id)).toEqual(["a1", "ok1", "done1"]);
    expect(new Set(d.nodes.map((n) => n.uid)).size).toBe(d.nodes.length);
    expect(copies.map((n) => n.place)).toEqual([{ x: 1.3, y: 1.3 }, { x: 1.3, y: 2.3 }, { x: 1.3, y: 3.3 }]);
    const lines = made.edges.map((u) => d.edges.find((e) => e.uid === u)!);
    expect(lines.map((e) => `${e.from}>${e.to}:${e.label ?? ""}`)).toEqual(["a1>ok1:", "ok1>done1:yes"]);
    // the originals are untouched
    expect(d.edges.slice(0, 3).map((e) => `${e.from}>${e.to}`)).toEqual(["begin>a", "a>ok", "ok>done"]);
  });
  it("a copied partition brings its shapes, and the copies belong to the copy", () => {
    const d = parseDoc(fixture("v2/activity-lanes.ksd"));
    const f = cmd.copyFragment(d, [uid(d, "sales")]);
    expect(f.nodes.map((n) => n.id)).toEqual(["sales", "check", "cleared", "cancel", "stop"]);
    const made = cmd.pasteFragment(d, f, new Map(), 5, 0);
    const lane = d.nodes.find((n) => n.uid === made.nodes[0])!;
    expect(lane.kind).toBe("partition");
    expect(d.nodes.filter((n) => n.parent === lane.id).length).toBe(4);
    expect(d.nodes.filter((n) => n.parent === "sales").length).toBe(4);
  });
  it("partitions reorder with their shapes, and membership is a semantic field", () => {
    const d = parseDoc(fixture("v2/activity-lanes.ksd"));
    expect(cmd.movePartition(d, uid(d, "warehouse"), -1)).toBe(true);
    expect(d.nodes.filter((n) => n.kind === "partition").map((n) => n.id)).toEqual(["customer", "warehouse", "sales"]);
    expect(cmd.movePartition(d, uid(d, "customer"), -1)).toBe(false);
    cmd.setParent(d, uid(d, "pack"), "sales");
    expect(d.nodes.find((n) => n.id === "pack")!.parent).toBe("sales");
    expect(toContract(d).nodes.find((n) => n.id === "pack")!.inside).toBe("sales");
  });
  it("kinds change only within a family, and text follows what the new kind can carry", () => {
    const d = parseDoc(FLOW.replace("flowchart", "activity").replace("process a", "action a").replace("start begin", "start begin\nfork f"));
    cmd.changeKind(d, uid(d, "f"), "join");
    expect(d.nodes.find((n) => n.id === "f")!.kind).toBe("join");
    expect(() => cmd.changeKind(d, uid(d, "f"), "action")).toThrow(/can't become/);
    cmd.changeKind(d, uid(d, "ok"), "merge");
    expect(d.nodes.find((n) => n.id === "ok")!.label).toBeNull();
    cmd.changeKind(d, uid(d, "ok"), "decision");
    expect(d.nodes.find((n) => n.id === "ok")!.label).toBe("ok");
  });
});

describe("arranging", () => {
  const boxes: Box[] = [{ id: "a", cx: 1, cy: 1, w: 1, h: 0.5 }, { id: "b", cx: 3, cy: 2, w: 2, h: 1 }, { id: "c", cx: 7, cy: 2.5, w: 1, h: 0.5 }];
  it("align lines the boxes up on their shared bounds", () => {
    expect([...align(boxes, "left").values()].map((p) => p.x)).toEqual([1, 1.5, 1]);
    expect([...align(boxes, "right").values()].map((p) => p.x)).toEqual([7, 6.5, 7]);
    expect([...align(boxes, "middle").values()].map((p) => p.y)).toEqual([1.75, 1.75, 1.75]);
    expect([...align(boxes, "top").values()].map((p) => p.y)).toEqual([1, 1.25, 1]);
    expect(align([boxes[0]], "left").size).toBe(0);
  });
  it("distribute puts equal gaps between boxes and leaves the outer two alone", () => {
    const out = distribute(boxes, "x");
    expect(out.get("a")!.x).toBe(1);
    expect(out.get("c")!.x).toBe(7);
    const gap1 = out.get("b")!.x - 1 - (0.5 + 1), gap2 = 7 - out.get("b")!.x - (1 + 0.5);
    expect(gap1).toBeCloseTo(gap2, 9);
    expect(distribute(boxes.slice(0, 2), "x").size).toBe(0);
  });
  it("match size grows every box to the largest", () => {
    expect([...matchSize(boxes, "width").values()].map((s) => s.w)).toEqual([2, 2, 2]);
    expect([...matchSize(boxes, "height").values()]).toEqual([{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }]);
  });
  it("a drag snaps to a neighbour's edge or center within the tolerance, and reports the guide", () => {
    const moving: Box = { id: "m", cx: 0, cy: 5, w: 1, h: 0.5 };
    const s = snapMove(moving, boxes, 0.96, 0, 0.06);
    expect(s.dx).toBeCloseTo(1, 9); // centers line up at x = 1
    expect(s.guides.length).toBe(1);
    expect(s.guides[0]).toMatchObject({ axis: "x", from: 0.75, to: 5.25 });
    const far = snapMove(moving, boxes, 0.8, 0, 0.06);
    expect(far).toEqual({ dx: 0.8, dy: 0, guides: [] });
    expect(snapGrid(1.07, 0.125)).toBe(1.125);
    expect(bounds(boxes)).toMatchObject({ cx: 4, w: 7 });
  });
});

describe("the router", () => {
  const box = (id: string, cx: number, cy: number): NodeGeom => ({ ...nodeSize(stubMeasurer, { uid: id, id, kind: "process", label: id, step: 0 }), cx, cy });
  const base = { gapFrom: 0, gapTo: 0, flow: "down" as const };
  it("runs straight down between two aligned boxes, bottom to top", () => {
    const a = box("a", 0, 0), b = box("b", 0, 2);
    const r = routeEdge({ ...base, from: a, to: b, kind: "elbow", obstacles: [a, b] });
    expect(r.points).toEqual([[0, a.h / 2], [0, 2 - b.h / 2]]);
    expect([r.fromSide, r.toSide]).toEqual(["bottom", "top"]);
  });
  it("takes one corner when the boxes are offset, and every run is level or upright", () => {
    const a = box("a", 0, 0), b = box("b", 3, 2);
    const r = routeEdge({ ...base, from: a, to: b, kind: "elbow", obstacles: [a, b] });
    expect(r.points.length).toBe(3);
    for (let i = 1; i < r.points.length; i++) expect(r.points[i][0] === r.points[i - 1][0] || r.points[i][1] === r.points[i - 1][1]).toBe(true);
  });
  it("goes around a shape in the way instead of through it", () => {
    const a = box("a", 0, 0), b = box("b", 0, 4), wall = { ...box("w", 0, 2), w: 3 };
    const r = routeEdge({ ...base, from: a, to: b, kind: "elbow", obstacles: [a, b, wall] });
    expect(r.blocked).toBe(false);
    expect(hits(r.points, [a, b, wall], { from: a, to: b })).toBe(0);
    expect(r.points.length).toBeGreaterThan(2);
  });
  it("a loop back goes around the side instead of lying on top of the line that came down", () => {
    const g = resolve(parseDoc("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b\nb -> a\n"), stubMeasurer);
    const [down, up] = g.edges;
    expect([down.fromSide, down.toSide]).toEqual(["bottom", "top"]);
    expect(up.fromSide).not.toBe("top");
    expect(up.toSide).not.toBe("bottom");
    expect(up.points.length).toBeGreaterThanOrEqual(4);
  });
  it("honors a side the author fixed, and corners the author placed", () => {
    const a = box("a", 0, 0), b = box("b", 3, 2);
    const r = routeEdge({ ...base, from: a, to: b, kind: "elbow", fromSide: "left", obstacles: [a, b] });
    expect(r.points[0]).toEqual(sideAnchor(a, "left"));
    const via = routeEdge({ ...base, from: a, to: b, kind: "elbow", via: [[0, 1], [3, 1]], obstacles: [a, b] });
    expect(via.points).toEqual([[0, a.h / 2], [0, 1], [3, 1], [3, 2 - b.h / 2]]);
  });
  it("a straight line is clipped to both outlines, and waypoints are passed through in order", () => {
    const a = box("a", 0, 0), b = box("b", 4, 0);
    expect(routeEdge({ ...base, from: a, to: b, kind: "straight", obstacles: [] }).points).toEqual([[a.w / 2, 0], [4 - b.w / 2, 0]]);
    const bent = routeEdge({ ...base, from: a, to: b, kind: "straight", via: [[2, 1]], obstacles: [] });
    expect(bent.points[1]).toEqual([2, 1]);
    expect(bent.points.length).toBe(3);
  });
  it("path helpers: length, a point at a fraction, the nearest fraction, simplify", () => {
    const pts: Array<[number, number]> = [[0, 0], [2, 0], [2, 2]];
    expect(pathLength(pts)).toBe(4);
    expect(pointAt(pts, 0.75)).toMatchObject({ p: [2, 1], dir: [0, 1], seg: 1 });
    expect(nearestT(pts, [2.5, 1])).toMatchObject({ t: 0.75, d: 0.5 });
    expect(simplify([[0, 0], [1, 0], [1, 0], [2, 0], [2, 1]])).toEqual([[0, 0], [2, 0], [2, 1]]);
  });
});

describe("diagnostics", () => {
  it("the reviewer's findings are unchanged for v1 files, and v2 rules add to them", () => {
    for (const f of ["flow-unlabeled", "usecase-actor-inside", "usecase-permit"]) {
      const d = parseDoc(fixture(`diagrams/${f}.ksd`));
      // the reviewer's wording, locations and severities stay exactly the Python reviewer's; only the ids are added
      const strip = (fs: RuleFinding[]) => fs.map(({ nodes: _n, edges: _e, ...rest }) => rest);
      expect(strip(review(d).findings)).toEqual(lint(toContract(d)).findings);
      expect(rulesV2(d)).toEqual([]);
    }
  });
  it("a finding points at the element it is about, not every element with the same name", () => {
    // two use cases called "track"; only the second is unconnected
    const d = parseDoc('diagram use-case\ntitle t\nactor r "Resident"\nboundary p "Portal" {\n  use-case t1 "track"\n  use-case t2 "track"\n}\nr -- t1\n');
    const iso = review(d).findings.find((f) => f.rule_id === "STRUCT-ISOLATED")!;
    expect(iso.location).toBe("use-case 'track'");
    expect(locate(iso, d)).toEqual({ nodes: ["t2"], edges: [] });
    // two same-named use cases each get their own label note, each pointing at its own shape
    const twins = parseDoc('diagram use-case\ntitle t\nactor r\nboundary p "P" {\n  use-case a "receipts"\n  use-case b "receipts"\n}\nr -- a\nr -- b\n');
    expect(review(twins).findings.filter((f) => f.rule_id === "UC-LABEL-VERB").map((f) => locate(f, twins).nodes)).toEqual([["a"], ["b"]]);
    // edge findings carry the edge's uid, as the v2 rules do
    const cls = parseDoc("diagram class\ntitle t\nclass A\nclass B\nA -- B\n");
    const mult = review(cls).findings.find((f) => f.rule_id === "CLASS-MULTIPLICITY")!;
    expect(locate(mult, cls)).toEqual({ nodes: ["A", "B"], edges: [cls.edges[0].uid] });
  });
  it("partition rules: a node outside every lane, an empty lane, a lone lane", () => {
    const d = parseDoc('diagram activity\ntitle t\npartition a "A" {\n  start s\n  action x\n}\npartition b "B" {\n}\naction loose\ns -> x\nx -> loose\n');
    const ids = rulesV2(d).map((f) => f.rule_id);
    expect(ids).toEqual(["ACT-PARTITION-OUTSIDE", "ACT-PARTITION-EMPTY"]);
    expect(rulesV2(d)[0]).toMatchObject({ severity: "minor", nodes: ["loose"] });
    const strict = parseDoc('diagram activity\nprofile strict-uml\ntitle t\npartition a "A" {\n  start s\n}\naction loose\ns -> loose\n');
    expect(rulesV2(strict).find((f) => f.rule_id === "ACT-PARTITION-OUTSIDE")!.severity).toBe("major");
    expect(rulesV2(strict).map((f) => f.rule_id)).toContain("ACT-PARTITION-SINGLE");
  });
  it("class rules: an inheritance cycle, a realization of a class, an abstract operation in a concrete class, a duplicate member", () => {
    const d = parseDoc("diagram class\ntitle t\nclass A {\n  +run(): void {abstract}\n  +x: int\n  -x: int\n}\nclass B\nclass C\nA --|> B\nB --|> C\nC --|> A\nA ..|> B\n");
    const by = new Map(rulesV2(d).map((f) => [f.rule_id, f]));
    expect(by.get("CLASS-GENERALIZATION-CYCLE")).toMatchObject({ severity: "major" });
    expect(by.get("CLASS-REALIZATION-TARGET")).toMatchObject({ severity: "minor", nodes: ["A", "B"] });
    expect(by.get("CLASS-ABSTRACT-OPERATION")!.problem).toBe("run is abstract, but the class is not.");
    expect(by.get("CLASS-DUPLICATE-MEMBER")!.problem).toBe("x: int is listed twice.");
    expect(review(d).status).toBe("changes-required");
    expect(rulesV2(parseDoc(fixture("v2/class-shapes.ksd")))).toEqual([]);
  });
  it("use-case description rules keep the trigger and the precondition apart", () => {
    const d = parseDoc('diagram use-case\ntitle t\nactor a "Ann"\nactor b "Bob"\nboundary s "S" {\n  use-case u "do it"\n}\na -- u\ndescribe u {\n  primary b\n  trigger The form is opened\n  pre The form is opened\n}\n');
    const ids = rulesV2(d).map((f) => f.rule_id);
    expect(ids).toEqual(["UC-DESCRIBE-PRIMARY", "UC-DESCRIBE-MAIN", "UC-DESCRIBE-TRIGGER"]);
    expect(rulesV2(d)[0].problem).toBe("Bob is the primary actor in the description but isn't linked to this use case.");
    expect(rulesV2(parseDoc(fixture("v2/usecase-described.ksd")))).toEqual([]);
  });
  it("a line from a shape to itself is reported only where it can't be true", () => {
    const self = (text: string) => rulesV2(parseDoc(text)).filter((f) => f.rule_id === "STRUCT-SELF-LINE");
    // a class associated with itself and a step that repeats are good notation
    expect(self("diagram class\ntitle t\nclass A\nA -- A\nA o-- A\n")).toEqual([]);
    expect(self("diagram activity\ntitle t\nstart s\naction a\nend e\ns -> a\na -> a : again\na -> e\n")).toEqual([]);
    expect(self("diagram class\ntitle t\nclass A\nA ..> A\n")[0]).toMatchObject({ severity: "major", nodes: ["A"], problem: "A class can't depend on itself." });
    const uc = self("diagram use-case\ntitle t\nactor a\nuse-case u\na -- u\nu -include-> u\na -- a\n");
    expect(uc.map((f) => f.problem)).toEqual(["A use case can't include itself.", "This line joins a shape to itself."]);
    // a class that is its own parent is the cycle rule's
    expect(rulesV2(parseDoc("diagram class\ntitle t\nclass A\nA --|> A\n")).map((f) => f.rule_id)).toEqual(["CLASS-GENERALIZATION-CYCLE"]);
  });
  it("every finding names its elements and the line to underline", () => {
    const p = parseSource(fixture("diagrams/flow-unlabeled.ksd"));
    const r = review(p.doc!);
    const refs = locate(r.findings[0], p.doc!);
    expect(refs.nodes).toEqual(["ok"]);
    const issues = allIssues(p, r, { errors: ["LINE_THROUGH_TEXT e1 crosses 'x'"], warnings: [] });
    const guard = issues.find((i) => i.rule_id === "FLOW-DECISION-GUARD")!;
    expect(guard).toMatchObject({ source: "notation", severity: "major", nodes: ["ok"] });
    expect(p.lines[guard.at!.line - 1]).toContain("decision ok");
    expect(issues.find((i) => i.source === "layout")).toMatchObject({ rule_id: "LINE_THROUGH_TEXT", severity: "error" });
    const dangling = parseSource(fixture("diagrams/dangling.ksd"));
    const di = allIssues(dangling, review(dangling.doc!), null);
    expect(di.find((i) => i.source === "reference")).toMatchObject({ rule_id: "PARSE-UNKNOWN-NODE", severity: "warning" });
    const edgeFinding = di.find((i) => i.rule_id === "STRUCT-DANGLING-EDGE")!;
    expect(edgeFinding.edges).toEqual([dangling.doc!.edges[1].uid]);
    expect(dangling.lines[edgeFinding.at!.line - 1]).toBe("review -> archive");
    const bad = parseSource("diagram flowchart\ntitle t\nwidget a\n");
    expect(allIssues(bad, null, null)).toEqual([{ source: "syntax", severity: "error", rule_id: "PARSE", problem: "unknown kind 'widget'", nodes: [], edges: [], at: { line: 3, col: 0, endCol: 6 } }]);
  });
  it("class diagrams get the reviewer's multiplicity note through the contract", () => {
    const d = parseDoc("diagram class\ntitle t\nclass A\nclass B\nA -- B\n");
    expect(review(d).findings.map((f) => f.rule_id)).toContain("CLASS-MULTIPLICITY");
    expect(review(parseDoc(fixture("v2/class-orders.ksd"))).findings.map((f) => f.rule_id)).not.toContain("CLASS-MULTIPLICITY");
  });
  it("cloning a document for an edit never shares state with the original", () => {
    const d = parseDoc(FLOW), c = cloneDoc(d);
    cmd.setLabel(c, c.nodes[1].uid, "changed");
    expect(d.nodes[1].label).toBe("a");
  });
});
