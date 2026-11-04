/**
 * Scene -> SVG string (spec/rendering.md §7): a port of figure.Figure.svg. Colors are roles, never hex,
 * except in the standalone download where the light and dark values are inlined. Every string that
 * came from the diagram is escaped here.
 */
import { BG, CH, DKG, GR, GREEN, TERRA, WASH, type Poly } from "./pen";
import { PX } from "./measure";
import type { Scene } from "./scene";
import type { Role } from "./shapes";

export const ROLE: Record<string, Role> = {
  [CH]: "ink", [GR]: "ink-2", [GREEN]: "accent", [DKG]: "accent-strong", [WASH]: "wash", [TERRA]: "terra", [BG]: "page",
};

// Must match reference/ksyt.css.
export const LIGHT: Record<Role, string> = {
  ink: "#242B27", "ink-2": "#606A63", accent: "#256B4A", "accent-strong": "#184C36", wash: "#DCEBDF", terra: "#C77859", page: "#FAFAF6",
};
export const DARK: Record<Role, string> = {
  ink: "#ECEAE2", "ink-2": "#A9B2AB", accent: "#7CC39A", "accent-strong": "#A8DCBD", wash: "#2B4536", terra: "#E3A086", page: "#1E2521",
};

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

function pathOf(polys: Poly[]): string {
  let out = "";
  for (const p of polys) out += "M" + p.map(([x, y]) => `${f1(x * PX)} ${f1(y * PX)}`).join(" L") + "Z";
  return out;
}

export interface SvgOptions {
  idPrefix?: string;
  /** standalone: inline role colors for light and dark, plus embedded fonts */
  standalone?: boolean;
  /** base64 woff2 by weight, for the standalone variant */
  fonts?: Partial<Record<300 | 400, string>>;
}

export function sceneToSvg(sc: Scene, o: SvgOptions = {}): string {
  const W = sc.w * PX, H = sc.h * PX;
  const pre = o.idPrefix ?? "fig";
  const tid = `${pre}-t`, did = `${pre}-d`;
  const lab = `aria-labelledby="${tid}${sc.desc ? " " + did : ""}"`;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" width="${Math.round(W)}" height="${Math.round(H)}" role="img" ${lab} class="ksyt-fig">`,
    `<title id="${tid}">${esc(sc.title)}</title>`,
  ];
  if (sc.desc) out.push(`<desc id="${did}">${esc(sc.desc)}</desc>`);
  if (o.standalone) out.push("<style>" + standaloneStyle(sc, o.fonts ?? {}) + "</style>");
  for (const el of sc.elements) {
    const groups = new Map<Role, Poly[]>();
    for (const [poly, color] of el.sketch.items) {
      const r = ROLE[color] ?? "ink";
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(poly);
    }
    out.push(`<g data-name="${esc(el.name)}"${el.step ? ` data-step="${el.step}"` : ""}>`);
    for (const [r, polys] of groups) out.push(`<path class="k-${r}" d="${pathOf(polys)}"/>`);
    out.push("</g>");
  }
  for (const t of sc.texts) {
    const anchor = t.anchor === "start" ? "" : ` text-anchor="${t.anchor}"`;
    const wt = t.weight === 400 ? "" : ` font-weight="${t.weight}"`;
    const st = t.step ? ` data-step="${t.step}"` : "";
    out.push(`<text class="k-hand k-${t.role}" data-name="${esc(t.name)}"${st} x="${f1(t.x * PX)}" y="${f1(t.y * PX)}" font-size="${t.size}"${anchor}${wt}>${esc(t.s)}</text>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

function standaloneStyle(sc: Scene, fonts: Partial<Record<300 | 400, string>>): string {
  const css: string[] = [];
  const weights = [...new Set(sc.texts.map((t) => t.weight))].sort();
  for (const wt of weights) {
    const data = fonts[wt];
    if (data) css.push(`@font-face{font-family:Kalam;font-weight:${wt};src:url(data:font/woff2;base64,${data}) format('woff2')}`);
  }
  css.push("text.k-hand{font-family:Kalam,'Atkinson Hyperlegible Next',sans-serif}");
  for (const [r, v] of Object.entries(LIGHT)) css.push(`.k-${r}{fill:var(--${r},${v})}`);
  css.push("@media (prefers-color-scheme:dark){" + Object.entries(DARK).map(([r, v]) => `.k-${r}{fill:var(--${r},${v})}`).join("") + "}");
  return css.join("");
}
