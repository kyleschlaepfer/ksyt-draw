/**
 * Text measuring (spec/rendering.md §2). The browser measures with a canvas and the real Kalam;
 * tests use the fixed-width stub. Sizes are CSS px; `top` is negative (ink above the baseline).
 */
export interface Metrics { adv: number; top: number; bot: number }

export interface Measurer {
  measure(text: string, px: number, weight: number): Metrics;
}

/** adv = 0.55 * px * chars, top = -0.75 * px, bot = 0.25 * px. */
export const stubMeasurer: Measurer = {
  measure(text, px) {
    return { adv: 0.55 * px * [...text].length, top: -0.75 * px, bot: 0.25 * px };
  },
};

export const PX = 96;

/** Width and height of a (possibly multi-line) label in inches. */
export function textBlock(m: Measurer, text: string, px: number, weight = 400): { tw: number; th: number; lines: string[] } {
  const lines = text.split("\n");
  const tw = Math.max(...lines.map((ln) => m.measure(ln, px, weight).adv)) / PX;
  return { tw, th: (lines.length * px * 1.25) / PX, lines };
}
