import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parseDoc } from "../src/core/doc/parse";
import type { ChalkDoc } from "../src/core/doc/types";
import { stubMeasurer, PX } from "../src/core/measure";
import { resolve, drawnPath, gaps, type Geometry } from "../src/core/geom/resolve";
import { hits, pathLength } from "../src/core/geom/route";
import { boxOf, contains, edgePoint, nodeSize, type NodeGeom } from "../src/core/geom/shape";
import { buildScene, paintBounds, MARGIN, type Scene } from "../src/core/render/scene";
import { sceneToSvg, portableSvg, exportPalette, esc } from "../src/core/render/svg";
import { checkScene } from "../src/core/qa";

const dirs = [new URL("../fixtures/diagrams/", import.meta.url), new URL("../fixtures/v2/", import.meta.url)];
const fixtures = dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".ksd")).sort().map((f) => [f, readFileSync(new URL(f, dir), "utf8")] as const));
const docs = new Map<string, ChalkDoc>(fixtures.map(([f, src]) => [f, parseDoc(src)]));
const geos = new Map<string, Geometry>([...docs].map(([f, d]) => [f, resolve(d, stubMeasurer)]));
const scenes = new Map<string, Scene>([...docs].map(([f, d]) => [f, buildScene(d, geos.get(f)!, stubMeasurer)]));
const doc = (text: string): ChalkDoc => parseDoc(text);
const geo = (text: string): Geometry => resolve(doc(text), stubMeasurer);

const overlap = (a: NodeGeom, b: NodeGeom) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;
const solid = (g: Geometry): NodeGeom[] => [...g.nodes.values()].filter((n) => n.shape !== "container" && n.shape !== "lane");

describe("layout: every fixture", () => {
  it("has the nine v1 fixtures and the v2 gallery", () => expect(fixtures.length).toBeGreaterThanOrEqual(17));
  for (const [f] of fixtures) {
    const g = geos.get(f)!, sc = scenes.get(f)!, d = docs.get(f)!;
    it(`${f}: no shape overlaps another`, () => {
      const nodes = solid(g);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlap(nodes[i], nodes[j]), `${nodes[i].id} vs ${nodes[j].id}`).toBe(false);
    });
    it(`${f}: the frame is tight around all the ink and text`, () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of sc.elements) for (const p of el.paints) {
        const b = paintBounds(p);
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
      }
      for (const t of sc.texts) { x0 = Math.min(x0, t.box[0] / PX); y0 = Math.min(y0, t.box[1] / PX); x1 = Math.max(x1, t.box[2] / PX); y1 = Math.max(y1, t.box[3] / PX); }
      expect(x0).toBeCloseTo(MARGIN, 6);
      expect(y0).toBeCloseTo(MARGIN, 6);
      expect(sc.w - x1).toBeCloseTo(MARGIN, 6);
      expect(sc.h - y1).toBeCloseTo(MARGIN, 6);
      expect(sc.steps).toBe(Math.max(0, ...d.nodes.map((n) => n.step), ...d.edges.map((e) => e.step)));
    });
    it(`${f}: every line is long enough to read, ends on its shapes' outlines and runs through nothing`, () => {
      for (const e of g.edges) {
        const from = g.nodes.get(e.from)!, to = g.nodes.get(e.to)!;
        const path = drawnPath(e);
        expect(pathLength(path), `${e.from} -> ${e.to}`).toBeGreaterThanOrEqual(0.4);
        const [gf, gt] = gaps(e.kind);
        for (const [p, n, gap] of [[e.points[0], from, gf], [e.points[e.points.length - 1], to, gt]] as const) {
          if (n.shape === "actor") continue; // an actor's anchors sit on its figure, inside its label box
          expect(contains(n, p[0], p[1], -0.01), `${e.id} starts or ends inside ${n.id}`).toBe(false);
          expect(contains(n, p[0], p[1], gap + 0.03), `${e.id} floats away from ${n.id}`).toBe(true);
        }
        if (!e.blocked) expect(hits(path, solid(g), { from, to }), `${e.from} -> ${e.to} crosses a shape`).toBe(0);
        if (e.routeKind === "elbow") for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1], b = e.points[i];
          expect(Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6, `${e.id} has a slanted run`).toBe(true);
        }
      }
    });
    it(`${f}: no two elbow lines run along one channel, so two lines never read as one`, () => {
      const elbows = g.edges.filter((e) => e.routeKind === "elbow" && !e.manual);
      for (let i = 0; i < elbows.length; i++) for (let j = i + 1; j < elbows.length; j++) {
        const a = elbows[i], b = elbows[j];
        for (let m = 1; m < a.points.length; m++) for (let n = 1; n < b.points.length; n++) {
          const [p0, p1, q0, q1] = [a.points[m - 1], a.points[m], b.points[n - 1], b.points[n]];
          for (const k of [0, 1]) {
            const u = 1 - k;
            if (Math.abs(p0[k] - p1[k]) > 1e-6 || Math.abs(q0[k] - q1[k]) > 1e-6 || Math.abs(p0[k] - q0[k]) >= 0.1) continue;
            const over = Math.min(Math.max(p0[u], p1[u]), Math.max(q0[u], q1[u])) - Math.max(Math.min(p0[u], p1[u]), Math.min(q0[u], q1[u]));
            // two arrows may land on the same spot of the same shape, sharing the last stub and no more
            const landing = a.to === b.to && m === a.points.length - 1 && n === b.points.length - 1 && over <= 0.33;
            if (!landing) expect(over, `${a.from} -> ${a.to} and ${b.from} -> ${b.to} share a run`).toBeLessThanOrEqual(0.03);
          }
        }
      }
    });
    it(`${f}: resolving twice gives the same answer`, () => {
      expect(JSON.stringify([...resolve(d, stubMeasurer).nodes.values()])).toBe(JSON.stringify([...g.nodes.values()]));
      expect(resolve(d, stubMeasurer).edges.map((e) => e.points)).toEqual(g.edges.map((e) => e.points));
    });
    for (const look of ["sketch", "precision"] as const) {
      it(`${f}: no layout errors in the ${look} look`, () => {
        const s = buildScene(d, g, stubMeasurer, { look });
        expect(checkScene(s, { minDisplayPx: 2000 }).errors).toEqual([]);
      });
    }
  }
});

