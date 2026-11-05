/**
 * PDF export: true vector, drawn straight from the export scene (not a picture of the screen). Ink is
 * paths, text is real text in the embedded fonts (selectable, searchable, sharp at any size).
 *
 * pdf-lib and its font kit are large, so this module is only loaded when a PDF is asked for. Fonts
 * are the WOFF files the page already ships (SIL OFL permits embedding), subset to the glyphs used.
 */
import { PDFDocument, LineCapStyle, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ChalkDoc } from "../core/doc/types";
import type { Measurer } from "../core/measure";
import type { Paint, Role, Scene, TextEl } from "../core/render/scene";
import { exportPalette } from "../core/render/svg";
import { beyondLatin } from "./fonts";
import { PAGES, type ExportOptions } from "./options";
import { exportScene } from "./svg";

type Loader = () => Promise<{ default: string }>;
const WOFF: Record<string, { latin: Loader; ext: Loader }> = {
  "hand-300": {
    latin: () => import("@fontsource/kalam/files/kalam-latin-300-normal.woff?inline"),
    ext: () => import("@fontsource/kalam/files/kalam-latin-ext-300-normal.woff?inline"),
  },
  "hand-400": {
    latin: () => import("@fontsource/kalam/files/kalam-latin-400-normal.woff?inline"),
    ext: () => import("@fontsource/kalam/files/kalam-latin-ext-400-normal.woff?inline"),
  },
  "body-400": {
    latin: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff?inline"),
    ext: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-400-normal.woff?inline"),
  },
  "body-700": {
    latin: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff?inline"),
    ext: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-700-normal.woff?inline"),
  },
};

function bytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (c: string): RGB => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

export interface PdfResult { blob: Blob; pageIn: [number, number]; scale: number }

/** The page (inches) and the scale that fits the scene on it; "fit" makes the page the size of the diagram. */
export function pageFor(sc: Scene, o: Pick<ExportOptions, "page" | "orientation">): { w: number; h: number; scale: number; dx: number; dy: number } {
  if (!o.page || o.page === "fit") return { w: sc.w, h: sc.h, scale: 1, dx: 0, dy: 0 };
  const [a, b] = PAGES[o.page];
  const landscape = o.orientation === "landscape";
  const w = landscape ? Math.max(a, b) : Math.min(a, b), h = landscape ? Math.min(a, b) : Math.max(a, b);
  const margin = 0.5;
  // never stretched and never enlarged past its natural size: a small diagram stays small on a big page
  const scale = Math.min(1, (w - 2 * margin) / sc.w, (h - 2 * margin) / sc.h);
  return { w, h, scale, dx: (w - sc.w * scale) / 2, dy: (h - sc.h * scale) / 2 };
}

export async function exportPdf(d: ChalkDoc, m: Measurer, o: ExportOptions): Promise<PdfResult> {
  const { scene } = exportScene(d, m, o);
  const pal = exportPalette(o.theme, o.backdrop);
  const pg = pageFor(scene, o);
  const PT = 72;
  const k = pg.scale * PT;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(scene.title);
  pdf.setSubject(scene.desc);
  pdf.setCreator("Chalk (draw.kyleschlaepfer.com)");
  pdf.setProducer("Chalk");
  const page = pdf.addPage([pg.w * PT, pg.h * PT]);
  const X = (x: number): number => (pg.dx + x * pg.scale) * PT;
  const Y = (y: number): number => (pg.h - pg.dy - y * pg.scale) * PT;

  if (o.backdrop !== "transparent") {
    // on a preset page the backdrop covers the diagram's own frame, not the whole sheet
    page.drawRectangle({ x: X(0), y: Y(scene.h), width: scene.w * k, height: scene.h * k, color: hex(pal.page) });
  }
  for (const el of scene.elements) for (const p of el.paints) drawPaint(page, p, pal, X, Y, k);

  const fonts = new Map<string, PDFFont>();
  const font = async (key: string, which: "latin" | "ext"): Promise<PDFFont> => {
    const id = `${key}/${which}`;
    let f = fonts.get(id);
    if (!f) {
      const src = WOFF[key] ?? WOFF["hand-400"];
      f = await pdf.embedFont(bytes((await src[which]()).default), { subset: true });
      fonts.set(id, f);
    }
    return f;
  };
  for (const t of scene.texts) await drawText(page, t, pal, X, Y, pg.scale, font);

  const data = await pdf.save();
  return { blob: new Blob([data as BlobPart], { type: "application/pdf" }), pageIn: [pg.w, pg.h], scale: pg.scale };
}

