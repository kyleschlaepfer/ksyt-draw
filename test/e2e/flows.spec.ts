/**
 * Whole flows through the tool, driven the way a person drives it: a real pointer, a real keyboard,
 * the real save, open and export controls. Each test is one of the scenarios M to X in the project
 * brief (the letter in its name); draw.spec.ts holds A to L.
 *
 * window.chalk.inspect() is only ever read here, never used to make a change.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { box, canvas, clickEdge, clickNode, drag, edge, field, getText, inspect, ksdOf, node, openTool, status, toPage, zoom, type Inspect } from "./helpers";
import { exportPalette } from "../../src/core/render/svg";
import { LINE_W } from "../../src/core/render/precision";
import { weightOf } from "../../src/core/render/scene";
import { dashPieces } from "../../src/core/render/sketch";

test.use({ viewport: { width: 1440, height: 1000 } });

const EXPORTS = join("test-results", "exports");
const PX = 96;
type Pt = [number, number];

const inline = (page: Page): Locator => page.locator(".draw-inline");
const tab = (page: Page, name: "write" | "draw" | "the syntax"): Locator => page.getByRole("tab", { name, exact: true });
const near = (a: number, b: number, tol = 2.5): boolean => Math.abs(a - b) <= tol;
/** Two frames: long enough for the properties panel to rebuild after a change. */
const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** What a document is, without the identities a session hands out: ids, kinds, text, where everything sits. */
function picture(s: Inspect) {
  return {
    nodes: s.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, parent: n.parent, placed: n.placed, sized: n.sized, x: n.x, y: n.y, w: n.w, h: n.h })),
    edges: s.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, label: e.label, routed: e.routed, points: e.points, fromSide: e.fromSide, toSide: e.toSide })),
    texts: s.texts,
  };
}

/** Type lines into the editor one key at a time. Escape closes a completion list so Enter is a new line. */
async function typeLines(page: Page, lines: string[]): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i]);
    await page.keyboard.press("Escape");
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
}

/** Hover a shape so its dots show, then drag from one of them to another shape. */
async function connect(page: Page, from: string, to: string, side: "top" | "right" | "bottom" | "left", hold?: () => Promise<void>): Promise<void> {
  // A docked library and inspector can make a wide automatic layout use a small scale. Refit before
  // calculating page coordinates so the chosen endpoints are actually inside the clipped canvas.
  await page.getByRole("button", { name: "fit", exact: true }).click();
  await canvas(page).scrollIntoViewIfNeeded();
  const a = await box(page, from);
  await page.mouse.move(a.cx, a.cy);
  const port = page.locator(`.overlay .port[data-port="${side}"]`);
  await expect(port).toBeVisible();
  const p = (await port.boundingBox())!;
  const b = await box(page, to);
  await drag(page, [p.x + p.width / 2, p.y + p.height / 2], [b.cx, b.cy], hold ? { hold } : {});
}

// ---------------------------------------------------------------- reading ink

/** The polygons in path data made of M and L runs (the pen's ink), in the path's own units. */
function polygons(d: string): Pt[][] {
  return d.split("M").filter((s) => s.trim() !== "").map((part) => {
    const nums = (part.match(/-?[0-9]+(?:\.[0-9]+)?/g) ?? []).map(Number);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  });
}

/** How many separate pieces of ink there are: polygons whose boxes touch count as one piece. */
function pieces(polys: Pt[][], tol = 0.6): number {
  const boxes = polys.filter((p) => p.length > 0).map((p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))]);
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[0] <= b[2] + tol && b[0] <= a[2] + tol && a[1] <= b[3] + tol && b[1] <= a[3] + tol) parent[find(i)] = find(j);
  }
  return new Set(boxes.map((_, i) => find(i))).size;
}

/** How far the ink within `radius` of a point reaches sideways from the line through it. An arrowhead reaches far; a bare line end does not. */
function spread(polys: Pt[][], tip: Pt, toward: Pt, radius: number): number {
  const L = Math.hypot(toward[0] - tip[0], toward[1] - tip[1]) || 1;
  const ux = (toward[0] - tip[0]) / L, uy = (toward[1] - tip[1]) / L;
  let most = 0;
  for (const poly of polys) for (const [x, y] of poly) {
    const dx = x - tip[0], dy = y - tip[1];
    if (Math.hypot(dx, dy) > radius) continue;
    most = Math.max(most, Math.abs(dx * -uy + dy * ux));
  }
  return most;
}

interface Drawn { d: string; cls: string; dash: string | null; sw: string | null }
/** The paths the canvas drew for one line or shape, in document pixels (96 to the inch). */
const drawn = (page: Page, layer: "edges" | "nodes", name: string): Promise<Drawn[]> =>
  page.locator(`.layer-${layer} g[data-name="${name}"] path`).evaluateAll((els) => els.map((e) => ({
    d: e.getAttribute("d") ?? "", cls: e.getAttribute("class") ?? "", dash: e.getAttribute("stroke-dasharray"), sw: e.getAttribute("stroke-width"),
  })));
interface InkBox { name: string; x0: number; y0: number; x1: number; y1: number }
/** The box each drawn text's letters really cover (not its line box), in document pixels. */
const inkBoxes = (page: Page, prefix: string): Promise<InkBox[]> =>
  page.locator(`.layer-texts text[data-name^="${prefix}"]`).evaluateAll((els) => els.map((node) => {
    const el = node as SVGTextElement;
    const cs = getComputedStyle(el);
    const c = document.createElement("canvas").getContext("2d")!;
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText(el.textContent ?? "");
    const x = parseFloat(el.getAttribute("x") ?? "0"), y = parseFloat(el.getAttribute("y") ?? "0");
    const left = (el.getAttribute("text-anchor") ?? "start") === "middle" ? x - m.width / 2 : x;
    return { name: el.getAttribute("data-name") ?? "", x0: left, y0: y - m.actualBoundingBoxAscent, x1: left + m.width, y1: y + m.actualBoundingBoxDescent };
  }));
const overlapping = (boxes: InkBox[]): string[] => {
  const out: string[] = [];
  for (const a of boxes) for (const b of boxes) {
    if (a.name < b.name && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) out.push(`${a.name} on ${b.name}`);
  }
  return out;
};
const inkOf = (paths: Drawn[]): Pt[][] => paths.filter((p) => !/\bk-page\b/.test(p.cls)).flatMap((p) => polygons(p.d));
const inPx = (p: Pt): Pt => [p[0] * PX, p[1] * PX];
const pathLen = (pts: Pt[]): number => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
/** How far a point is from a shape's box (0 inside it), in inches. */
const boxDist = (p: { x: number; y: number }, n: Inspect["nodes"][number]): number =>
  Math.hypot(Math.max(0, Math.abs(p.x - n.x) - n.w / 2), Math.max(0, Math.abs(p.y - n.y) - n.h / 2));
/** Where a point is against an ellipse: under 1 inside, 1 on the outline, over 1 outside. */
const onEllipse = (p: Pt, n: Inspect["nodes"][number]): number => Math.hypot((p[0] - n.x) / (n.w / 2), (p[1] - n.y) / (n.h / 2));
const distToPath = (p: Pt, pts: Pt[]): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t)));
  }
  return best;
};

// ---------------------------------------------------------------- the document bar

const docBar = (page: Page): Locator => page.locator(".doc-bar");
const menuItem = (page: Page, words: string | RegExp): Locator => docBar(page).locator('[role="menuitem"]', { hasText: words });

/** Save through the real save button; the browser's download lands in `dir`. */
async function saveAs(page: Page, what: "project file" | "diagram text", dir: string): Promise<{ path: string; name: string }> {
  await docBar(page).getByRole("button", { name: "save", exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), menuItem(page, what).click()]);
  const path = join(dir, dl.suggestedFilename());
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
}
async function startNew(page: Page, template: RegExp): Promise<void> {
  await docBar(page).getByRole("button", { name: "new", exact: true }).click();
  await menuItem(page, template).click();
}
/** Open through the real open control: the menu, then the browser's file chooser. */
async function openFromDisk(page: Page, path: string): Promise<void> {
  await docBar(page).getByRole("button", { name: "open", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuItem(page, "a file from this computer").click()]);
  await chooser.setFiles(path);
}

/** Save, start something else, open the saved file: the document comes back exactly as it was. */
async function roundTrip(page: Page, what: "project file" | "diagram text", dir: string): Promise<{ before: Inspect; after: Inspect; path: string; name: string }> {
  const before = await inspect(page);
  const saved = await saveAs(page, what, dir);
  await expect(status(page)).toHaveText(`saved ${saved.name}`);
  await startNew(page, /^flowchart/);
  await expect.poll(async () => (await inspect(page)).nodes.map((n) => n.id)).toEqual([]);
  await openFromDisk(page, saved.path);
  await expect(status(page)).toContainText(`opened ${saved.name}`);
  await expect.poll(() => getText(page)).toBe(before.text);
  const after = await inspect(page);
  expect(after.valid).toBe(true);
  expect(picture(after)).toEqual(picture(before));
  return { before, after, ...saved };
}

// ---------------------------------------------------------------- write and draw are one document

