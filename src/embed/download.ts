/**
 * "download SVG" on the embed and the write view: a self-contained file in the look and theme on
 * screen, with a solid page background and the fonts embedded (SIL OFL permits embedding). The font
 * data arrives as lazy data-URL chunks, which the embed's CSP allows where fetch would not.
 */
import type { ChalkDoc, Look } from "../core/doc/types";
import { exportSvg } from "../export/svg";
import { saveBlob } from "../export/save";
import { canvasMeasurer } from "./measure-dom";

export async function downloadSvg(d: ChalkDoc, look: Look, themeAttr: string | null): Promise<void> {
  const dark = themeAttr === "dark" || (themeAttr !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const text = await exportSvg(d, canvasMeasurer, { look, theme: dark ? "dark" : "light", backdrop: "page", padding: 0.25 });
  saveBlob(new Blob([text], { type: "image/svg+xml" }), `${d.meta.id || "diagram"}.svg`);
}