describe("use-case layout", () => {
  const inside = (n: NodeGeom, b: NodeGeom) => n.cx - n.w / 2 > b.cx - b.w / 2 && n.cx + n.w / 2 < b.cx + b.w / 2 && n.cy - n.h / 2 > b.cy - b.h / 2 && n.cy + n.h / 2 < b.cy + b.h / 2;
  for (const [f] of fixtures.filter(([f]) => f.startsWith("usecase"))) {
    it(`${f}: actors outside, use cases inside`, () => {
      const g = geos.get(f)!;
      const b = [...g.nodes.values()].find((n) => n.kind === "boundary")!;
      for (const n of g.nodes.values()) {
        if (n.kind === "use-case") expect(inside(n, b), n.id).toBe(true);
        if (n.kind === "actor") expect(inside(n, b), n.id).toBe(f === "usecase-actor-inside.ksd");
      }
    });
  }
  it("usecase-permit: include runs from base to included, extend from extension to base, right actor on the right", () => {
    const g = geos.get("usecase-permit.ksd")!;
    const inc = g.edges.find((e) => e.kind === "include")!, ext = g.edges.find((e) => e.kind === "extend")!;
    expect([inc.from, inc.to]).toEqual(["apply", "pay"]);
    expect([ext.from, ext.to]).toEqual(["waiver", "pay"]);
    const b = g.nodes.get("portal")!;
    expect(g.nodes.get("clerk")!.cx).toBeGreaterThan(b.cx + b.w / 2);
    expect(g.nodes.get("resident")!.cx).toBeLessThan(b.cx - b.w / 2);
    // pay sits in the row of apply, in a second column; waiver is pushed to the next row
    expect(g.nodes.get("pay")!.cy).toBeCloseTo(g.nodes.get("apply")!.cy, 9);
    expect(g.nodes.get("pay")!.cx).toBeGreaterThan(g.nodes.get("apply")!.cx);
    expect(g.nodes.get("waiver")!.cy).toBeGreaterThan(g.nodes.get("pay")!.cy);
    expect(g.nodes.get("resident")!.cy).toBeCloseTo((g.nodes.get("apply")!.cy + g.nodes.get("track")!.cy) / 2, 9);
    // the stereotype reads above its line
    const t = g.texts.find((x) => x.name === `${inc.id}:stereotype`)!;
    expect(t.s).toBe("«include»");
    expect(t.cy).toBeLessThan(g.nodes.get("apply")!.cy);
  });
  it("a use case that only a right-hand actor uses stands in the far column, next to that actor", () => {
    for (const [f, actor, uc, near] of [["usecase-permit.ksd", "clerk", "review", "apply"], ["usecase-described.ksd", "librarian", "catalog", "borrow"]] as const) {
      const g = geos.get(f)!;
      const a = g.nodes.get(actor)!, u = g.nodes.get(uc)!, n = g.nodes.get(near)!;
      expect(u.cx, f).toBeGreaterThan(n.cx + n.w / 2);
      expect(a.cy, f).toBeCloseTo(u.cy, 9);
      // its line is short: it no longer runs the width of the system
      const line = g.edges.find((e) => (e.from === actor && e.to === uc) || (e.from === uc && e.to === actor))!;
      expect(pathLength(line.points), f).toBeLessThan(2);
    }
    // with nothing to keep in the near column there is no far one
    const one = geo('diagram use-case\ntitle one actor, on the right\nactor a "A" right\nboundary s "S" {\n  use-case x "x"\n  use-case y "y"\n}\na -- x\na -- y');
    expect(one.nodes.get("x")!.cx).toBeCloseTo(one.nodes.get("y")!.cx, 9);
  });
  it("a line that would cross a use case it doesn't join swings around it", () => {
    const g = geos.get("usecase-actor-inside.ksd")!;
    const bent = g.edges.filter((e) => e.smooth);
    expect(bent.length).toBe(1);
    expect(bent[0].points.length).toBe(3);
    const borrow = g.nodes.get("borrow")!;
    expect(Math.min(...drawnPath(bent[0]).map((p) => p[0]))).toBeLessThan(borrow.cx - borrow.w / 2 - 0.2);
  });
  it("a boundary fits what is inside it, and follows a use case that was placed by hand", () => {
    const base = 'diagram use-case\ntitle t\nactor a\nboundary b "B" {\nuse-case u "one"\nuse-case v "two"\n}\na -- u\na -- v\n';
    const g0 = geo(base), g1 = geo(base + "layout {\n  place v 6 4\n}\n");
    expect(g1.nodes.get("v")!.cx).toBe(6);
    expect(g1.nodes.get("b")!.w).toBeGreaterThan(g0.nodes.get("b")!.w + 1);
    const b = g1.nodes.get("b")!;
    expect(boxOf(b)[2]).toBeGreaterThan(6 + g1.nodes.get("v")!.w / 2);
    // nothing else moved
    expect(g1.nodes.get("u")!.cx).toBeCloseTo(g0.nodes.get("u")!.cx, 9);
  });
});

