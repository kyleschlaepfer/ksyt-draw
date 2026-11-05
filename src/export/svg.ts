/**
 * The export pipeline's first stages, shared by every format:
 *
 *   document -> resolved geometry -> export scene (look, padding, backdrop) -> checked
 *
 * The scene is built for the file, not copied from the screen: no selection, grid or handle can be in
 * it, because they never existed here.
 */
import type { ChalkDoc } from "../core/doc/types";
import type { Measurer } from "../core/measure";
import { resolve } from "../core/geom/resolve";
import { buildScene, type Scene } from "../core/render/scene";
import { portableSvg } from "../core/render/svg";
import { checkScene, type QaReport } from "../core/qa";
import { fontsFor } from "./fonts";
import type { ExportOptions } from "./options";

export interface ExportScene { scene: Scene; qa: QaReport }

export function exportScene(d: ChalkDoc, m: Measurer, o: Pick<ExportOptions, "look" | "padding" | "backdrop">): ExportScene {
  const geometry = resolve(d, m);
  const scene = buildScene(d, geometry, m, { look: o.look, margin: o.padding, knockouts: o.backdrop !== "transparent" });
  return { scene, qa: checkScene(scene, { minDisplayPx: 2000 }) };
}

/** A self-contained SVG file as text. */
export async function exportSvg(d: ChalkDoc, m: Measurer, o: Pick<ExportOptions, "look" | "padding" | "backdrop" | "theme">, size?: { width: number; height: number }): Promise<string> {
  const { scene } = exportScene(d, m, o);
  return portableSvg(scene, { theme: o.theme, backdrop: o.backdrop, fonts: await fontsFor(scene), ...(size ?? {}) });
}
