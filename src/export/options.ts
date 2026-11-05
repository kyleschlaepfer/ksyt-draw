/** What an export can be asked for. The defaults give a file that drops straight into a slide or a report. */
import type { Look } from "../core/doc/types";
import type { Backdrop } from "../core/render/svg";

export type ExportFormat = "svg" | "png" | "pdf";
export type PagePreset = "fit" | "letter" | "a4" | "slide";

export interface ExportOptions {
  look: Look;
  theme: "light" | "dark";
  backdrop: Backdrop;
  /** space around the ink, inches */
  padding: number;
  /** svg: write the letters as shapes, so the file looks the same in programs that ignore its fonts */
  outlineText?: boolean;
  /** png: output pixels per CSS pixel (96 px per inch) */
  scale?: number;
  /** pdf: the page, and which way up */
  page?: PagePreset;
  orientation?: "portrait" | "landscape";
}

export const PADDING: Record<"tight" | "normal" | "roomy", number> = { tight: 0.1, normal: 0.25, roomy: 0.5 };
export const DEFAULTS: ExportOptions = { look: "sketch", theme: "light", backdrop: "white", padding: PADDING.normal, scale: 2, page: "fit", orientation: "landscape" };

/** Page sizes in inches, portrait (the slide is 16:9 at PowerPoint's 13.333 x 7.5). */
export const PAGES: Record<Exclude<PagePreset, "fit">, [number, number]> = { letter: [8.5, 11], a4: [8.27, 11.69], slide: [7.5, 13.333] };