describe("flow layout", () => {
  it("fork and join bars span their branches, and lines meet them square-on", () => {
    const g = geos.get("activity-parallel.ksd")!;
    const laptop = g.nodes.get("laptop")!, badge = g.nodes.get("badge")!;
    for (const id of ["split", "wait"]) {
      const bar = g.nodes.get(id)!;
      expect(bar.h).toBeCloseTo(0.075, 9);
      expect(bar.cx - bar.w / 2).toBeLessThan(Math.min(laptop.cx, badge.cx) - 0.2);
      expect(bar.cx + bar.w / 2).toBeGreaterThan(Math.max(laptop.cx, badge.cx) + 0.2);
    }
    for (const e of g.edges) {
      if (g.nodes.get(e.from)!.shape !== "bar" && g.nodes.get(e.to)!.shape !== "bar") continue;
      expect(e.points.length, `${e.from} -> ${e.to}`).toBe(2);
      expect(e.points[0][0]).toBeCloseTo(e.points[1][0], 9);
    }
  });
  it("direction right lays out left to right with upright bars", () => {
    const src = "diagram activity\ntitle t\ndirection right\nstart s\nfork f\naction a\naction b\njoin j\nend e\ns -> f\nf -> a\nf -> b\na -> j\nb -> j\nj -> e";
    const g = geo(src);
    expect(g.nodes.get("e")!.cx).toBeGreaterThan(g.nodes.get("s")!.cx + 2);
    expect(g.nodes.get("f")!.vertical).toBe(true);
    expect(g.nodes.get("f")!.w).toBeCloseTo(0.075, 9);
    const forced = resolve(doc(src), stubMeasurer, { direction: "down" });
    expect(forced.nodes.get("e")!.cy).toBeGreaterThan(forced.nodes.get("s")!.cy + 2);
  });
  it("a decision's two answers leave from two different corners, each with its guard beside it", () => {
    const g = geos.get("flow-approval.ksd")!;
    const exits = g.edges.filter((e) => e.from === "ok");
    expect(new Set(exits.map((e) => e.fromSide)).size).toBe(2);
    for (const e of exits) {
      const t = g.texts.find((x) => x.name === `${e.id}:label`)!;
      expect(["yes", "no"]).toContain(t.s);
      const ok = g.nodes.get("ok")!;
      expect(Math.hypot(t.x - ok.cx, t.cy - ok.cy)).toBeLessThan(ok.w);
    }
  });
  it("two answers under a wide decision stand out past its corners, so each line leaves a corner and turns once", () => {
    const g = geos.get("activity-decision-merge.ksd")!;
    const how = g.nodes.get("how")!;
    const yes = g.edges.find((e) => e.from === "how" && e.to === "password")!, no = g.edges.find((e) => e.from === "how" && e.to === "code")!;
    expect([yes.fromSide, yes.toSide, yes.points.length]).toEqual(["left", "top", 3]);
    expect([no.fromSide, no.toSide, no.points.length]).toEqual(["right", "top", 3]);
    expect(g.nodes.get("password")!.cx).toBeLessThanOrEqual(how.cx - how.w / 2 - 0.3 + 1e-6);
    expect(g.nodes.get("code")!.cx).toBeGreaterThanOrEqual(how.cx + how.w / 2 + 0.3 - 1e-6);
    // and the two paths come back into the merge at two different corners
    const back = g.edges.filter((e) => e.to === "together");
    expect(new Set(back.map((e) => e.toSide))).toEqual(new Set(["left", "right"]));
    expect(back.map((e) => e.fromSide)).toEqual(["bottom", "bottom"]);
  });
  it("a later line keeps out of the channel an earlier one runs in", () => {
    const g = geos.get("flow-branched.ksd")!;
    const loop = g.edges.find((e) => e.from === "fixed" && e.to === "fix")!, help = g.edges.find((e) => e.from === "faq" && e.to === "done")!;
    // the loop back leaves the decision level with the help article; the help article's line must not join it
    expect(loop.fromSide).toBe("right");
    expect(help.fromSide).toBe("bottom");
    expect(help.toSide).toBe("right");
  });
  it("placed nodes sit where `at` says, and placing one moves no other", () => {
    const base = "diagram flowchart\ntitle t\nstart s\nprocess a\nprocess b\nend e\ns -> a\na -> b\nb -> e";
    const g0 = geo(base), g1 = geo(base.replace("process a", "process a at 5 1.5"));
    expect([g1.nodes.get("a")!.cx, g1.nodes.get("a")!.cy]).toEqual([5, 1.5]);
    for (const id of ["s", "b", "e"]) {
      expect(g1.nodes.get(id)!.cx).toBeCloseTo(g0.nodes.get(id)!.cx, 9);
      expect(g1.nodes.get(id)!.cy).toBeCloseTo(g0.nodes.get(id)!.cy, 9);
    }
  });
  it("skips lines to shapes that aren't declared", () => {
    const g = geos.get("dangling.ksd")!;
    expect(g.edges.map((e) => e.to)).not.toContain("archive");
  });
  it("an explicit size is kept, text wraps to it, and the shape never gets smaller than its longest word", () => {
    const g = geo('diagram flowchart\ntitle t\nprocess a "schedule the maintenance work"\nlayout {\n  size a 1.6 0.5\n}\n');
    const a = g.nodes.get("a")!;
    expect(a.w).toBeCloseTo(Math.max(1.6, a.minW), 9);
    expect(a.lines.length).toBeGreaterThan(1);
    expect(a.h).toBeGreaterThan(0.5);
    expect(a.minW).toBeGreaterThan(stubMeasurer.measure("maintenance", 22, 400).adv / PX);
  });
});

