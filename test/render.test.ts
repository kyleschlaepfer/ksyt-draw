import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "../src/core/parse";
import { stubMeasurer, PX } from "../src/core/measure";
import { buildScene, type Scene } from "../src/core/scene";
import { layoutFlow } from "../src/core/layout-flow";
import { layoutUseCase } from "../src/core/layout-usecase";
import { sceneToSvg, esc } from "../src/core/svg";
import { edgePoint, nodeSize } from "../src/core/shapes";
import { MARGIN } from "../src/core/scene";
import type { Diagram } from "../src/core/model";
import { BG } from "../src/core/pen";
import { checkScene } from "../src/core/qa";
const checkSceneErrors = (sc: Scene) => checkScene(sc, { minDisplayPx: 1280 }).errors;

const DIR = new URL("../fixtures/diagrams/", import.meta.url);
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".ksd")).sort();
const load = (f: string): Diagram => parse(readFileSync(new URL(f, DIR), "utf8"));
const scenes = new Map<string, Scene>(fixtures.map((f) => [f, buildScene(load(f), stubMeasurer)]));

const overlap = (a: { cx: number; cy: number; w: number; h: number }, b: { cx: number; cy: number; w: number; h: number }) =>
  Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;

describe("layout: every fixture", () => {
  for (const f of fixtures) {
    const d = load(f);
    const sc = scenes.get(f)!;
    it(`${f}: no node overlaps`, () => {
      const nodes = sc.nodes.filter((n) => n.kind !== "boundary");
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        expect(overlap(nodes[i], nodes[j]), `${nodes[i].id} vs ${nodes[j].id}`).toBe(false);
      }
    });
    it(`${f}: every node inside the frame`, () => {
      // the frame hugs the ink; a dot or bar's geometric box can exceed its ink by a hair
      for (const n of sc.nodes) {
        expect(n.cx - n.w / 2).toBeGreaterThanOrEqual(MARGIN - 0.03);
        expect(n.cy - n.h / 2).toBeGreaterThanOrEqual(MARGIN - 0.03);
        expect(n.cx + n.w / 2).toBeLessThanOrEqual(sc.w - MARGIN + 0.03);
        expect(n.cy + n.h / 2).toBeLessThanOrEqual(sc.h - MARGIN + 0.03);
      }
      for (const el of sc.elements) {
        if (!el.sketch.items.length) continue;
        const [x0, y0, x1, y1] = el.sketch.bbox();
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(sc.w + 1e-9);
        expect(y1).toBeLessThanOrEqual(sc.h + 1e-9);
      }
    });
    it(`${f}: every arrow at least 0.5 in`, () => {
      const lay = d.claimed_diagram_type === "use-case" ? layoutUseCase(d, stubMeasurer) : layoutFlow(d, stubMeasurer);
      for (const r of lay.routes) {
        const aim0 = r.interior[0] ?? r.p1 ?? [r.to.cx, r.to.cy] as [number, number];
        const aim1 = r.interior[r.interior.length - 1] ?? r.p0 ?? [r.from.cx, r.from.cy] as [number, number];
        const p0 = r.p0 ?? edgePoint(r.from, aim0, 0.06), p1 = r.p1 ?? edgePoint(r.to, aim1, 0.06);
        const pts = [p0, ...r.interior, p1];
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        expect(L, r.edge.id).toBeGreaterThanOrEqual(0.5);
      }
    });
    it(`${f}: frame is tight and steps are tagged`, () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of sc.elements) {
        if (!el.sketch.items.length) continue;
        const b = el.sketch.bbox();
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
      }
      for (const t of sc.texts) {
        x0 = Math.min(x0, t.box[0] / PX); y0 = Math.min(y0, t.box[1] / PX); x1 = Math.max(x1, t.box[2] / PX); y1 = Math.max(y1, t.box[3] / PX);
      }
      expect(x0).toBeCloseTo(MARGIN, 6);
      expect(y0).toBeCloseTo(MARGIN, 6);
      expect(sc.w - x1).toBeCloseTo(MARGIN, 6);
      expect(sc.h - y1).toBeCloseTo(MARGIN, 6);
      const maxStep = Math.max(0, ...d.nodes.map((n) => n.step), ...d.edges.map((e) => e.step));
      expect(sc.steps).toBe(maxStep);
    });
  }
});

