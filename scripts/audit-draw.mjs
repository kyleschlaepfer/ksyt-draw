// Measures the draw workspace the way a person meets it, and saves screenshots beside the numbers.
// node scripts/audit-draw.mjs <outDir> [base url]
//   needs a running build (npx vite preview) or dev server
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import LZString from "lz-string";

const out = process.argv[2] ?? ".scratch/audit";
const base = process.argv[3] ?? "http://localhost:4173";
mkdirSync(out, { recursive: true });
const hash = (file, tab = "draw") => `#${new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(readFileSync(file, "utf8").replace(/\r\n/g, "\n")) })}&tab=${tab}`;
const SIZES = [[1920, 1080], [1440, 900], [1024, 768], [390, 844]];
const browser = await chromium.launch();
const report = {};

async function open(page, file) {
  await page.goto(base + "/" + hash(file));
  await page.waitForFunction(() => !!window.chalk);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".draw-canvas .layer-nodes > g").first().waitFor({ state: "attached" });
  await page.waitForTimeout(400);
}

/** Where things are, in CSS px, and what scrolls. */
async function measure(page) {
  return page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const tools = [...document.querySelectorAll(".draw-toolbar > *")].filter((e) => e.getClientRects().length);
    // a row is a band of controls whose vertical middles agree; separators and spacers don't count
    const mids = tools.filter((e) => e.getBoundingClientRect().height >= 24).map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }).sort((a, b) => a - b);
    const rows = new Set();
    let last = -Infinity;
    for (const m of mids) { if (m - last > 16) rows.add(m); last = m; }
    const vw = innerWidth, vh = innerHeight;
    const canvas = r(".draw-canvas");
    const zoom = document.querySelector("#draw-zoom")?.textContent ?? "";
    return {
      viewport: [vw, vh], pageScrolls: document.documentElement.scrollHeight > vh + 1, pageHeight: document.documentElement.scrollHeight,
      canvas, canvasShareOfViewport: canvas ? Math.round((canvas.w * canvas.h) / (vw * vh) * 100) : 0,
      canvasBottomVisible: canvas ? canvas.y + canvas.h <= vh : false,
      toolbar: r(".draw-toolbar"), toolbarRows: rows.size, library: r(".draw-side"), inspector: r(".draw-inspector"), zoom,
    };
  });
}

/** How much of one shape (and its label) is inside the canvas, as a fraction. */
async function visibleShare(page, id) {
  return page.evaluate((id) => {
    const st = window.chalk.inspect();
    const n = st.nodes.find((x) => x.id === id);
    const world = document.querySelector(".draw-canvas .world");
    const m = /translate\(([-0-9.]+) ([-0-9.]+)\) scale\(([-0-9.]+)\)/.exec(world.getAttribute("transform"));
    const [tx, ty, z] = [+m[1], +m[2], +m[3]];
    const c = document.querySelector(".draw-canvas").getBoundingClientRect();
    const x0 = n.x - n.w / 2, x1 = n.x + n.w / 2, y0 = n.y - n.h / 2, y1 = n.y + n.h / 2;
    const sx = (v) => v * 96 * z + tx, sy = (v) => v * 96 * z + ty;
    const ix = Math.max(0, Math.min(sx(x1), c.width) - Math.max(sx(x0), 0)), iy = Math.max(0, Math.min(sy(y1), c.height) - Math.max(sy(y0), 0));
    return Math.round((ix * iy) / ((sx(x1) - sx(x0)) * (sy(y1) - sy(y0))) * 100) / 100;
  }, id);
}

for (const [w, h] of SIZES) {
  for (const theme of w >= 1440 ? ["light", "dark"] : ["light"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const page = await ctx.newPage();
    await open(page, "fixtures/diagrams/usecase-permit.ksd");
    const key = `${w}x${h}-${theme}`;
    report[key] = { open: await measure(page) };
    await page.screenshot({ path: `${out}/draw-${key}.png` });
    if (theme === "light") {
      await page.screenshot({ path: `${out}/draw-${key}-full.png`, fullPage: true });
      // a shape selected: does the inspector take the canvas's room?
      const uid = await page.evaluate(() => window.chalk.inspect().nodes.find((n) => n.id === "apply").uid);
      const bb = await page.locator(`.layer-hits g[data-uid="${uid}"] .hit`).first().boundingBox();
      if (bb) {
        await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.waitForTimeout(300);
        report[key].selected = await measure(page);
        await page.screenshot({ path: `${out}/draw-${key}-selected.png` });
      }
      // the reported clipping: fit, then zoom in with the toolbar
      await page.keyboard.press("Escape");
      const fit = page.getByRole("button", { name: /^fit$/ });
      if (await fit.count()) await fit.first().click();
      const zoomIn = page.locator('button[aria-label="zoom in"]');
      const trail = [];
      trail.push({ zoom: (await measure(page)).zoom, resident: await visibleShare(page, "resident"), clerk: await visibleShare(page, "clerk") });
      for (let i = 0; i < 3; i++) {
        // a phone keeps zoom to pinching and the more menu
        if (!(await zoomIn.count()) || !(await zoomIn.first().isVisible())) break;
        await zoomIn.first().click();
        await page.waitForTimeout(150);
        trail.push({ zoom: (await measure(page)).zoom, resident: await visibleShare(page, "resident"), clerk: await visibleShare(page, "clerk") });
      }
      report[key].zoomTrail = trail;
      await page.screenshot({ path: `${out}/draw-${key}-zoomed.png` });
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) {
  const o = v.open;
  console.log(`${k}: canvas ${o.canvas?.w}x${o.canvas?.h} (${o.canvasShareOfViewport}% of viewport), page scrolls ${o.pageScrolls} (height ${o.pageHeight}), canvas bottom visible ${o.canvasBottomVisible}, toolbar rows ${o.toolbarRows}, zoom ${o.zoom}`);
  if (v.selected) console.log(`   selected: canvas ${v.selected.canvas?.w}x${v.selected.canvas?.h}, inspector ${v.selected.inspector?.w ?? "-"}w`);
  if (v.zoomTrail) console.log("   zoom in: " + v.zoomTrail.map((t) => `${t.zoom} resident ${t.resident} clerk ${t.clerk}`).join(" | "));
}