describe("partitions", () => {
  const g = geos.get("activity-lanes.ksd")!;
  const lanes = ["customer", "sales", "warehouse"].map((id) => g.nodes.get(id)!);
  it("lanes sit side by side, share one top and one height, and hold their own nodes", () => {
    for (let i = 1; i < lanes.length; i++) {
      expect(boxOf(lanes[i])[0]).toBeCloseTo(boxOf(lanes[i - 1])[2], 9);
      expect(lanes[i].cy).toBeCloseTo(lanes[0].cy, 9);
      expect(lanes[i].h).toBeCloseTo(lanes[0].h, 9);
    }
    const d = docs.get("activity-lanes.ksd")!;
    for (const n of d.nodes) {
      if (!n.parent) continue;
      const [x0, y0, x1, y1] = boxOf(g.nodes.get(n.parent)!);
      const [a, b, c, e] = boxOf(g.nodes.get(n.id)!);
      expect(a >= x0 && c <= x1 && b >= y0 + (g.nodes.get(n.parent)!.header ?? 0) && e <= y1, `${n.id} in ${n.parent}`).toBe(true);
    }
  });
  it("a line may cross from lane to lane; the flow still runs down", () => {
    const cross = g.edges.find((e) => e.from === "pay" && e.to === "check")!;
    expect(cross.points[cross.points.length - 1][0]).toBeGreaterThan(boxOf(lanes[0])[2]);
    expect(g.nodes.get("ship")!.cy).toBeGreaterThan(g.nodes.get("place")!.cy);
  });
  it("horizontal lanes are rows, flow runs left to right, and the title band is on the left", () => {
    const h = resolve(doc(fixtures.find(([f]) => f === "activity-lanes.ksd")![1].replace("title ", "lanes horizontal\ntitle ")), stubMeasurer);
    const rows = ["customer", "sales", "warehouse"].map((id) => h.nodes.get(id)!);
    expect(h.direction).toBe("right");
    for (let i = 1; i < rows.length; i++) expect(boxOf(rows[i])[1]).toBeCloseTo(boxOf(rows[i - 1])[3], 9);
    expect(rows[0].horizontal).toBe(true);
    expect(h.nodes.get("ship")!.cx).toBeGreaterThan(h.nodes.get("place")!.cx);
    const title = h.texts.find((t) => t.name === "customer:title")!;
    expect(title.x).toBeLessThan(boxOf(rows[0])[0] + (rows[0].header ?? 0));
  });
  it("an explicit thickness is kept, and the next lane starts where it ends", () => {
    const src = fixtures.find(([f]) => f === "activity-lanes.ksd")![1] + "layout {\n  lane customer 4\n}\n";
    const w = resolve(doc(src), stubMeasurer);
    expect(w.nodes.get("customer")!.w).toBe(4);
    expect(boxOf(w.nodes.get("sales")!)[0]).toBeCloseTo(boxOf(w.nodes.get("customer")!)[2], 9);
  });
});

