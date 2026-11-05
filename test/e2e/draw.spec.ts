/**
 * The draw view, driven the way a person drives it: a real pointer and a real keyboard. Each test is
 * one of the scenarios in docs/revamp/TEST_MATRIX.md (the letter in its name).
 */
import { test, expect, type Page } from "@playwright/test";
import { box, canvas, clickEdge, clickNode, drag, edge, field, getText, inspect, ksdOf, node, openTool, status, toPage, zoom } from "./helpers";

test.use({ viewport: { width: 1440, height: 1000 } });

const ACTIVITY = "diagram activity\nid claims\ntitle A claim is reviewed before it is paid\n\nstart begin\naction review \"review claim\"\naction pay \"pay claim\"\nend done\n\nbegin -> review\nreview -> pay\npay -> done\n";
const inline = (page: Page) => page.locator(".draw-inline");
const near = (a: number, b: number, tol = 2.5): boolean => Math.abs(a - b) <= tol;

test.describe("placing and editing shapes", () => {
  test("A: shapes dragged or clicked from the palette land exactly where they were put, with stable ids", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    const before = await inspect(page);
    const cv = (await canvas(page).boundingBox())!;
    // drag from the palette
    const drop: [number, number] = [cv.x + 620, cv.y + 180];
    const item = (await page.locator('.draw-shape[data-kind="action"]').boundingBox())!;
    await drag(page, [item.x + 10, item.y + 10], drop, { hold: async () => { await expect(page.locator(".draw-canvas .ghost > g")).toBeAttached(); } });
    const a1 = await box(page, "action1");
    expect(near(a1.cx, drop[0]) && near(a1.cy, drop[1]), `action1 at ${a1.cx},${a1.cy}, dropped at ${drop}`).toBe(true);
    await expect(status(page)).toContainText("added action action1");
    // click to arm, click to place
    await page.locator('.draw-shape[data-kind="decision"]').click();
    await expect(page.locator('.draw-shape[data-kind="decision"]')).toHaveAttribute("aria-pressed", "true");
    const spot: [number, number] = [cv.x + 620, cv.y + 420];
    await page.mouse.click(spot[0], spot[1]);
    const d1 = await box(page, "decision1");
    expect(near(d1.cx, spot[0]) && near(d1.cy, spot[1])).toBe(true);
    // The library remains armed so several empty shapes can be laid out before any are named.
    await expect(page.locator('.draw-shape[data-kind="decision"]')).toHaveAttribute("aria-pressed", "true");
    const spot2: [number, number] = [cv.x + cv.width / 2, cv.y + cv.height / 2];
    await page.mouse.click(spot2[0], spot2[1]);
    const d2 = await box(page, "decision2");
    expect(near(d2.cx, spot2[0]) && near(d2.cy, spot2[1])).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator('.draw-shape[data-kind="decision"]')).toHaveAttribute("aria-pressed", "false");
    // nothing that was already there moved, and nothing was renamed
    const after = await inspect(page);
    for (const n of before.nodes) {
      const now = after.nodes.find((x) => x.uid === n.uid)!;
      expect(now.id).toBe(n.id);
      expect(Math.abs(now.x - n.x) + Math.abs(now.y - n.y), `${n.id} moved`).toBeLessThan(0.002);
    }
    expect(after.text).toContain('action action1 ""');
    // a drop outside the canvas adds nothing
    await drag(page, [item.x + 10, item.y + 10], [cv.x + 300, cv.y + cv.height + 60]);
    expect((await inspect(page)).nodes.length).toBe(after.nodes.length);
    await expect(status(page)).toContainText("nothing added");
  });

  test("B: double-click a shape and type, one character at a time, with the caret and focus kept", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    const b = await box(page, "review");
    await page.mouse.dblclick(b.cx, b.cy);
    const f = inline(page);
    await expect(f).toBeVisible();
    await expect(f).toBeFocused();
    await expect(f).toHaveValue("review claim");
    // the field sits on the shape it edits
    const fb = (await f.boundingBox())!;
    expect(near(fb.x + fb.width / 2, b.cx, 4) && near(fb.y + fb.height / 2, b.cy, 4)).toBe(true);
    // every keystroke lands, in order, and the field is the same element throughout
    await f.evaluate((el) => { (el as HTMLElement & { __mark?: number }).__mark = 1; });
    await page.keyboard.press("ControlOrMeta+a");
    const word = "check the claim form";
    for (let i = 0; i < word.length; i++) {
      await page.keyboard.type(word[i]);
      await expect(f).toHaveValue(word.slice(0, i + 1));
      await expect(f).toBeFocused();
    }
    expect(await f.evaluate((el) => (el as HTMLElement & { __mark?: number }).__mark)).toBe(1);
    // the document has not changed yet: one edit, made on commit
    expect(await getText(page)).toContain('action review "review claim"');
    // caret movement and a selection
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("paper ");
    await expect(f).toHaveValue("check the claim paper form");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ControlOrMeta+ArrowRight");
    // word selection takes the space after the word on some platforms: type the word and a space, then tidy doubles
    await page.keyboard.type("verify ");
    if ((await f.inputValue()).startsWith("verify  ")) await page.keyboard.press("Backspace");
    await expect(f).toHaveValue(/^verify the claim paper form$/);
    // paste, then a second line
    await page.keyboard.press("End");
    await page.keyboard.insertText(" (pasted)");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("twice");
    await expect(f).toHaveValue("verify the claim paper form (pasted)\ntwice");
    await page.keyboard.press("Enter");
    await expect(f).toHaveCount(0);
    await expect(canvas(page)).toBeFocused();
    expect(await getText(page)).toContain('action review "verify the claim paper form (pasted)\\ntwice"');
    await expect(page.locator('.layer-texts text[data-name="review:label"]')).toHaveText("verify the claim paper form (pasted)");
    await expect(page.locator('.layer-texts text[data-name="review:label2"]')).toHaveText("twice");
    // the text is inside the shape after the shape grew to hold it
    const grown = await box(page, "review");
    for (const name of ["review:label", "review:label2"]) {
      const t = (await page.locator(`.layer-texts text[data-name="${name}"]`).boundingBox())!;
      expect(t.x >= grown.x && t.x + t.width <= grown.x + grown.width && t.y >= grown.y - 1 && t.y + t.height <= grown.y + grown.height + 1, `${name} inside its box`).toBe(true);
    }
    // one undo takes the whole edit back
    await page.keyboard.press("ControlOrMeta+z");
    expect(await getText(page)).toBe(ACTIVITY);
  });

  test("B: Escape cancels, clicking away commits, typing on a selected shape replaces its text, special nodes have no text", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    const b = await box(page, "pay");
    await page.mouse.dblclick(b.cx, b.cy);
    await page.keyboard.type("x");
    await page.keyboard.press("Escape");
    await expect(inline(page)).toHaveCount(0);
    expect(await getText(page)).toBe(ACTIVITY);
    await expect(page.locator('.layer-texts text[data-name="pay:label"]')).toBeVisible();
    // blur commits
    await page.mouse.dblclick(b.cx, b.cy);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("settle claim");
    const cv = (await canvas(page).boundingBox())!;
    await page.mouse.click(cv.x + 40, cv.y + cv.height - 40);
    await expect(inline(page)).toHaveCount(0);
    expect(await getText(page)).toContain('action pay "settle claim"');
    // type-to-replace
    await clickNode(page, "review");
    await page.keyboard.type("audit");
    await expect(inline(page)).toHaveValue("audit");
    await page.keyboard.press("Enter");
    expect(await getText(page)).toContain('action review "audit"');
    // an initial node is not a text box
    const s = await box(page, "begin");
    await page.mouse.dblclick(s.cx, s.cy);
    await expect(inline(page)).toHaveCount(0);
    await expect(status(page)).toContainText("has no text");
    // an em dash is refused and nothing changes
    await clickNode(page, "review");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("a — b");
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText("no em dashes (house rule)");
    expect(await getText(page)).toContain('action review "audit"');
  });

  test("C: dragging at several zoom levels moves the shape with the pointer, keeps the view still and re-routes its lines live", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    await page.getByRole("button", { name: "library" }).click();
    await page.getByRole("button", { name: "properties hide" }).click();
    for (const presses of [0, 2, -2]) {
      // Exercise each zoom from the same document position rather than eventually dragging
      // beyond the clipped viewport of the deliberately docked canvas workspace.
      await openTool(page, ACTIVITY, "draw");
      await page.locator("#draw-zoom").click();
      for (let i = 0; i < Math.abs(presses); i++) await page.getByRole("button", { name: presses > 0 ? "zoom in" : "zoom out" }).click();
      const z = await zoom(page);
      const b = await box(page, "pay"), other = await box(page, "review");
      const before = await node(page, "pay");
      const lineBefore = (await edge(page, "review", "pay")).points;
      let mid = "";
      // Alt switches snapping off, so the shape goes exactly where the pointer does
      await page.keyboard.down("Alt");
      await drag(page, [b.cx, b.cy], [b.cx + 80, b.cy + 30], {
        hold: async () => { mid = await page.locator('.layer-edges g[data-name="e2"]').innerHTML(); },
      });
      await page.keyboard.up("Alt");
      const after = await node(page, "pay");
      // 80 px on screen is 80 / zoom px in the document
      expect(near((after.x - before.x) * 96 * z, 80, 3), `zoom ${z}: moved ${(after.x - before.x) * 96 * z}px`).toBe(true);
      expect(near((after.y - before.y) * 96 * z, 30, 3)).toBe(true);
      const now = await box(page, "pay");
      expect(near(now.cx, b.cx + 80, 3)).toBe(true);
      // the view did not jump: a shape that was not dragged is where it was
      const still = await box(page, "review");
      expect(near(still.cx, other.cx, 0.6) && near(still.cy, other.cy, 0.6)).toBe(true);
      // the line was already following during the drag, and ends on the moved shape
      expect(mid.length).toBeGreaterThan(100);
      const line = (await edge(page, "review", "pay")).points;
      expect(line).not.toEqual(lineBefore);
      const tip = line[line.length - 1];
      expect(Math.abs(tip[0] - after.x) <= after.w / 2 + 0.08 && Math.abs(tip[1] - after.y) <= after.h / 2 + 0.08).toBe(true);
      expect(await zoom(page)).toBe(z);
    }
    // only the dragged shape was placed by hand
    expect((await inspect(page)).nodes.filter((n) => n.placed).map((n) => n.id)).toEqual(["pay"]);
    await page.screenshot({ path: "test-results/draw-after-drag.png" });
  });

  test("D: resize handles change the size from the dragged corner, keep the far corner fixed and never clip the text", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    await clickNode(page, "review");
    const z = await zoom(page);
    const b = await box(page, "review");
    const se = (await page.locator('.overlay .handle[data-handle="se"]').boundingBox())!;
    await drag(page, [se.x + 5, se.y + 5], [se.x + 5 + 80, se.y + 5 + 44]);
    const big = await box(page, "review");
    expect(near(big.width, b.width + 80, 3) && near(big.height, b.height + 44, 3), `${big.width}x${big.height} from ${b.width}x${b.height}`).toBe(true);
    expect(near(big.x, b.x, 1) && near(big.y, b.y, 1)).toBe(true);
    const n = await node(page, "review");
    expect(n.sized).toBe(true);
    expect(await getText(page)).toMatch(/size review [0-9.]+ [0-9.]+/);
    expect(near(n.w * 96 * z, big.width, 1)).toBe(true);
    // lines stay attached to the resized shape
    const line = (await edge(page, "review", "pay")).points;
    expect(Math.abs(line[0][1] - (n.y + n.h / 2))).toBeLessThan(0.08);
    // shrinking far past the text stops at the size the text needs
    const nw = (await page.locator('.overlay .handle[data-handle="nw"]').boundingBox())!;
    await drag(page, [nw.x + 5, nw.y + 5], [nw.x + 5 + 400, nw.y + 5 + 300]);
    const small = await box(page, "review");
    const label = (await page.locator('.layer-texts text[data-name="review:label"]').boundingBox())!;
    expect(label.x >= small.x && label.x + label.width <= small.x + small.width && label.y >= small.y && label.y + label.height <= small.y + small.height).toBe(true);
    // the corner that was not dragged stayed where it was
    expect(near(small.x + small.width, big.x + big.width, 1.5) && near(small.y + small.height, big.y + big.height, 1.5)).toBe(true);
    // numeric size, and back to automatic
    await field(page, "node:w").fill("3");
    await field(page, "node:w").press("Enter");
    await expect.poll(async () => (await node(page, "review")).w).toBe(3);
    await page.getByRole("button", { name: "fit to its text" }).click();
    await expect.poll(async () => (await node(page, "review")).sized).toBe(false);
    expect(await getText(page)).not.toMatch(/size review/);
  });
});