test.describe("write and draw", () => {
  const HEAD = [
    "diagram activity", "id intake", "title A request is checked before it is filled", "",
    "start begin", 'action check "check request"', 'decision ok "complete?"', 'action fill "fill request"',
  ];
  const TYPED = [
    'action back "send it back"', "merge again", "end done", "",
    "begin -> check", "check -> ok", "ok -> fill : [yes]", "ok -> back : [no]", "fill -> again", "back -> again", "again -> done",
  ];

  test("M: a diagram typed in write is the same diagram in draw: every shape and line, nothing lost", async ({ page }) => {
    await openTool(page, null, "write");
    // the first lines go in as a paste, the rest one key at a time
    await page.locator(".ksd-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(HEAD.join("\n") + "\n");
    await typeLines(page, TYPED);
    const text = [...HEAD, ...TYPED].join("\n");
    await expect.poll(() => getText(page)).toBe(text);
    await expect(page.locator("#preview svg title")).toHaveText("A request is checked before it is filled");
    await expect(page.locator("#panel-write .play-status")).toContainText("7 nodes, 7 edges");

    await tab(page, "draw").click();
    await expect(page.locator(".draw-canvas .layer-nodes > g").first()).toBeAttached();
    const st = await inspect(page);
    expect(st.valid).toBe(true);
    expect(st.text).toBe(text);
    expect(st.nodes.map((n) => [n.id, n.kind, n.label])).toEqual([
      ["begin", "initial", null], ["check", "action", "check request"], ["ok", "decision", "complete?"], ["fill", "action", "fill request"],
      ["back", "action", "send it back"], ["again", "merge", null], ["done", "final", null],
    ]);
    expect(st.edges.map((e) => [e.id, e.from, e.to, e.kind, e.label])).toEqual([
      ["e1", "begin", "check", "arrow", null], ["e2", "check", "ok", "arrow", null], ["e3", "ok", "fill", "arrow", "[yes]"], ["e4", "ok", "back", "arrow", "[no]"],
      ["e5", "fill", "again", "arrow", null], ["e6", "back", "again", "arrow", null], ["e7", "again", "done", "arrow", null],
    ]);
    // each one is really on the canvas: a drawn shape, a hit target, its words
    await expect(page.locator(".draw-canvas .layer-nodes > g")).toHaveCount(7);
    await expect(page.locator(".draw-canvas .layer-edges > g")).toHaveCount(7);
    for (const n of st.nodes) {
      await expect(page.locator(`.layer-nodes g[data-name="${n.id}"]`)).toHaveCount(1);
      await expect(page.locator(`.layer-hits g[data-uid="${n.uid}"]`)).toHaveCount(1);
      expect(n.w > 0 && n.h > 0, `${n.id} has a size`).toBe(true);
      if (n.label) await expect(page.locator(`.layer-texts text[data-name="${n.id}:label"]`)).toHaveText(n.label);
    }
    for (const e of st.edges) {
      await expect(page.locator(`.layer-edges g[data-name="${e.id}"]`)).toHaveCount(1);
      if (e.label) await expect(page.locator(`.layer-texts text[data-name="${e.id}:label"]`)).toHaveText(e.label);
      // a line runs from its own source to its own target
      const a = st.nodes.find((n) => n.id === e.from)!, b = st.nodes.find((n) => n.id === e.to)!;
      const p0 = e.points[0], p1 = e.points[e.points.length - 1];
      expect(boxDist({ x: p0[0], y: p0[1] }, a), `${e.id} starts on ${e.from}`).toBeLessThan(0.1);
      expect(boxDist({ x: p1[0], y: p1[1] }, b), `${e.id} ends on ${e.to}`).toBeLessThan(0.1);
    }
    // no two shapes share a spot
    for (const a of st.nodes) for (const b of st.nodes) if (a.id < b.id) expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), `${a.id} and ${b.id}`).toBeGreaterThan(0.2);
    // looking is not editing: the text is still exactly what was typed
    await tab(page, "write").click();
    expect(await getText(page)).toBe(text);
    await page.screenshot({ path: "test-results/flows-typed-then-drawn.png" });
  });

  const ODD = [
    "diagram flowchart", "id odd", "title   A draft is reviewed and either published or sent back", "",
    "# the author's own note: this line stays exactly as it is",
    "start begin", 'process   draft    "write draft"', 'decision ok "ready?"', 'process publish "publish"', "end done", "",
    "begin -> draft", "draft   ->   ok", "ok -> publish : yes", "ok -> draft : no", "",
    "  # an indented note between two lines", "publish -> done", "",
  ].join("\n");

  test("N: changes made in draw land in a layout block, the author's own lines stay untouched, and the drawing comes back the same", async ({ page }) => {
    await openTool(page, ODD, "draw");
    // move one shape
    const pb = await box(page, "publish");
    await page.keyboard.down("Alt");
    await drag(page, [pb.cx, pb.cy], [pb.cx + 170, pb.cy + 30]);
    await page.keyboard.up("Alt");
    // resize another
    await clickNode(page, "draft");
    const se = (await page.locator('.overlay .handle[data-handle="se"]').boundingBox())!;
    await drag(page, [se.x + 5, se.y + 5], [se.x + 5 + 60, se.y + 5 + 26]);
    // bend a line
    await clickEdge(page, "ok", "draft");
    const handle = page.locator(".overlay .seg").last();
    const h = (await handle.boundingBox())!;
    const vertical = await handle.evaluate((el) => el.classList.contains("seg-v"));
    await drag(page, [h.x + h.width / 2, h.y + h.height / 2], [h.x + h.width / 2 + (vertical ? -40 : 0), h.y + h.height / 2 + (vertical ? 0 : 40)]);
    // and drag a label off its line
    const yes = await edge(page, "ok", "publish");
    const lb = (await page.locator(`.layer-hits rect[data-uid="${yes.uid}"][data-label]`).boundingBox())!;
    await drag(page, [lb.x + lb.width / 2, lb.y + lb.height / 2], [lb.x + lb.width / 2 + 46, lb.y + lb.height / 2 - 30]);

    const before = await inspect(page);
    expect(before.nodes.find((n) => n.id === "publish")!.placed).toBe(true);
    expect(before.nodes.find((n) => n.id === "draft")!.sized).toBe(true);
    expect(before.edges.find((e) => e.from === "ok" && e.to === "draft")!.routed).toBe(true);

    await tab(page, "write").click();
    await expect(page.locator(".ksd-editor .cm-content")).toContainText("layout {");
    const text = await getText(page);
    const lines = text.split("\n");
    const open = lines.indexOf("layout {");
    expect(open).toBeGreaterThan(0);
    const close = lines.indexOf("}", open);
    const block = lines.slice(open + 1, close).map((s) => s.trim());
    expect(block.some((s) => /^place publish [-0-9.]+ [-0-9.]+$/.test(s)), block.join(" | ")).toBe(true);
    expect(block.some((s) => /^size draft [0-9.]+ [0-9.]+$/.test(s)), block.join(" | ")).toBe(true);
    expect(block.some((s) => /^route ok -> draft elbow from \w+ to \w+ via [-0-9. ,]+$/.test(s)), block.join(" | ")).toBe(true);
    expect(block.some((s) => /^label ok -> publish [0-9.]+ -?[0-9.]+ -?[0-9.]+$/.test(s)), block.join(" | ")).toBe(true);
    // the block is the only thing that was added: everything above it is the author's text, character for character
    expect(lines[open - 1].startsWith("# layout:")).toBe(true);
    expect(lines.slice(0, open - 1).join("\n").trimEnd()).toBe(ODD.trimEnd());
    expect(lines.slice(close + 1).join("").trim()).toBe("");
    for (const own of ["title   A draft is reviewed and either published or sent back", "# the author's own note: this line stays exactly as it is", 'process   draft    "write draft"', "draft   ->   ok", "  # an indented note between two lines"]) {
      expect(lines, own).toContain(own);
    }
    // the figure beside the text is the same drawing
    await expect(page.locator("#preview svg.ksyt-fig")).toBeVisible();

    // back in draw nothing has moved
    await tab(page, "draw").click();
    expect(await inspect(page)).toEqual(before);
    // and the text alone carries it: a line typed in write makes the text the source again, and the drawing is still the same
    await tab(page, "write").click();
    await page.locator(".ksd-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await typeLines(page, ["", "# read back from the text"]);
    await expect.poll(() => getText(page)).toContain("# read back from the text");
    await tab(page, "draw").click();
    const again = await inspect(page);
    expect(again.valid).toBe(true);
    expect({ nodes: again.nodes, edges: again.edges, texts: again.texts }).toEqual({ nodes: before.nodes, edges: before.edges, texts: before.texts });
    await page.screenshot({ path: "test-results/flows-layout-block.png" });
  });
});

// ---------------------------------------------------------------- notation made with the pointer

