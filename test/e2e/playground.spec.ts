import { test, expect } from "@playwright/test";
import { ksdOf } from "./helpers";
import { parseHash } from "../../src/core/state";

test.describe("playground", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __copied: string[] }).__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => { (window as unknown as { __copied: string[] }).__copied.push(t); } },
      });
    });
  });

  test("starts with the example, typing updates the preview and the hash", async ({ page }) => {
    await page.goto("/");
    const ta = page.locator("textarea#ksd");
    await expect(ta).toHaveValue(/diagram use-case/);
    await expect(page.locator("#preview svg.ksyt-fig")).toBeVisible();
    await expect(page.locator("#preview svg title")).toContainText("Residents apply and track");
    await ta.fill(ksdOf("flow-approval"));
    await expect(page.locator("#preview svg title")).toHaveText("After review, a request takes exactly one of two paths");
    await expect(page.locator(".lint h2").first()).toHaveText("notation check: pass");
    await expect(page.locator(".lint h2").nth(1)).toHaveText("layout check: pass");
    const hash = await page.evaluate(() => location.hash);
    expect(parseHash(hash).d).toBe(ksdOf("flow-approval"));
    await page.screenshot({ path: "test-results/playground-1280.png", fullPage: true });
  });

  test("a parse error shows its line, then clears", async ({ page }) => {
    await page.goto("/");
    const ta = page.locator("textarea#ksd");
    await ta.fill("diagram flowchart\ntitle t\nprocess a\nprocess a");
    await expect(page.locator("#preview .error-card p")).toContainText("line 4:");
    await expect(page.locator("#preview .error-card code")).toHaveText("duplicate id 'a'");
    await expect(page.locator(".play-status")).toContainText("line 4: duplicate id 'a'");
    await ta.fill("diagram flowchart\ntitle t\nprocess a\nprocess b\na -> b");
    await expect(page.locator("#preview svg.ksyt-fig")).toBeVisible();
    expect(await page.locator("#preview .error-card").count()).toBe(0);
  });

  test("copy embed code gives an iframe whose src reproduces the diagram; copy link and site line work", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea#ksd").fill(ksdOf("usecase-permit"));
    await expect(page.locator("#preview svg title")).toContainText("Residents apply");
    await page.getByRole("button", { name: "copy embed code" }).click();
    await expect(page.locator(".play-status")).toHaveText("copied the embed code");
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    const snippet = copied[0];
    expect(snippet).toMatch(/^<iframe\n/);
    expect(snippet).toContain('class="ksyt-draw-frame"');
    expect(snippet).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"');
    expect(snippet).toContain('title="Use-case diagram: Residents apply and track; paying the fee is always part of applying"');
    const src = /src="([^"]+)"/.exec(snippet)![1].replace(/&amp;/g, "&");
    const url = new URL(src);
    expect(url.pathname).toBe("/embed/");
    const st = parseHash(url.hash);
    expect(st.d).toBe(ksdOf("usecase-permit"));
    expect(st.id).toBe("permit-portal");
    await page.goto(src);
    await expect(page.locator("svg title")).toContainText("Residents apply and track");

    await page.goto("/");
    await page.locator("textarea#ksd").fill(ksdOf("usecase-permit"));
    await page.getByRole("button", { name: "copy link" }).click();
    const link = (await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))[0];
    expect(parseHash(new URL(link).hash).d).toBe(ksdOf("usecase-permit"));
    await page.getByRole("button", { name: "copy for the site" }).click();
    const line = (await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))[1];
    expect(line).toContain('import permitPortal from "../../diagrams/permit-portal.ksd?raw";');
    expect(line).toContain('<DiagramEmbed ksd={permitPortal} caption="Residents apply and track; paying the fee is always part of applying" />');
  });

  test("hostile text in the playground renders literally", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    await page.goto("/");
    await page.locator("textarea#ksd").fill('diagram flowchart\ntitle <img src=x onerror=alert(1)>\nprocess a "<b>bold</b>"\nprocess b\na -> b');
    await expect(page.locator("#preview svg.ksyt-fig")).toBeVisible();
    await expect(page.locator('#preview svg text[data-name="a:label"]')).toHaveText("<b>bold</b>");
    expect(await page.locator("#preview img, #preview b").count()).toBe(0);
    expect(dialogs).toBe(0);
  });

  test("stacks on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await expect(page.locator("#preview svg.ksyt-fig")).toBeVisible();
    const ta = await page.locator("textarea#ksd").boundingBox();
    const pv = await page.locator("#preview").boundingBox();
    expect(pv!.y).toBeGreaterThan(ta!.y + ta!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/playground-375.png", fullPage: true });
  });
});
