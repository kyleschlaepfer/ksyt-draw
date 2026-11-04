/**
 * "download SVG": the standalone variant with light and dark colors inlined and Kalam embedded
 * (SIL OFL permits embedding). The font data arrives as lazy data-URL chunks, which the embed's
 * CSP allows where fetch would not.
 */
import type { Scene } from "../core/scene";
import { sceneToSvg } from "../core/svg";

let fonts: Partial<Record<300 | 400, string>> | null = null;

async function loadFontData(): Promise<Partial<Record<300 | 400, string>>> {
  if (fonts) return fonts;
  const strip = (dataUrl: string) => dataUrl.replace(/^data:[^,]*,/, "");
  const [f400, f300] = await Promise.all([
    import("@fontsource/kalam/files/kalam-latin-400-normal.woff2?inline"),
    import("@fontsource/kalam/files/kalam-latin-300-normal.woff2?inline"),
  ]);
  fonts = { 400: strip(f400.default), 300: strip(f300.default) };
  return fonts;
}

export async function standaloneSvg(sc: Scene): Promise<string> {
  const data = await loadFontData();
  return sceneToSvg(sc, { standalone: true, fonts: data, idPrefix: sc.id || "fig" });
}

export async function downloadSvg(sc: Scene): Promise<void> {
  const text = await standaloneSvg(sc);
  const blob = new Blob([text], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sc.id || "diagram"}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