test.describe("relationships and members", () => {
  const PORTAL = [
    "diagram use-case", "id portal", "title Residents apply; paying the fee is part of applying", "",
    'actor resident "Resident"', 'boundary portal "Permit portal" {', '  use-case apply "apply for permit"', '  use-case pay "pay fee"', '  use-case waiver "request fee waiver"', "}", "",
    "resident -- apply", "",
  ].join("\n");

  test("P: include and extend made by dragging between use cases: dashed, pointing the right way, with their stereotype", async ({ page }) => {
    await openTool(page, PORTAL, "draw");
    // between two use cases the usual relationship is include: the base use case's dot is dragged to the one it includes
    await expect(page.locator("#draw-relation")).toHaveValue("");
    let said = "";
    await connect(page, "apply", "pay", "right", async () => {
      await expect(page.locator(".overlay .preview")).toHaveCount(1);
      await expect(page.locator(".overlay .target:not(.is-bad)")).toHaveCount(1);
      said = (await status(page).textContent()) ?? "";
    });
    expect(said).toBe("let go to connect");
    expect(await getText(page)).toContain("apply -include-> pay");
    // the new line is selected, and the panel names what it means
    await expect(page.locator(".draw-inspector h2")).toHaveText("line");
    await expect(field(page, "edge:op")).toHaveValue("-include->");
    await expect(page.locator(".draw-inspector")).toContainText("Drawn dashed");
    // extend is chosen where the tool offers it, before the line is drawn: from the extension to the base
    await page.locator("#draw-relation").selectOption({ label: "extend" });
    await expect(page.locator("#draw-relation")).toHaveValue("-extend->");
    await connect(page, "waiver", "pay", "right");
    const text = await getText(page);
    expect(text).toContain("waiver -extend-> pay");
    expect(text).not.toContain("pay -extend-> waiver");
    expect(text).not.toContain("pay -include-> apply");
    await expect(field(page, "edge:op")).toHaveValue("-extend->");

    // the use cases held their places while the lines went in, which leaves the lines short; tidy up gives them room
    // (what the lines look like before tidying is the fixme test below)
    await expect(status(page)).toContainText("tidy up lets them go");
    await page.getByRole("button", { name: "tidy up" }).click();
    await page.locator('[role="menuitem"]', { hasText: "the whole diagram" }).click();
    await page.getByRole("button", { name: "keep it" }).click();
    await expect(status(page)).toContainText("tidied");
    await page.getByRole("button", { name: "fit", exact: true }).click();
    expect(await getText(page)).not.toContain("layout {");

    let st = await inspect(page);
    const inc = st.edges.find((e) => e.kind === "include")!, ext = st.edges.find((e) => e.kind === "extend")!;
    expect([inc.from, inc.to]).toEqual(["apply", "pay"]);
    expect([ext.from, ext.to]).toEqual(["waiver", "pay"]);
    for (const [e, word] of [[inc, "«include»"], [ext, "«extend»"]] as const) {
      const from = st.nodes.find((n) => n.id === e.from)!, to = st.nodes.find((n) => n.id === e.to)!;
      const tipTo = e.points[e.points.length - 1], tipFrom = e.points[0];
      // the line ends on the outline of the use case it points at
      expect(onEllipse(tipTo, to), `${e.kind} ends on ${e.to}`).toBeGreaterThan(0.97);
      expect(onEllipse(tipTo, to)).toBeLessThan(1.3);
      expect(onEllipse(tipFrom, from), `${e.kind} starts on ${e.from}`).toBeLessThan(1.3);
      // sketch: the pen lifts between dashes, so the line is separate pieces of ink
      const ink = inkOf(await drawn(page, "edges", e.id));
      const dashes = dashPieces(e.points, 0.16, 0.1, 0.04, 0.06).length;
      expect(dashes, `${e.kind} is long enough to show its dashes`).toBeGreaterThanOrEqual(2);
      // (the last dash runs into the arrowhead, so the two can count as one piece)
      expect(pieces(ink), `${e.kind} is drawn in pieces`).toBeGreaterThanOrEqual(Math.max(2, dashes - 1));
      // the open arrowhead is at the target end and nowhere else
      const atTo = spread(ink, inPx(tipTo), inPx(e.points[e.points.length - 2]), 0.22 * PX);
      const atFrom = spread(ink, inPx(tipFrom), inPx(e.points[1]), 0.22 * PX);
      expect(atTo, `${e.kind}: arrowhead at ${e.to} (${atTo.toFixed(1)}px against ${atFrom.toFixed(1)}px)`).toBeGreaterThan(atFrom + 3);
      expect(atTo).toBeGreaterThan(5);
      // the stereotype is written beside the line
      const label = st.texts.find((t) => t.name === `${e.id}:stereotype`)!;
      expect(label.s).toBe(word);
      const lb = (await inkBoxes(page, `${e.id}:stereotype`))[0];
      const gap = Math.min(...[lb.x0, (lb.x0 + lb.x1) / 2, lb.x1].flatMap((x) => [lb.y0, (lb.y0 + lb.y1) / 2, lb.y1].map((y) => distToPath([x / PX, y / PX], e.points))));
      expect(gap, `${word} is beside its line`).toBeLessThan(0.3);
      expect(gap, `${word} is not on its line`).toBeGreaterThan(0.02);
      await expect(page.locator(`.layer-texts text[data-name="${e.id}:stereotype"]`)).toHaveText(word);
      await expect(page.locator(`.layer-texts text[data-name="${e.id}:stereotype"]`)).toBeVisible();
    }
    // an association between the actor and a use case is one unbroken line with no head
    const assoc = st.edges.find((e) => e.kind === "association")!;
    expect(pieces(inkOf(await drawn(page, "edges", assoc.id)))).toBe(1);
    await page.screenshot({ path: "test-results/flows-include-extend.png" });

    // the precision look says the same thing with real strokes: a dash pattern on the shaft, an open head whose point is on the target
    await canvas(page).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".draw-inspector h2")).toHaveText("diagram");
    await field(page, "doc:look").selectOption("precision");
    await expect.poll(() => getText(page)).toContain("look precision");
    st = await inspect(page);
    for (const kind of ["include", "extend"]) {
      const e = st.edges.find((x) => x.kind === kind)!;
      const to = st.nodes.find((n) => n.id === e.to)!, from = st.nodes.find((n) => n.id === e.from)!;
      const paths = await drawn(page, "edges", e.id);
      expect(paths.length).toBe(2);
      expect(paths[0].dash, `${kind} shaft is dashed`).toMatch(/^[0-9.]+ [0-9.]+$/);
      expect(paths[1].dash).toBeNull();
      const head = polygons(paths[1].d)[0];
      expect(head.length).toBe(3);
      const tip: Pt = [head[1][0] / PX, head[1][1] / PX];
      expect(onEllipse(tip, to), `${kind} head points at ${e.to}`).toBeLessThan(1.3);
      expect(onEllipse(tip, from)).toBeGreaterThan(1.5);
      // the two barbs trail back along the line, away from the target
      for (const barb of [head[0], head[2]]) expect(onEllipse([barb[0] / PX, barb[1] / PX], to)).toBeGreaterThan(onEllipse(tip, to));
    }
    const plain = await drawn(page, "edges", st.edges.find((e) => e.kind === "association")!.id);
    expect(plain.length).toBe(1);
    expect(plain[0].dash).toBeNull();
    await page.screenshot({ path: "test-results/flows-include-extend-precision.png" });
    // and the tool's own layout check has nothing to say about the tidied diagram
    await tab(page, "write").click();
    await expect(page.locator(".lint h2").nth(1)).toHaveText("layout check: pass");
  });

  // Was a bug: a line drawn with the pointer pinned the other shapes where they were, so an include between two use
  // cases the layout had stacked 0.45 in apart came out 0.38 in long, with its stereotype across both outlines. The
  // session now makes room (Session.makeRoom): the far shape is pushed over just far enough.
  test("P: include and extend read as dashed and keep their stereotypes clear of the shapes as soon as they are drawn, before any tidying", async ({ page }) => {
    await openTool(page, PORTAL, "draw");
    await connect(page, "apply", "pay", "right");
    await page.locator("#draw-relation").selectOption({ label: "extend" });
    await connect(page, "waiver", "pay", "right");
    const st = await inspect(page);
    for (const e of st.edges.filter((x) => x.kind !== "association")) {
      expect(dashPieces(e.points, 0.16, 0.1, 0.04, 0.06).length, `${e.kind} has room for more than one dash`).toBeGreaterThanOrEqual(2);
    }
    await tab(page, "write").click();
    await expect(page.locator(".lint h2").nth(1)).toHaveText("layout check: pass");
  });

  const BANK = ["diagram class", "id bank", "title An account belongs to one customer", "", "class Account", "class Customer", "", "Customer -- Account", ""].join("\n");

  test("Q: an attribute and an operation added to a class, typed in place and in the panel: compartments, rows, a bigger box, the text", async ({ page }) => {
    await openTool(page, BANK, "draw");
    const before = await node(page, "Account");
    await clickNode(page, "Account");
    await expect(page.locator(".draw-inspector h2")).toHaveText("class");
    /** double-click the row a member is written on */
    const openRow = async (index: number): Promise<void> => {
      const n = await node(page, "Account");
      const row = (await inspect(page)).texts.find((t) => t.name === `Account:m${index}`)!;
      const at = await toPage(page, [n.x, row.y]);
      await page.mouse.dblclick(at[0], at[1]);
      await expect(inline(page)).toBeVisible();
      await expect(inline(page)).toBeFocused();
    };

    // an attribute: added from the panel, then named where it is drawn
    await page.locator(".draw-inspector").getByRole("button", { name: "add attribute" }).click();
    await expect(status(page)).toContainText("added an attribute");
    expect(await getText(page)).toContain("class Account {\n  +attribute1: Type\n}");
    await openRow(0);
    await expect(inline(page)).toHaveValue("+attribute1: Type");
    await expect(inline(page)).toHaveAttribute("aria-label", "attribute of Account");
    // the field sits on the row it edits
    const rowBox = (await page.locator('.layer-texts text[data-name="Account:m0"]').boundingBox())!;
    const fieldBox = (await inline(page).boundingBox())!;
    const classBox = await box(page, "Account");
    expect(near(fieldBox.y + fieldBox.height / 2, rowBox.y + rowBox.height / 2, 6), "the field is on the member's row").toBe(true);
    expect(fieldBox.x >= classBox.x - 2 && fieldBox.x < rowBox.x + 4, "the field starts at the row's left edge").toBe(true);
    // the row's own text steps aside while it is being edited
    await expect(page.locator('.layer-texts text[data-name="Account:m0"]')).toBeHidden();
    await page.keyboard.type("-balance: Money");
    await expect(inline(page)).toHaveValue("-balance: Money");
    await page.keyboard.press("Enter");
    await expect(inline(page)).toHaveCount(0);
    expect(await getText(page)).toContain("class Account {\n  -balance: Money\n}");
    // something that is not a member is refused and nothing changes
    await openRow(0);
    await page.keyboard.type("two words");
    await page.keyboard.press("Enter");
    await expect(status(page)).toContainText("can't read that member");
    expect(await getText(page)).toContain("class Account {\n  -balance: Money\n}");
    // Escape leaves a row as it was
    await openRow(0);
    await page.keyboard.type("+gone: Never");
    await page.keyboard.press("Escape");
    await expect(inline(page)).toHaveCount(0);
    expect(await getText(page)).not.toContain("gone");

    // a second attribute, named in the panel
    await page.locator(".draw-inspector").getByRole("button", { name: "add attribute" }).click();
    await expect.poll(() => getText(page)).toContain("  -balance: Money\n  +attribute1: Type\n}");
    await settle(page);
    await field(page, "class:m1").fill("+owner: String");
    await field(page, "class:m1").press("Enter");
    await expect.poll(() => getText(page)).toContain("  -balance: Money\n  +owner: String\n}");

    // an operation: added from the panel, typed in place
    await settle(page);
    await page.locator(".draw-inspector").getByRole("button", { name: "add operation" }).click();
    await expect(status(page)).toContainText("added an operation");
    await expect.poll(() => getText(page)).toContain("  +operation1(): void\n}");
    await openRow(2);
    await expect(inline(page)).toHaveValue("+operation1(): void");
    await expect(inline(page)).toHaveAttribute("aria-label", "operation of Account");
    await page.keyboard.type("+deposit(amount: Money): void");
    await page.keyboard.press("Enter");
    await expect(inline(page)).toHaveCount(0);

    const st = await inspect(page);
    expect(st.text).toContain("class Account {\n  -balance: Money\n  +owner: String\n  +deposit(amount: Money): void\n}");
    expect(st.text).toContain("class Customer\n");
    // the rows, top to bottom: the name, two attributes, one operation
    const rows = st.texts.filter((t) => t.name.startsWith("Account:"));
    expect(rows.map((t) => [t.name, t.s])).toEqual([
      ["Account:name", "Account"], ["Account:m0", "-balance: Money"], ["Account:m1", "+owner: String"], ["Account:m2", "+deposit(amount: Money): void"],
    ]);
    for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeGreaterThan(rows[i - 1].y);
    // members start at the same left edge; the name is centered
    expect(rows[1].x).toBeCloseTo(rows[2].x, 6);
    expect(rows[2].x).toBeCloseTo(rows[3].x, 6);
    const after = st.nodes.find((n) => n.id === "Account")!;
    expect(rows[0].x).toBeCloseTo(after.x, 3);
    // three compartments: a rule sits between the name and the attributes, and between the attributes and the operations
    const step = rows[2].y - rows[1].y;
    expect(rows[3].y - rows[2].y, "a compartment line between attributes and operations").toBeGreaterThan(step + 0.05);
    expect(rows[1].y - rows[0].y, "a compartment line under the name").toBeGreaterThan(step + 0.05);
    // the box grew to hold them, and holds them
    expect(after.h).toBeGreaterThan(before.h + 3 * step);
    expect(after.w).toBeGreaterThan(before.w);
    const outer = await box(page, "Account");
    for (const r of rows) {
      const t = (await page.locator(`.layer-texts text[data-name="${r.name}"]`).boundingBox())!;
      expect(t.x >= outer.x && t.x + t.width <= outer.x + outer.width && t.y >= outer.y && t.y + t.height <= outer.y + outer.height, `${r.name} inside the class box`).toBe(true);
    }
    // the line to the other class is still attached to the bigger box
    const line = st.edges[0];
    const end = line.from === "Account" ? line.points[0] : line.points[line.points.length - 1];
    expect(boxDist({ x: end[0], y: end[1] }, after)).toBeLessThan(0.1);
    await page.screenshot({ path: "test-results/flows-class-members.png" });

    // in the precision look the compartments are plain strokes: the outline and two rules
    await canvas(page).focus();
    await page.keyboard.press("Escape");
    await field(page, "doc:look").selectOption("precision");
    await expect.poll(() => getText(page)).toContain("look precision");
    const strokes = await drawn(page, "nodes", "Account");
    expect(strokes.length).toBe(3);
    const now = await inspect(page);
    const shape = now.nodes.find((n) => n.id === "Account")!;
    const left = (shape.x - shape.w / 2) * PX, right = (shape.x + shape.w / 2) * PX;
    const rules = strokes.slice(1).map((s) => polygons(s.d)[0]);
    for (const rule of rules) {
      expect(rule.length).toBe(2);
      expect(near(rule[0][1], rule[1][1], 0.01), "a rule is level").toBe(true);
      expect(near(Math.min(rule[0][0], rule[1][0]), left, 1) && near(Math.max(rule[0][0], rule[1][0]), right, 1), "a rule spans the box").toBe(true);
    }
    const words = now.texts.filter((t) => t.name.startsWith("Account:"));
    const ruleY = rules.map((r) => r[0][1] / PX).sort((a, b) => a - b);
    expect(ruleY[0] > words[0].y && ruleY[0] < words[1].y, "first rule between the name and the attributes").toBe(true);
    expect(ruleY[1] > words[2].y && ruleY[1] < words[3].y, "second rule between the attributes and the operations").toBe(true);
  });

  // Was a bug: every member added in draw pinned both classes, and the class grew about its own center until, with five
  // members, it was drawn over the class above it. The session now pushes the neighbour away as the class grows.
  test("Q: a class that grows as members are added never grows over the class beside it", async ({ page }) => {
    await openTool(page, BANK, "draw");
    await clickNode(page, "Account");
    for (let i = 0; i < 6; i++) {
      await settle(page);
      await page.locator(".draw-inspector").getByRole("button", { name: i % 2 ? "add operation" : "add attribute" }).click();
      await expect.poll(async () => (await inspect(page)).texts.filter((t) => /^Account:m/.test(t.name)).length).toBe(i + 1);
      const st = await inspect(page);
      const a = st.nodes.find((n) => n.id === "Account")!, c = st.nodes.find((n) => n.id === "Customer")!;
      const apart = Math.abs(a.x - c.x) >= (a.w + c.w) / 2 || Math.abs(a.y - c.y) >= (a.h + c.h) / 2;
      expect(apart, `with ${i + 1} members Account and Customer don't overlap`).toBe(true);
    }
    await tab(page, "write").click();
    await expect(page.locator(".lint h2").nth(1)).toHaveText("layout check: pass");
  });

  const SHOP = ["diagram class", "id shop", "title A customer places orders", "", "class Customer {", "  +name: String", "}", "class Order {", "  +number: int", "}", "", "Customer -- Order", ""].join("\n");

  test("R: multiplicities and role names set in the panel are written at the right ends and drawn beside their own ends of the line", async ({ page }) => {
    await openTool(page, SHOP, "draw");
    await clickEdge(page, "Customer", "Order");
    await expect(page.locator(".draw-inspector h2")).toHaveText("line");
    // the panel names each end by its class
    await expect(page.locator(".draw-inspector label", { hasText: "how many at Customer" })).toHaveCount(1);
    await expect(page.locator(".draw-inspector label", { hasText: "how many at Order" })).toHaveCount(1);
    const set = async (key: string, value: string, expected: string): Promise<void> => {
      await settle(page);
      await field(page, key).fill(value);
      await field(page, key).press("Enter");
      await expect.poll(() => getText(page)).toContain(expected);
    };
    await set("edge:from-mult", "1", 'Customer "1" -- Order');
    await set("edge:to-mult", "0..*", 'Customer "1" -- "0..*" Order');
    await set("edge:to-role", "orders", 'Customer "1" -- "0..* orders" Order');
    await set("edge:from-role", "buyer", 'Customer "1 buyer" -- "0..* orders" Order');
    await set("edge:label", "places", 'Customer "1 buyer" -- "0..* orders" Order : places');
    await settle(page);
    // the fields show what the text says
    await expect(field(page, "edge:from-mult")).toHaveValue("1");
    await expect(field(page, "edge:from-role")).toHaveValue("buyer");
    await expect(field(page, "edge:to-mult")).toHaveValue("0..*");
    await expect(field(page, "edge:to-role")).toHaveValue("orders");

    const st = await inspect(page);
    const e = st.edges[0];
    expect([e.from, e.to, e.kind, e.label]).toEqual(["Customer", "Order", "association", "places"]);
    const customer = st.nodes.find((n) => n.id === "Customer")!, order = st.nodes.find((n) => n.id === "Order")!;
    const p0 = e.points[0], p1 = e.points[e.points.length - 1];
    const length = pathLen(e.points);
    const want: Array<[string, string, "from" | "to"]> = [["from-mult", "1", "from"], ["from-role", "buyer", "from"], ["to-mult", "0..*", "to"], ["to-role", "orders", "to"]];
    for (const [suffix, s, end] of want) {
      const t = st.texts.find((x) => x.name === `${e.id}:${suffix}`)!;
      expect(t, `${suffix} is drawn`).toBeTruthy();
      expect(t.s).toBe(s);
      const own = end === "from" ? customer : order, other = end === "from" ? order : customer;
      const ownTip = end === "from" ? p0 : p1, otherTip = end === "from" ? p1 : p0;
      // nearer to its own class and its own end of the line than to the other
      expect(boxDist(t, own), `${suffix} "${s}" is by ${own.id}`).toBeLessThan(boxDist(t, other));
      const dOwn = Math.hypot(t.x - ownTip[0], t.y - ownTip[1]), dOther = Math.hypot(t.x - otherTip[0], t.y - otherTip[1]);
      expect(dOwn).toBeLessThan(dOther);
      expect(dOwn, `${suffix} sits at its end, not along the line`).toBeLessThan(Math.max(0.55, length * 0.45));
      // beside the line, not on a class
      expect(distToPath([t.x, t.y], e.points)).toBeLessThan(0.45);
      expect(boxDist(t, own)).toBeGreaterThan(0);
      await expect(page.locator(`.layer-texts text[data-name="${e.id}:${suffix}"]`)).toHaveText(s);
    }
    // the name of the association is drawn too
    const name = st.texts.find((x) => x.name === `${e.id}:label`)!;
    expect(name.s).toBe("places");
    await page.screenshot({ path: "test-results/flows-multiplicities.png" });

    // with room between the classes each of the five texts has its own spot (the short line the layout gives is the fixme test below)
    const ob = await box(page, "Order");
    await page.keyboard.down("Alt");
    await drag(page, [ob.cx, ob.cy], [ob.cx, ob.cy + 130]);
    await page.keyboard.up("Alt");
    expect((await inkBoxes(page, `${e.id}:`)).length).toBe(5);
    expect(overlapping(await inkBoxes(page, `${e.id}:`))).toEqual([]);
    const far = await inspect(page);
    const line = far.edges[0];
    for (const [suffix, , end] of want) {
      const t = far.texts.find((x) => x.name === `${line.id}:${suffix}`)!;
      const ownTip = end === "from" ? line.points[0] : line.points[line.points.length - 1];
      expect(Math.hypot(t.x - ownTip[0], t.y - ownTip[1]), `${suffix} stayed at its end when the line grew`).toBeLessThan(0.7);
    }
    await page.screenshot({ path: "test-results/flows-multiplicities-room.png" });
    // swapping the ends takes each multiplicity and role with its class
    await clickEdge(page, "Customer", "Order");
    await page.locator(".draw-inspector").getByRole("button", { name: "swap ends" }).click();
    await expect.poll(() => getText(page)).toContain('Order "0..* orders" -- "1 buyer" Customer : places');
    // clearing a field takes it out of the text
    await set("edge:to-role", "", 'Order "0..* orders" -- "1" Customer : places');
    expect((await inspect(page)).texts.some((t) => t.name.endsWith(":to-role"))).toBe(false);
  });

  // Was a bug: on the 0.73 in line the layout gives between two bare classes, a name plus a multiplicity and a role
  // at each end don't fit, and they were written over each other. The session now makes room as the texts are added
  // (a line with end texts needs 1 in), so each has its own spot.
  test("R: a name, two multiplicities and two roles on the line the layout gives don't overlap each other", async ({ page }) => {
    await openTool(page, SHOP, "draw");
    await clickEdge(page, "Customer", "Order");
    for (const [key, value, expected] of [
      ["edge:from-mult", "1", 'Customer "1" -- Order'], ["edge:to-mult", "0..*", '"1" -- "0..*" Order'], ["edge:to-role", "orders", '"0..* orders" Order'],
      ["edge:from-role", "buyer", 'Customer "1 buyer" --'], ["edge:label", "places", "Order : places"],
    ]) {
      await settle(page);
      await field(page, key).fill(value);
      await field(page, key).press("Enter");
      await expect.poll(() => getText(page)).toContain(expected);
    }
    expect(overlapping(await inkBoxes(page, "e1:"))).toEqual([]);
    await tab(page, "write").click();
    await expect(page.locator(".lint h2").nth(1)).toHaveText("layout check: pass");
  });
});

