// Renders every fixture through the embed page and saves a contact sheet per look.
// usage: node scripts/shots.mjs <outDir> [base url] [name filter]
// Needs a server: `npx vite --port 5173` (dev) or `npx vite preview --port 4173` (build).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import LZString from "lz-string";

const out = process.argv[2] ?? ".scratch/shots";
const base = process.argv[3] ?? "http://localhost:5173";
const filter = process.argv[4] ?? "";
mkdirSync(out, { recursive: true });
const dirs = ["fixtures/diagrams", "fixtures/v2"];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ksd") && f.includes(filter)).map((f) => [f.replace(/\.ksd$/, ""), readFileSync(join(d, f), "utf8").replace(/\r\n/g, "\n")]));
const browser = await chromium.launch();
const errors = [];
for (const look of ["sketch", "precision"]) {
  for (const [name, ksd] of files) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name} ${look}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} ${look}: console ${m.text()}`); });
    const hash = new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(ksd), qa: "1", look }).toString();
    await page.goto(`${base}/embed/#${hash}`);
    await page.waitForSelector("svg.ksyt-fig, .error-card", { timeout: 15000 }).catch(() => errors.push(`${name} ${look}: nothing rendered`));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const fig = page.locator("figure.fig .fig-stage");
    if (await fig.count()) await fig.screenshot({ path: join(out, `${name}.${look}.png`) });
    else await page.screenshot({ path: join(out, `${name}.${look}.png`) });
    const qa = await page.locator(".lint h2").allTextContents();
    const rows = await page.locator(".lint li .row").allTextContents();
    console.log(`${look.padEnd(9)} ${name.padEnd(28)} ${qa.join(" | ")}${rows.filter((r) => /error|LINE_|TEXT_|CLIP/.test(r)).map((r) => "\n    " + r).join("")}`);
    await ctx.close();
  }
}
await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exitCode = 1; }