function svgPath(pts: Array<[number, number]>, closed: boolean, r: number, k: number): string {
  // pdf-lib draws SVG path data in a y-down space scaled by us; coordinates here are inches * k
  const f = (v: number): string => (v * k).toFixed(2);
  const n = pts.length;
  if (!r || n < 3) return "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L") + (closed ? " Z" : "");
  const corner = (i: number): { a: [number, number]; c: [number, number]; b: [number, number] } => {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const kk = Math.min(r, l1 / 2, l2 / 2);
    return { a: [c[0] + ((p[0] - c[0]) / l1) * kk, c[1] + ((p[1] - c[1]) / l1) * kk], c, b: [c[0] + ((q[0] - c[0]) / l2) * kk, c[1] + ((q[1] - c[1]) / l2) * kk] };
  };
  if (closed) {
    let d = `M${f(corner(0).b[0])} ${f(corner(0).b[1])}`;
    for (let i = 1; i <= n; i++) {
      const c = corner(i % n);
      d += ` L${f(c.a[0])} ${f(c.a[1])} Q${f(c.c[0])} ${f(c.c[1])} ${f(c.b[0])} ${f(c.b[1])}`;
    }
    return d + " Z";
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const c = corner(i);
    d += ` L${f(c.a[0])} ${f(c.a[1])} Q${f(c.c[0])} ${f(c.c[1])} ${f(c.b[0])} ${f(c.b[1])}`;
  }
  return d + ` L${f(pts[n - 1][0])} ${f(pts[n - 1][1])}`;
}

function drawPaint(page: PDFPage, p: Paint, pal: Record<Role, string>, X: (x: number) => number, Y: (y: number) => number, k: number): void {
  // the path's own coordinates are measured from the scene's top-left corner, y down
  const origin = { x: X(0), y: Y(0) };
  if (p.t === "poly") {
    page.drawSvgPath(svgPath(p.pts, true, 0, k), { ...origin, color: hex(pal[p.fill]), borderWidth: 0 });
  } else if (p.t === "line") {
    page.drawSvgPath(svgPath(p.pts, !!p.closed, p.r ?? 0, k), {
      ...origin, ...(p.fill ? { color: hex(pal[p.fill]) } : {}), borderColor: hex(pal[p.stroke]), borderWidth: p.sw * k,
      borderLineCap: LineCapStyle.Round, ...(p.dash ? { borderDashArray: [p.dash[0] * k, p.dash[1] * k] } : {}),
    });
  } else {
    page.drawEllipse({
      x: X(p.cx), y: Y(p.cy), xScale: p.rx * k, yScale: p.ry * k, ...(p.fill ? { color: hex(pal[p.fill]) } : {}),
      ...(p.stroke && p.sw ? { borderColor: hex(pal[p.stroke]), borderWidth: p.sw * k } : {}),
    });
  }
}

async function drawText(page: PDFPage, t: TextEl, pal: Record<Role, string>, X: (x: number) => number, Y: (y: number) => number, scale: number,
  font: (key: string, which: "latin" | "ext") => Promise<PDFFont>): Promise<void> {
  const key = `${t.family}-${t.weight}`;
  const size = t.size * 0.75 * scale; // CSS px to points
  // runs of basic and extended Latin are set in the subset that has their glyphs
  const runs: Array<{ s: string; ext: boolean }> = [];
  for (const ch of t.s) {
    const ext = beyondLatin(ch);
    const last = runs[runs.length - 1];
    if (last && last.ext === ext) last.s += ch; else runs.push({ s: ch, ext });
  }
  const set: Array<{ s: string; f: PDFFont; w: number }> = [];
  for (const r of runs) {
    const f = await font(key, r.ext ? "ext" : "latin");
    let s = r.s;
    // a glyph neither subset has would stop the export: leave that character out rather than fail
    const have = new Set(f.getCharacterSet());
    s = [...s].filter((ch) => have.has(ch.codePointAt(0)!)).join("");
    if (s) set.push({ s, f, w: f.widthOfTextAtSize(s, size) });
  }
  const total = set.reduce((a, r) => a + r.w, 0);
  let x = X(t.x) - (t.anchor === "middle" ? total / 2 : t.anchor === "end" ? total : 0);
  const y = Y(t.y);
  for (const r of set) {
    page.drawText(r.s, { x, y, size, font: r.f, color: hex(pal[t.role]) });
    x += r.w;
  }
  if (t.underline && total > 0) {
    const x0 = X(t.x) - (t.anchor === "middle" ? total / 2 : t.anchor === "end" ? total : 0);
    page.drawLine({ start: { x: x0, y: y - size * 0.12 }, end: { x: x0 + total, y: y - size * 0.12 }, thickness: Math.max(0.5, size * 0.06), color: hex(pal[t.role]) });
  }
}
