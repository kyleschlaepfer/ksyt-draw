/**
 * Draw as a workspace: it fills the window, the canvas is most of it, nothing on the page scrolls while
 * drawing, the tool bar is one row, the side zones open and close and are remembered, and the camera
 * keeps the drawing in view (fit, zoom, tidy up, a resize). Write and the syntax stay pages.
 *
 * These open draw the way a first visit does (properties closed), unless a test says otherwise.
 */
import { test, expect, type Page } from "@playwright/test";
import { box, canvas, clickEdge, clickNode, getText, inspect, ksdOf, openTool, status, zoom } from "./helpers";

const USECASE = ksdOf("usecase-permit");
const tab = (page: Page, name: "write" | "draw" | "the syntax") => page.getByRole("tab", { name, exact: true });

/** Where the workspace's parts are and whether anything but the canvas scrolls. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const r = (sel: string) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const tools = [...document.querySelectorAll(".draw-toolbar > *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height >= 24);
    const mids = tools.map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }).sort((a, b) => a - b);
    let rows = 0, last = -Infinity;
    for (const m of mids) { if (m - last > 16) rows++; last = m; }
    return {
      vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth, scrollY,
      canvas: r(".draw-canvas"), library: r(".draw-side"), inspector: r(".draw-inspector"), rows, header: r(".site-header"), intro: r(".tool-intro"),
    };
  });
}

/** Every shape and every text of the drawing, as page boxes, measured from the canvas's own SVG. */
async function drawingBoxes(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ what: string; x0: number; y0: number; x1: number; y1: number }> = [];
    for (const g of document.querySelectorAll(".draw-canvas .layer-nodes > g, .draw-canvas .layer-containers > g, .draw-canvas .layer-texts text")) {
      const b = g.getBoundingClientRect();
      if (b.width || b.height) out.push({ what: `${g.getAttribute("data-name") ?? g.tagName} ${g.textContent ?? ""}`.trim(), x0: b.left, y0: b.top, x1: b.right, y1: b.bottom });
    }
    return out;
  });
}
async function allInView(page: Page): Promise<string[]> {
  const c = (await canvas(page).boundingBox())!;
  const outside = (await drawingBoxes(page)).filter((b) => b.x0 < c.x - 0.5 || b.y0 < c.y - 0.5 || b.x1 > c.x + c.width + 0.5 || b.y1 > c.y + c.height + 0.5);
  return outside.map((b) => b.what);
}

