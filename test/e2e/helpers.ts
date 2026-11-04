import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { buildHash, type HashInput } from "../../src/core/state";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "..", "..", "fixtures", "diagrams");
export const fixtureNames = readdirSync(FIXTURES).filter((f) => f.endsWith(".ksd")).map((f) => f.replace(/\.ksd$/, "")).sort();
export const ksdOf = (name: string): string => readFileSync(join(FIXTURES, name + ".ksd"), "utf8");

export const embedUrl = (input: HashInput): string => "/embed/#" + buildHash(input);

/** The host pages served by test/e2e/host-server.mjs on a second loopback origin. */
export const HOST_ORIGIN = "http://localhost:4174";
export const hostPageUrl = (frames: Array<{ id: string; src: string; title: string }>): string =>
  `${HOST_ORIGIN}/host?f=${encodeURIComponent(JSON.stringify(frames))}`;
export const barePageUrl = (src: string): string => `${HOST_ORIGIN}/bare?src=${encodeURIComponent(src)}`;
/** The embed as the host pages see it: the preview server on its own origin. */
export const EMBED_ORIGIN = "http://localhost:4173";

/** Every label's rendered size in CSS px, from the SVG's on-screen scale. */
export async function labelSizes(page: Page, selector = "svg.ksyt-fig"): Promise<number[]> {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel) as SVGSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    return Array.from(svg.querySelectorAll("text")).map((t) => parseFloat(t.getAttribute("font-size") || "0") * scale);
  }, selector);
}

export async function layoutCheckText(page: Page): Promise<string> {
  const h = page.locator(".lint h2").nth(1);
  return (await h.textContent()) ?? "";
}
