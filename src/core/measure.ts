/**
 * Text measuring (spec/rendering.md §2). The browser measures with a canvas and the real fonts;
 * tests use the fixed-width stub. Sizes are CSS px; `top` is negative (ink above the baseline).
 *
 * Geometry is always sized with the handwriting font, so a diagram has the same shapes in the sketch
 * and precision looks; the precision look sets its text in the prose font at PRECISION_SCALE, which
 * is narrower than the handwriting at full size, so it always fits.
 */
export interface Metrics { adv: number; top: number; bot: number }
export type FontFamily = "hand" | "body";

export interface Measurer {
  measure(text: string, px: number, weight: number, family?: FontFamily): Metrics;
}

/** adv = 0.55 * px * chars, top = -0.75 * px, bot = 0.25 * px. */
export const stubMeasurer: Measurer = {
  measure(text, px) {
    return { adv: 0.55 * px * [...text].length, top: -0.75 * px, bot: 0.25 * px };
  },
};

export const PX = 96;
export const NODE_PX = 22;
export const SMALL_PX = 20;
/** Atkinson Hyperlegible Next at this fraction of the handwriting size is never wider than it. */
export const PRECISION_SCALE = 0.86;
export const LINE = 1.25;

/** Width and height of a (possibly multi-line) label in inches. */
export function textBlock(m: Measurer, text: string, px: number, weight = 400): { tw: number; th: number; lines: string[] } {
  const lines = text.split("\n");
  const tw = Math.max(...lines.map((ln) => m.measure(ln, px, weight).adv)) / PX;
  return { tw, th: (lines.length * px * LINE) / PX, lines };
}

/** Break a label's lines at spaces so none is wider than `maxIn` inches (a single long word stays whole). */
export function wrapText(m: Measurer, text: string, px: number, weight: number, maxIn: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/ +/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (cur && m.measure(next, px, weight).adv / PX > maxIn) { out.push(cur); cur = w; }
      else cur = next;
    }
    out.push(cur);
  }
  return out;
}
