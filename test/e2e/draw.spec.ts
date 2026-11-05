import { test, expect, type Page } from "@playwright/test";
import { buildHash, parseHash } from "../../src/core/state";

const text = (page: Page) => page.locator("textarea#ksd").inputValue();
const hashText = (page: Page) => page.evaluate(() => location.hash).then((h) => parseHash(h).d ?? "");

test.describe("draw tab", () => {
  test("start over makes a flowchart from the dropdown, shapes are added and named, and the text follows", async ({ page }) => {
    await page.goto("/#tab=draw");
    await expect(page.locator(".draw-canvas svg.ksyt-fig")).toBeVisible();
    await page.locator("#draw-type").selectOption("flowchart");
    await page.getByRole("button", { name: "start over" }).click();
    expect(await hashText(page)).toContain("diagram flowchart");
    await expect(page.locator(".draw-canvas svg [data-name='begin']")).toBeVisible();
    // click a palette shape: it's added and selected, its text field is ready
    await page.locator(".draw-shape[data-kind='process']").click();
    await expect(page.locator("#draw-node-label")).toBeVisible();
    await page.locator("#draw-node-label").fill("review the request");
    await expect(page.locator(".draw-canvas svg text[data-name='process1:label']")).toHaveText("review the request");
    expect(await hashText(page)).toContain('process process1 "review the request"');
    // a decision too
    await page.locator(".draw-shape[data-kind='decision']").click();
    await page.locator("#draw-node-label").fill("approved?");
    expect(await hashText(page)).toContain('decision decision1 "approved?"');
    // the write tab shows the same text
    await page.getByRole("tab", { name: "write" }).click();
    await expect(page.locator("textarea#ksd")).toHaveValue(/decision decision1 "approved\?"/);
    await expect(page.locator("#preview svg text[data-name='decision1:label']")).toHaveText("approved?");
  });

  test("connecting two shapes adds an edge line, labels it, and deleting removes it", async ({ page }) => {
    await page.goto("/#tab=draw");
    await page.locator("#draw-type").selectOption("flowchart");
    await page.getByRole("button", { name: "start over" }).click();
    await page.locator(".draw-shape[data-kind='process']").click();
    await page.getByRole("button", { name: "connect two shapes" }).click();
    await expect(page.locator(".draw-main .play-status")).toHaveText("click the first shape");
    await page.locator(".draw-canvas svg [data-name='begin']").click({ force: true });
    await page.locator(".draw-canvas svg [data-name='process1']").click({ force: true });
    expect(await hashText(page)).toContain("begin -> process1");
    await expect(page.locator("#draw-edge-label")).toBeVisible();
    await page.locator("#draw-edge-label").fill("yes");
    expect(await hashText(page)).toContain("begin -> process1 : yes");
    await expect(page.locator(".draw-canvas svg text[data-name='e2:label']")).toHaveText("yes");
    await page.locator("#draw-edge-op").selectOption("..>");
    expect(await hashText(page)).toContain("begin ..> process1 : yes");
    await page.getByRole("button", { name: "delete" }).click();
    expect(await hashText(page)).not.toContain("begin ..> process1");
    expect(await page.locator(".draw-canvas svg [data-name='e2']").count()).toBe(0);
  });

  test("dragging a shape pins it with an `at` line and the picture holds still", async ({ page }) => {
    await page.goto("/#tab=draw");
    await expect(page.locator(".draw-canvas svg.ksyt-fig")).toBeVisible();
    const before = await hashText(page);
    expect(before).not.toContain(" at ");
    const node = page.locator(".draw-canvas svg [data-name='track']");
    const b = await node.boundingBox();
    const others = page.locator(".draw-canvas svg [data-name='apply']");
    const applyBefore = await others.boundingBox();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width / 2 + 60, b!.y + b!.height / 2 + 120, { steps: 8 });
    await page.mouse.up();
    const after = await hashText(page);
    expect(after).toMatch(/use-case track "track status" at [-0-9.]+ [-0-9.]+/);
    // every other shape got pinned where it was, so nothing else jumped
    expect(after).toMatch(/use-case apply "apply for permit" at /);
    const applyAfter = await others.boundingBox();
    expect(Math.abs(applyAfter!.x - applyBefore!.x)).toBeLessThan(8);
    const b2 = await node.boundingBox();
    expect(b2!.y).toBeGreaterThan(b!.y + 80);
    // arrow keys nudge, undo takes it back
    await page.locator(".draw-canvas").focus();
    await page.keyboard.press("ArrowRight");
    const nudged = await hashText(page);
    expect(nudged).not.toBe(after);
    await page.getByRole("button", { name: "undo" }).click();
    expect(await hashText(page)).toBe(after);
    await page.screenshot({ path: "test-results/draw-after-drag.png", fullPage: false });
  });

  test("dropping a palette shape onto the drawing places it there", async ({ page }) => {
    await page.goto("/#tab=draw");
    await expect(page.locator(".draw-canvas svg.ksyt-fig")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator(".draw-shape[data-kind='note']").scrollIntoViewIfNeeded();
    const shape = await page.locator(".draw-shape[data-kind='note']").boundingBox();
    const canvas = await page.locator(".draw-canvas").boundingBox();
    await page.mouse.move(shape!.x + 10, shape!.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + canvas!.width - 120, canvas!.y + canvas!.height - 80, { steps: 6 });
    await expect(page.locator(".draw-ghost")).toBeVisible();
    await page.mouse.up();
    expect(await hashText(page)).toMatch(/note note1 "note 1" at [-0-9.]+ [-0-9.]+/);
    const placed = await page.locator(".draw-canvas svg text[data-name='note1:label']").boundingBox();
    expect(placed!.x).toBeGreaterThan(canvas!.x + canvas!.width / 2);
  });

  test("a use case joins the boundary, can be moved outside, and ids can be renamed", async ({ page }) => {
    await page.goto("/#tab=draw");
    await page.locator(".draw-shape[data-kind='use-case']").click();
    let t = await hashText(page);
    expect(t).toMatch(/boundary portal "Permit portal" \{[\s\S]*use-case usecase1 "use case 1"[\s\S]*\}/);
    await page.locator("#draw-node-inside").selectOption("");
    t = await hashText(page);
    expect(t).toMatch(/\}[\s\S]*use-case usecase1 "use case 1"/);
    await page.locator("#draw-node-id").fill("renew");
    await page.locator("#draw-node-id").press("Enter");
    expect(await hashText(page)).toContain('use-case renew "use case 1"');
    await page.locator("#draw-node-id").fill("not valid!");
    await page.locator("#draw-node-id").press("Enter");
    await expect(page.locator(".draw-main .play-status")).toContainText("an id is a letter");
  });

  test("a parse error on the write tab blocks the draw tab with a message, not a crash", async ({ page }) => {
    await page.goto("/#" + buildHash({ d: "diagram flowchart\ntitle t\nwidget w" }) + "&tab=draw");
    await expect(page.locator(".draw-canvas .error-card")).toContainText("Fix it on the write tab first");
    await expect(page.locator(".draw-canvas .error-card code")).toHaveText("unknown kind 'widget'");
  });

  test("the title and type edits write back, and the write tab's preview follows", async ({ page }) => {
    await page.goto("/#tab=draw");
    await page.locator("#draw-title").fill("Who talks to the permit portal");
    expect(await hashText(page)).toContain("title Who talks to the permit portal");
    await page.getByRole("tab", { name: "write" }).click();
    await expect(page.locator("#preview svg title")).toHaveText("Who talks to the permit portal");
    await page.getByRole("tab", { name: "draw" }).click();
    await page.locator("#draw-type").selectOption("activity");
    expect(await hashText(page)).toContain("diagram activity");
    await expect(page.locator(".draw-main .play-status")).toContainText("activity diagram");
    expect(await page.locator(".draw-shape[data-kind='fork']").count()).toBe(1);
  });
});