describe("classes", () => {
  const g = geos.get("class-shapes.ksd")!;
  it("a class box has a name compartment, then attributes, then operations, each row inside the box", () => {
    const shape = g.nodes.get("Shape")!;
    expect(shape.cls!.dividers.length).toBe(2);
    expect(shape.cls!.rows.map((r) => r.role)).toEqual(["name", "note", "member", "member", "member"]);
    expect(shape.cls!.rows.find((r) => r.role === "note")!.text).toBe("{abstract}");
    for (const r of shape.cls!.rows) expect(r.cy).toBeLessThan(shape.h);
    expect(g.nodes.get("Square")!.cls!.dividers.length).toBe(0);
    expect(g.nodes.get("Drawable")!.cls!.rows[0].text).toBe("«interface»");
  });
  it("a parent sits above its children whichever way the line was written", () => {
    expect(g.nodes.get("Shape")!.cy).toBeLessThan(g.nodes.get("Circle")!.cy);
    expect(g.nodes.get("Rectangle")!.cy).toBeLessThan(g.nodes.get("Square")!.cy);
    const up = g.edges.find((e) => e.from === "Circle" && e.to === "Shape")!;
    expect([up.fromSide, up.toSide]).toEqual(["top", "bottom"]);
  });
  it("multiplicities stand at their own ends of the line", () => {
    const o = geos.get("class-orders.ksd")!;
    const places = o.edges.find((e) => e.from === "Customer" && e.to === "Order")!;
    const a = o.texts.find((t) => t.name === `${places.id}:from-mult`)!, b = o.texts.find((t) => t.name === `${places.id}:to-mult`)!;
    expect([a.s, b.s]).toEqual(["1", "0..*"]);
    const customer = o.nodes.get("Customer")!, order = o.nodes.get("Order")!;
    expect(Math.hypot(a.x - customer.cx, a.cy - customer.cy)).toBeLessThan(Math.hypot(a.x - order.cx, a.cy - order.cy));
    expect(Math.hypot(b.x - order.cx, b.cy - order.cy)).toBeLessThan(Math.hypot(b.x - customer.cx, b.cy - customer.cy));
  });
});