for (const [w, h] of [[1920, 1080], [1440, 900]] as const) {
  test.describe(`at ${w} by ${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test("the canvas is the workspace: most of the window, no page scroll, one row of tools, a readable scale", async ({ page }) => {
      await openTool(page, USECASE, "draw", { panels: "default" });
      const l = await layout(page);
      expect(l.header, "the page header steps aside in draw").toBeNull();
      expect(l.intro).toBeNull();
      expect(l.scrollH, "the page itself does not scroll").toBeLessThanOrEqual(h);
      expect(l.scrollW).toBeLessThanOrEqual(w);
      expect(l.canvas!.y + l.canvas!.h).toBeLessThanOrEqual(h);
      expect((l.canvas!.w * l.canvas!.h) / (w * h), "share of the window").toBeGreaterThan(0.65);
      expect(l.canvas!.w).toBeGreaterThan(w - 260);
      expect(l.rows, "the tool bar does not wrap").toBe(1);
      expect(l.inspector, "properties wait until asked for").toBeNull();
      // a readable scale: the whole drawing at actual size on these screens, and all of it in view
      expect(await zoom(page)).toBeGreaterThanOrEqual(0.95);
      expect(await allInView(page)).toEqual([]);
      await page.screenshot({ path: `test-results/workspace-${w}.png` });
    });

    test("ordinary drawing never scrolls the page: placing, selecting, zooming and opening the properties", async ({ page }) => {
      await openTool(page, USECASE, "draw", { panels: "default" });
      const cv = (await canvas(page).boundingBox())!;
      await page.locator('.draw-shape[data-kind="use-case"]').click();
      await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.85);
      await page.keyboard.press("Escape");
      await clickNode(page, "apply");
      await page.getByRole("button", { name: "zoom in" }).click();
      await page.locator("#draw-properties").click();
      await page.mouse.wheel(0, 300);
      const l = await layout(page);
      expect(l.scrollY).toBe(0);
      expect(l.scrollH).toBeLessThanOrEqual(h);
      expect(l.rows).toBe(1);
    });
  });
}

test.describe("side zones", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the library and the properties close and open again, give their room to the canvas, and are remembered", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const shapes = page.getByRole("button", { name: "shapes", exact: true });
    const props = page.locator("#draw-properties");
    await expect(shapes).toHaveAttribute("aria-expanded", "true");
    await expect(props).toHaveAttribute("aria-expanded", "false");
    const open = await layout(page);

    await shapes.click();
    await expect(page.locator(".draw-side")).toBeHidden();
    const noLibrary = await layout(page);
    expect(noLibrary.canvas!.w).toBeCloseTo(open.canvas!.w + open.library!.w, -1);

    await props.click();
    await expect(page.locator(".draw-inspector")).toBeVisible();
    await expect(page.locator(".draw-inspector h2")).toHaveText("diagram");
    const withProps = await layout(page);
    expect(withProps.canvas!.w).toBeCloseTo(noLibrary.canvas!.w - withProps.inspector!.w, -1);
    // a docked panel, not a sliver of canvas: never the 68 px regression
    expect(withProps.canvas!.w).toBeGreaterThan(900);
    expect(withProps.canvas!.h).toBeGreaterThan(600);

    // the drawing stayed in view while the room changed
    expect(await allInView(page)).toEqual([]);

    // remembered in this browser
    await page.reload();
    await expect(page.locator(".draw-canvas .layer-nodes > g").first()).toBeAttached();
    await expect(page.locator(".draw-side")).toBeHidden();
    await expect(page.locator(".draw-inspector")).toBeVisible();

    // the panel's own close, and the library back
    await page.getByRole("button", { name: "close properties" }).click();
    await expect(page.locator(".draw-inspector")).toBeHidden();
    await page.getByRole("button", { name: "shapes", exact: true }).click();
    await expect(page.locator(".draw-side")).toBeVisible();
    const back = await layout(page);
    expect(back.canvas!.w).toBeCloseTo(open.canvas!.w, -1);
  });
});

test.describe("the camera", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("fit shows everything, an actor outside the boundary and its name included, and stepping in from fit keeps it framed", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    // somewhere else first: far in, off to one side
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "zoom in" }).click();
    // the wheel pans the canvas, focused or not (the page has nothing to scroll)
    await page.locator("#draw-zoom").focus();
    const was = await page.locator(".draw-canvas .world").getAttribute("transform");
    await page.mouse.move(700, 450);
    await page.mouse.wheel(900, 0);
    await expect.poll(() => page.locator(".draw-canvas .world").getAttribute("transform")).not.toBe(was);
    await page.getByRole("button", { name: "fit", exact: true }).click();
    expect(await allInView(page)).toEqual([]);
    const names = await drawingBoxes(page);
    expect(names.some((b) => b.what.includes("Resident"))).toBe(true);
    // closer than fit the drawing is bigger than the view: it still fills the view, no side left empty
    await page.getByRole("button", { name: "zoom in" }).click();
    const c = (await canvas(page).boundingBox())!;
    const all = await drawingBoxes(page);
    expect(Math.min(...all.map((x) => x.x0))).toBeLessThanOrEqual(c.x + 40);
    expect(Math.max(...all.map((x) => x.x1))).toBeGreaterThanOrEqual(c.x + c.width - 40);
    // zooming out never leaves the drawing off to one side
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "zoom out" }).click();
    expect(await allInView(page)).toEqual([]);
  });

  test("from the opening view, a step in keeps the actors outside the boundary and their names in view", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    expect(await allInView(page)).toEqual([]);
    await page.getByRole("button", { name: "zoom in" }).click();
    expect(await zoom(page)).toBeGreaterThan(1.1);
    expect(await allInView(page)).toEqual([]);
  });

  test("zooming with the bar holds a selected shape still once the drawing is bigger than the view, and keeps a drawing that fits in view", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    // while it fits, a step in keeps all of it on screen
    await clickNode(page, "pay");
    await page.getByRole("button", { name: "zoom in" }).click();
    expect(await allInView(page)).toEqual([]);
    // closer in, the selected shape is what holds still
    await page.getByRole("button", { name: "zoom in" }).click();
    await page.getByRole("button", { name: "zoom in" }).click();
    await clickNode(page, "pay");
    const before = await box(page, "pay");
    await page.getByRole("button", { name: "zoom in" }).click();
    const after = await box(page, "pay");
    expect(Math.abs(after.cx - before.cx)).toBeLessThan(2);
    expect(Math.abs(after.cy - before.cy)).toBeLessThan(2);
    expect(after.width).toBeGreaterThan(before.width * 1.1);
  });

  test("tidy up frames what it would give; put back returns the view too, keep it keeps the result in view", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    // move a shape by hand so there is something to tidy, then look closely at one corner
    const pay = await box(page, "pay");
    await page.mouse.move(pay.cx, pay.cy);
    await page.mouse.down();
    await page.mouse.move(pay.cx + 120, pay.cy + 160, { steps: 8 });
    await page.mouse.up();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "zoom in" }).click();
    const close = await page.locator("#draw-zoom").textContent();
    const worldBefore = await page.locator(".draw-canvas .world").getAttribute("transform");

    await page.getByRole("button", { name: "tidy up" }).click();
    await page.getByRole("menuitem", { name: /the whole diagram/ }).click();
    await expect(page.getByRole("button", { name: "keep it" })).toBeVisible();
    expect(await allInView(page), "the proposal is shown whole").toEqual([]);
    await page.getByRole("button", { name: "put it back" }).click();
    await expect(page.locator("#draw-zoom")).toHaveText(close!);
    expect(await page.locator(".draw-canvas .world").getAttribute("transform")).toBe(worldBefore);
    expect((await inspect(page)).nodes.find((n) => n.id === "pay")!.placed).toBe(true);

    await page.getByRole("button", { name: "tidy up" }).click();
    await page.getByRole("menuitem", { name: /the whole diagram/ }).click();
    await page.getByRole("button", { name: "keep it" }).click();
    await expect(status(page)).toContainText("tidied");
    expect((await inspect(page)).nodes.find((n) => n.id === "pay")!.placed).toBe(false);
    expect(await allInView(page)).toEqual([]);
    expect(await zoom(page)).toBeGreaterThan(0.6);
  });
});

test.describe("everyday edits without the properties", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a shape's text, a line's meaning and label, swapping and deleting, all from the bar beside the selection", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const bar = page.locator(".draw-selbar");
    await clickNode(page, "track");
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "text" }).click();
    await page.keyboard.type("check status");
    await page.keyboard.press("Enter");
    expect((await inspect(page)).nodes.find((n) => n.id === "track")!.label).toBe("check status");

    await clickEdge(page, "apply", "pay");
    await expect(bar.getByRole("combobox", { name: "what the line means" })).toHaveValue(/include/);
    await bar.getByRole("combobox", { name: "what the line means" }).selectOption({ label: "extend" });
    await expect.poll(() => getText(page)).toContain("apply -extend-> pay");
    await expect(page.locator(".draw-inspector")).toBeHidden();

    await clickNode(page, "review");
    await bar.getByRole("button", { name: "delete" }).click();
    expect((await inspect(page)).nodes.some((n) => n.id === "review")).toBe(false);
    expect(await getText(page)).not.toMatch(/^s*use-case review /m);
    await expect(page.locator(".draw-inspector")).toBeHidden();
  });

  test("the bar keeps out of the way: it never covers a shape's connection dots and hides during a drag", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    await clickNode(page, "pay");
    const bar = (await page.locator(".draw-selbar").boundingBox())!;
    for (const dot of await page.locator(".overlay .port").all()) {
      const d = (await dot.boundingBox())!;
      const overlap = !(d.x > bar.x + bar.width || d.x + d.width < bar.x || d.y > bar.y + bar.height || d.y + d.height < bar.y);
      expect(overlap).toBe(false);
    }
    const p = await box(page, "pay");
    await page.mouse.move(p.cx, p.cy);
    await page.mouse.down();
    await page.mouse.move(p.cx + 40, p.cy + 30, { steps: 5 });
    await expect(page.locator(".draw-selbar")).toBeHidden();
    await page.mouse.up();
    await expect(page.locator(".draw-selbar")).toBeVisible();
  });
});

test.describe("narrow windows and switching views", () => {
  for (const [w, h] of [[820, 1180], [390, 844]] as const) {
    test(`at ${w}: a full-size canvas, side zones over it, and write and the syntax are pages again`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openTool(page, USECASE, "draw", { panels: "default" });
      let l = await layout(page);
      expect(l.scrollH).toBeLessThanOrEqual(h);
      expect(l.canvas!.w).toBeGreaterThan(w - 2);
      expect(l.canvas!.h).toBeGreaterThan(h * 0.6);
      // on a narrow screen the library starts closed and lies over the canvas when opened
      await expect(page.locator(".draw-side")).toBeHidden();
      await page.getByRole("button", { name: "shapes", exact: true }).click();
      await expect(page.locator(".draw-side")).toBeVisible();
      l = await layout(page);
      expect(l.canvas!.w, "the canvas keeps its room").toBeGreaterThan(w - 2);
      await page.getByRole("button", { name: "shapes", exact: true }).click();

      await tab(page, "write").click();
      await expect(page.locator(".site-header")).toBeVisible();
      await expect(page.locator(".tool-intro")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(h);
      await tab(page, "the syntax").click();
      await expect(page.locator(".site-footer")).toBeVisible();
      await tab(page, "draw").click();
      l = await layout(page);
      expect(l.scrollY).toBe(0);
      expect(l.canvas!.w).toBeGreaterThan(w - 2);
      expect(l.canvas!.h).toBeGreaterThan(h * 0.6);
      expect(await allInView(page)).toEqual([]);
      await page.goBack();
      await expect(page.locator(".site-footer")).toBeVisible();
      await page.goBack();
      await expect(page.locator(".site-header")).toBeVisible();
      await page.goForward();
      await page.goForward();
      await expect(page.locator(".site-header")).toBeHidden();
      await expect(canvas(page)).toBeVisible();
      await page.screenshot({ path: `test-results/workspace-${w}.png` });
    });
  }
});
