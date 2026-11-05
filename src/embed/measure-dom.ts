/** Browser text measuring with the real fonts on a canvas, and the font loading that must come first. */
import type { FontFamily, Measurer, Metrics } from "../core/measure";

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, Metrics>();
const FAMILY: Record<FontFamily, string> = { hand: "Kalam, sans-serif", body: "'Atkinson Hyperlegible Next', sans-serif" };

export const canvasMeasurer: Measurer = {
  measure(text, px, weight, family = "hand") {
    const key = `${family}|${weight}|${px}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return { adv: 0.55 * px * text.length, top: -0.75 * px, bot: 0.25 * px };
    ctx.font = `${weight} ${px}px ${FAMILY[family]}`;
    const m = ctx.measureText(text);
    const out: Metrics = { adv: m.width, top: -m.actualBoundingBoxAscent, bot: m.actualBoundingBoxDescent };
    cache.set(key, out);
    return out;
  },
};

export interface FontStatus { ok: boolean; missing: string[] }

/** Load the handwriting and prose fonts before anything is measured. Never silently lay out with a fallback. */
export async function loadFonts(): Promise<FontStatus> {
  const want = ["400 22px Kalam", "300 20px Kalam"];
  const also = ["400 18px 'Atkinson Hyperlegible Next'", "700 18px 'Atkinson Hyperlegible Next'"];
  const missing: string[] = [];
  try {
    await Promise.all([...want, ...also].map((f) => document.fonts.load(f)));
  } catch {
    // fall through: check() below reports what is missing
  }
  for (const f of want) if (!document.fonts.check(f)) missing.push(f);
  cache.clear();
  return { ok: missing.length === 0, missing };
}