describe("use-case layout", () => {
  const inside = (n: { cx: number; cy: number; w: number; h: number }, b: { cx: number; cy: number; w: number; h: number }) =>
    n.cx - n.w / 2 > b.cx - b.w / 2 && n.cx + n.w / 2 < b.cx + b.w / 2 && n.cy - n.h / 2 > b.cy - b.h / 2 && n.cy + n.h / 2 < b.cy + b.h / 2;
  for (const f of fixtures.filter((f) => f.startsWith("usecase"))) {
    it(`${f}: actors outside, use cases inside`, () => {
      const sc = scenes.get(f)!;
      const b = sc.nodes.find((n) => n.kind === "boundary")!;
      for (const n of sc.nodes) {
        if (n.kind === "use-case") expect(inside(n, b), n.id).toBe(true);
        if (n.kind === "actor" && f !== "usecase-actor-inside.ksd") expect(inside(n, b), n.id).toBe(false);
        if (n.kind === "actor" && f === "usecase-actor-inside.ksd") expect(inside(n, b), n.id).toBe(true);
      }
    });
  }
  it("usecase-permit: include drawn from base to included, extend from extension to base, right actor on the right", () => {
    const d = load("usecase-permit.ksd");
    const lay = layoutUseCase(d, stubMeasurer);
    const inc = lay.routes.find((r) => r.edge.kind === "include")!;
    expect(inc.from.id).toBe("apply");
    expect(inc.to.id).toBe("pay");
    const ext = lay.routes.find((r) => r.edge.kind === "extend")!;
    expect(ext.from.id).toBe("waiver");
    expect(ext.to.id).toBe("pay");
    const b = lay.boundaries[0];
    expect(lay.nodes.get("clerk")!.cx).toBeGreaterThan(b.cx + b.w / 2);
    expect(lay.nodes.get("resident")!.cx).toBeLessThan(b.cx - b.w / 2);
    // pay sits in the row of apply, in a second column; waiver is pushed to the next row
    expect(lay.nodes.get("pay")!.cy).toBeCloseTo(lay.nodes.get("apply")!.cy, 9);
    expect(lay.nodes.get("pay")!.cx).toBeGreaterThan(lay.nodes.get("apply")!.cx);
    expect(lay.nodes.get("waiver")!.cy).toBeGreaterThan(lay.nodes.get("pay")!.cy);
    // the resident is centered between apply and track
    const r = lay.nodes.get("resident")!;
    expect(r.cy).toBeCloseTo((lay.nodes.get("apply")!.cy + lay.nodes.get("track")!.cy) / 2, 9);
  });
  it("the «include» label sits on the upper side of its line", () => {
    const sc = scenes.get("usecase-permit.ksd")!;
    const t = sc.texts.find((t) => t.name === "e4:label")!;
    expect(t.s).toBe("«include»");
    const apply = sc.nodes.find((n) => n.id === "apply")!;
    expect(t.y).toBeLessThan(apply.cy);
  });
});

