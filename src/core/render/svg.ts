/**
 * Scene -> SVG string. Two writers over the same scene:
 *
 *   sceneToSvg     for the page: colors are theme roles (CSS classes), so light and dark follow the
 *                  site's tokens. Nothing in it works without the page's stylesheet.
 *   portableSvg    for export: a self-contained file. Every color is a plain attribute for the theme
 *                  the author chose (no CSS variables, no media queries, nothing that changes with the
 *                  viewer's settings), the background is explicit, the fonts are embedded when given
 *                  and backed by a fallback stack and textLength so text keeps its measured width
 *                  in tools that ignore embedded fonts.
 *
 * Every string that came from the diagram is escaped here.
 */
import { PX } from "../measure";
import type { Element, Paint, Role, Scene, TextEl } from "./scene";

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

const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const f2 = (v: number): string => String(Math.round(v * 100) / 100);
const P = (v: number): string => f1(v * PX);

/** Path data for a polyline or polygon, with corners rounded to radius r (inches) when asked. */
export function linePath(pts: Array<[number, number]>, closed: boolean, r = 0): string {
  const n = pts.length;
  if (!r || n < 3) return "M" + pts.map(([x, y]) => `${P(x)} ${P(y)}`).join(" L") + (closed ? "Z" : "");
  const corner = (i: number): { a: [number, number]; c: [number, number]; b: [number, number] } => {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const k = Math.min(r, l1 / 2, l2 / 2);
    return { a: [c[0] + ((p[0] - c[0]) / l1) * k, c[1] + ((p[1] - c[1]) / l1) * k], c, b: [c[0] + ((q[0] - c[0]) / l2) * k, c[1] + ((q[1] - c[1]) / l2) * k] };
  };
  let d = "";
  if (closed) {
    const first = corner(0);
    d = `M${P(first.b[0])} ${P(first.b[1])}`;
    for (let i = 1; i <= n; i++) {
      const k = corner(i % n);
      d += ` L${P(k.a[0])} ${P(k.a[1])} Q${P(k.c[0])} ${P(k.c[1])} ${P(k.b[0])} ${P(k.b[1])}`;
    }
    return d + "Z";
  }
  d = `M${P(pts[0][0])} ${P(pts[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const k = corner(i);
    d += ` L${P(k.a[0])} ${P(k.a[1])} Q${P(k.c[0])} ${P(k.c[1])} ${P(k.b[0])} ${P(k.b[1])}`;
  }
  return d + ` L${P(pts[n - 1][0])} ${P(pts[n - 1][1])}`;
}

type Color = (role: Role, how: "fill" | "stroke") => string;

function paintsToSvg(paints: Paint[], color: Color): string[] {
  const out: string[] = [];
  let run: { role: Role; d: string } | null = null;
  const flush = (): void => { if (run) { out.push(`<path ${color(run.role, "fill")} d="${run.d}"/>`); run = null; } };
  for (const p of paints) {
    if (p.t === "poly") {
      // consecutive polygons of one color share a path (a pen stroke is several)
      const d = "M" + p.pts.map(([x, y]) => `${P(x)} ${P(y)}`).join(" L") + "Z";
      if (run && run.role === p.fill) run.d += d;
      else { flush(); run = { role: p.fill, d }; }
      continue;
    }
    flush();
    if (p.t === "line") {
      const fill = p.fill ? color(p.fill, "fill") : 'fill="none"';
      const dash = p.dash ? ` stroke-dasharray="${f1(p.dash[0] * PX)} ${f1(p.dash[1] * PX)}"` : "";
      out.push(`<path ${fill} ${color(p.stroke, "stroke")} stroke-width="${f2(p.sw * PX)}" stroke-linecap="round" stroke-linejoin="round"${dash} d="${linePath(p.pts, !!p.closed, p.r ?? 0)}"/>`);
    } else {
      const fill = p.fill ? color(p.fill, "fill") : 'fill="none"';
      const stroke = p.stroke && p.sw ? ` ${color(p.stroke, "stroke")} stroke-width="${f2(p.sw * PX)}"` : "";
      out.push(`<ellipse ${fill}${stroke} cx="${P(p.cx)}" cy="${P(p.cy)}" rx="${P(p.rx)}" ry="${P(p.ry)}"/>`);
    }
  }
  flush();
  return out;
}

export interface SvgOptions {
  idPrefix?: string;
}

/** The figure for the page: role classes, `data-name` and `data-step` on every part. */
export function sceneToSvg(sc: Scene, o: SvgOptions = {}): string {
  const W = sc.w * PX, H = sc.h * PX;
  const pre = o.idPrefix ?? "fig";
  const tid = `${pre}-t`, did = `${pre}-d`;
  const lab = `aria-labelledby="${tid}${sc.desc ? " " + did : ""}"`;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" width="${Math.round(W)}" height="${Math.round(H)}" role="img" ${lab} class="ksyt-fig ksyt-${sc.look}">`,
    `<title id="${tid}">${esc(sc.title)}</title>`,
  ];
  if (sc.desc) out.push(`<desc id="${did}">${esc(sc.desc)}</desc>`);
  for (const el of sc.elements) out.push(elementMarkup(el));
  for (const t of sc.texts) out.push(textMarkup(t));
  out.push("</svg>");
  return out.join("\n");
}

