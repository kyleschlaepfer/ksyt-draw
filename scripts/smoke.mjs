// A smoke test of a running app: every view loads, the canvas draws, each export format produces a real file.
// usage: node scripts/smoke.mjs [base url] [outDir]     (start the app first: npm run dev)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import LZString from "lz-string";

const base = process.argv[2] ?? "http://localhost:5173";
const out = process.argv[3] ?? ".scratch/smoke";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
const open = async (file, tab) => {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  await page.goto(`${base}/#${new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(text) })}${tab ? "&tab=" + tab : ""}`);
  await page.waitForFunction(() => !!window.chalk);
};

await open("fixtures/diagrams/usecase-permit.ksd");
await page.waitForSelector("#preview svg.ksyt-fig");
await page.waitForSelector(".ksd-editor .cm-content");
await page.screenshot({ path: join(out, "write.png") });
console.log("write: editor and preview up");

await open("fixtures/v2/activity-lanes.ksd", "draw");
await page.waitForSelector(".draw-canvas .layer-nodes > g", { state: "attached" });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "draw-lanes.png") });
console.log("draw: canvas up,", await page.locator(".draw-canvas .layer-nodes > g").count(), "shapes");

await open("fixtures/v2/class-orders.ksd", "draw");
await page.waitForSelector(".draw-canvas .layer-nodes > g", { state: "attached" });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "draw-class.png") });

await page.getByRole("tab", { name: "the syntax" }).click();
await page.waitForSelector("#panel-syntax h2");
console.log("syntax: up");

await page.getByRole("tab", { name: "write" }).click();
await page.locator("#open-export").click();
await page.waitForSelector("dialog.export-dialog[open] .export-preview img[src]");
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "export-dialog.png") });
for (const [format, magic] of [["png", "\x89PNG"], ["svg", "<?xml"], ["pdf", "%PDF"]]) {
  await page.locator(`dialog.export-dialog input[name="export-format"][value="${format}"]`).check();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator("#export-download").click()]);
  const path = join(out, dl.suggestedFilename());
  await dl.saveAs(path);
  const head = readFileSync(path).subarray(0, 5).toString("latin1");
  const ok = head.startsWith(magic);
  console.log(`export ${format}: ${dl.suggestedFilename()} ${statSync(path).size} bytes ${ok ? "ok" : "BAD HEADER " + JSON.stringify(head)}`);
  if (!ok) problems.push(`export ${format}: bad file`);
  await page.waitForTimeout(200);
}
await page.locator('dialog.export-dialog input[name="export-look"][value="precision"]').check();
await page.locator('dialog.export-dialog input[name="export-format"][value="png"]').check();
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#export-download").click()]);
await dl.saveAs(join(out, "orders.precision.png"));
await browser.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no browser errors");
process.exitCode = problems.length ? 1 : 0;
