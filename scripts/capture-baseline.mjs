// Captures UI and export evidence from a running preview server (npx vite preview --port 4173).
// usage: node scripts/capture-baseline.mjs <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "docs/revamp/baseline";
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? "http://localhost:4173";
const browser = await chromium.launch();

async function shot(name, { width, height = 900, theme = "light", url, act, full = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(base + url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  if (act) await act(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  await ctx.close();
}

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 820, 390]) {
    await shot(`write-${theme}-${width}`, { width, theme, url: "/" });
    await shot(`draw-${theme}-${width}`, { width, theme, url: "/#tab=draw" });
    await shot(`syntax-${theme}-${width}`, { width, theme, url: "/#tab=syntax", full: false });
  }
}
await shot("draw-selected-node-light-1440", {
  width: 1440, url: "/#tab=draw",
  act: async (p) => { await p.locator(".draw-canvas svg [data-name='apply']").first().click({ force: true }); },
});
await shot("draw-selected-edge-light-1440", {
  width: 1440, url: "/#tab=draw",
  act: async (p) => { await p.locator(".draw-canvas svg [data-name='e1']").first().click({ force: true }); },
});
await browser.close();
console.log("captured to", out);
