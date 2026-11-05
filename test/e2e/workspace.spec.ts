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

test.describe("the notation check in the status strip", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const REVERSED = ksdOf("usecase-include-reversed");

  test("a clear count opens a list upward, inside the window, and closes by its button, close, Escape or a click away", async ({ page }) => {
    await openTool(page, REVERSED, "draw", { panels: "default" });
    const toggle = page.locator("#draw-check");
    await expect(toggle).toHaveText("1 notation warning");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const strip = (await page.locator(".draw-foot").boundingBox())!;
    const t = (await toggle.boundingBox())!;
    expect(t.y).toBeGreaterThanOrEqual(strip.y);
    expect(t.y + t.height).toBeLessThanOrEqual(strip.y + strip.height);
    expect(strip.x + strip.width - (t.x + t.width)).toBeLessThan(16);

    await toggle.click();
    const list = page.locator(".draw-findings");
    await expect(list).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const b = (await list.boundingBox())!, cv = (await canvas(page).boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(cv.y);
    expect(b.y + b.height).toBeLessThanOrEqual(strip.y);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
    // severity, the problem, the fix and a way to the element
    const item = list.locator("li").first();
    await expect(item.locator(".sev")).toHaveText("major");
    await expect(item).toContainText("appears reversed");
    await expect(item.getByRole("button", { name: "show it" })).toBeVisible();

    await list.getByRole("button", { name: "close" }).click();
    await expect(list).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await toggle.click();
    await page.mouse.click(cv.x + 40, cv.y + 40);
    await expect(list).toBeHidden();
  });

  test("with nothing to report it says so", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    await expect(page.locator("#draw-check")).toHaveText("no notation issues");
    await page.locator("#draw-check").click();
    await expect(page.locator(".draw-findings")).toContainText("Nothing to fix");
  });

  test("show it selects what the finding is about, brings it into view and closes the list", async ({ page }) => {
    await openTool(page, REVERSED, "draw", { panels: "default" });
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "zoom in" }).click();
    const cv = (await canvas(page).boundingBox())!;
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    await page.mouse.wheel(-3000, -2000);
    await page.locator("#draw-check").click();
    await page.locator(".draw-findings").getByRole("button", { name: "show it" }).click();
    const marks = page.locator(".overlay .sel, .overlay .sel-line");
    await expect(marks.first()).toBeAttached();
    // the list closed, the canvas has the focus, and what the finding is about is in view
    await expect(page.locator(".draw-findings")).toBeHidden();
    await expect(canvas(page)).toBeFocused();
    for (const m of await marks.all()) {
      const b = (await m.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(cv.x);
      expect(b.y).toBeGreaterThanOrEqual(cv.y);
      expect(b.x + b.width).toBeLessThanOrEqual(cv.x + cv.width);
      expect(b.y + b.height).toBeLessThanOrEqual(cv.y + cv.height);
    }
  });
});

