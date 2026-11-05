/**
 * PNG export: the same self-contained SVG the vector export writes, rasterized by the browser at the
 * asked scale. The fonts are embedded in that SVG, so the pixels never depend on what is installed.
 */
import type { ChalkDoc } from "../core/doc/types";
import type { Measurer } from "../core/measure";
import { PX } from "../core/measure";
import { portableSvg } from "../core/render/svg";
import { fontsFor } from "./fonts";
import type { ExportOptions } from "./options";
import { exportScene } from "./svg";

/** Canvases above this many pixels fail silently in some browsers. */
export const MAX_PIXELS = 16_000_000;

export interface PngResult { blob: Blob; width: number; height: number; scale: number }

/** Draw an SVG file's text onto a canvas of the given pixel size. */
export async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  // a data URL (not a blob URL) so the page's CSP `img-src data:` covers it everywhere
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error("the picture could not be drawn"));
    img.src = url;
  });
  await img.decode().catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser can't make a picture here");
  ctx.imageSmoothingQuality = "high";
  // fonts embedded in an SVG image can take a frame to apply; draw, wait, draw again
  ctx.drawImage(img, 0, 0, width, height);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

export async function exportPng(d: ChalkDoc, m: Measurer, o: ExportOptions): Promise<PngResult> {
  const { scene } = exportScene(d, m, o);
  const w = scene.w * PX, h = scene.h * PX;
  let scale = o.scale ?? 2;
  if (w * h * scale * scale > MAX_PIXELS) scale = Math.max(1, Math.floor(Math.sqrt(MAX_PIXELS / (w * h)) * 10) / 10);
  const width = Math.round(w * scale), height = Math.round(h * scale);
  const svg = portableSvg(scene, { theme: o.theme, backdrop: o.backdrop, fonts: await fontsFor(scene), width, height });
  const canvas = await rasterize(svg, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("this browser can't make a PNG here");
  return { blob, width, height, scale };
}
