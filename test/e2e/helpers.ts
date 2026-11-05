import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { buildHash, type HashInput } from "../../src/core/state";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "..", "..", "fixtures", "diagrams");
export const FIXTURES_V2 = join(here, "..", "..", "fixtures", "v2");
const names = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".ksd")).map((f) => f.replace(/\.ksd$/, "")).sort();
export const fixtureNames = names(FIXTURES);
export const v2Names = names(FIXTURES_V2);
/** A fixture's text with Unix line endings (a Windows checkout may have converted them). */
export const ksdOf = (name: string): string =>
  readFileSync(join(fixtureNames.includes(name) ? FIXTURES : FIXTURES_V2, name + ".ksd"), "utf8").replace(/\r\n/g, "\n");

export const embedUrl = (input: HashInput): string => "/embed/#" + buildHash(input);

/** The host pages served by test/e2e/host-server.mjs on a second loopback origin. */
export const HOST_ORIGIN = "http://localhost:4174";
export const hostPageUrl = (frames: Array<{ id: string; src: string; title: string }>): string =>
  `${HOST_ORIGIN}/host?f=${encodeURIComponent(JSON.stringify(frames))}`;
export const barePageUrl = (src: string): string => `${HOST_ORIGIN}/bare?src=${encodeURIComponent(src)}`;
/** The embed as the host pages see it: the preview server on its own origin. */
export const EMBED_ORIGIN = "http://localhost:4173";

/** Every label's rendered size in CSS px, from the SVG's on-screen scale. */
export async function labelSizes(page: Page, selector = "svg.ksyt-fig"): Promise<number[]> {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel) as SVGSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    return Array.from(svg.querySelectorAll("text")).map((t) => parseFloat(t.getAttribute("font-size") || "0") * scale);
  }, selector);
}

export async function layoutCheckText(page: Page): Promise<string> {
  const h = page.locator(".lint h2").nth(1);
  return (await h.textContent()) ?? "";
}

// ---------------------------------------------------------------- the tool page

interface Chalk { getText(): string; setText(t: string): void; valid: boolean; inspect(): Inspect }
export interface Inspect {
  text: string;
  valid: boolean;
  canUndo: boolean;
  nodes: Array<{ id: string; uid: string; kind: string; label: string | null; parent: string | null; placed: boolean; sized: boolean; x: number; y: number; w: number; h: number }>;
  edges: Array<{ uid: string; id: string; from: string; to: string; kind: string; label: string | null; routed: boolean; points: Array<[number, number]>; fromSide: string; toSide: string }>;
  texts: Array<{ name: string; s: string; x: number; y: number }>;
}
const chalk = (): Chalk => (window as unknown as { chalk: Chalk }).chalk;

/**
 * Open the tool with a diagram, on a view, with an empty local draft. Draw's properties start open here,
 * as a remembered choice, because most tests work through them; `panels: "default"` opens draw the way a
 * first visit does (properties closed).
 */
export async function openTool(page: Page, text: string | null, tab: "write" | "draw" = "write", o: { panels?: "default" | { library?: boolean; inspector?: boolean } } = {}): Promise<void> {
  if (o.panels !== "default") {
    const p = { library: true, inspector: true, ...(o.panels ?? {}) };
    await page.addInitScript((v) => { try { if (!sessionStorage.getItem("chalk-test-panels")) { localStorage.setItem("chalk-draw-panels", v); sessionStorage.setItem("chalk-test-panels", "1"); } } catch { /* blocked */ } }, JSON.stringify(p));
  }
  const hash = (text ? buildHash({ d: text }) : "") + (tab === "draw" ? `${text ? "&" : ""}tab=draw` : "");
  await page.goto("/" + (hash ? "#" + hash : ""));
  await page.waitForFunction(() => !!(window as unknown as { chalk?: unknown }).chalk);
  if (tab === "draw") await expect(page.locator(".draw-canvas .layer-nodes > g").first()).toBeAttached();
  else await expect(page.locator(".ksd-editor .cm-content")).toBeVisible();
}

