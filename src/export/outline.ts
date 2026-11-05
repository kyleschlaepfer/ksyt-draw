/**
 * Text as shapes: every label turned into the outlines of its letters, in the real fonts.
 *
 * An SVG file can carry its fonts, but only browsers read them. Slide and document programs and most
 * drawing tools ignore an embedded web font and set the text in whatever they have, which is wider
 * or narrower than the handwriting and spills out of the shapes. Outlines look the same everywhere.
 * The price is that the letters are no longer text: they can't be searched, selected or retyped.
 *
 * The font kit is large, so this module is only loaded when outlines are asked for.
 */
import fontkit, { type Font } from "@pdf-lib/fontkit";
import type { Scene, TextEl } from "../core/render/scene";
import { PX } from "../core/measure";
import { beyondLatin } from "./fonts";
import { woffBytes } from "./woff";

interface Command { command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath"; args: number[] }
const LETTER: Record<Command["command"], string> = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C", closePath: "Z" };

const fonts = new Map<string, Font>();
async function font(key: string, which: "latin" | "ext"): Promise<Font> {
  const id = `${key}/${which}`;
  let f = fonts.get(id);
  if (!f) {
    f = fontkit.create(await woffBytes(key, which));
    fonts.set(id, f);
  }
  return f;
}

const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/** One label's letters as SVG path data, in px in the scene's frame. */
async function outline(t: TextEl): Promise<string> {
  const key = `${t.family}-${t.weight}`;
  // runs of basic and extended Latin are set in the file that has their glyphs
  const runs: Array<{ s: string; ext: boolean }> = [];
  for (const ch of t.s) {
    const ext = beyondLatin(ch);
    const last = runs[runs.length - 1];
    if (last && last.ext === ext) last.s += ch; else runs.push({ s: ch, ext });
  }
  const set: Array<{ k: number; glyphs: Array<{ commands: Command[]; x: number; y: number }>; w: number }> = [];
  for (const r of runs) {
    const f = await font(key, r.ext ? "ext" : "latin");
    const k = t.size / f.unitsPerEm;
    const run = f.layout(r.s);
    let pen = 0;
    const glyphs = run.glyphs.map((g, i) => {
      const pos = run.positions[i];
      const at = { commands: (g.path as unknown as { commands: Command[] }).commands, x: pen + pos.xOffset, y: pos.yOffset };
      pen += pos.xAdvance;
      return at;
    });
    set.push({ k, glyphs, w: pen * k });
  }
  const total = set.reduce((a, r) => a + r.w, 0);
  const x0 = t.x * PX - (t.anchor === "middle" ? total / 2 : t.anchor === "end" ? total : 0), y0 = t.y * PX;
  const d: string[] = [];
  let x = x0;
  for (const r of set) {
    for (const g of r.glyphs) {
      for (const c of g.commands) {
        // font units run upward from the baseline; the page runs downward
        const a = c.args.map((v, i) => n2(i % 2 === 0 ? x + (g.x + v) * r.k : y0 - (g.y + v) * r.k));
        d.push(LETTER[c.command] + a.join(" "));
      }
    }
    x += r.w;
  }
  if (t.underline && total > 0) {
    const y = y0 + t.size * 0.12, h = Math.max(0.7, t.size * 0.06);
    d.push(`M${n2(x0)} ${n2(y - h / 2)}L${n2(x0 + total)} ${n2(y - h / 2)}L${n2(x0 + total)} ${n2(y + h / 2)}L${n2(x0)} ${n2(y + h / 2)}Z`);
  }
  return d.join("");
}

/** Path data for every text in the scene, in the scene's order. */
export async function outlineTexts(sc: Scene): Promise<string[]> {
  return Promise.all(sc.texts.map(outline));
}
