import { test, expect } from "@playwright/test";
import { embedUrl, fixtureNames, ksdOf, labelSizes, layoutCheckText } from "./helpers";

const EXPECTED: Record<string, string> = {
  "flow-approval": "pass", "flow-unlabeled": "needs changes", "activity-fork-either": "needs changes", "activity-parallel": "pass",
  "usecase-permit": "pass", "usecase-include-reversed": "needs changes", "usecase-is-flow": "blocked",
  "usecase-actor-inside": "needs changes", dangling: "needs changes",
};

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} at 1280`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    for (const name of fixtureNames) {
      test(`${name} renders with zero QA errors`, async ({ page }) => {
        await page.goto(embedUrl({ d: ksdOf(name), id: name, qa: true }));
        await expect(page.locator("svg.ksyt-fig")).toBeVisible();
        await expect(page.locator(".lint h2").first()).toHaveText(`notation check: ${EXPECTED[name]}`);
        expect(await layoutCheckText(page)).toBe("layout check: pass");
        const rows = await page.locator(".lint ul").nth(1).locator("li .sev").allTextContents();
        expect(rows.filter((r) => r === "error")).toEqual([]);
        // the house look: Kalam text, charcoal on off-white or chalk on chalkboard
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(theme === "dark" ? "rgb(30, 37, 33)" : "rgb(250, 250, 246)");
        const font = await page.evaluate(() => getComputedStyle(document.querySelector("svg.ksyt-fig text")!).fontFamily);
        expect(font).toMatch(/Kalam/);
        expect(await page.evaluate(() => document.fonts.check("400 22px Kalam"))).toBe(true);
        const ink = await page.evaluate(() => getComputedStyle(document.querySelector("svg.ksyt-fig .k-ink")!).fill);
        expect(ink).toBe(theme === "dark" ? "rgb(236, 234, 226)" : "rgb(36, 43, 39)");
        await page.screenshot({ path: `test-results/${name}-${theme}-1280.png`, fullPage: true });
      });
    }
  });
}

test.describe("phone at 375", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  for (const name of fixtureNames) {
    test(`${name} keeps labels at 13 px or more`, async ({ page }) => {
      await page.goto(embedUrl({ d: ksdOf(name), id: name, qa: true }));
      await expect(page.locator("svg.ksyt-fig")).toBeVisible();
      const sizes = await labelSizes(page);
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(13);
      await page.screenshot({ path: `test-results/${name}-light-375.png`, fullPage: true });
    });
  }
  test("a right-running flow switches to top-down", async ({ page }) => {
    const wide = [
      "diagram flowchart", "id wide", "title A long chain reads top-down on a phone", "direction right",
      "start s", "process a \"receive the request\"", "process b \"check the paperwork\"", "process c \"schedule the inspection\"",
      "process d \"issue the permit\"", "end e", "s -> a", "a -> b", "b -> c", "c -> d", "d -> e",
    ].join("\n");
    await page.goto(embedUrl({ d: wide, id: "wide", qa: true }));
    const box = await page.locator("svg.ksyt-fig").boundingBox();
    expect(box!.height).toBeGreaterThan(box!.width);
    for (const s of await labelSizes(page)) expect(s).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: "test-results/wide-phone-375.png", fullPage: true });
  });
  test("the same flow runs left to right on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const wide = "diagram flowchart\nid wide\ntitle t\ndirection right\nstart s\nprocess a \"receive the request\"\nprocess b \"check the paperwork\"\nend e\ns -> a\na -> b\nb -> e";
    await page.goto(embedUrl({ d: wide, id: "wide" }));
    const box = await page.locator("svg.ksyt-fig").boundingBox();
    expect(box!.width).toBeGreaterThan(box!.height);
  });
});

test.describe("dark at 375", () => {
  test.use({ viewport: { width: 375, height: 800 }, colorScheme: "dark" });
  for (const name of fixtureNames) {
    test(`${name} screenshot`, async ({ page }) => {
      await page.goto(embedUrl({ d: ksdOf(name), id: name }));
      await expect(page.locator("svg.ksyt-fig")).toBeVisible();
      await page.screenshot({ path: `test-results/${name}-dark-375.png`, fullPage: true });
    });
  }
});
