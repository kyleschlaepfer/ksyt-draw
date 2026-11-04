/** Browser text measuring with the real Kalam on a canvas, and the font loading that must come first. */
import type { Measurer, Metrics } from "../core/measure";

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, Metrics>();

export const canvasMeasurer: Measurer = {
  measure(text, px, weight) {
    const key = `${weight}|${px}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return { adv: 0.55 * px * text.length, top: -0.75 * px, bot: 0.25 * px };
    ctx.font = `${weight} ${px}px Kalam, sans-serif`;
    const m = ctx.measureText(text);
    const out: Metrics = { adv: m.width, top: -m.actualBoundingBoxAscent, bot: m.actualBoundingBoxDescent };
    cache.set(key, out);
    return out;
  },
};

export interface FontStatus { ok: boolean; missing: string[] }

/** Load Kalam 400 and 300 (and the body font) before anything is measured. Never silently lay out with a fallback. */
export async function loadFonts(): Promise<FontStatus> {
  const want = ["400 22px Kalam", "300 20px Kalam"];
  const missing: string[] = [];
  try {
    await Promise.all([...want, "400 18px 'Atkinson Hyperlegible Next'"].map((f) => document.fonts.load(f)));
  } catch {
    // fall through: check() below reports what is missing
  }
  for (const f of want) if (!document.fonts.check(f)) missing.push(f);
  cache.clear();
  return { ok: missing.length === 0, missing };
}