// one class attribute per part: k-<role> fills, ks-<role> strokes
const classColor: Color = (role, how) => `class="${how === "fill" ? "k" : "ks"}-${role}"`;
const mergeClasses = (s: string): string => s.replace(/class="(k-[a-z0-9-]+)" class="(ks-[a-z0-9-]+)"/, 'class="$1 $2"');

/** One element as page markup (role classes). The draw canvas builds and patches its picture from these. */
export function elementMarkup(el: Element): string {
  return `<g data-name="${esc(el.name)}" data-kind="${el.kind}"${el.step ? ` data-step="${el.step}"` : ""}>` +
    paintsToSvg(el.paints, classColor).map(mergeClasses).join("") + "</g>";
}

export function textMarkup(t: TextEl): string {
  return textTag(t, `class="${t.family === "hand" ? "k-hand" : "k-body"} k-${t.role}" data-name="${esc(t.name)}"${t.step ? ` data-step="${t.step}"` : ""}`, false);
}

function textTag(t: TextEl, attrs: string, portable: boolean): string {
  const anchor = t.anchor === "start" ? "" : ` text-anchor="${t.anchor}"`;
  const wt = t.weight === 400 ? "" : ` font-weight="${t.weight}"`;
  const deco = t.underline ? ' text-decoration="underline"' : "";
  const len = portable && t.adv > 0 ? ` textLength="${f1(t.adv)}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text ${attrs} x="${P(t.x)}" y="${P(t.y)}" font-size="${t.size}"${anchor}${wt}${deco}${len}>${esc(t.s)}</text>`;
}

export type Backdrop = "page" | "white" | "transparent";
export interface FontFile { data: string; range?: string }

export interface PortableOptions {
  theme?: "light" | "dark";
  backdrop?: Backdrop;
  /** base64 woff2 files by "family-weight" key (hand-300, hand-400, body-400, body-700), each with its unicode-range when it is a subset */
  fonts?: Partial<Record<string, FontFile[]>>;
  idPrefix?: string;
  /** output size in px; default is the scene's natural size at 96 px per inch */
  width?: number;
  height?: number;
}

export const FONT_STACK: Record<"hand" | "body", string> = {
  hand: "Kalam, 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
  body: "'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', Verdana, 'Segoe UI', Arial, sans-serif",
};
const FONT_NAME: Record<"hand" | "body", string> = { hand: "Kalam", body: "Atkinson Hyperlegible Next" };

/** The color every role resolves to in an export. With a white backdrop, the "page" fills are white too. */
export function exportPalette(theme: "light" | "dark", backdrop: Backdrop): Record<Role, string> {
  const base = theme === "dark" ? DARK : LIGHT;
  return backdrop === "white" ? { ...base, page: "#FFFFFF" } : base;
}

/** A self-contained SVG file. Build the scene with `knockouts: false` for a transparent backdrop. */
export function portableSvg(sc: Scene, o: PortableOptions = {}): string {
  const theme = o.theme ?? "light", backdrop = o.backdrop ?? "page";
  const pal = exportPalette(theme, backdrop);
  const W = Math.round(sc.w * PX), H = Math.round(sc.h * PX);
  const pre = o.idPrefix ?? (sc.id || "fig");
  const tid = `${pre}-t`, did = `${pre}-d`;
  const color: Color = (role, how) => `${how}="${pal[role]}"`;
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${o.width ?? W}" height="${o.height ?? H}" role="img" aria-labelledby="${tid}${sc.desc ? " " + did : ""}">`,
    `<title id="${tid}">${esc(sc.title)}</title>`,
  ];
  if (sc.desc) out.push(`<desc id="${did}">${esc(sc.desc)}</desc>`);
  const css: string[] = [];
  const used = new Set(sc.texts.map((t) => `${t.family}-${t.weight}`));
  for (const key of [...used].sort()) {
    const [family, weight] = key.split("-") as ["hand" | "body", string];
    for (const file of o.fonts?.[key] ?? []) {
      css.push(`@font-face{font-family:'${FONT_NAME[family]}';font-weight:${weight};src:url(data:font/woff2;base64,${file.data}) format('woff2')${file.range ? `;unicode-range:${file.range}` : ""}}`);
    }
  }
  if (css.length) out.push(`<style>${css.join("")}</style>`);
  if (backdrop !== "transparent") out.push(`<rect width="${W}" height="${H}" fill="${pal.page}"/>`);
  for (const el of sc.elements) {
    out.push(`<g id="${esc(pre)}-${esc(el.name)}">`);
    out.push(...paintsToSvg(el.paints, color));
    out.push("</g>");
  }
  for (const t of sc.texts) out.push(textTag(t, `font-family="${FONT_STACK[t.family]}" fill="${pal[t.role]}"`, true));
  out.push("</svg>");
  return out.join("\n");
}
