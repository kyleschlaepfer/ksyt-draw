import { test, expect } from "@playwright/test";
import { embedUrl, ksdOf } from "./helpers";

test.describe("build-up steps", () => {
  test("activity-parallel starts at step 1 of 3, reveals the fork, shows all, and takes arrow keys", async ({ page }) => {
    await page.goto(embedUrl({ d: ksdOf("activity-parallel"), id: "onboarding" }));
    const svg = page.locator("svg.ksyt-fig");
    await expect(svg).toBeVisible();
    const status = page.locator(".phase-status");
    await expect(status).toHaveText("step 1 of 3");
    const fork = svg.locator('[data-name="split"]');
    const join = svg.locator('[data-name="wait"]');
    await expect(fork).toHaveClass(/is-hidden/);
    await expect(fork).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("button", { name: "back" })).toBeDisabled();
    await page.getByRole("button", { name: "next step" }).click();
    await expect(status).toHaveText("step 2 of 3");
    await expect(fork).not.toHaveClass(/is-hidden/);
    await expect(fork).not.toHaveAttribute("aria-hidden");
    await expect(join).toHaveClass(/is-hidden/);
    await page.getByRole("button", { name: "show all" }).click();
    await expect(status).toHaveText("step 3 of 3");
    await expect(join).not.toHaveClass(/is-hidden/);
    expect(await svg.locator(".is-hidden").count()).toBe(0);
    await expect(page.getByRole("button", { name: "next step" })).toBeDisabled();
    await page.locator("figure.fig").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(status).toHaveText("step 2 of 3");
    await page.keyboard.press("ArrowLeft");
    await expect(status).toHaveText("step 1 of 3");
    await page.keyboard.press("ArrowRight");
    await expect(status).toHaveText("step 2 of 3");
    await page.screenshot({ path: "test-results/activity-parallel-step2.png", fullPage: true });
  });
  test("step=all in the hash shows everything; a diagram without steps has no controls", async ({ page }) => {
    await page.goto(embedUrl({ d: ksdOf("activity-parallel"), step: "all" }));
    await expect(page.locator(".phase-status")).toHaveText("step 3 of 3");
    await page.goto(embedUrl({ d: ksdOf("flow-approval") }));
    await expect(page.locator("svg.ksyt-fig")).toBeVisible();
    expect(await page.locator(".phase-controls").count()).toBe(0);
  });
});

test.describe("lint panel", () => {
  test("usecase-is-flow with lint=1 shows blocked and the rule id", async ({ page }) => {
    await page.goto(embedUrl({ d: ksdOf("usecase-is-flow"), lint: true }));
    await expect(page.locator(".lint h2").first()).toHaveText("notation check: blocked");
    const row = page.locator(".lint li").first();
    await expect(row.locator(".sev")).toHaveText("critical");
    await expect(row.locator(".rule")).toHaveText("FAMILY-USECASE-IS-FLOW");
    await expect(page.locator(".lint-foot")).toHaveText("checked as uml-inspired");
    // the diagram still draws
    await expect(page.locator("svg.ksyt-fig")).toBeVisible();
    await page.screenshot({ path: "test-results/usecase-is-flow-lint.png", fullPage: true });
  });
  test("lint=0 hides the panel; tools=0 hides the footer", async ({ page }) => {
    await page.goto(embedUrl({ d: ksdOf("usecase-is-flow"), tools: false }));
    await expect(page.locator("svg.ksyt-fig")).toBeVisible();
    expect(await page.locator(".lint").count()).toBe(0);
    expect(await page.locator(".embed-foot").count()).toBe(0);
    await expect(page.locator("details summary")).toHaveText("describe this figure");
  });
});

test.describe("errors and safety", () => {
  test("a missing diagram shows a plain error card", async ({ page }) => {
    await page.goto("/embed/#v=1");
    await expect(page.locator(".error-card h2")).toHaveText("This link doesn't contain a diagram.");
    await page.goto("/embed/#v=1&d=not-a-diagram");
    await expect(page.locator(".error-card h2")).toHaveText("This link doesn't contain a diagram.");
  });
  test("a parse error shows its line", async ({ page }) => {
    await page.goto(embedUrl({ d: "diagram flowchart\ntitle t\nwidget a" }));
    await expect(page.locator(".error-card p")).toContainText("line 3:");
    await expect(page.locator(".error-card code")).toHaveText("unknown kind 'widget'");
  });
  test("hostile labels render literally and open no dialog", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    const evil = "<img src=x onerror=alert(1)>";
    const ksd = `diagram flowchart\nid xss\ntitle ${evil}\ndesc ${evil}\nstart s\nprocess a "${evil}"\nend e\ns -> a : ${evil}\na -> e\nnote n "${evil}"`;
    await page.goto(embedUrl({ d: ksd, qa: true, lint: true }));
    await expect(page.locator("svg.ksyt-fig")).toBeVisible();
    await page.waitForTimeout(300);
    expect(dialogs).toBe(0);
    expect(await page.locator("img").count()).toBe(0);
    await expect(page.locator('svg text[data-name="a:label"]')).toHaveText(evil);
    await expect(page.locator("svg title")).toHaveText(evil);
    expect(await page.title()).toBe(evil);
    await page.locator("details summary").click();
    await expect(page.locator("details li").nth(1)).toHaveText(evil);
    const html = await page.content();
    expect(html).not.toContain("<img src=x");
  });
  test("download SVG produces a standalone file with Kalam embedded", async ({ page }) => {
    await page.goto(embedUrl({ d: ksdOf("flow-approval") }));
    await expect(page.locator("svg.ksyt-fig")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "download SVG" }).click()]);
    expect(download.suggestedFilename()).toBe("approval.svg");
    const path = await download.path();
    const text = (await import("node:fs")).readFileSync(path!, "utf8");
    expect(text).toContain("@font-face{font-family:'Kalam';font-weight:400;src:url(data:font/woff2;base64,");
    // v2: the file no longer changes with the viewer's theme or needs the page's stylesheet
    expect(text).not.toContain("prefers-color-scheme");
    expect(text).not.toContain("var(");
    expect(text).not.toContain("class=");
    expect(text).toMatch(/<rect width="[0-9]+" height="[0-9]+" fill="#FAFAF6"\/>/);
    expect(text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });
});