export const getText = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { chalk: { getText(): string } }).chalk.getText());
export const inspect = (page: Page): Promise<Inspect> => page.evaluate(() => (window as unknown as { chalk: { inspect(): unknown } }).chalk.inspect() as never);
/** Replace the whole text through the editor, as a paste would. */
export async function fillEditor(page: Page, text: string): Promise<void> {
  const content = page.locator(".ksd-editor .cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}
export const editorLine = (page: Page, n: number): Locator => page.locator(".ksd-editor .cm-line").nth(n - 1);

void chalk;

// ---------------------------------------------------------------- the canvas

export const canvas = (page: Page): Locator => page.locator(".draw-canvas");
export const status = (page: Page): Locator => page.locator("#panel-draw .play-status");

export async function node(page: Page, id: string): Promise<Inspect["nodes"][number]> {
  const n = (await inspect(page)).nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}
/** The on-screen box of a shape (its hit target), in page pixels. */
export async function box(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const n = await node(page, id);
  const b = await page.locator(`.layer-hits g[data-uid="${n.uid}"] .hit`).first().boundingBox();
  if (!b) throw new Error(`${id} is not on the canvas`);
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
export async function edge(page: Page, from: string, to: string): Promise<Inspect["edges"][number]> {
  const e = (await inspect(page)).edges.find((x) => x.from === from && x.to === to);
  if (!e) throw new Error(`no line ${from} -> ${to}`);
  return e;
}
/** Press on a point, move in steps, release: a real drag. */
export async function drag(page: Page, from: [number, number], to: [number, number], o: { steps?: number; hold?: () => Promise<void> } = {}): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + (to[0] - from[0]) * 0.2, from[1] + (to[1] - from[1]) * 0.2, { steps: 3 });
  await page.mouse.move(to[0], to[1], { steps: o.steps ?? 10 });
  if (o.hold) await o.hold();
  await page.mouse.up();
}
/** Click a shape's middle. */
export async function clickNode(page: Page, id: string, o: { shift?: boolean } = {}): Promise<void> {
  const b = await box(page, id);
  if (o.shift) await page.keyboard.down("Shift");
  await page.mouse.click(b.cx, b.cy);
  if (o.shift) await page.keyboard.up("Shift");
}
/** Click a line somewhere along it (a third of the way, away from labels and ends). */
export async function clickEdge(page: Page, from: string, to: string): Promise<string> {
  const e = await edge(page, from, to);
  const hit = page.locator(`.layer-hits path[data-uid="${e.uid}"]`);
  const view = await page.evaluate(() => {
    const w = document.querySelector(".draw-canvas .world") as SVGGElement;
    const m = /translate\(([-0-9.]+) ([-0-9.]+)\) scale\(([-0-9.]+)\)/.exec(w.getAttribute("transform") ?? "")!;
    const r = document.querySelector(".draw-canvas svg")!.getBoundingClientRect();
    return { x: parseFloat(m[1]) + r.left, y: parseFloat(m[2]) + r.top, zoom: parseFloat(m[3]) };
  });
  await expect(hit).toBeAttached();
  // a point on the longest run of the line, in page pixels
  let best = 0, at: [number, number] = [0, 0];
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; at = [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4]; }
  }
  await page.mouse.click(view.x + at[0] * 96 * view.zoom, view.y + at[1] * 96 * view.zoom);
  return e.uid;
}
/** Document inches -> page pixels, through the canvas's current view. */
export async function toPage(page: Page, p: [number, number]): Promise<[number, number]> {
  return page.evaluate(([x, y]) => {
    const w = document.querySelector(".draw-canvas .world") as SVGGElement;
    const m = /translate\(([-0-9.]+) ([-0-9.]+)\) scale\(([-0-9.]+)\)/.exec(w.getAttribute("transform") ?? "")!;
    const r = document.querySelector(".draw-canvas svg")!.getBoundingClientRect();
    const z = parseFloat(m[3]);
    return [parseFloat(m[1]) + r.left + x * 96 * z, parseFloat(m[2]) + r.top + y * 96 * z] as [number, number];
  }, p);
}
export async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(/scale\(([-0-9.]+)\)/.exec(document.querySelector(".draw-canvas .world")!.getAttribute("transform") ?? "")![1]));
}
/** A properties-panel field by its key. */
export const field = (page: Page, key: string): Locator => page.locator(`.draw-inspector [data-field="${key}"]`);