test.describe("lines", () => {
  test("relationship tools can be completed entirely from the keyboard", async ({ page }) => {
    await openTool(page, 'diagram activity\ntitle Keyboard connector\n\naction one ""\naction two ""\n', "draw");
    await page.getByRole("button", { name: "control flow", exact: true }).click();
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.press("ArrowRight"); // keyboard entry selects the first shape
    await page.keyboard.press("Enter");      // source
    await expect(status(page)).toContainText("choose the target");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");      // target
    await expect(status(page)).toContainText("connected");
    expect(await getText(page)).toContain("one -> two");
    await expect(page.getByRole("button", { name: "control flow", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("E: drag from a port to another shape: a live preview, a highlighted target, and a line attached to both outlines", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    const cv = (await canvas(page).boundingBox())!;
    const start = await box(page, "review");
    await page.locator('.draw-shape[data-kind="action"]').click();
    await page.mouse.click(Math.min(cv.x + cv.width - 420, start.cx + 330), start.cy + 150);
    await page.keyboard.press("Escape");
    const from = await box(page, "review");
    await page.mouse.move(from.cx, from.cy);
    const port = page.locator('.overlay .port[data-port="right"]');
    await expect(port).toBeVisible();
    await expect(page.locator(".overlay .port")).toHaveCount(4);
    const p = (await port.boundingBox())!;
    const to = await box(page, "action1");
    let sawPreview = false, sawTarget = false, said = "";
    await drag(page, [p.x + p.width / 2, p.y + p.height / 2], [to.cx, to.cy], {
      hold: async () => {
        await expect(page.locator(".overlay .preview")).toHaveCount(1);
        await expect(page.locator(".overlay .target:not(.is-bad)")).toHaveCount(1);
        sawPreview = sawTarget = true;
        said = (await status(page).textContent()) ?? "";
      },
    });
    expect(sawPreview && sawTarget).toBe(true);
    expect(said).toBe("let go to connect");
    expect(await getText(page)).toContain("review -> action1");
    const line = await edge(page, "review", "action1");
    const a = await node(page, "review"), b = await node(page, "action1");
    const [p0, p1] = [line.points[0], line.points[line.points.length - 1]];
    // each end is on its shape's outline (within the arrow's small gap), not at its center
    const onOutline = (q: [number, number], n: typeof a): boolean => {
      const dx = Math.abs(q[0] - n.x) - n.w / 2, dy = Math.abs(q[1] - n.y) - n.h / 2;
      return Math.max(dx, dy) > -0.01 && Math.max(dx, dy) < 0.09;
    };
    expect(onOutline(p0, a) && onOutline(p1, b), JSON.stringify(line.points)).toBe(true);
    expect(line.fromSide).toBe("right");
    // the new line is selected, ready for its label
    await expect(page.locator(".draw-inspector h2")).toHaveText("line");
    // the same port gesture can make a self-link entirely in Draw
    await page.mouse.move(from.cx, from.cy);
    const again = (await page.locator('.overlay .port[data-port="top"]').boundingBox())!;
    await drag(page, [again.x + 6, again.y + 6], [from.cx, from.cy + 4]);
    const withLoop = await inspect(page);
    expect(withLoop.edges.length).toBe(5);
    expect(withLoop.edges.some((e) => e.from === "review" && e.to === "review" && e.points.length >= 4)).toBe(true);
    await page.screenshot({ path: "test-results/draw-connected.png" });
  });

  test("F: drag a line's end to another shape to re-attach it; the model and the route follow", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    const uid = await clickEdge(page, "review", "pay");
    await expect(page.locator(".overlay .end")).toHaveCount(2);
    const end = (await page.locator('.overlay .end[data-end="to"]').boundingBox())!;
    const target = await box(page, "done");
    await drag(page, [end.x + 7, end.y + 7], [target.cx, target.cy]);
    const text = await getText(page);
    expect(text).toContain("review -> done");
    expect(text).not.toContain("review -> pay");
    const after = await inspect(page);
    const line = after.edges.find((e) => e.uid === uid)!;
    expect([line.from, line.to]).toEqual(["review", "done"]);
    const d = after.nodes.find((n) => n.id === "done")!;
    const tip = line.points[line.points.length - 1];
    expect(Math.hypot(tip[0] - d.x, tip[1] - d.y)).toBeLessThan(d.w / 2 + 0.1);
    // dropped on nothing, a line stays where it was
    await clickEdge(page, "begin", "review");
    const e2 = (await page.locator('.overlay .end[data-end="to"]').boundingBox())!;
    const cv = (await canvas(page).boundingBox())!;
    await drag(page, [e2.x + 7, e2.y + 7], [cv.x + 60, cv.y + cv.height - 60]);
    expect(await getText(page)).toContain("begin -> review");
  });

  test("G: drag an elbow line's run to bend it; the route is saved and survives a reload", async ({ page }) => {
    await openTool(page, ksdOf("flow-branched"), "draw");
    await clickEdge(page, "severity", "page");
    const before = (await edge(page, "severity", "page")).points;
    expect(before.length).toBeGreaterThanOrEqual(3);
    const handle = page.locator(".overlay .seg").last();
    const h = (await handle.boundingBox())!;
    const vertical = await handle.evaluate((el) => el.classList.contains("seg-v"));
    await drag(page, [h.x + h.width / 2, h.y + h.height / 2], [h.x + h.width / 2 + (vertical ? -50 : 0), h.y + h.height / 2 + (vertical ? 0 : 50)]);
    const text = await getText(page);
    expect(text).toMatch(/route severity -> page elbow from \w+ to \w+ via [-0-9. ,]+/);
    const bent = await edge(page, "severity", "page");
    expect(bent.routed).toBe(true);
    expect(bent.points).not.toEqual(before);
    for (let i = 1; i < bent.points.length; i++) {
      expect(Math.abs(bent.points[i][0] - bent.points[i - 1][0]) < 1e-6 || Math.abs(bent.points[i][1] - bent.points[i - 1][1]) < 1e-6, "still right angles").toBe(true);
    }
    // it is still editable: the handles are there for the new route
    expect(await page.locator(".overlay .seg").count()).toBeGreaterThan(0);
    // a reload brings the same route back from the local draft
    await page.goto("/#tab=draw");
    await expect(page.locator(".draw-canvas .layer-nodes > g").first()).toBeAttached();
    expect((await edge(page, "severity", "page")).points).toEqual(bent.points);
    // reset hands it back to the router
    await clickEdge(page, "severity", "page");
    await page.getByRole("button", { name: "reset route" }).click();
    expect((await edge(page, "severity", "page")).points).toEqual(before);
    expect(await getText(page)).not.toContain("route severity");
  });

  test("H: a line's color and weight change and are saved; its pattern belongs to its meaning and is not a free choice", async ({ page }) => {
    await openTool(page, ksdOf("usecase-permit"), "draw");
    const uid = await clickEdge(page, "apply", "pay");
    await page.locator(".inspector-section", { hasText: "look" }).locator("summary").click();
    await field(page, "edge:style:color").selectOption("terra");
    await field(page, "edge:style:weight").selectOption("bold");
    expect(await getText(page)).toContain("style apply -include-> pay color terra weight bold");
    const e = (await inspect(page)).edges.find((x) => x.uid === uid)!;
    expect(e.kind).toBe("include");
    await expect(page.locator(`.layer-edges g[data-name="${e.id}"] path.k-terra`)).toHaveCount(1);
    await expect(page.locator(`.layer-texts text[data-name="${e.id}:stereotype"]`)).toHaveClass(/k-terra/);
    // no control offers "dashed": the panel explains why
    await expect(page.locator(".draw-inspector")).toContainText("Drawn dashed: the line's pattern and its ends are part of what it means");
    expect(await page.locator('.draw-inspector select option:text-is("dashed")').count()).toBe(0);
    // changing the meaning is a separate, named choice, and the style survives it
    await field(page, "edge:op").selectOption("-extend->");
    await expect(status(page)).toContainText("now extend");
    expect(await getText(page)).toContain("style apply -extend-> pay color terra weight bold");
    // a shape's fill and outline
    await clickNode(page, "track");
    await page.locator(".inspector-section", { hasText: "look" }).locator("summary").click();
    await field(page, "node:style:fill").selectOption("wash");
    expect(await getText(page)).toContain("style track fill wash");
    await expect(page.locator('.layer-nodes g[data-name="track"] path.k-wash')).toHaveCount(1);
  });

  test("a line's label is edited in place and can be dragged off the line and reset", async ({ page }) => {
    await openTool(page, ksdOf("flow-approval"), "draw");
    const e = await edge(page, "ok", "schedule");
    const label = page.locator(`.layer-hits rect[data-uid="${e.uid}"][data-label]`);
    const lb = (await label.boundingBox())!;
    await page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await expect(inline(page)).toHaveValue("yes");
    await page.keyboard.type("[approved]");
    await page.keyboard.press("Enter");
    expect(await getText(page)).toContain("ok -> schedule : [approved]");
    const l2 = (await label.boundingBox())!;
    await drag(page, [l2.x + l2.width / 2, l2.y + l2.height / 2], [l2.x + l2.width / 2 - 70, l2.y + l2.height / 2 + 40]);
    expect(await getText(page)).toMatch(/label ok -> schedule [0-9.]+ -?[0-9.]+ -?[0-9.]+/);
    const moved = (await label.boundingBox())!;
    expect(near(moved.x + moved.width / 2, l2.x + l2.width / 2 - 70, 4)).toBe(true);
    await page.getByRole("button", { name: "reset label" }).click();
    expect(await getText(page)).not.toContain("label ok");
  });
});

test.describe("class compartments", () => {
  test("attributes and operations can be added and edited directly on the class", async ({ page }) => {
    await openTool(page, ksdOf("class-orders"), "draw");
    await clickNode(page, "Customer");
    await page.locator('.quick-add[data-add-member="attribute"]').click();
    await expect(inline(page)).toHaveValue("+attribute1: Type");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("+sku: String");
    await page.keyboard.press("Enter");
    expect(await getText(page)).toContain("+sku: String");

    await clickNode(page, "Customer");
    await canvas(page).focus();
    await page.keyboard.press("Alt+o");
    await expect(inline(page)).toHaveValue("+operation1(): Type");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("+find(id: String): Product");
    await page.keyboard.press("Enter");
    expect(await getText(page)).toContain("+find(id: String): Product");
    await expect(page.locator('.layer-texts text[data-name="Customer:m3"]')).toHaveText("+sku: String");
    await expect(page.locator('.layer-texts text[data-name="Customer:m4"]')).toHaveText("+find(id: String): Product");
  });
});

test.describe("swimlanes", () => {
  test("I: build three lanes, put actions in them, and connect across lanes: membership is real and the geometry agrees", async ({ page }) => {
    await openTool(page, "diagram activity\ntitle Who does what\n\nstart begin\n", "draw");
    const cv = (await canvas(page).boundingBox())!;
    // three partitions, from the palette
    await page.locator('.draw-shape[data-kind="partition"]').click();
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(cv.x + 300, cv.y + 300);
    }
    await page.keyboard.press("Escape");
    let state = await inspect(page);
    expect(state.nodes.filter((n) => n.kind === "partition").map((n) => n.id)).toEqual(["lane1", "lane2", "lane3"]);
    // name them in place
    for (const [id, name] of [["lane1", "Customer"], ["lane2", "Sales"], ["lane3", "Warehouse"]]) {
      const lane = await node(page, id);
      const head = await toPage(page, [lane.x, lane.y - lane.h / 2 + 0.2]);
      await page.mouse.dblclick(head[0], head[1]);
      await expect(inline(page)).toBeVisible();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(name);
      await page.keyboard.press("Enter");
    }
    expect(await getText(page)).toContain('partition lane2 "Sales" {');
    // drop an action into each lane
    const item = (await page.locator('.draw-shape[data-kind="action"]').boundingBox())!;
    for (const id of ["lane1", "lane2", "lane3"]) {
      const lane = await node(page, id);
      const at = await toPage(page, [lane.x, lane.y + 0.2]);
      await drag(page, [item.x + 10, item.y + 10], at);
    }
    state = await inspect(page);
    expect(state.nodes.filter((n) => n.kind === "action").map((n) => [n.id, n.parent])).toEqual([["action1", "lane1"], ["action2", "lane2"], ["action3", "lane3"]]);
    expect(state.text).toMatch(/partition lane1 "Customer" \{\n {2}action action1 ""\n\}/);
    // each action is drawn inside its own lane
    for (const n of state.nodes.filter((x) => x.kind === "action")) {
      const lane = state.nodes.find((x) => x.id === n.parent)!;
      expect(Math.abs(n.x - lane.x) < lane.w / 2 && Math.abs(n.y - lane.y) < lane.h / 2, `${n.id} in ${lane.id}`).toBe(true);
    }
    // lanes are one pool: side by side, same top and height
    const lanes = state.nodes.filter((n) => n.kind === "partition");
    for (let i = 1; i < lanes.length; i++) {
      expect(Math.abs(lanes[i].x - lanes[i].w / 2 - (lanes[i - 1].x + lanes[i - 1].w / 2))).toBeLessThan(0.002);
      expect(Math.abs(lanes[i].h - lanes[0].h)).toBeLessThan(0.002);
    }
    // connect across the lanes by dragging ports
    for (const [a, b] of [["action1", "action2"], ["action2", "action3"]]) {
      const from = await box(page, a), to = await box(page, b);
      await page.mouse.move(from.cx, from.cy);
      const port = (await page.locator('.overlay .port[data-port="right"]').boundingBox())!;
      await drag(page, [port.x + 6, port.y + 6], [to.cx, to.cy]);
    }
    state = await inspect(page);
    expect(state.text).toContain("action1 -> action2\naction2 -> action3");
    expect(state.edges.length).toBe(2);
    // a lane is not concurrency: the check has nothing to say about forks here
    await expect(status(page)).not.toContainText("fork");
    await page.screenshot({ path: "test-results/draw-three-lanes.png" });
  });

  test("J: drag a lane divider and move an action to another lane: lanes shift together, membership follows, lines stay attached", async ({ page }) => {
    await openTool(page, ksdOf("activity-lanes"), "draw");
    // Return the optional side zones while manipulating a wide three-lane pool.
    await page.getByRole("button", { name: "library" }).click();
    await page.getByRole("button", { name: "properties hide" }).click();
    await page.getByRole("button", { name: "fit", exact: true }).click();
    const before = await inspect(page);
    const customer = before.nodes.find((n) => n.id === "customer")!;
    const customerUid = before.nodes.find((n) => n.id === "customer")!.uid;
    const divider = (await page.locator(`.divider[data-divider="${customerUid}"]`).boundingBox())!;
    const at: [number, number] = [divider.x + divider.width / 2, divider.y + divider.height / 2];
    const z = await zoom(page);
    await drag(page, at, [at[0] + 90, at[1]]);
    let now = await inspect(page);
    const c2 = now.nodes.find((n) => n.id === "customer")!;
    expect(Math.abs((c2.w - customer.w) * 96 * z - 90)).toBeLessThan(3);
    expect(now.text).toMatch(/lane customer [0-9.]+/);
    // the lanes after it moved with the divider, still edge to edge
    const s1 = before.nodes.find((n) => n.id === "sales")!, s2 = now.nodes.find((n) => n.id === "sales")!;
    expect(Math.abs((s2.x - s1.x) - (c2.w - customer.w))).toBeLessThan(0.01);
    expect(Math.abs(s2.x - s2.w / 2 - (c2.x + c2.w / 2))).toBeLessThan(0.002);
    // and every node is still inside its own lane, with its lines on its outline
    const insideOwnLane = (st: typeof now): void => {
      for (const n of st.nodes.filter((x) => x.parent)) {
        const lane = st.nodes.find((x) => x.id === n.parent)!;
        expect(Math.abs(n.x - lane.x) <= lane.w / 2 && Math.abs(n.y - lane.y) <= lane.h / 2, `${n.id} in ${lane.id}`).toBe(true);
      }
      for (const e of st.edges) {
        for (const [p, id] of [[e.points[0], e.from], [e.points[e.points.length - 1], e.to]] as const) {
          const n = st.nodes.find((x) => x.id === id)!;
          expect(Math.abs(p[0] - n.x) <= n.w / 2 + 0.09 && Math.abs(p[1] - n.y) <= n.h / 2 + 0.09, `${e.from}->${e.to} on ${id}`).toBe(true);
        }
      }
    };
    insideOwnLane(now);
    // move "cancel order" from Sales to Warehouse
    const cancel = await box(page, "cancel");
    const wh = now.nodes.find((n) => n.id === "warehouse")!;
    const target = await toPage(page, [wh.x, now.nodes.find((n) => n.id === "cancel")!.y + 1.6]);
    await drag(page, [cancel.cx, cancel.cy], target);
    await expect(status(page)).toContainText("cancel order is now in Warehouse");
    now = await inspect(page);
    expect(now.nodes.find((n) => n.id === "cancel")!.parent).toBe("warehouse");
    expect(now.text).toMatch(/partition warehouse "Warehouse" \{[^}]*action cancel "cancel order"/);
    expect(now.text).not.toMatch(/partition sales "Sales" \{[^}]*action cancel/);
    insideOwnLane(now);
    // undo and redo walk the two transactions
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).nodes.find((n) => n.id === "cancel")!.parent).toBe("sales");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await getText(page)).toBe(ksdOf("activity-lanes"));
    await page.keyboard.press("ControlOrMeta+y");
    await page.keyboard.press("ControlOrMeta+y");
    expect((await inspect(page)).nodes.find((n) => n.id === "cancel")!.parent).toBe("warehouse");
    await page.screenshot({ path: "test-results/draw-lanes-edited.png" });
  });

  test("a lane can be renamed, reordered, duplicated and deleted; deleting it keeps its shapes and says so", async ({ page }) => {
    await openTool(page, ksdOf("activity-lanes"), "draw");
    const lane = await node(page, "sales");
    const head = await toPage(page, [lane.x, lane.y - lane.h / 2 + 0.2]);
    await page.mouse.click(head[0], head[1]);
    await expect(page.locator(".draw-inspector h2")).toHaveText("partition (swimlane)");
    await page.getByRole("button", { name: "move left" }).click();
    expect((await inspect(page)).nodes.filter((n) => n.kind === "partition").map((n) => n.id)).toEqual(["sales", "customer", "warehouse"]);
    await page.getByRole("button", { name: "duplicate" }).click();
    let st = await inspect(page);
    expect(st.nodes.filter((n) => n.kind === "partition").length).toBe(4);
    expect(st.nodes.filter((n) => n.parent === "sales1").length).toBe(4);
    await canvas(page).focus();
    await page.keyboard.press("ControlOrMeta+z");
    await page.mouse.click(...(await toPage(page, [(await node(page, "sales")).x, (await node(page, "sales")).y - (await node(page, "sales")).h / 2 + 0.2])));
    await page.keyboard.press("Delete");
    await expect(status(page)).toContainText("4 shapes that were inside stayed, outside any container");
    st = await inspect(page);
    expect(st.nodes.some((n) => n.id === "sales")).toBe(false);
    expect(st.nodes.find((n) => n.id === "check")!.parent).toBeNull();
    expect(st.edges.length).toBe(9);
  });
});