describe("flow layout", () => {
  it("activity-parallel: fork and join bars span their branches", () => {
    const d = load("activity-parallel.ksd");
    const lay = layoutFlow(d, stubMeasurer);
    const laptop = lay.nodes.get("laptop")!, badge = lay.nodes.get("badge")!;
    for (const id of ["split", "wait"]) {
      const bar = lay.nodes.get(id)!;
      expect(bar.h).toBeCloseTo(0.075, 9);
      expect(bar.cx - bar.w / 2).toBeLessThan(Math.min(laptop.cx, badge.cx) - 0.2);
      expect(bar.cx + bar.w / 2).toBeGreaterThan(Math.max(laptop.cx, badge.cx) + 0.2);
    }
    // arrows to and from a bar are perpendicular to it
    for (const r of lay.routes) {
      if (r.from.shape === "bar") expect(r.p0![0]).toBeCloseTo(r.to.cx, 9);
      if (r.to.shape === "bar") expect(r.p1![0]).toBeCloseTo(r.from.cx, 9);
    }
  });
  it("direction right lays out left to right with vertical bars", () => {
    const d = parse("diagram activity\ntitle t\ndirection right\nstart s\nfork f\naction a\naction b\njoin j\nend e\ns -> f\nf -> a\nf -> b\na -> j\nb -> j\nj -> e");
    const lay = layoutFlow(d, stubMeasurer);
    expect(lay.nodes.get("e")!.cx).toBeGreaterThan(lay.nodes.get("s")!.cx + 2);
    expect(lay.nodes.get("f")!.vertical).toBe(true);
    expect(lay.nodes.get("f")!.w).toBeCloseTo(0.075, 9);
    const forced = layoutFlow(d, stubMeasurer, "down");
    expect(forced.nodes.get("e")!.cy).toBeGreaterThan(forced.nodes.get("s")!.cy + 2);
  });
  it("branch labels sit beside the first segment, never on it", () => {
    const sc = scenes.get("flow-approval.ksd")!;
    for (const name of ["e4:label", "e5:label"]) {
      const t = sc.texts.find((t) => t.name === name)!;
      expect(["yes", "no"]).toContain(t.s);
      const edge = sc.elements.find((e) => e.name === name.split(":")[0])!;
      const pad = 0.03 + (0.06 * 20) / 96;
      const rect: [number, number, number, number] = [t.box[0] / PX - pad, t.box[1] / PX - pad, t.box[2] / PX + pad, t.box[3] / PX + pad];
      for (const [poly, color] of edge.sketch.items) {
        if (color === BG) continue;
        for (const [x, y] of poly) expect(x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3], name).toBe(false);
      }
    }
  });
  it("pinned nodes sit where `at` says", () => {
    const d = parse("diagram flowchart\ntitle t\nstart s\nprocess a at 5 1.5\nend e\ns -> a\na -> e");
    const lay = layoutFlow(d, stubMeasurer);
    expect(lay.nodes.get("a")!.cx).toBe(5);
    expect(lay.nodes.get("a")!.cy).toBe(1.5);
    expect(lay.routes.every((r) => r.interior.length === 0)).toBe(true);
  });
  it("skips edges to unknown nodes", () => {
    const sc = scenes.get("dangling.ksd")!;
    expect(sc.elements.map((e) => e.name)).not.toContain("e2");
  });
});

describe("shapes", () => {
  it("decision text corners clear the sides", () => {
    const g = nodeSize(stubMeasurer, { id: "d", kind: "decision", label: "is the request complete and paid?", step: 0 });
    const hw = g.w / 2, hh = g.h / 2;
    expect((g.tw / 2 + 0.06) / hw + (g.th / 2 + 0.04) / hh).toBeLessThanOrEqual(1 + 1e-9);
  });
  it("edge points land on the outline plus the gap", () => {
    const box = nodeSize(stubMeasurer, { id: "b", kind: "process", label: "x", step: 0 });
    box.cx = 1; box.cy = 1;
    expect(edgePoint(box, [1, 5], 0.06)[1]).toBeCloseTo(1 + box.h / 2 + 0.06, 9);
    const uc = nodeSize(stubMeasurer, { id: "u", kind: "use-case", label: "pay fee", step: 0 });
    uc.cx = 0; uc.cy = 0;
    const p = edgePoint(uc, [3, 0], 0);
    expect(p[0]).toBeCloseTo(uc.w / 2, 9);
    const dia = nodeSize(stubMeasurer, { id: "d", kind: "decision", label: "ok?", step: 0 });
    dia.cx = 0; dia.cy = 0;
    const q = edgePoint(dia, [1, 1], 0);
    expect(Math.abs(q[0]) / (dia.w / 2) + Math.abs(q[1]) / (dia.h / 2)).toBeCloseTo(1, 9);
  });
});

