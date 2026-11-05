/**
 * The fonts as WOFF bytes, for the writers that need real font data (PDF embedding, text outlines).
 * Each file is a lazy chunk, loaded the first time an export needs it. Both families are SIL OFL.
 */
type Loader = () => Promise<{ default: string }>;
export const WOFF: Record<string, { latin: Loader; ext: Loader }> = {
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

export function bytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cache = new Map<string, Uint8Array>();

/** One font file's bytes; an unknown key falls back to the handwriting at regular weight. */
export async function woffBytes(key: string, which: "latin" | "ext"): Promise<Uint8Array> {
  const id = `${key}/${which}`;
  let b = cache.get(id);
  if (!b) {
    b = bytes((await (WOFF[key] ?? WOFF["hand-400"])[which]()).default);
    cache.set(id, b);
  }
  return b;
}