test.describe("many shapes at once", () => {
  test("K: align and distribute a multi-selection; each is one step to undo", async ({ page }) => {
    await openTool(page, ksdOf("usecase-permit"), "draw");
    // a marquee around the two use cases in the first column, then a shift-click adds one from the second
    const a = await box(page, "apply"), t = await box(page, "track");
    await drag(page, [a.x - 14, a.y - 14], [Math.max(a.x + a.width, t.x + t.width) + 14, t.y + t.height + 14]);
    await expect(page.locator(".draw-inspector h2")).toHaveText("2 selected");
    await clickNode(page, "review", { shift: true });
    await expect(page.locator(".draw-inspector h2")).toHaveText("3 selected");
    await expect(page.locator(".overlay .sel")).toHaveCount(3);
    const before = await inspect(page);
    await page.locator(".draw-inspector").getByRole("button", { name: "left", exact: true }).click();
    let st = await inspect(page);
    const lefts = ["apply", "track", "review"].map((id) => { const n = st.nodes.find((x) => x.id === id)!; return n.x - n.w / 2; });
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(0.002);
    await page.locator(".draw-inspector").getByRole("button", { name: "down", exact: true }).click();
    st = await inspect(page);
    const ys = ["apply", "track", "review"].map((id) => st.nodes.find((x) => x.id === id)!);
    const gap1 = ys[1].y - ys[1].h / 2 - (ys[0].y + ys[0].h / 2), gap2 = ys[2].y - ys[2].h / 2 - (ys[1].y + ys[1].h / 2);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.003);
    await canvas(page).focus();
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    st = await inspect(page);
    for (const n of before.nodes) expect(Math.abs(st.nodes.find((x) => x.id === n.id)!.x - n.x)).toBeLessThan(0.002);
    expect(st.text).toBe(ksdOf("usecase-permit"));
    await page.keyboard.press("ControlOrMeta+y");
    expect((await inspect(page)).nodes.filter((n) => n.placed).length).toBeGreaterThanOrEqual(2);
    // shift-click adds to and removes from the selection
    await clickNode(page, "pay", { shift: true });
    await expect(page.locator(".draw-inspector h2")).toHaveText("4 selected");
    await clickNode(page, "pay", { shift: true });
    await expect(page.locator(".draw-inspector h2")).toHaveText("3 selected");
  });

  test("L: copy and paste a connected fragment: fresh ids, the same relationships, placed at an offset", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    await clickNode(page, "review");
    await clickNode(page, "pay", { shift: true });
    await page.keyboard.press("ControlOrMeta+c");
    await expect(status(page)).toHaveText("copied 2 shapes");
    await page.keyboard.press("ControlOrMeta+v");
    const st = await inspect(page);
    expect(st.nodes.map((n) => n.id)).toEqual(["begin", "review", "pay", "done", "review1", "pay1"]);
    expect(st.text).toContain("review1 -> pay1");
    const r = st.nodes.find((n) => n.id === "review")!, r1 = st.nodes.find((n) => n.id === "review1")!;
    expect(Math.abs(r1.x - r.x - 0.3) + Math.abs(r1.y - r.y - 0.3)).toBeLessThan(0.01);
    expect(new Set(st.nodes.map((n) => n.uid)).size).toBe(6);
    // the copies are what is selected now; duplicate makes another pair, and Delete removes it
    await expect(page.locator(".overlay .sel")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+d");
    expect((await inspect(page)).nodes.length).toBe(8);
    await page.keyboard.press("Delete");
    expect((await inspect(page)).nodes.length).toBe(6);
    // the originals and their lines were never touched
    expect(st.text.startsWith(ACTIVITY.trimEnd())).toBe(false);
    expect(st.text).toContain("begin -> review\nreview -> pay\npay -> done");
  });

  test("keyboard: Tab walks shapes, arrows nudge by one step or a bigger one, Escape lets go, shortcuts leave fields alone", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    await canvas(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".overlay .sel")).toHaveCount(1);
    await expect(status(page)).toContainText("initial");
    await page.keyboard.press("Tab");
    await expect(status(page)).toContainText('action "review claim"');
    const before = await node(page, "review");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const after = await node(page, "review");
    expect(after.x - before.x).toBeCloseTo(0.05, 3);
    expect(after.y - before.y).toBeCloseTo(0.25, 3);
    await page.keyboard.press("Escape");
    await expect(page.locator(".overlay .sel")).toHaveCount(0);
    // with nothing selected, Tab leaves the canvas
    await page.keyboard.press("Tab");
    await expect(canvas(page)).not.toBeFocused();
    // Backspace in a properties field edits the field, not the diagram
    await clickNode(page, "pay");
    await field(page, "node:label").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Tab");
    expect(await getText(page)).toContain('action pay "pay clai"');
    expect((await inspect(page)).nodes.some((n) => n.id === "pay")).toBe(true);
  });
});

