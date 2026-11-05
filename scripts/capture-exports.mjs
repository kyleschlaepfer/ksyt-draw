// Downloads real export files from the running app and renders each at insertion sizes.
// usage: node scripts/capture-exports.mjs <outDir> [fixtureDir]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import LZString from "lz-string";

const out = process.argv[2] ?? "docs/revamp/baseline/exports";
const dir = process.argv[3] ?? "fixtures/diagrams";
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? "http://localhost:4173";
const browser = await chromium.launch();
const names = readdirSync(dir).filter((f) => f.endsWith(".ksd")).map((f) => f.replace(/\.ksd$/, ""));
const report = [];
for (const name of names) {
  const ksd = readFileSync(join(dir, name + ".ksd"), "utf8").replace(/\r\n/g, "\n");
  const hash = new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(ksd) }).toString();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/#${hash}`);
  await page.waitForSelector("#preview svg, #preview .error-card");
  await page.evaluate(() => document.fonts.ready);
  const btn = page.getByRole("button", { name: /download SVG/i });
  let svg = null;
  if (await page.locator("#preview svg").count()) {
    const [dl] = await Promise.all([page.waitForEvent("download"), btn.click()]);
    const p = join(out, `${name}.svg`);
    await dl.saveAs(p);
    svg = readFileSync(p, "utf8");
  }
  await ctx.close();
  if (!svg) { report.push({ name, error: "no export" }); continue; }
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const w = Number(m[1]), h = Number(m[2]);
  report.push({ name, w, h, bytes: svg.length });
  // the file as a third party sees it: an <img> on a white page, at slide, document and embed sizes
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  await p2.setContent(`<body style="margin:0;background:#fff;font:14px sans-serif">
    <div style="display:flex;gap:24px;align-items:flex-start;padding:16px">
      <div><div>slide half, 600 px</div><img src="${dataUrl}" style="width:600px;border:1px solid #ddd"></div>
      <div><div>report column, 420 px</div><img src="${dataUrl}" style="width:420px;border:1px solid #ddd"></div>
      <div><div>thumbnail, 240 px</div><img src="${dataUrl}" style="width:240px;border:1px solid #ddd"></div>
    </div></body>`);
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: join(out, `${name}.sizes.png`), fullPage: true });
  await ctx2.close();
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
console.log(report.map((r) => `${r.name}: ${r.w}x${r.h} ${r.bytes}b`).join("\n"));