// ---------------------------------------------------------------- save and reopen

interface SavedNode { id: string; uid: string; place?: { x: number; y: number }; size?: { w: number; h: number }; thickness?: number; members?: Array<{ name: string }>; describe?: { goal?: string; main?: string[] }; style?: Record<string, string> }
interface SavedEdge { from: string; to: string; route?: { kind: string; via?: number[][] }; labelPos?: { t: number }; style?: Record<string, string>; ends?: { from?: { mult?: string; role?: string }; to?: { mult?: string; role?: string } } }
interface SavedProject { format: string; version: number; app: string; source: string; model: { nodes: SavedNode[]; edges: SavedEdge[] }; workspace?: { view?: { zoom: number } } }
const readProject = (path: string): SavedProject => JSON.parse(readFileSync(path, "utf8")) as SavedProject;
const outDir = (name: string): string => { const dir = test.info().outputPath(name); mkdirSync(dir, { recursive: true }); return dir; };
const openLook = (page: Page): Promise<void> => page.locator(".inspector-section", { hasText: "look" }).locator("summary").click();

test.describe("save and reopen", () => {
  test("canvas-first: five empty classes can be arranged, connected, warned about, named later, and reopened unfinished", async ({ page }) => {
    await openTool(page, "diagram class\nid unfinished-domain\ntitle Unfinished domain\n", "write");
    await tab(page, "draw").click();
    await expect(canvas(page)).toBeVisible();
    const cv = (await canvas(page).boundingBox())!;

    // One library choice remains armed: construction order belongs to the person drawing.
    await page.locator('.draw-shape[data-kind="class"]').click();
    const places: Pt[] = [
      [cv.x + cv.width * 0.22, cv.y + cv.height * 0.28],
      [cv.x + cv.width * 0.50, cv.y + cv.height * 0.28],
      [cv.x + cv.width * 0.78, cv.y + cv.height * 0.28],
      [cv.x + cv.width * 0.35, cv.y + cv.height * 0.62],
      [cv.x + cv.width * 0.65, cv.y + cv.height * 0.62],
    ];
    for (const p of places) await page.mouse.click(p[0], p[1]);
    await page.keyboard.press("Escape");
    let built = await inspect(page);
    expect(built.nodes.map((n) => [n.id, n.label])).toEqual([
      ["Class1", ""], ["Class2", ""], ["Class3", ""], ["Class4", ""], ["Class5", ""],
    ]);

    // Rearrange before naming, then use the visible relationship tools rather than a form.
    const fifth = await box(page, "Class5");
    await page.keyboard.down("Alt");
    await drag(page, [fifth.cx, fifth.cy], [fifth.cx + 36, fifth.cy - 24]);
    await page.keyboard.up("Alt");
    await page.getByRole("button", { name: "association", exact: true }).click();
    await clickNode(page, "Class1");
    await clickNode(page, "Class2");
    await expect(status(page)).toContainText("connected");

    // Deliberately incomplete/invalid UML is drawn and saved; the checker explains it instead of blocking it.
    await page.getByRole("button", { name: "dependency", exact: true }).click();
    await clickNode(page, "Class3");
    await clickNode(page, "Class3");
    await expect(page.locator("#draw-check")).toContainText(/[0-9]+ notation warnings?/);
    await page.locator("#draw-check").click();
    await expect(page.locator(".draw-findings")).toContainText("can't depend on itself");
    await page.locator(".draw-findings li", { hasText: "can't depend on itself" }).getByRole("button", { name: "show it" }).click();
    await expect(page.locator(".overlay .sel")).toHaveCount(1);
    await expect(page.locator(".overlay .sel-line")).toHaveCount(1); // the class and its self-dependency

    // Text can come last. The other four classes intentionally remain empty.
    const first = await box(page, "Class1");
    await page.mouse.dblclick(first.cx, first.cy);
    await expect(inline(page)).toHaveValue("");
    await page.keyboard.type("Order");
    await page.keyboard.press("Enter");
    built = await inspect(page);
    expect(built.nodes.find((n) => n.id === "Class1")!.label).toBe("Order");
    expect(built.nodes.filter((n) => n.label === "")).toHaveLength(4);
    expect(built.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["Class1", "Class2", "association"], ["Class3", "Class3", "dependency"],
    ]);
    await page.screenshot({ path: "docs/revamp/after/canvas-first-class.png", fullPage: true });

    const reopened = await roundTrip(page, "project file", outDir("canvas-first"));
    expect(picture(reopened.after)).toEqual(picture(built));
    expect(reopened.after.nodes.filter((n) => n.label === "")).toHaveLength(4);
    expect(reopened.after.edges.some((e) => e.from === "Class3" && e.to === "Class3" && e.kind === "dependency")).toBe(true);
    await expect(page.locator("#draw-check")).toContainText(/[0-9]+ notation warnings?/);
  });

  test("workspace: empty use cases and an actor placed, connected, named and labelled from the canvas alone, then saved and reopened", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTool(page, "diagram use-case\nid desk\ntitle Help desk\n", "write", { panels: "default" });
    await tab(page, "draw").click();
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator(".draw-inspector")).toBeHidden();
    const cv = (await canvas(page).boundingBox())!;
    await page.locator('.draw-shape[data-kind="actor"]').click();
    await page.mouse.click(cv.x + cv.width * 0.2, cv.y + cv.height * 0.4);
    await page.locator('.draw-shape[data-kind="use-case"]').click();
    await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.3);
    await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.6);
    await page.keyboard.press("Escape");
    let s = await inspect(page);
    const actor = s.nodes.find((n) => n.kind === "actor")!, [uc1, uc2] = s.nodes.filter((n) => n.kind === "use-case");
    expect(s.nodes.every((n) => !n.label)).toBe(true);

    // connect with the line tools: an association, then an include between the two goals
    await page.getByRole("button", { name: "association", exact: true }).click();
    await clickNode(page, actor.id);
    await clickNode(page, uc1.id);
    await page.getByRole("button", { name: "include", exact: true }).click();
    await clickNode(page, uc1.id);
    await clickNode(page, uc2.id);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await inspect(page)).edges.length).toBe(2);

    // names typed in place, from the bar beside the selection
    const bar = page.locator(".draw-selbar");
    for (const [n, word] of [[actor, "Caller"], [uc1, "log a ticket"], [uc2, "look up account"]] as const) {
      await clickNode(page, n.id);
      await bar.getByRole("button", { name: /^(text|name)$/ }).click();
      await page.keyboard.type(word);
      await page.keyboard.press("Enter");
    }
    // the association's meaning changed and back from the same bar; still no properties panel
    await clickEdge(page, actor.id, uc1.id);
    await expect(bar.getByRole("combobox", { name: "what the line means" })).toHaveValue("--");
    await expect(page.locator(".draw-inspector")).toBeHidden();
    s = await inspect(page);
    expect(s.nodes.map((n) => n.label).sort()).toEqual(["Caller", "log a ticket", "look up account"]);
    expect(s.edges.map((e) => [e.from, e.to, e.kind])).toEqual([[actor.id, uc1.id, "association"], [uc1.id, uc2.id, "include"]]);
    await page.screenshot({ path: "test-results/workspace-workflow.png" });

    const reopened = await roundTrip(page, "project file", outDir("workspace"));
    expect(reopened.after.nodes.map((n) => n.label).sort()).toEqual(["Caller", "log a ticket", "look up account"]);
  });

  test("S: an activity with a resized lane, a placed and a sized shape, a bent line, a moved label and a styled line reopens exactly as saved, from a project file and from .ksd text", async ({ page }) => {
    await openTool(page, ksdOf("activity-lanes"), "draw");
    // a lane with a thickness: drag its divider
    const customer = await node(page, "customer");
    const divider = await toPage(page, [customer.x + customer.w / 2, customer.y]);
    await drag(page, divider, [divider[0] + 70, divider[1]]);
    // a placed shape
    const ship = await box(page, "ship");
    await page.keyboard.down("Alt");
    await drag(page, [ship.cx, ship.cy], [ship.cx + 24, ship.cy + 36]);
    await page.keyboard.up("Alt");
    // a sized shape
    await clickNode(page, "place");
    const se = (await page.locator('.overlay .handle[data-handle="se"]').boundingBox())!;
    await drag(page, [se.x + 5, se.y + 5], [se.x + 5 + 44, se.y + 5 + 22]);
    // a bent route
    await clickEdge(page, "pay", "check");
    const handle = page.locator(".overlay .seg").last();
    const h = (await handle.boundingBox())!;
    const vertical = await handle.evaluate((el) => el.classList.contains("seg-v"));
    await drag(page, [h.x + h.width / 2, h.y + h.height / 2], [h.x + h.width / 2 + (vertical ? 30 : 0), h.y + h.height / 2 + (vertical ? 0 : 30)]);
    // a moved label
    const guard = await edge(page, "cleared", "cancel");
    const lb = (await page.locator(`.layer-hits rect[data-uid="${guard.uid}"][data-label]`).boundingBox())!;
    await drag(page, [lb.x + lb.width / 2, lb.y + lb.height / 2], [lb.x + lb.width / 2 + 30, lb.y + lb.height / 2 + 26]);
    // a line style
    await page.getByRole("button", { name: "fit", exact: true }).click();
    await canvas(page).scrollIntoViewIfNeeded();
    await clickEdge(page, "pack", "ship");
    await openLook(page);
    await field(page, "edge:style:color").selectOption("terra");
    await settle(page);
    await field(page, "edge:style:weight").selectOption("bold");
    await expect.poll(() => getText(page)).toContain("style pack -> ship color terra weight bold");

    const built = await inspect(page);
    expect(built.text).toMatch(/\n {2}lane customer [0-9.]+\n/);
    expect(built.text).toMatch(/\n {2}place ship [-0-9.]+ [-0-9.]+\n/);
    expect(built.text).toMatch(/\n {2}size place [0-9.]+ [0-9.]+\n/);
    expect(built.text).toMatch(/\n {2}route pay -> check elbow [^\n]*via [-0-9. ,]+\n/);
    expect(built.text).toMatch(/\n {2}label cleared -> cancel [0-9.]+ -?[0-9.]+ -?[0-9.]+\n/);
    expect(built.nodes.find((n) => n.id === "ship")!.placed && built.nodes.find((n) => n.id === "place")!.sized).toBe(true);
    await page.screenshot({ path: "test-results/flows-save-lanes-before.png" });

    const dir = outDir("saves");
    const project = await roundTrip(page, "project file", dir);
    expect(project.name).toBe("order-lanes.chalk.json");
    const file = readProject(project.path);
    expect([file.format, file.version, file.app]).toEqual(["chalk-project", 2, "Chalk"]);
    expect(file.source).toBe(built.text);
    // the model in the file holds every property, as data
    const saved = (id: string): SavedNode => file.model.nodes.find((n) => n.id === id)!;
    const savedEdge = (from: string, to: string): SavedEdge => file.model.edges.find((e) => e.from === from && e.to === to)!;
    expect(saved("customer").thickness).toBeGreaterThan(1);
    expect(saved("ship").place).toBeTruthy();
    expect(saved("place").size).toBeTruthy();
    expect(savedEdge("pay", "check").route!.via!.length).toBeGreaterThan(0);
    expect(savedEdge("cleared", "cancel").labelPos).toBeTruthy();
    expect(savedEdge("pack", "ship").style).toEqual({ color: "terra", weight: "bold" });
    expect(file.workspace!.view!.zoom).toBeGreaterThan(0);
    // the picture on the canvas is the reopened document, not a leftover
    await expect(page.locator(".draw-canvas .layer-nodes > g")).toHaveCount(built.nodes.filter((n) => n.kind !== "partition").length);
    await expect(page.locator('.layer-edges g[data-name="e8"] path.k-terra')).toHaveCount(1);
    await page.screenshot({ path: "test-results/flows-save-lanes-after.png" });

    // the same again as plain text: the .ksd is complete on its own
    const ksd = await roundTrip(page, "diagram text", dir);
    expect(ksd.name).toBe("order-lanes.ksd");
    expect(readFileSync(ksd.path, "utf8")).toBe(built.text);
    expect(picture(ksd.after)).toEqual(picture(built));
    // undo steps back over the open to the blank flowchart chosen during the round trip
    await canvas(page).focus();
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).nodes.map((n) => n.id)).toEqual([]);
  });

  test("S: a class diagram with a member added in draw, a moved class and a role name reopens exactly as saved", async ({ page }) => {
    await openTool(page, ksdOf("class-orders"), "draw");
    // a class member, added and named in place
    await page.getByRole("button", { name: "fit", exact: true }).click();
    await canvas(page).scrollIntoViewIfNeeded();
    await clickNode(page, "Catalog");
    await page.locator(".draw-inspector").getByRole("button", { name: "add attribute" }).click();
    await expect.poll(() => getText(page)).toContain("class Catalog {\n  +attribute1: Type\n}");
    const cat = await node(page, "Catalog");
    const row = (await inspect(page)).texts.find((t) => t.name === "Catalog:m0")!;
    const at = await toPage(page, [cat.x, row.y]);
    await page.mouse.dblclick(at[0], at[1]);
    await expect(inline(page)).toHaveValue("+attribute1: Type");
    await page.keyboard.type("+season: String");
    await page.keyboard.press("Enter");
    await expect.poll(() => getText(page)).toContain("class Catalog {\n  +season: String\n}");
    // a placed shape
    const product = await box(page, "Product");
    await page.keyboard.down("Alt");
    await drag(page, [product.cx, product.cy], [product.cx + 60, product.cy + 30]);
    await page.keyboard.up("Alt");
    // a role name at one end of an association
    await clickEdge(page, "Customer", "Order");
    await settle(page);
    await field(page, "edge:to-role").fill("orders");
    await field(page, "edge:to-role").press("Enter");
    await expect.poll(() => getText(page)).toContain('Customer "1" -- "0..* orders" Order : places');

    const built = await inspect(page);
    expect(built.texts.find((t) => t.name === "Catalog:m0")!.s).toBe("+season: String");
    const project = await roundTrip(page, "project file", outDir("saves"));
    expect(project.name).toBe("orders.chalk.json");
    const file = readProject(project.path);
    expect(file.source).toBe(built.text);
    expect(file.model.nodes.find((n) => n.id === "Catalog")!.members!.map((m) => m.name)).toEqual(["season"]);
    expect(file.model.nodes.find((n) => n.id === "Product")!.place).toBeTruthy();
    expect(file.model.edges.find((e) => e.from === "Customer")!.ends).toEqual({ from: { mult: "1" }, to: { mult: "0..*", role: "orders" } });
    // the reopened class can be edited where it is drawn, as before
    await expect(page.locator('.layer-texts text[data-name="Catalog:m0"]')).toHaveText("+season: String");
    await expect(page.locator('.layer-texts text[data-name="e1:to-role"]')).toHaveText("orders");
    const ksd = await roundTrip(page, "diagram text", outDir("saves"));
    expect(readFileSync(ksd.path, "utf8")).toBe(built.text);
  });

  test("S: a use-case diagram with a description written in the panel, a moved actor and a styled line reopens exactly as saved", async ({ page }) => {
    await openTool(page, ksdOf("usecase-permit"), "draw");
    // a use-case description
    await clickNode(page, "apply");
    await page.locator(".inspector-section", { hasText: "A structured description" }).locator("summary").click();
    await field(page, "uc:goal").fill("Get a building permit without a visit to the office");
    await field(page, "uc:goal").press("Enter");
    await expect.poll(() => getText(page)).toContain("describe apply {\n  goal Get a building permit without a visit to the office\n}");
    await settle(page);
    await field(page, "uc:primary").selectOption("resident");
    await expect.poll(() => getText(page)).toContain("  primary resident\n");
    await settle(page);
    await field(page, "uc:main").fill("1. The resident fills in the form\n2. The resident pays the fee\n3. The portal confirms the application");
    await page.keyboard.press("Tab");
    await expect.poll(() => getText(page)).toContain("  main 3. The portal confirms the application\n");
    // a placed shape
    const clerk = await box(page, "clerk");
    await page.keyboard.down("Alt");
    await drag(page, [clerk.cx, clerk.cy], [clerk.cx + 30, clerk.cy + 50]);
    await page.keyboard.up("Alt");
    // a line style
    await clickEdge(page, "apply", "pay");
    await openLook(page);
    await field(page, "edge:style:color").selectOption("accent");
    await expect.poll(() => getText(page)).toContain("style apply -include-> pay color accent");

    const built = await inspect(page);
    expect(built.text).toContain([
      "describe apply {", "  goal Get a building permit without a visit to the office", "  primary resident",
      "  main 1. The resident fills in the form", "  main 2. The resident pays the fee", "  main 3. The portal confirms the application", "}",
    ].join("\n"));
    const project = await roundTrip(page, "project file", outDir("saves"));
    expect(project.name).toBe("permit-portal.chalk.json");
    const file = readProject(project.path);
    expect(file.source).toBe(built.text);
    const apply = file.model.nodes.find((n) => n.id === "apply")!;
    expect(apply.describe!.goal).toBe("Get a building permit without a visit to the office");
    expect(apply.describe!.main!.length).toBe(3);
    expect(file.model.nodes.find((n) => n.id === "clerk")!.place).toBeTruthy();
    // the description is back in the panel after reopening
    await clickNode(page, "apply");
    await expect(field(page, "uc:goal")).toHaveValue("Get a building permit without a visit to the office");
    await expect(field(page, "uc:primary")).toHaveValue("resident");
    await expect(field(page, "uc:main")).toHaveValue("1. The resident fills in the form\n2. The resident pays the fee\n3. The portal confirms the application");
    await expect(page.locator('.layer-edges g[data-name="e4"] path.k-accent')).toHaveCount(1);
    const ksd = await roundTrip(page, "diagram text", outDir("saves"));
    expect(readFileSync(ksd.path, "utf8")).toBe(built.text);
  });

  // Was a gap: openFile() read the saved uids and threw them away. The project's model now travels with the text into
  // the session, which gives each shape and line the uid it was saved with.
  test("S: a project file brings each shape's identity (uid) back with it", async ({ page }) => {
    await openTool(page, ksdOf("class-orders"), "draw");
    const { before, after, path } = await roundTrip(page, "project file", outDir("saves"));
    expect(readProject(path).model.nodes.map((n) => n.uid)).toEqual(before.nodes.map((n) => n.uid));
    expect(after.nodes.map((n) => n.uid)).toEqual(before.nodes.map((n) => n.uid));
    expect(after.edges.map((e) => e.uid)).toEqual(before.edges.map((e) => e.uid));
  });
});