test.describe("horizontal lanes", () => {
  const ROWS = ksdOf("activity-lanes").replace("title ", "lanes horizontal\ntitle ");

  test("drag a row's divider and move an action to another row: rows shift together, membership follows, lines stay attached", async ({ page }) => {
    await openTool(page, ROWS, "draw");
    const before = await inspect(page);
    const customer = before.nodes.find((n) => n.id === "customer")!;
    const sales = before.nodes.find((n) => n.id === "sales")!;
    // rows, one under the other, each as long as the next
    expect(customer.w).toBeGreaterThan(customer.h);
    expect(sales.y).toBeGreaterThan(customer.y);
    expect(Math.abs(sales.w - customer.w)).toBeLessThan(0.002);
    const at = await toPage(page, [customer.x, customer.y + customer.h / 2]);
    const z = await zoom(page);
    await drag(page, at, [at[0], at[1] + 60]);
    let now = await inspect(page);
    const c2 = now.nodes.find((n) => n.id === "customer")!;
    expect(Math.abs((c2.h - customer.h) * 96 * z - 60)).toBeLessThan(3);
    expect(Math.abs(c2.w - customer.w)).toBeLessThan(0.002);
    expect(now.text).toMatch(/lane customer [0-9.]+/);
    // the rows under it moved down with the divider, still edge to edge
    const s2 = now.nodes.find((n) => n.id === "sales")!;
    expect(Math.abs((s2.y - sales.y) - (c2.h - customer.h))).toBeLessThan(0.01);
    expect(Math.abs(s2.y - s2.h / 2 - (c2.y + c2.h / 2))).toBeLessThan(0.002);
    const insideOwnRow = (st: typeof now): void => {
      for (const n of st.nodes.filter((x) => x.parent)) {
        const lane = st.nodes.find((x) => x.id === n.parent)!;
        expect(Math.abs(n.x - lane.x) <= lane.w / 2 && Math.abs(n.y - lane.y) <= lane.h / 2, `${n.id} in ${lane.id}`).toBe(true);
      }
      for (const e of st.edges) {
        for (const [p, id] of [[e.points[0], e.from], [e.points[e.points.length - 1], e.to]] as const) {
          const n = st.nodes.find((x) => x.id === id)!;
          expect(Math.abs(p[0] - n.x) <= n.w / 2 + 0.09 && Math.abs(p[1] - n.y) <= n.h / 2 + 0.09, `${e.from}->${e.to} on ${id}`).toBe(true);
        }
      }
    };
    insideOwnRow(now);
    // move "cancel order" from Sales down into Warehouse, to a free spot at the row's far end
    const cancel = await box(page, "cancel");
    const wh = now.nodes.find((n) => n.id === "warehouse")!;
    const inWarehouse = now.nodes.filter((n) => n.parent === "warehouse");
    const free = Math.max(...inWarehouse.map((n) => n.x + n.w / 2)) + 1.1;
    const target = await toPage(page, [Math.min(free, wh.x + wh.w / 2 - 0.9), wh.y]);
    await drag(page, [cancel.cx, cancel.cy], target);
    await expect(status(page)).toContainText("cancel order is now in Warehouse");
    now = await inspect(page);
    expect(now.nodes.find((n) => n.id === "cancel")!.parent).toBe("warehouse");
    expect(now.text).toMatch(/partition warehouse "Warehouse" \{[^}]*action cancel "cancel order"/);
    expect(now.text).toContain("lanes horizontal");
    insideOwnRow(now);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).nodes.find((n) => n.id === "cancel")!.parent).toBe("sales");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await getText(page)).toBe(ROWS);
    await page.screenshot({ path: "test-results/draw-rows-edited.png" });
  });
});