describe("svg", () => {
  const hostile = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "]]>", "a & b", "it's"];
  it("escapes every label, title and desc", () => {
    for (const bad of hostile) {
      const q = bad.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const d = parse(`diagram use-case\ntitle T ${q}\ndesc D ${q}\nactor a "A ${q}"\nboundary b "B ${q}" {\nuse-case u "U ${q}"\nuse-case v "V ${q}"\n}\na -- u : L ${q}\nu -include-> v\nnote n "N ${q}"`);
      const svg = sceneToSvg(buildScene(d, stubMeasurer));
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("<img");
      expect(svg).not.toContain("]]>");
      expect(svg).toContain(esc(bad));
      const tags = svg.match(/<[a-zA-Z/][^>]*>/g)!.map((t) => t.replace(/^<\/?/, "").split(/[\s>/]/)[0]);
      expect(new Set(tags)).toEqual(new Set(["svg", "title", "desc", "g", "path", "text"]));
    }
  });
  it("uses role classes only, with title, desc and data-step", () => {
    const sc = scenes.get("activity-parallel.ksd")!;
    const svg = sceneToSvg(sc);
    expect(svg).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(svg).toMatch(/<title id="fig-t">/);
    expect(svg).toMatch(/<desc id="fig-d">/);
    expect(svg).toContain('aria-labelledby="fig-t fig-d"');
    expect(svg).toContain('class="k-page"');
    expect(svg).toContain('data-name="split" data-step="1"');
    expect(svg).toContain('data-name="wait" data-step="2"');
    expect(svg).toMatch(/<text class="k-hand k-ink" data-name="laptop:label" data-step="1"/);
    expect(svg).not.toMatch(/data-name="begin" data-step/);
    const standalone = sceneToSvg(sc, { standalone: true, fonts: { 400: "AAAA" } });
    expect(standalone).toContain("@font-face{font-family:Kalam;font-weight:400");
    expect(standalone).toContain("prefers-color-scheme:dark");
    expect(standalone).toContain("#242B27");
  });
  it("prints one-decimal coordinates", () => {
    const svg = sceneToSvg(scenes.get("flow-approval.ksd")!);
    const nums = svg.match(/ d="M([0-9.]+) /)![1];
    expect(nums).toMatch(/^[0-9]+\.[0-9]$/);
  });
});

describe("bent connectors", () => {
  it("an association that would cross a node it doesn't join bends around it, and the bend is drawn", () => {
    const d = parse(readFileSync(new URL("usecase-actor-inside.ksd", DIR), "utf8"));
    const lay = layoutUseCase(d, stubMeasurer);
    const e2 = lay.routes.find((r) => r.edge.id === "e2")!;
    expect(e2.interior.length).toBe(1);
    const sc = buildScene(d, stubMeasurer);
    const borrow = sc.nodes.find((n) => n.id === "borrow")!;
    const line = sc.elements.find((e) => e.name === "e2")!;
    const xs = line.sketch.items.flatMap(([p]) => p.map((q) => q[0]));
    // the stroke swings clear of the ellipse it must not cross
    expect(Math.min(...xs)).toBeLessThan(borrow.cx - borrow.w / 2 - 0.2);
  });
  it("a dependency with a bend still gets its label and head", () => {
    const d = parse("diagram use-case\ntitle t\nactor a\nboundary b \"B\" {\nuse-case u \"one\"\nuse-case v \"two\"\nuse-case w \"three\"\n}\na -- u\na -- v\na -- w\nu -include-> w");
    const sc = buildScene(d, stubMeasurer);
    const t = sc.texts.find((t) => t.name === "e4:label")!;
    expect(t.s).toBe("«include»");
    expect(checkSceneErrors(sc)).toEqual([]);
  });
});