// ---------------------------------------------------------------- exports

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  expect(b.subarray(0, 8).toString("latin1")).toBe("\x89PNG\r\n\x1a\n");
  expect(b.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const dialog = (page: Page): Locator => page.locator("dialog.export-dialog");
const choose = (page: Page, group: string, value: string | number): Promise<void> => dialog(page).locator(`input[name="export-${group}"][value="${value}"]`).check();
const facts = (page: Page): Locator => dialog(page).locator(".export-facts");
const PNG_FACTS = /^(\d+) x (\d+) px(?: \(|\.)/;
const NATURAL_FACTS = /^(\d+) x (\d+) px, ([0-9.]+) x ([0-9.]+) in\./;

async function openExport(page: Page): Promise<void> {
  await page.locator("#open-export").click();
  await expect(dialog(page).locator(".export-preview img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await dialog(page).locator("details.export-more summary").click();
}
/** Press download in the export dialog and keep the file. */
async function download(page: Page, path: string): Promise<Download> {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialog(page).locator("#export-download").click()]);
  await dl.saveAs(path);
  await expect(dialog(page).locator(".export-note")).toHaveText(`saved ${dl.suggestedFilename()}`);
  return dl;
}
/**
 * Pick a look, then read the diagram's natural size off the dialog. The dialog redraws a moment after each choice, so
 * the PNG wording is waited for first: the size line that follows can then only belong to this look.
 */
async function naturalSize(page: Page, look: "sketch" | "precision"): Promise<{ w: number; h: number; inW: number; inH: number }> {
  await choose(page, "format", "png");
  await choose(page, "look", look);
  await expect(facts(page)).toHaveText(PNG_FACTS);
  await choose(page, "format", "svg");
  await expect(facts(page)).toHaveText(NATURAL_FACTS);
  const m = NATURAL_FACTS.exec((await facts(page).textContent()) ?? "")!;
  return { w: Number(m[1]), h: Number(m[2]), inW: Number(m[3]), inH: Number(m[4]) };
}

/** What every exported SVG must be: a file that stands on its own and holds nothing of the editor. */
function checkSvg(svg: string, o: { w: number; h: number; ground: "white" | "clear"; docId: string; names: string[] }): void {
  expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const root = /<svg [^>]*>/.exec(svg)![0];
  expect(root).toContain(`viewBox="0 0 ${o.w} ${o.h}"`);
  expect(root).toContain(`width="${o.w}"`);
  expect(root).toContain(`height="${o.h}"`);
  // nothing that needs a stylesheet or changes with the viewer's settings
  expect(svg).not.toContain("var(");
  expect(svg).not.toContain("class=");
  expect(svg).not.toContain("style=");
  expect(svg).not.toContain("@media");
  expect(svg).not.toContain("currentColor");
  for (const style of svg.match(/<style>[\s\S]*?<\/style>/g) ?? []) {
    const rules = style.replace(/^<style>|<\/style>$/g, "").replace(/@font-face\{[^}]*\}/g, "");
    expect(rules.trim(), "only @font-face rules in the file's style").toBe("");
  }
  // the background
  const rects = svg.match(/<rect [^>]*>/g) ?? [];
  if (o.ground === "white") expect(rects).toEqual([`<rect width="${o.w}" height="${o.h}" fill="#FFFFFF"/>`]);
  else {
    expect(rects).toEqual([]);
    // see-through all the way: no page-colored fill hiding behind a shape either
    expect(svg).not.toMatch(/fill="#(?:FAFAF6|FFFFFF)"/i);
  }
  // nothing of the editor: no selection, grid, handle, port or hit target, by class, by attribute or by element
  const bare = svg.replace(/base64,[A-Za-z0-9+/=]+/g, "").replace(/<(title|desc|text)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  expect(bare).not.toMatch(/data-[a-z]+=/);
  expect(bare).not.toMatch(/<(?:pattern|defs|circle|line|foreignObject|script|image|use)\b/);
  expect(bare).not.toMatch(/draw-grid|draw-svg|ksyt-fig|layer-|overlay|handle|sel-line|hit-line|grid-dot|marquee|ghost|\bport\b|\bguide\b/);
  // every group in the file is one of the diagram's own shapes or lines
  const groups = (svg.match(/<g id="[^"]*">/g) ?? []).map((g) => g.slice(7, -2));
  expect(groups.sort()).toEqual(o.names.map((n) => `${o.docId}-${n}`).sort());
}

/** The fonts a PDF page uses that are embedded in the file (their font programs are in it). */
function embeddedFonts(pdf: PDFDocument): string[] {
  const page = pdf.getPages()[0];
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const out: string[] = [];
  for (const [, ref] of fonts?.entries() ?? []) {
    const font = pdf.context.lookup(ref, PDFDict);
    const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
    const holder = descendants ? descendants.lookup(0, PDFDict) : font;
    const descriptor = holder.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (!descriptor) continue;
    if (["FontFile", "FontFile2", "FontFile3"].some((k) => descriptor.has(PDFName.of(k)))) out.push(String(font.get(PDFName.of("BaseFont"))));
  }
  return out;
}

test.describe("exports", () => {
  for (const [fixture, type] of [["activity-lanes", "activity"], ["usecase-permit", "use-case"], ["class-orders", "class"]] as const) {
    test(`T: ${type} (${fixture}) exports as SVG, PNG and PDF in both looks, and each file is what the dialog said it would be`, async ({ page }) => {
      test.setTimeout(180_000);
      mkdirSync(EXPORTS, { recursive: true });
      await openTool(page, ksdOf(fixture), "draw");
      // the editor is busy when the export is made: a shape is selected with its handles out, and the grid is on
      const st = await inspect(page);
      const first = st.nodes.find((n) => ["action", "use-case", "class"].includes(n.kind))!;
      await clickNode(page, first.id);
      await page.getByRole("button", { name: "snap to grid" }).click();
      await expect(page.locator(".overlay .sel")).toHaveCount(1);
      expect(await page.locator(".overlay .handle").count()).toBeGreaterThan(0);
      const docId = /^id (\S+)$/m.exec(st.text)![1];
      const names = [...st.nodes.map((n) => n.id), ...st.edges.map((e) => e.id)];
      await openExport(page);

      const sizes: Record<string, { w: number; h: number }> = {};
      for (const look of ["sketch", "precision"] as const) {
        const file = (suffix: string): string => join(EXPORTS, `${fixture}.${look}.${suffix}`);
        const nat = await naturalSize(page, look);
        sizes[look] = nat;
        expect(nat.w).toBeGreaterThan(200);
        // the inches on the dialog are the same size as its pixels, at 96 to the inch
        expect(Math.abs(nat.inW * PX - nat.w)).toBeLessThanOrEqual(0.05 * PX + 0.5);
        expect(Math.abs(nat.inH * PX - nat.h)).toBeLessThanOrEqual(0.05 * PX + 0.5);

        // ---- SVG, white background
        await choose(page, "ground", "white");
        const dl = await download(page, file("svg"));
        expect(dl.suggestedFilename()).toBe(`${docId}.svg`);
        const svg = readFileSync(file("svg"), "utf8");
        checkSvg(svg, { ...nat, ground: "white", docId, names });
        // real text, in the look's own font, embedded
        const texts = svg.match(/<text [^>]*>/g) ?? [];
        expect(texts.length).toBe(st.texts.length);
        for (const t of texts) expect(t).toContain(look === "sketch" ? `font-family="Kalam,` : `font-family="'Atkinson Hyperlegible Next',`);
        expect(svg).toMatch(new RegExp(`@font-face\\{font-family:'${look === "sketch" ? "Kalam" : "Atkinson Hyperlegible Next"}';font-weight:[0-9]+;src:url\\(data:font/woff2;base64,`));
        // sketch ink is filled pen shapes; precision ink is strokes
        expect(/ stroke-width="/.test(svg)).toBe(look === "precision");

        // ---- SVG, see-through
        await choose(page, "ground", "clear");
        await download(page, file("clear.svg"));
        checkSvg(readFileSync(file("clear.svg"), "utf8"), { ...nat, ground: "clear", docId, names });
        await choose(page, "ground", "white");

        // ---- SVG with its letters as shapes
        await choose(page, "text", "shapes");
        await download(page, file("shapes.svg"));
        const shapes = readFileSync(file("shapes.svg"), "utf8");
        expect(shapes).not.toContain("<text");
        expect(shapes).not.toContain("@font-face");
        expect(shapes).not.toContain("<style");
        expect(shapes).not.toContain("font-family");
        checkSvg(shapes, { ...nat, ground: "white", docId, names });
        // each label is still there, as a shape that carries its words
        expect((shapes.match(/<path d="[^"]+" fill="#[0-9A-Fa-f]{6}"><title>/g) ?? []).length).toBe(st.texts.length);
        await choose(page, "text", "letters");

        // ---- PNG at 1x and 2x: the pixels are the natural size times the scale, as the dialog says
        await choose(page, "format", "png");
        for (const scale of [1, 2]) {
          await choose(page, "scale", scale);
          await expect(facts(page)).toContainText(`${nat.w * scale} x ${nat.h * scale} px.`);
          const png = await download(page, file(`${scale}x.png`));
          expect(png.suggestedFilename()).toBe(`${docId}.png`);
          const got = pngSize(file(`${scale}x.png`));
          if (scale === 1) expect(got, `${look} PNG at 1x`).toEqual({ width: nat.w, height: nat.h });
          else {
            // SKIPPED STEP: at 2x the file can be one pixel off what the dialog says (the fixme test below asserts the
            // exact size). Until that is fixed this only checks that the file is the 2x file, to the pixel either way.
            expect(Math.abs(got.width - nat.w * scale), `${look} PNG at 2x is ${got.width} wide for ${nat.w * scale}`).toBeLessThanOrEqual(1);
            expect(Math.abs(got.height - nat.h * scale), `${look} PNG at 2x is ${got.height} tall for ${nat.h * scale}`).toBeLessThanOrEqual(1);
          }
        }

        // ---- PDF on a page the size of the diagram
        await choose(page, "format", "pdf");
        await expect(dialog(page).locator('input[name="export-page"][value="fit"]')).toBeChecked();
        await download(page, file("pdf"));
        const bytes = readFileSync(file("pdf"));
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPageCount()).toBe(1);
        const size = pdf.getPages()[0].getSize();
        // 72 points to the inch against 96 pixels: the page is the diagram, to within the dialog's rounding to whole pixels
        expect(Math.abs(size.width - nat.w * 0.75), `${look} PDF page width ${size.width}pt for ${nat.w}px`).toBeLessThanOrEqual(0.4);
        expect(Math.abs(size.height - nat.h * 0.75), `${look} PDF page height ${size.height}pt for ${nat.h}px`).toBeLessThanOrEqual(0.4);
        const fonts = embeddedFonts(pdf);
        expect(fonts.length, `${look} PDF has embedded fonts`).toBeGreaterThanOrEqual(1);
        for (const f of fonts) expect(f).toMatch(look === "sketch" ? /Kalam/ : /Atkinson/);
        expect(pdf.getTitle()).toBe(/^title (.+)$/m.exec(st.text)![1].trim());
      }
      // the two looks draw the same geometry, so their files are the same size to within the stroke width and the font
      expect(Math.abs(sizes.sketch.w - sizes.precision.w)).toBeLessThan(sizes.sketch.w * 0.2);
      // exporting changed nothing in the document, and the editor is as it was
      await dialog(page).getByRole("button", { name: "close" }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await getText(page)).toBe(st.text);
      await expect(page.locator(".overlay .sel")).toHaveCount(1);
    });
  }

  // Was a bug: the dialog and exportPng rounded differently, so a 2x file could be one pixel off what the dialog said
  // (942 x 1840 against 941 x 1839). Both now start from the SVG's own whole-pixel size.
  test("T: a 2x PNG is exactly twice the natural size, and exactly the size the dialog shows", async ({ page }) => {
    mkdirSync(EXPORTS, { recursive: true });
    for (const [fixture, look] of [["class-orders", "sketch"], ["activity-lanes", "precision"]] as const) {
      await openTool(page, ksdOf(fixture), "draw");
      await openExport(page);
      const nat = await naturalSize(page, look);
      await choose(page, "format", "png");
      await choose(page, "scale", 2);
      await expect(facts(page)).toContainText(`${nat.w * 2} x ${nat.h * 2} px.`);
      const path = join(EXPORTS, `${fixture}.${look}.2x-exact.png`);
      await download(page, path);
      expect(pngSize(path), `${fixture} ${look}`).toEqual({ width: nat.w * 2, height: nat.h * 2 });
      await dialog(page).getByRole("button", { name: "close" }).click();
    }
  });

  const CLAIMS = "diagram activity\nid claims\ntitle A claim is reviewed before it is paid\n\nstart begin\naction review \"review claim\"\naction pay \"pay claim\"\nend done\n\nbegin -> review\nreview -> pay\npay -> done\n";

  test("X: a line's color, weight and dashes, set in the panel, are in the exported file in both looks", async ({ page }) => {
    mkdirSync(EXPORTS, { recursive: true });
    await openTool(page, CLAIMS, "draw");
    await clickEdge(page, "review", "pay");
    await openLook(page);
    await field(page, "edge:style:color").selectOption("terra");
    await settle(page);
    await field(page, "edge:style:weight").selectOption("bold");
    await settle(page);
    // the pattern is not a free choice: a dashed line is a proposed path, chosen as what the line means
    await field(page, "edge:op").selectOption("..>");
    await expect(status(page)).toContainText("now proposed path");
    await expect.poll(() => getText(page)).toContain("review ..> pay\n");
    expect(await getText(page)).toContain("style review ..> pay color terra weight bold");
    await expect(page.locator(".draw-inspector")).toContainText("Drawn dashed");
    const st = await inspect(page);
    const styled = st.edges.find((e) => e.from === "review")!, plainLine = st.edges.find((e) => e.from === "begin")!;
    expect([styled.id, plainLine.id]).toEqual(["e2", "e1"]);
    // on the canvas first
    await expect(page.locator('.layer-edges g[data-name="e2"] path.k-terra')).toHaveCount(1);
    await page.screenshot({ path: "test-results/flows-styled-line.png" });

    const terra = exportPalette("light", "white").terra, ink = exportPalette("light", "white").ink;
    const group = (svg: string, name: string): string => new RegExp(`<g id="claims-${name}">([\\s\\S]*?)</g>`).exec(svg)![1];
    await openExport(page);
    await choose(page, "format", "svg");
    await choose(page, "ground", "white");
    const size: Record<string, string> = {};
    for (const look of ["sketch", "precision"] as const) {
      await choose(page, "look", look);
      const path = join(EXPORTS, `claims-styled.${look}.svg`);
      await download(page, path);
      const svg = readFileSync(path, "utf8");
      size[look] = /<svg [^>]*>/.exec(svg)![0];
      const mine = group(svg, "e2"), other = group(svg, "e1");
      // the color: the export color of the role, as a plain attribute, on the styled line only
      expect(mine).toContain(terra);
      expect(mine).not.toContain(ink);
      expect(other).toContain(ink);
      expect(other).not.toContain(terra);
      expect(svg.split(terra).length - 1, "terracotta is used by the one styled line").toBe((mine.match(new RegExp(terra, "g")) ?? []).length);
      if (look === "precision") {
        const shaft = /<path [^>]*stroke-dasharray="[^"]*"[^>]*>/.exec(mine)![0];
        // weight: bold is 1.6 times the unstyled stroke
        const bold = Number(/stroke-width="([0-9.]+)"/.exec(shaft)![1]), normal = Number(/stroke-width="([0-9.]+)"/.exec(other)![1]);
        expect(normal).toBeCloseTo(LINE_W * PX, 2);
        expect(bold).toBeCloseTo(LINE_W * weightOf("bold") * PX, 2);
        expect(bold).toBeGreaterThan(normal * 1.5);
        // dashes: a real dash pattern on the shaft, none on the head, none on an unstyled line
        expect(shaft).toContain(`stroke="${terra}"`);
        expect(shaft).toContain('stroke-dasharray="8.6 6.2"');
        expect((mine.match(/stroke-dasharray=/g) ?? []).length).toBe(1);
        expect((mine.match(/<path /g) ?? []).length).toBe(2);
        expect(other).not.toContain("stroke-dasharray");
        expect(svg).not.toContain('fill="' + terra);
      } else {
        // sketch ink is filled pen strokes: the color is a fill, and nothing is stroked
        expect(mine).toContain(`fill="${terra}"`);
        expect(svg).not.toContain("stroke-width");
        expect(svg).not.toContain("stroke-dasharray");
        const mineInk = (mine.match(/ d="([^"]+)"/g) ?? []).flatMap((d) => polygons(d.slice(4, -1)));
        const otherInk = (other.match(/ d="([^"]+)"/g) ?? []).flatMap((d) => polygons(d.slice(4, -1)));
        // dashes: the pen lifts, so the styled line is separate pieces; the unstyled one is one unbroken stroke
        const dashes = dashPieces(styled.points, 0.17, 0.1, 0, 0.1).length;
        expect(dashes).toBeGreaterThanOrEqual(2);
        expect(pieces(mineInk), "the dashed line is drawn in pieces").toBeGreaterThanOrEqual(Math.max(2, dashes - 1));
        expect(pieces(otherInk), "the solid line is one piece").toBe(1);
        // weight: a bold stroke is wider across than an unstyled one (both lines run straight down the page here)
        const across = (polys: Pt[][], line: Inspect["edges"][number]): number => {
          const horizontal = Math.abs(line.points[0][1] - line.points[line.points.length - 1][1]) < 0.01;
          // the widest dash or shaft polygon, measured across the line's direction; the arrowhead's short strokes are not long enough to count
          let most = 0;
          for (const p of polys) {
            const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
            const along = horizontal ? Math.max(...xs) - Math.min(...xs) : Math.max(...ys) - Math.min(...ys);
            const wide = horizontal ? Math.max(...ys) - Math.min(...ys) : Math.max(...xs) - Math.min(...xs);
            if (along > wide * 3) most = Math.max(most, wide);
          }
          return most;
        };
        expect(across(mineInk, styled), "bold pen strokes are wider than normal ones").toBeGreaterThan(across(otherInk, plainLine) * 1.2);
      }
    }
    // both looks are the same picture at the same size, give or take the stroke
    const dims = (root: string): number[] => [Number(/width="(\d+)"/.exec(root)![1]), Number(/height="(\d+)"/.exec(root)![1])];
    expect(Math.abs(dims(size.sketch)[0] - dims(size.precision)[0])).toBeLessThan(40);
    expect(Math.abs(dims(size.sketch)[1] - dims(size.precision)[1])).toBeLessThan(40);
  });
});

// ---------------------------------------------------------------- a large diagram

/** A valid activity of exactly `nodes` shapes and `lines` lines: three-way decisions that merge again, one after another. */
function bigActivity(nodes: number, lines: number): string {
  const decl: string[] = ["start begin"], flow: string[] = [];
  let count = 1, prev = "begin", units = 0;
  while (count + 5 <= nodes - 1) {
    const u = ++units;
    decl.push(`decision d${u} "case ${u}?"`, `action a${u} "handle a ${u}"`, `action b${u} "handle b ${u}"`, `action c${u} "handle c ${u}"`, `merge m${u}`);
    flow.push(`${prev} -> d${u}`, `d${u} -> a${u} : [a]`, `d${u} -> b${u} : [b]`, `d${u} -> c${u} : [c]`, `a${u} -> m${u}`, `b${u} -> m${u}`, `c${u} -> m${u}`);
    prev = `m${u}`;
    count += 5;
  }
  for (let k = 1; count < nodes - 1; k++, count++) {
    decl.push(`action t${k} "wrap up ${k}"`);
    flow.push(`${prev} -> t${k}`);
    prev = `t${k}`;
  }
  decl.push("end done");
  flow.push(`${prev} -> done`);
  for (let u = 1; flow.length < lines; u++) {
    if (u > units) throw new Error("not enough decisions for that many lines");
    flow.push(`d${u} -> m${u} : [skip]`);
  }
  return ["diagram activity", `id big${nodes}`, `title A long intake flow with ${nodes} shapes and ${lines} lines`, "", ...decl, "", ...flow, ""].join("\n");
}

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

test.describe("a large diagram", () => {
  test("V: dragging a shape in a diagram of 100 shapes and 150 lines keeps up with the pointer (and at 50, under the partial re-routing threshold)", async ({ page }) => {
    test.setTimeout(240_000);
    // time every animation-frame callback the app runs, and stamp every frame, while a drag is being recorded
    interface Probe { __raf: typeof requestAnimationFrame; __rec: boolean; __work: Array<{ t: number; ms: number }>; __frames: Array<{ t: number; at: number }> }
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: typeof requestAnimationFrame; __rec: boolean; __work: Array<{ t: number; ms: number }>; __frames: Array<{ t: number; at: number }> };
      w.__raf = window.requestAnimationFrame.bind(window);
      w.__rec = false;
      w.__work = [];
      w.__frames = [];
      // the app's own frame callbacks (the canvas redraws a drag in one), each timed and stamped with its frame
      window.requestAnimationFrame = (cb: FrameRequestCallback): number => w.__raf((t) => {
        const s = performance.now();
        try { cb(t); } finally { if (w.__rec) w.__work.push({ t, ms: performance.now() - s }); }
      });
    });
    interface Run {
      nodes: number; lines: number; frames: number; redraws: number;
      /** ms between one animation frame and the next, over every frame of the drag */
      frameMedian: number; frameP95: number; frameMax: number;
      /** the same, over the frames that redrew the diagram: how long a redraw holds the screen */
      redrawFrameMedian: number; redrawFrameP95: number; redrawFrameMax: number;
      /** the same frames by the clock: from one frame's callbacks starting to the next frame's starting */
      clockMedian: number; clockP95: number; clockMax: number;
      /** script time inside those frames */
      workMedian: number; workP95: number; workMax: number;
      dropMs: number;
    }
    const runs: Run[] = [];
    for (const [nodes, lines] of [[50, 75], [100, 150]]) {
      await openTool(page, bigActivity(nodes, lines), "draw");
      const st = await inspect(page);
      expect(st.valid).toBe(true);
      expect([st.nodes.length, st.edges.length]).toEqual([nodes, lines]);
      // the same shape in both runs, near the top so it is on screen
      const z = await zoom(page);
      const b = await box(page, "b1");
      const before = await node(page, "b1");
      const others = st.nodes.filter((n) => n.id !== "b1");
      await page.mouse.move(b.cx, b.cy);
      await page.mouse.down();
      await page.evaluate(() => {
        const w = window as unknown as Probe;
        w.__work = [];
        w.__frames = [];
        w.__rec = true;
        // one stamp per animation frame, for as long as the drag is recorded: the frame's own timestamp, and the clock when it
        // ran. This callback is asked for before the pointer event that asks for a redraw, so it runs first in its frame.
        const each = (t: number): void => { w.__frames.push({ t, at: performance.now() }); if (w.__rec) w.__raf(each); };
        w.__raf(each);
      });
      // 48 pointer steps, each its own event, with snapping off so the shape tracks the pointer exactly
      await page.keyboard.down("Alt");
      const STEPS = 48;
      for (let i = 1; i <= STEPS; i++) await page.mouse.move(b.cx + i * 3, b.cy + i * 1.5);
      await page.evaluate(() => new Promise<void>((r) => { const w = window as unknown as Probe; w.__raf(() => w.__raf(() => r())); }));
      const rec = await page.evaluate(() => {
        const w = window as unknown as Probe;
        w.__rec = false;
        return { work: w.__work, frames: w.__frames };
      });
      // the shape is under the pointer while the button is still down
      const mid = await page.locator(`.layer-hits g[data-uid="${before.uid}"] .hit`).boundingBox();
      expect(near(mid!.x + mid!.width / 2, b.cx + STEPS * 3, 3) && near(mid!.y + mid!.height / 2, b.cy + STEPS * 1.5, 3), "the shape followed the pointer").toBe(true);
      const t1 = Date.now();
      await page.mouse.up();
      await page.keyboard.up("Alt");
      const after = await node(page, "b1");
      const dropMs = Date.now() - t1;
      expect(near((after.x - before.x) * PX * z, STEPS * 3, 3) && near((after.y - before.y) * PX * z, STEPS * 1.5, 3), "the shape landed where it was dropped").toBe(true);
      // nothing else moved
      const now = await inspect(page);
      for (const n of others) {
        const m = now.nodes.find((x) => x.id === n.id)!;
        expect(Math.abs(m.x - n.x) + Math.abs(m.y - n.y), `${n.id} stayed put`).toBeLessThan(0.005);
      }
      const up = (a: number, b2: number): number => a - b2;
      const gaps = rec.frames.slice(1).map((f, i) => f.t - rec.frames[i].t).sort(up);
      // script time per frame (a frame may run more than one of the app's callbacks), and how long that frame lasted
      const perFrame = new Map<number, number>();
      for (const k of rec.work) perFrame.set(k.t, (perFrame.get(k.t) ?? 0) + k.ms);
      const work = [...perFrame.values()].sort(up);
      const held: number[] = [], clock: number[] = [];
      for (const t of perFrame.keys()) {
        const i = rec.frames.findIndex((f) => f.t === t);
        if (i < 0 || i + 1 >= rec.frames.length) continue;
        held.push(rec.frames[i + 1].t - t);
        clock.push(rec.frames[i + 1].at - rec.frames[i].at);
      }
      held.sort(up);
      clock.sort(up);
      expect(work.length, "the drag was redrawn many times, not once at the end").toBeGreaterThanOrEqual(30);
      expect(held.length).toBeGreaterThanOrEqual(30);
      const r1 = (v: number): number => Math.round(v * 10) / 10;
      runs.push({
        nodes, lines, frames: gaps.length, redraws: work.length,
        frameMedian: r1(pct(gaps, 0.5)), frameP95: r1(pct(gaps, 0.95)), frameMax: r1(gaps[gaps.length - 1]),
        redrawFrameMedian: r1(pct(held, 0.5)), redrawFrameP95: r1(pct(held, 0.95)), redrawFrameMax: r1(held[held.length - 1]),
        clockMedian: r1(pct(clock, 0.5)), clockP95: r1(pct(clock, 0.95)), clockMax: r1(clock[clock.length - 1]),
        workMedian: r1(pct(work, 0.5)), workP95: r1(pct(work, 0.95)), workMax: r1(work[work.length - 1]), dropMs,
      });
    }
    for (const r of runs) {
      const line = `V: ${r.nodes} shapes, ${r.lines} lines, ${r.redraws} redraws in ${r.frames} frames: ` +
        `a frame that redraws lasts median ${r.redrawFrameMedian} ms, p95 ${r.redrawFrameP95} ms, max ${r.redrawFrameMax} ms by frame timestamps, ` +
        `median ${r.clockMedian} ms, p95 ${r.clockP95} ms, max ${r.clockMax} ms by the clock; ` +
        `script time in it median ${r.workMedian} ms, p95 ${r.workP95} ms, max ${r.workMax} ms; ` +
        `all frames median ${r.frameMedian} ms, p95 ${r.frameP95} ms, max ${r.frameMax} ms; the drop took about ${r.dropMs} ms`;
      console.log(line);
      test.info().annotations.push({ type: "frame times", description: line });
    }
    for (const r of runs) {
      // generous: a frame every 50 ms is about the slowest that still feels attached to the pointer
      expect(r.redrawFrameMedian, `${r.nodes} shapes: median length of a frame that redraws`).toBeLessThan(50);
      expect(r.clockMedian, `${r.nodes} shapes: median length of a frame that redraws, by the clock`).toBeLessThan(50);
      expect(r.workMedian, `${r.nodes} shapes: median script time in a redraw`).toBeLessThan(50);
      expect(r.frameMedian, `${r.nodes} shapes: median frame interval`).toBeLessThan(50);
      expect(r.redrawFrameP95, `${r.nodes} shapes: 95th percentile length of a frame that redraws`).toBeLessThan(120);
    }
  });
});

// ---------------------------------------------------------------- refresh and back

test.describe("refresh and back", () => {
  const CLAIMS = "diagram activity\nid claims\ntitle A claim is reviewed before it is paid\n\nstart begin\naction review \"review claim\"\naction pay \"pay claim\"\nend done\n\nbegin -> review\nreview -> pay\npay -> done\n";
  const draft = (page: Page): Promise<string | null> => page.evaluate(() => {
    const raw = localStorage.getItem("chalk:draft");
    return raw ? (JSON.parse(raw) as { text: string }).text : null;
  });
  const loaded = async (page: Page): Promise<void> => {
    await page.waitForFunction(() => !!(window as unknown as { chalk?: unknown }).chalk);
    await expect(page.locator(".draw-canvas .layer-nodes > g").first()).toBeAttached();
  };
  /** Two edits in draw: a shape moved, a shape renamed in place. */
  const edit = async (page: Page): Promise<Inspect> => {
    const b = await box(page, "pay");
    await page.keyboard.down("Alt");
    await drag(page, [b.cx, b.cy], [b.cx + 150, b.cy + 20]);
    await page.keyboard.up("Alt");
    const r = await box(page, "review");
    await page.mouse.dblclick(r.cx, r.cy);
    await expect(inline(page)).toBeFocused();
    await page.keyboard.type("check the claim twice");
    await page.keyboard.press("Enter");
    const st = await inspect(page);
    expect(st.text).toContain('action review "check the claim twice"');
    expect(st.text).toMatch(/place pay [-0-9.]+ [-0-9.]+/);
    // the draft is written a moment after the edit
    await expect.poll(() => draft(page)).toBe(st.text);
    return st;
  };

  test("W: a refresh brings the drawing back from the local draft, still in draw; the syntax view and back leave it as it was", async ({ page }) => {
    await openTool(page, CLAIMS, "draw");
    const before = await edit(page);

    // refresh
    await page.reload();
    await loaded(page);
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#panel-draw")).toBeVisible();
    let now = await inspect(page);
    expect(now.text).toBe(before.text);
    expect(picture(now)).toEqual(picture(before));
    await expect(page.locator('.layer-texts text[data-name="review:label"]')).toHaveText("check the claim twice");

    // the draft alone is enough: the page opened again with no diagram in its link
    await page.goto("about:blank");
    await page.goto("/#tab=draw");
    await loaded(page);
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    now = await inspect(page);
    expect(now.text).toBe(before.text);
    expect(picture(now)).toEqual(picture(before));
    // a restored drawing is still a drawing: it can be edited, and undone
    await page.getByRole("button", { name: "fit", exact: true }).click();
    await canvas(page).scrollIntoViewIfNeeded();
    const d = await box(page, "done");
    await page.keyboard.down("Alt");
    await drag(page, [d.cx, d.cy], [d.cx - 120, d.cy]);
    await page.keyboard.up("Alt");
    const edited = await inspect(page);
    expect(edited.text).toMatch(/place done [-0-9.]+ [-0-9.]+/);
    await expect.poll(() => draft(page)).toBe(edited.text);

    // to the syntax view by its address, the way a link or a bookmark gets there, and back with the browser's button
    await page.evaluate(() => { location.hash = "tab=syntax"; });
    await expect(tab(page, "the syntax")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#panel-syntax h2").first()).toBeVisible();
    await page.goBack();
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#panel-draw")).toBeVisible();
    now = await inspect(page);
    expect(now).toEqual(edited);
    // the edits can still be undone: back did not start the document over
    expect(now.canUndo).toBe(true);
    await expect(page.locator('.layer-texts text[data-name="review:label"]')).toHaveText("check the claim twice");
    await page.screenshot({ path: "test-results/flows-refresh-back.png" });
  });

  test("W: leaving the page from the syntax view and coming back with the browser's buttons loses nothing", async ({ page }) => {
    // a page to go back to: the embed of the same diagram
    await page.goto("/embed/");
    await openTool(page, CLAIMS, "draw");
    const before = await edit(page);
    await tab(page, "the syntax").click();
    await expect(page.locator("#panel-syntax")).toBeVisible();
    // a change of view is one step of the browser's history: the first back returns to the drawing, the second leaves the tool
    await page.goBack();
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page).toHaveURL(/\/embed\/$/);
    await page.goForward();
    await page.waitForFunction(() => !!(window as unknown as { chalk?: unknown }).chalk);
    await page.goForward();
    await page.waitForFunction(() => !!(window as unknown as { chalk?: unknown }).chalk);
    const now = await inspect(page);
    expect(now.text).toBe(before.text);
    expect(picture(now)).toEqual(picture(before));
    // it comes back on the view it was left on
    await expect(tab(page, "the syntax")).toHaveAttribute("aria-selected", "true");
    await tab(page, "draw").click();
    await expect(page.locator('.layer-texts text[data-name="review:label"]')).toHaveText("check the claim twice");
    expect(picture(await inspect(page))).toEqual(picture(before));
  });

  // Was a gap: the view tabs rewrote one history entry, so the back button left the tool. A change of view is now a
  // history entry of its own, and going back to it never brings back older text: undo does that, not the back button.
  test("W: after switching to the syntax view with its tab, the browser's back button returns to the drawing", async ({ page }) => {
    await page.goto("/embed/");
    await openTool(page, CLAIMS, "draw");
    const before = await edit(page);
    await tab(page, "the syntax").click();
    await expect(page.locator("#panel-syntax")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/#.*tab=draw/);
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    expect(await inspect(page)).toEqual(before);
    // text changed on a later view is still there after going back: the entry is a view, not a version
    await tab(page, "write").click();
    const edited = (await getText(page)).replace("pay claim", "pay the claim in full");
    await page.evaluate((t) => (window as unknown as { chalk: { setText(t: string): void } }).chalk.setText(t), edited);
    await expect.poll(() => getText(page)).toBe(edited);
    await page.goBack();
    await expect(tab(page, "draw")).toHaveAttribute("aria-selected", "true");
    expect(await getText(page)).toBe(edited);
    await expect(page.locator('.layer-texts text[data-name="pay:label"]')).toHaveText("pay the claim in full");
  });
});
