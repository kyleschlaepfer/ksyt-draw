/**
 * Font data for exports, as base64 woff2. Both families are SIL OFL, which permits embedding. Each
 * file is a lazy data-URL chunk (the embed's CSP allows that where fetch would not), loaded on the
 * first export that needs it. The extended-Latin subset is only added when the text uses it.
 */
import type { FontFile } from "../core/render/svg";
import type { Scene } from "../core/render/scene";

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

type Loader = () => Promise<{ default: string }>;
const FILES: Record<string, { latin: Loader; ext: Loader }> = {
  "hand-300": {
    latin: () => import("@fontsource/kalam/files/kalam-latin-300-normal.woff2?inline"),
    ext: () => import("@fontsource/kalam/files/kalam-latin-ext-300-normal.woff2?inline"),
  },
  "hand-400": {
    latin: () => import("@fontsource/kalam/files/kalam-latin-400-normal.woff2?inline"),
    ext: () => import("@fontsource/kalam/files/kalam-latin-ext-400-normal.woff2?inline"),
  },
  "body-400": {
    latin: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2?inline"),
    ext: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-400-normal.woff2?inline"),
  },
  "body-700": {
    latin: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2?inline"),
    ext: () => import("@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-700-normal.woff2?inline"),
  },
};

const cache = new Map<string, string>();
const strip = (dataUrl: string): string => dataUrl.replace(/^data:[^,]*,/, "");

async function load(key: string, which: "latin" | "ext"): Promise<string> {
  const k = `${key}/${which}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const data = strip((await FILES[key][which]()).default);
  cache.set(k, data);
  return data;
}

/** Does the text use characters outside the basic Latin subset the fonts ship first? */
export function beyondLatin(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0xff || c === 0x131 || c === 0x152 || c === 0x153 || (c >= 0x2000 && c <= 0x206f) || c === 0x20ac || c === 0x2122) continue;
    return true;
  }
  return false;
}

/** The font files this scene's text needs, keyed for portableSvg. */
export async function fontsFor(sc: Scene): Promise<Record<string, FontFile[]>> {
  const out: Record<string, FontFile[]> = {};
  const keys = new Set(sc.texts.map((t) => `${t.family}-${t.weight}`));
  await Promise.all([...keys].filter((k) => FILES[k]).map(async (key) => {
    const [family, weight] = key.split("-");
    const needsExt = sc.texts.some((t) => t.family === family && String(t.weight) === weight && beyondLatin(t.s));
    const files: FontFile[] = [{ data: await load(key, "latin"), range: LATIN }];
    if (needsExt) files.push({ data: await load(key, "ext"), range: LATIN_EXT });
    out[key] = files;
  }));
  return out;
}