test.describe("build-up steps and undo from the panel", () => {
  const STEPPED = ksdOf("activity-parallel");

  test("a shape's step is set in the panel: one step line before it, the old step back after it, nothing else in the text touched", async ({ page }) => {
    await openTool(page, STEPPED, "draw");
    await clickNode(page, "laptop");
    const step = field(page, "step");
    await expect(step).toBeVisible();
    await expect(step).toHaveValue("1");
    await step.fill("2");
    await step.press("Enter");
    await expect(status(page)).toContainText("shows from step 2");
    expect(await getText(page)).toBe(STEPPED.replace('action laptop "order laptop"\n', 'step 2\naction laptop "order laptop"\nstep 1\n'));
    await expect(field(page, "step")).toHaveValue("2");
    // not a whole number: refused, said, and the field goes back
    await field(page, "step").fill("1.5");
    await field(page, "step").press("Enter");
    await expect(status(page)).toContainText("a step is a whole number");
    await expect(field(page, "step")).toHaveValue("2");
    // several at once, shapes and lines together: the whole of step 1 joins step 2 and one step line is left
    await canvas(page).focus();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(field(page, "step")).toHaveValue("");
    await field(page, "step").fill("2");
    await field(page, "step").press("Enter");
    const text = await getText(page);
    expect(text.match(/^step \d+$/gm)).toEqual(["step 2"]);
    const st = await inspect(page);
    expect(st.valid).toBe(true);
    expect(st.nodes.length).toBe(8);
  });

  test("undo and redo keys work after a click in the properties panel, and a field being typed in keeps them for itself", async ({ page }) => {
    await openTool(page, ACTIVITY, "draw");
    // a button that goes away with the shape it deleted
    await clickNode(page, "pay");
    await page.locator('.draw-inspector [data-field="act:delete"]').click();
    expect((await inspect(page)).nodes.some((n) => n.id === "pay")).toBe(false);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(status(page)).toContainText("undone");
    expect(await getText(page)).toBe(ACTIVITY);
    await page.keyboard.press("ControlOrMeta+y");
    expect((await inspect(page)).nodes.some((n) => n.id === "pay")).toBe(false);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await getText(page)).toBe(ACTIVITY);
    // a choice in the panel, with the focus left on it
    await clickNode(page, "review");
    await field(page, "node:style:weight").evaluate((el) => { (el.closest("details") as HTMLDetailsElement).open = true; });
    await field(page, "node:style:weight").selectOption("bold");
    await expect.poll(() => getText(page)).toContain("style review weight bold");
    await field(page, "node:style:weight").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => getText(page)).toBe(ACTIVITY);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => getText(page)).toContain("style review weight bold");
    // in a text field the keys are the field's own: the drawing does not change
    await field(page, "node:label").click();
    await page.keyboard.press("End");
    await page.keyboard.type("s");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await getText(page)).toContain("style review weight bold");
  });
});