describe("shapes", () => {
  it("decision text corners clear the sides", () => {
    const g = nodeSize(stubMeasurer, { uid: "u", id: "d", kind: "decision", label: "is the request complete and paid?", step: 0 });
    expect((g.tw / 2 + 0.06) / (g.w / 2) + (g.th / 2 + 0.04) / (g.h / 2)).toBeLessThanOrEqual(1 + 1e-9);
  });
  it("edge points land on the outline plus the gap", () => {
    const box = nodeSize(stubMeasurer, { uid: "u", id: "b", kind: "process", label: "x", step: 0 });
    box.cx = 1; box.cy = 1;
    expect(edgePoint(box, [1, 5], 0.06)[1]).toBeCloseTo(1 + box.h / 2 + 0.06, 9);
    const uc = nodeSize(stubMeasurer, { uid: "u", id: "u", kind: "use-case", label: "pay fee", step: 0 });
    expect(edgePoint(uc, [3, 0], 0)[0]).toBeCloseTo(uc.w / 2, 9);
    const dia = nodeSize(stubMeasurer, { uid: "u", id: "d", kind: "decision", label: "ok?", step: 0 });
    const q = edgePoint(dia, [1, 1], 0);
    expect(Math.abs(q[0]) / (dia.w / 2) + Math.abs(q[1]) / (dia.h / 2)).toBeCloseTo(1, 9);
  });
});

describe("the two looks", () => {
  it("draw the same geometry: same shapes, same routes, same label centers", () => {
    for (const [f] of fixtures) {
      const d = docs.get(f)!, g = geos.get(f)!;
      const a = buildScene(d, g, stubMeasurer, { look: "sketch", frame: false }), b = buildScene(d, g, stubMeasurer, { look: "precision", frame: false });
      expect(a.nodes.map((n) => [n.id, n.cx, n.cy, n.w, n.h])).toEqual(b.nodes.map((n) => [n.id, n.cx, n.cy, n.w, n.h]));
      expect(a.edges.map((e) => e.points)).toEqual(b.edges.map((e) => e.points));
      expect(a.texts.map((t) => [t.name, t.s, t.x])).toEqual(b.texts.map((t) => [t.name, t.s, t.x]));
      expect(b.texts.every((t) => t.family === "body")).toBe(true);
      expect(a.texts.every((t) => t.family === "hand")).toBe(true);
    }
  });
  it("precision uses real strokes; sketch uses pen polygons only", () => {
    const d = docs.get("flow-approval.ksd")!, g = geos.get("flow-approval.ksd")!;
    const kinds = (look: "sketch" | "precision") => new Set(buildScene(d, g, stubMeasurer, { look }).elements.flatMap((e) => e.paints.map((p) => p.t)));
    expect([...kinds("sketch")]).toEqual(["poly"]);
    expect(kinds("precision").has("line")).toBe(true);
    expect(sceneToSvg(buildScene(d, g, stubMeasurer, { look: "precision" }))).toMatch(/class="k-page ks-ink" stroke-width="[0-9.]+" stroke-linecap="round"/);
  });
  it("a style changes ink without changing meaning or geometry", () => {
    const plain = 'diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b\n';
    const styled = plain + "layout {\n  style a fill wash color accent weight bold\n  style a -> b color terra weight bold\n}\n";
    const g0 = geo(plain), g1 = geo(styled);
    expect(g1.edges[0].points).toEqual(g0.edges[0].points);
    expect(g1.edges[0].kind).toBe("arrow");
    const sc = buildScene(doc(styled), g1, stubMeasurer, { look: "precision" });
    const a = sc.elements.find((e) => e.name === "a")!.paints[0];
    expect(a).toMatchObject({ fill: "wash", stroke: "accent" });
    const line = sc.elements.find((e) => e.kind === "edge")!.paints[0];
    expect(line).toMatchObject({ stroke: "terra" });
    expect((line as { sw: number }).sw).toBeGreaterThan((buildScene(doc(plain), g0, stubMeasurer, { look: "precision" }).elements.find((e) => e.kind === "edge")!.paints[0] as { sw: number }).sw);
  });
});

