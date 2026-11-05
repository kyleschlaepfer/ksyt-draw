// The export gallery: every fixture exported through the real export dialog as SVG, PNG and PDF in
// both looks, then shown the way a third party sees the files, at slide, report and embed widths,
// beside the v1 export where one exists.
// usage: node scripts/gallery.mjs [outDir] [base url] [name filter]
// Needs a server: `npx vite --port 5173` (dev) or `npx vite preview --port 4173` (build).
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import LZString from "lz-string";

const out = process.argv[2] ?? "docs/revamp/gallery";
const base = process.argv[3] ?? "http://localhost:5173";
const filter = process.argv[4] ?? "";
const baseline = "docs/revamp/baseline/exports";
const WIDTHS = [["slide half", 600], ["report column", 420], ["embed or thumbnail", 240]];
mkdirSync(out, { recursive: true });

const dirs = ["fixtures/diagrams", "fixtures/v2"];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ksd") && f.includes(filter))
  .map((f) => ({ name: f.replace(/\.ksd$/, ""), ksd: readFileSync(join(d, f), "utf8").replace(/\r\n/g, "\n") })));
const browser = await chromium.launch();
const problems = [];
const report = [];

for (const { name, ksd } of files) {
  const entry = { name, looks: {} };
  report.push(entry);
  for (const look of ["sketch", "precision"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${name} ${look}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} ${look}: console ${m.text()}`); });
    await page.goto(`${base}/#${new URLSearchParams({ v: "1", d: LZString.compressToEncodedURIComponent(ksd) })}`);
    await page.waitForFunction(() => !!window.chalk);
    await page.waitForSelector("#preview svg.ksyt-fig");
    await page.locator("#open-export").click();
    await page.locator(`dialog.export-dialog input[name="export-look"][value="${look}"]`).check();
    await page.waitForSelector("dialog.export-dialog[open] .export-preview img[src]");
    const got = { files: {} };
    for (const [format, magic] of [["svg", "<?xml"], ["png", "\x89PNG"], ["pdf", "%PDF"]]) {
      await page.locator(`dialog.export-dialog input[name="export-format"][value="${format}"]`).check();
      await page.waitForTimeout(120);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator("#export-download").click()]);
      const path = join(out, `${name}.${look}.${format}`);
      await dl.saveAs(path);
      if (!readFileSync(path).subarray(0, 5).toString("latin1").startsWith(magic)) problems.push(`${name} ${look} ${format}: bad file header`);
      got.files[format] = statSync(path).size;
      if (format === "svg") got.facts = (await page.locator("dialog.export-dialog .export-facts").textContent())?.trim();
    }
    entry.looks[look] = got;
    console.log(`${look.padEnd(9)} ${name.padEnd(28)} ${got.facts}`);
    if (!/Layout check: pass/.test(got.facts ?? "")) problems.push(`${name} ${look}: ${got.facts}`);
    await ctx.close();
  }
}

// the sheets: each file as an <img> on a white page, the way a slide or a document shows it
const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
for (const { name } of files) {
  const rows = [];
  const before = join(baseline, `${name}.svg`);
  if (existsSync(before)) rows.push(["before (v1 export)", dataUrl(before, "image/svg+xml")]);
  rows.push(["sketch (SVG file)", dataUrl(join(out, `${name}.sketch.svg`), "image/svg+xml")]);
  rows.push(["precision (SVG file)", dataUrl(join(out, `${name}.precision.svg`), "image/svg+xml")]);
  rows.push(["sketch (PNG file, 2x)", dataUrl(join(out, `${name}.sketch.png`), "image/png")]);
  const html = `<body style="margin:0;background:#fff;font:13px sans-serif;color:#333"><div style="padding:14px;display:inline-block">
    <div style="font-size:16px;margin-bottom:8px">${name}</div>
    ${rows.map(([label, url]) => `<div style="margin-bottom:12px"><div style="margin-bottom:4px">${label}</div>
      <div style="display:flex;gap:18px;align-items:flex-start">${WIDTHS.map(([what, w]) =>
        `<div><img src="${url}" style="width:${w}px;border:1px solid #ddd;display:block"><div style="color:#777">${what}, ${w} px</div></div>`).join("")}</div></div>`).join("")}
  </div></body>`;
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.locator("body > div").screenshot({ path: join(out, `${name}.sheet.png`) });
  await ctx.close();
}
await browser.close();

if (!filter) {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1) + "\n");
  const md = ["# Export gallery", "",
    "Made by `node scripts/gallery.mjs`. Every file here came out of the export dialog of the running app.",
    "Each sheet shows the files as a slide or a document shows them: an image on a white page at 600, 420 and 240 px wide.",
    "", "| Fixture | Files | Size and check (sketch) |", "|---|---|---|",
    ...report.map((r) => `| [${r.name}](${r.name}.sheet.png) | ${["sketch", "precision"].flatMap((l) => ["svg", "png", "pdf"].map((f) => `[${l} ${f}](${r.name}.${l}.${f})`)).join(", ")} | ${r.looks.sketch.facts} |`),
    "", ...report.flatMap((r) => [`## ${r.name}`, "", `![${r.name} at three widths](${r.name}.sheet.png)`, ""])];
  writeFileSync(join(out, "README.md"), md.join("\n"));
}
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no problems");
process.exitCode = problems.length ? 1 : 0;