test.describe("moving around in select mode", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const world = (page: Page) => page.locator(".draw-canvas .world").getAttribute("transform");
  const translate = async (page: Page): Promise<[number, number]> => {
    const m = /translate\(([-0-9.]+) ([-0-9.]+)\)/.exec((await world(page)) ?? "")!;
    return [parseFloat(m[1]), parseFloat(m[2])];
  };
  /** a point on the canvas with nothing under it (only the dot grid), with room around it to drag */
  const emptySpot = async (page: Page): Promise<[number, number]> => page.evaluate(() => {
    const c = document.querySelector(".draw-canvas")!.getBoundingClientRect();
    for (let y = c.bottom - 30; y > c.top + 100; y -= 20) for (let x = c.left + 30; x < c.right - 200; x += 20) {
      const e = document.elementFromPoint(x, y);
      if (e?.classList.contains("grid")) return [x, y] as [number, number];
    }
    throw new Error("no empty canvas");
  });

  for (const presses of [0, 3, -3]) {
    test(`dragging empty canvas pans the view and only the view (zoom steps ${presses})`, async ({ page }) => {
      await openTool(page, USECASE, "draw", { panels: "default" });
      for (let i = 0; i < Math.abs(presses); i++) await page.getByRole("button", { name: presses > 0 ? "zoom in" : "zoom out" }).click();
      const before = await inspect(page);
      const z = await zoom(page);
      const t0 = await translate(page);
      const at = await emptySpot(page);
      await page.mouse.move(at[0], at[1]);
      await page.mouse.down();
      await page.mouse.move(at[0] + 60, at[1] - 40, { steps: 4 });
      // follows the pointer while dragging
      let t = await translate(page);
      expect(Math.abs(t[0] - t0[0] - 60)).toBeLessThan(1.5);
      expect(Math.abs(t[1] - t0[1] + 40)).toBeLessThan(1.5);
      await page.mouse.move(at[0] + 150, at[1] - 90, { steps: 6 });
      await page.mouse.up();
      t = await translate(page);
      expect(Math.abs(t[0] - t0[0] - 150)).toBeLessThan(1.5);
      expect(Math.abs(t[1] - t0[1] + 90)).toBeLessThan(1.5);
      expect(await zoom(page)).toBeCloseTo(z, 5);
      // the document did not change: same text, same geometry, nothing placed
      const after = await inspect(page);
      expect(after.text).toBe(before.text);
      expect(after.nodes.map((n) => [n.id, n.x, n.y, n.placed])).toEqual(before.nodes.map((n) => [n.id, n.x, n.y, n.placed]));
      expect(after.canUndo).toBe(before.canUndo);
    });
  }

  test("a click on empty canvas clears the selection without moving the view; a drag keeps the selection", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    await clickNode(page, "pay");
    const at = await emptySpot(page);
    const t0 = await world(page);
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(at[0] + 80, at[1] - 20, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".overlay .sel")).toHaveCount(1);
    const t1 = await world(page);
    expect(t1).not.toBe(t0);
    await page.mouse.click(at[0], at[1]);
    await expect(page.locator(".overlay .sel")).toHaveCount(0);
    expect(await world(page)).toBe(t1);
  });

  test("dragging a shape moves the shape, not the view", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const t0 = await world(page);
    const p = await box(page, "pay");
    const z = await zoom(page);
    await page.mouse.move(p.cx, p.cy);
    await page.mouse.down();
    await page.mouse.move(p.cx + 96, p.cy + 48, { steps: 8 });
    await page.mouse.up();
    expect(await world(page)).toBe(t0);
    const after = (await inspect(page)).nodes.find((n) => n.id === "pay")!;
    expect(after.placed).toBe(true);
    const moved = await box(page, "pay");
    expect(Math.abs(moved.cx - p.cx - 96)).toBeLessThan(0.15 * 96 * z + 2);
  });

  test("Shift+drag on empty canvas draws a selection box; Escape calls off a pan and puts the view back", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const a = await box(page, "apply"), t = await box(page, "track");
    const t0 = await world(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(a.x - 14, a.y - 14);
    await page.mouse.down();
    await page.mouse.move(Math.max(a.x + a.width, t.x + t.width) + 14, t.y + t.height + 14, { steps: 8 });
    await expect(page.locator(".overlay .marquee")).toHaveCount(1);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect(page.locator(".overlay .sel")).toHaveCount(2);
    expect(await world(page)).toBe(t0);

    const at = await emptySpot(page);
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(at[0] + 120, at[1] - 60, { steps: 5 });
    expect(await world(page)).not.toBe(t0);
    await page.keyboard.press("Escape");
    expect(await world(page)).toBe(t0);
    await page.mouse.up();
  });

  test("Space+drag pans even over a shape; the middle button pans; Ctrl+arrows pan from the keyboard", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const before = await inspect(page);
    const p = await box(page, "pay");
    await canvas(page).focus();
    let t0 = await translate(page);
    await page.keyboard.down(" ");
    await page.mouse.move(p.cx, p.cy);
    await page.mouse.down();
    await page.mouse.move(p.cx - 70, p.cy + 30, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    let t = await translate(page);
    expect(Math.abs(t[0] - t0[0] + 70)).toBeLessThan(1.5);
    expect((await inspect(page)).text).toBe(before.text);

    t0 = t;
    const q = await box(page, "pay");
    await page.mouse.move(q.cx, q.cy);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(q.cx + 50, q.cy, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    t = await translate(page);
    expect(Math.abs(t[0] - t0[0] - 50)).toBeLessThan(1.5);

    t0 = t;
    await canvas(page).focus();
    await page.keyboard.press("Control+ArrowLeft");
    t = await translate(page);
    expect(t[0] - t0[0]).toBe(80);
    expect((await inspect(page)).text).toBe(before.text);
  });

  test("the shape and line tools still place and connect: an armed shape, a line tool and a port drag", async ({ page }) => {
    await openTool(page, USECASE, "draw", { panels: "default" });
    const cv = (await canvas(page).boundingBox())!;
    const t0 = await world(page);
    // an armed shape: a click on empty canvas places it, it does not pan
    await page.locator('.draw-shape[data-kind="use-case"]').click();
    await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height - 60);
    await page.keyboard.press("Escape");
    let s = await inspect(page);
    const added = s.nodes.find((n) => !["resident", "clerk", "portal", "apply", "track", "review", "pay", "waiver"].includes(n.id))!;
    expect(added.kind).toBe("use-case");
    expect(await world(page)).toBe(t0);
    // a line tool: clicks pick the ends
    await page.getByRole("button", { name: "association", exact: true }).click();
    await clickNode(page, "clerk");
    await clickNode(page, added.id);
    await page.keyboard.press("Escape");
    s = await inspect(page);
    expect(s.edges.some((e) => e.from === "clerk" && e.to === added.id)).toBe(true);
    // a port drag still makes a line rather than panning
    const from = await box(page, "resident");
    await page.mouse.move(from.cx, from.cy);
    const port = (await page.locator('.overlay .port[data-port="bottom"]').boundingBox())!;
    const to = await box(page, added.id);
    const t1 = await world(page);
    await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.cx, to.cy, { steps: 10 });
    await page.mouse.up();
    expect(await world(page)).toBe(t1);
    expect((await inspect(page)).edges.some((e) => e.from === "resident" && e.to === added.id)).toBe(true);
  });
});