describe("svg for the page", () => {
  const hostile = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "]]>", "a & b", "it's"];
  it("escapes every label, title and desc", () => {
    for (const bad of hostile) {
      const q = bad.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const d = doc(`diagram use-case\ntitle T ${q}\ndesc D ${q}\nactor a "A ${q}"\nboundary b "B ${q}" {\nuse-case u "U ${q}"\nuse-case v "V ${q}"\n}\na -- u : L ${q}\nu -include-> v\nnote n "N ${q}"`);
      for (const look of ["sketch", "precision"] as const) {
        const sc = buildScene(d, resolve(d, stubMeasurer), stubMeasurer, { look });
        for (const svg of [sceneToSvg(sc), portableSvg(sc)]) {
          expect(svg).not.toContain("<script");
          expect(svg).not.toContain("<img");
          expect(svg).not.toContain("]]>");
          expect(svg).toContain(esc(bad));
          const tags = svg.match(/<[a-zA-Z/][^>]*>/g)!.map((t) => t.replace(/^<\/?/, "").split(/[\s>/]/)[0]);
          for (const t of tags) expect(["svg", "title", "desc", "g", "path", "text", "ellipse", "rect", "style"]).toContain(t);
        }
      }
    }
  });
  it("a class member with markup in it is text, in both writers", () => {
    const d = doc('diagram class\ntitle t\nclass A {\n  +x: List<b>&"c"\n}\n');
    const sc = buildScene(d, resolve(d, stubMeasurer), stubMeasurer);
    expect(sceneToSvg(sc)).toContain("+x: List&lt;b&gt;&amp;&quot;c&quot;");
  });
  it("uses role classes only, with title, desc and data-step", () => {
    const svg = sceneToSvg(scenes.get("activity-parallel.ksd")!);
    expect(svg).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(svg).toMatch(/<title id="fig-t">/);
    expect(svg).toMatch(/<desc id="fig-d">/);
    expect(svg).toContain('aria-labelledby="fig-t fig-d"');
    expect(svg).toContain('class="k-page"');
    expect(svg).toContain('data-name="split" data-kind="node" data-step="1"');
    expect(svg).toContain('data-name="wait" data-kind="node" data-step="2"');
    expect(svg).toMatch(/<text class="k-hand k-ink" data-name="laptop:label" data-step="1"/);
    expect(svg).not.toMatch(/data-name="begin"[^>]* data-step/);
    expect(svg.match(/ d="M([0-9.]+) /)![1]).toMatch(/^[0-9]+\.[0-9]$/);
  });
});

describe("portable svg (the export)", () => {
  const sc = scenes.get("usecase-permit.ksd")!;
  it("stands alone: plain color attributes, no classes, no CSS variables, nothing that follows the viewer's theme", () => {
    const svg = portableSvg(sc, { theme: "light", backdrop: "white" });
    expect(svg).not.toContain("var(");
    expect(svg).not.toContain("class=");
    expect(svg).not.toContain("prefers-color-scheme");
    expect(svg).not.toContain("@media");
    expect(svg).toContain('<rect width="' + Math.round(sc.w * PX) + '" height="' + Math.round(sc.h * PX) + '" fill="#FFFFFF"/>');
    expect(svg).toContain('fill="#242B27"');
    // shapes are filled with the backdrop's own color, never a second off-white
    expect(svg).not.toContain("#FAFAF6");
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
  it("dark is a choice, written into the file", () => {
    const svg = portableSvg(sc, { theme: "dark", backdrop: "page" });
    expect(svg).toContain('fill="#1E2521"/>');
    expect(svg).toContain('fill="#ECEAE2"');
    expect(svg).not.toContain("#242B27");
  });
  it("a transparent export has no backdrop and no page-colored fills at all", () => {
    const d = docs.get("usecase-permit.ksd")!;
    const clear = buildScene(d, geos.get("usecase-permit.ksd")!, stubMeasurer, { knockouts: false });
    const svg = portableSvg(clear, { backdrop: "transparent" });
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("#FAFAF6");
    expect(svg).not.toContain("#FFFFFF");
  });
  it("text keeps its measured width where the font is missing, and names a fallback", () => {
    const svg = portableSvg(sc);
    expect(svg).toMatch(/<text font-family="Kalam, [^"]+cursive" fill="#242B27" x="[0-9.]+" y="[0-9.]+" font-size="22" text-anchor="middle" textLength="[0-9.]+" lengthAdjust="spacingAndGlyphs">apply for permit<\/text>/);
  });
  it("embeds the fonts it is given, each with its range, and only those the text uses", () => {
    const svg = portableSvg(sc, { fonts: { "hand-400": [{ data: "AAAA", range: "U+0000-00FF" }], "body-700": [{ data: "BBBB" }] } });
    expect(svg).toContain("@font-face{font-family:'Kalam';font-weight:400;src:url(data:font/woff2;base64,AAAA) format('woff2');unicode-range:U+0000-00FF}");
    expect(svg).not.toContain("BBBB");
  });
  it("with outlines, the letters are shapes: no text, no fonts, and each shape keeps its words as its name", () => {
    const outlines = sc.texts.map((_, i) => `M${i} 0L1 1Z`);
    const svg = portableSvg(sc, { outlines, fonts: { "hand-400": [{ data: "AAAA" }] } });
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("font-family");
    sc.texts.forEach((t, i) => expect(svg).toContain(`<path d="M${i} 0L1 1Z" fill="${exportPalette("light", "page")[t.role]}"><title>${esc(t.s)}</title></path>`));
    // a label with nothing to draw (only spaces) leaves nothing behind
    expect(portableSvg(sc, { outlines: sc.texts.map(() => "") })).not.toContain('<path d=""');
  });
  it("padding is the margin around the ink, and size attributes can be set without changing the picture", () => {
    const d = docs.get("flow-approval.ksd")!, g = geos.get("flow-approval.ksd")!;
    const tight = buildScene(d, g, stubMeasurer, { margin: 0.1 }), roomy = buildScene(d, g, stubMeasurer, { margin: 0.5 });
    expect(roomy.w - tight.w).toBeCloseTo(0.8, 9);
    expect(checkScene(tight).errors).toEqual([]);
    const big = portableSvg(tight, { width: 2000, height: 3000 });
    expect(big).toContain(`viewBox="0 0 ${Math.round(tight.w * PX)} ${Math.round(tight.h * PX)}" width="2000" height="3000"`);
  });
});

describe("resolving part of a drag", () => {
  it("re-routing only the moved shape's lines gives what a full pass gives for them", () => {
    const d = docs.get("flow-branched.ksd")!;
    const before = resolve(d, stubMeasurer);
    const moved = JSON.parse(JSON.stringify(d)) as ChalkDoc;
    const n = moved.nodes.find((x) => x.id === "queue")!;
    n.place = { x: before.nodes.get("queue")!.cx + 0.4, y: before.nodes.get("queue")!.cy + 0.3 };
    const full = resolve(moved, stubMeasurer), part = resolve(moved, stubMeasurer, { partial: { from: before, moved: new Set(["queue"]) } });
    for (const e of full.edges.filter((x) => x.from === "queue" || x.to === "queue")) {
      expect(part.edges.find((x) => x.uid === e.uid)!.points).toEqual(e.points);
    }
    // the others were not touched
    for (const e of before.edges.filter((x) => x.from !== "queue" && x.to !== "queue")) {
      expect(part.edges.find((x) => x.uid === e.uid)!.points).toEqual(e.points);
    }
    expect(part.edges.length).toBe(full.edges.length);
  });
});
