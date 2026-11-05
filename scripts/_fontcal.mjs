import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:4173/");
await p.evaluate(() => document.fonts.ready);
const r = await p.evaluate(async () => {
  await Promise.all(["400 22px Kalam", "300 20px Kalam", "400 18px 'Atkinson Hyperlegible Next'", "700 18px 'Atkinson Hyperlegible Next'"].map((f) => document.fonts.load(f)));
  const c = document.createElement("canvas").getContext("2d");
  const samples = ["submit request", "schedule the work", "payment cleared?", "apply for permit", "+placeOrder(cart: Cart): Order", "Customer", "«include»", "0..*", "[needs changes]", "The quick brown fox jumps over the lazy dog"];
  const out = {};
  for (const s of samples) {
    c.font = "400 22px Kalam"; const k = c.measureText(s);
    c.font = "400 22px 'Atkinson Hyperlegible Next'"; const a = c.measureText(s);
    out[s] = { kalam: +k.width.toFixed(1), atk: +a.width.toFixed(1), ratio: +(k.width / a.width).toFixed(3), kAsc: +k.actualBoundingBoxAscent.toFixed(1), kDesc: +k.actualBoundingBoxDescent.toFixed(1), aAsc: +a.actualBoundingBoxAscent.toFixed(1), aDesc: +a.actualBoundingBoxDescent.toFixed(1) };
  }
  return out;
});
console.log(JSON.stringify(r, null, 0).replace(/},/g, "},\n"));
await b.close();
