import { test, expect, type Page } from "@playwright/test";
import { EMBED_ORIGIN, barePageUrl, embedUrl, hostPageUrl, ksdOf } from "./helpers";

const BASE = EMBED_ORIGIN;

async function messages(page: Page): Promise<Array<{ origin: string; data: Record<string, unknown> }>> {
  return page.evaluate(() => (window as unknown as { __messages: Array<{ origin: string; data: Record<string, unknown> }> }).__messages);
}

async function framesWith(page: Page) {
  await page.goto(hostPageUrl([
    { id: "f1", src: BASE + embedUrl({ d: ksdOf("usecase-permit"), id: "permit-portal" }), title: "Use-case diagram: permits" },
    { id: "f2", src: BASE + embedUrl({ d: ksdOf("activity-parallel"), id: "onboarding", lint: true }), title: "Activity diagram: onboarding" },
  ]));
  const f1 = page.frameLocator("#f1"), f2 = page.frameLocator("#f2");
  await expect(f1.locator("svg.ksyt-fig")).toBeVisible();
  await expect(f2.locator("svg.ksyt-fig")).toBeVisible();
  return { f1, f2 };
}

test.describe("host page with two embeds", () => {
  test("ready arrives with the right id and resize sets the iframe height", async ({ page }) => {
    await framesWith(page);
    await expect.poll(async () => (await messages(page)).filter((m) => m.data.type === "ready").map((m) => m.data.id).sort())
      .toEqual(["onboarding", "permit-portal"]);
    for (const m of await messages(page)) {
      expect(m.origin).toBe(BASE);
      expect(m.data.source).toBe("ksyt-draw");
      expect(m.data.v).toBe(1);
    }
    const ready = (await messages(page)).find((m) => m.data.id === "onboarding" && m.data.type === "ready")!.data;
    expect(ready.steps).toBe(2);
    expect(ready.step).toBe(0);
    expect(ready.title).toBe("A new hire's laptop and badge are prepared at the same time");
    const lintMsg = (await messages(page)).find((m) => m.data.id === "onboarding" && m.data.type === "lint")!.data;
    expect(lintMsg.status).toBe("pass");
    // no inner scrollbar: the iframe is as tall as its document
    for (const id of ["f1", "f2"]) {
      await expect.poll(() => page.evaluate((id) => {
        const f = document.getElementById(id) as HTMLIFrameElement;
        return parseFloat(f.style.height) >= 200;
      }, id)).toBe(true);
      const fits = await page.evaluate((id) => {
        const f = document.getElementById(id) as HTMLIFrameElement;
        const doc = f.contentWindow!.document.documentElement;
        return parseFloat(f.style.height) + 0.5 >= doc.scrollHeight && f.clientHeight + 0.5 >= doc.scrollHeight;
      }, id).catch(() => null);
      // cross-origin frames can't be inspected from the host; check from inside instead
      if (fits !== null) expect(fits).toBe(true);
    }
    const inner = await page.frameLocator("#f2").locator("html").evaluate((h) => ({ scroll: h.scrollHeight, client: h.clientHeight }));
    expect(inner.scroll).toBeLessThanOrEqual(inner.client + 1);
    await page.screenshot({ path: "test-results/host-two-embeds.png", fullPage: true });
  });

  test("theme follows the host: dark switches the embed background and back", async ({ page }) => {
    const { f1 } = await framesWith(page);
    const bg = () => f1.locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(await bg()).toBe("rgb(250, 250, 246)");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect.poll(bg).toBe("rgb(30, 37, 33)");
    await expect(f1.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expect.poll(bg).toBe("rgb(250, 250, 246)");
    await page.screenshot({ path: "test-results/host-theme-light.png", fullPage: true });
  });

  test("step messages go both ways", async ({ page }) => {
    const { f2 } = await framesWith(page);
    await f2.getByRole("button", { name: "next step" }).click();
    await expect.poll(async () => (await messages(page)).filter((m) => m.data.type === "step" && m.data.id === "onboarding").map((m) => m.data.step))
      .toEqual([1]);
    await page.evaluate(() => {
      const f = document.getElementById("f2") as HTMLIFrameElement;
      f.contentWindow!.postMessage({ source: "ksyt-draw-host", v: 1, type: "step", step: "all" }, "*");
    });
    await expect(f2.locator(".phase-status")).toHaveText("step 3 of 3");
    await expect.poll(async () => (await messages(page)).filter((m) => m.data.type === "step" && m.data.id === "onboarding").map((m) => m.data.step))
      .toEqual([1, 2]);
  });

  test("messages from a wrong source are ignored on both sides", async ({ page }) => {
    const { f2 } = await framesWith(page);
    // host side: a message that is not from one of its frames does not touch the iframe
    const before = await page.evaluate(() => (document.getElementById("f2") as HTMLIFrameElement).style.height);
    await page.evaluate(() => window.postMessage({ source: "ksyt-draw", v: 1, id: "onboarding", type: "resize", height: 9999 }, "*"));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (document.getElementById("f2") as HTMLIFrameElement).style.height)).toBe(before);
    // embed side: a step message from a sibling frame (not the parent) is ignored
    await page.evaluate(() => {
      const s = document.createElement("iframe");
      s.id = "sibling";
      s.srcdoc = "<script>parent.frames[1].postMessage({ source: 'ksyt-draw-host', v: 1, type: 'step', step: 'all' }, '*');</script>";
      document.body.appendChild(s);
    });
    await page.waitForTimeout(400);
    await expect(f2.locator(".phase-status")).toHaveText("step 1 of 3");
    // and one from the parent with the wrong shape is ignored too
    await page.evaluate(() => {
      const f = document.getElementById("f2") as HTMLIFrameElement;
      f.contentWindow!.postMessage({ source: "ksyt-draw-host", v: 1, type: "step", step: { nope: true } }, "*");
      f.contentWindow!.postMessage({ source: "someone-else", v: 1, type: "step", step: "all" }, "*");
      f.contentWindow!.postMessage({ source: "ksyt-draw-host", v: 2, type: "step", step: "all" }, "*");
    });
    await page.waitForTimeout(300);
    await expect(f2.locator(".phase-status")).toHaveText("step 1 of 3");
  });

  test("load replaces the diagram through the same path", async ({ page }) => {
    const { f1 } = await framesWith(page);
    await page.evaluate((ksd) => {
      const f = document.getElementById("f1") as HTMLIFrameElement;
      f.contentWindow!.postMessage({ source: "ksyt-draw-host", v: 1, type: "load", ksd }, "*");
    }, ksdOf("flow-approval"));
    await expect(f1.locator("svg title")).toHaveText("After review, a request takes exactly one of two paths");
    await expect.poll(async () => (await messages(page)).filter((m) => m.data.type === "ready" && m.data.id === "permit-portal").length).toBe(2);
  });

  test("works as a bare iframe on a plain page without the host script", async ({ page }) => {
    await page.goto(barePageUrl(BASE + embedUrl({ d: ksdOf("flow-approval"), id: "bare" })));
    const f = page.frameLocator("#bare");
    await expect(f.locator("svg.ksyt-fig")).toBeVisible();
    await expect(f.locator("details summary")).toHaveText("describe this figure");
    expect(await page.evaluate(() => (document.getElementById("bare") as HTMLIFrameElement).style.height)).toBe("600px");
    await page.screenshot({ path: "test-results/host-bare-iframe.png", fullPage: true });
  });
});
