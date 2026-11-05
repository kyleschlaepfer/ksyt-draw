// The app as it looks now, in the same shots as scripts/capture-baseline.mjs took of v1, so the two
// folders can be laid side by side: write, draw and the syntax view; light and dark; 1440, 820, 390 px.
// usage: node scripts/capture-ui.mjs [outDir] [base url]
// Needs a server: `npx vite --port 5173` (dev) or `npx vite preview --port 4173` (build).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import LZString from "lz-string";

const out = process.argv[2] ?? "docs/revamp/after";
const base = process.argv[3] ?? "http://localhost:5173";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const withDoc = (file, tab) => {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return `/#${new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(text) })}${tab ? "&tab=" + tab : ""}`;
};

async function shot(name, { width, height = 900, theme = "light", url, act, full = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: console ${m.text()}`); });
  await page.goto(base + url);
  await page.waitForFunction(() => !!window.chalk);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  if (act) await act(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  await ctx.close();
}

/** Click the middle of a shape on the canvas, found by its id. */
const clickShape = async (page, id) => {
  const uid = await page.evaluate((i) => window.chalk.inspect().nodes.find((n) => n.id === i)?.uid, id);
  const b = await page.locator(`.layer-hits g[data-uid="${uid}"] .hit`).first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
/** Click a line on its longest run. */
const clickLine = async (page, from, to) => {
  const at = await page.evaluate(([f, t]) => {
    const e = window.chalk.inspect().edges.find((x) => x.from === f && x.to === t);
    let best = 0, p = [0, 0];
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > best) { best = L; p = [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4]; }
    }
    const w = document.querySelector(".draw-canvas .world");
    const m = /translate\(([-0-9.]+) ([-0-9.]+)\) scale\(([-0-9.]+)\)/.exec(w.getAttribute("transform") ?? "");
    const r = document.querySelector(".draw-canvas svg").getBoundingClientRect();
    const z = parseFloat(m[3]);
    return [parseFloat(m[1]) + r.left + p[0] * 96 * z, parseFloat(m[2]) + r.top + p[1] * 96 * z];
  }, [from, to]);
  await page.mouse.click(at[0], at[1]);
};

// a click in the middle of a long line would scroll the editor sideways first
const NEAR_START = { x: 60, y: 8 };
const PERMIT = "fixtures/diagrams/usecase-permit.ksd";
for (const theme of ["light", "dark"]) {
  for (const width of [1440, 820, 390]) {
    await shot(`write-${theme}-${width}`, { width, theme, url: withDoc(PERMIT) });
    await shot(`draw-${theme}-${width}`, { width, theme, url: withDoc(PERMIT, "draw") });
    await shot(`syntax-${theme}-${width}`, { width, theme, url: "/#tab=syntax", full: false });
  }
  await shot(`draw-lanes-${theme}-1440`, { width: 1440, theme, url: withDoc("fixtures/v2/activity-lanes.ksd", "draw") });
  await shot(`draw-class-${theme}-1440`, { width: 1440, theme, url: withDoc("fixtures/v2/class-orders.ksd", "draw"), act: (p) => clickShape(p, "Order") });
  await shot(`draw-selected-node-${theme}-1440`, { width: 1440, theme, url: withDoc(PERMIT, "draw"), act: (p) => clickShape(p, "apply") });
  await shot(`draw-selected-edge-${theme}-1440`, { width: 1440, theme, url: withDoc(PERMIT, "draw"), act: (p) => clickLine(p, "apply", "pay") });
  await shot(`write-linked-${theme}-1440`, {
    width: 1440, theme, url: withDoc(PERMIT),
    // the cursor on a declaration: its line is marked, and so is its shape in the figure
    act: async (p) => { await p.locator(".ksd-editor .cm-line", { hasText: "use-case apply" }).click({ position: NEAR_START }); },
  });
  await shot(`write-mistake-${theme}-1440`, {
    width: 1440, theme, url: withDoc(PERMIT),
    act: async (p) => { await p.locator(".ksd-editor .cm-line", { hasText: "use-case track" }).click({ position: NEAR_START }); await p.keyboard.press("End"); await p.keyboard.type(" sideways"); },
  });
  await shot(`export-${theme}-1440`, {
    width: 1440, theme, url: withDoc("fixtures/v2/class-orders.ksd"), full: false,
    act: async (p) => { await p.locator("#open-export").click(); await p.waitForSelector("dialog.export-dialog[open] .export-preview img[src]"); },
  });
}
await shot("draw-phone-selected-light-390", { width: 390, height: 800, url: withDoc(PERMIT, "draw"), act: (p) => clickShape(p, "apply") });
await browser.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : `captured to ${out}, no browser errors`);
process.exitCode = problems.length ? 1 : 0;
