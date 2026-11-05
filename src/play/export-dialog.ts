/**
 * The export dialog: pick a format and a look, see the actual file's picture before saving it.
 *
 * The preview is the export itself (the same SVG the file will hold, shown as an image), not the
 * canvas, so what you see is what the file contains. The few choices that matter are up front; the
 * rest sit under "more". Choices are remembered with the workspace.
 */
import { PX } from "../core/measure";
import { DEFAULTS, PADDING, PAGES, type ExportFormat, type ExportOptions, type PagePreset } from "../export/options";
import { exportPng, MAX_PIXELS } from "../export/png";
import { exportScene, sceneSvg } from "../export/svg";
import { saveBlob } from "../export/save";
import { button, el, type App } from "./app";

type Ground = "white" | "page" | "clear" | "board";
interface Choice { format: ExportFormat; look: "sketch" | "precision"; ground: Ground; padding: keyof typeof PADDING; scale: number; text: "letters" | "shapes"; page: PagePreset; orientation: "portrait" | "landscape" }

const GROUND: Record<Ground, Pick<ExportOptions, "theme" | "backdrop">> = {
  white: { theme: "light", backdrop: "white" }, page: { theme: "light", backdrop: "page" },
  clear: { theme: "light", backdrop: "transparent" }, board: { theme: "dark", backdrop: "page" },
};

let dialog: HTMLDialogElement | null = null;

export function openExportDialog(app: App, say: (msg: string) => void): void {
  const d = app.session.doc;
  if (!d) { say("there is nothing to export yet: the text has a mistake"); return; }
  dialog?.remove();
  const saved = (app.workspace.export ?? {}) as Partial<Choice>;
  const c: Choice = {
    format: (["svg", "png", "pdf"] as const).includes(saved.format as ExportFormat) ? (saved.format as ExportFormat) : "png",
    look: saved.look === "precision" || saved.look === "sketch" ? saved.look : d.meta.look ?? "sketch",
    ground: (["white", "page", "clear", "board"] as const).includes(saved.ground as Ground) ? (saved.ground as Ground) : "white",
    padding: saved.padding && saved.padding in PADDING ? saved.padding : "normal",
    scale: [1, 2, 3, 4].includes(Number(saved.scale)) ? Number(saved.scale) : 2,
    text: saved.text === "shapes" ? "shapes" : "letters",
    page: saved.page && (saved.page === "fit" || saved.page in PAGES) ? saved.page : "fit",
    orientation: saved.orientation === "portrait" ? "portrait" : "landscape",
  };
  const options = (): ExportOptions => ({ ...DEFAULTS, look: c.look, ...GROUND[c.ground], padding: PADDING[c.padding], scale: c.scale, page: c.page, orientation: c.orientation, outlineText: c.format === "svg" && c.text === "shapes" });

  const dlg = el("dialog", "export-dialog");
  dialog = dlg;
  dlg.setAttribute("aria-labelledby", "export-title");
  const title = el("h2", undefined, "export");
  title.id = "export-title";
  const stageBox = el("div", "export-preview");
  const img = el("img");
  img.alt = "the picture this export will save";
  stageBox.appendChild(img);
  const facts = el("p", "note export-facts");
  facts.setAttribute("aria-live", "polite");
  const form = el("div", "export-options");

  const group = <T extends string>(legend: string, name: keyof Choice, items: Array<[T, string, string?]>): HTMLElement => {
    const fs = el("fieldset", "export-group");
    fs.appendChild(el("legend", undefined, legend));
    for (const [value, word, hint] of items) {
      const lab = el("label", "export-choice");
      const r = el("input");
      r.type = "radio";
      r.name = `export-${name}`;
      r.value = value;
      r.checked = String(c[name]) === value;
      r.addEventListener("change", () => { (c[name] as unknown) = typeof c[name] === "number" ? Number(value) : value; refresh(); });
      const text = el("span", undefined, word);
      if (hint) text.appendChild(el("small", undefined, hint));
      lab.append(r, text);
      fs.appendChild(lab);
    }
    return fs;
  };

  const format = group<ExportFormat>("format", "format", [
    ["png", "PNG", "a picture: slides, documents, anywhere"], ["svg", "SVG", "vector: web pages, design tools"], ["pdf", "PDF", "vector: print and reports"],
  ]);
  const look = group("drawn as", "look", [["sketch", "sketch", "the pen style of the videos"], ["precision", "precision", "crisp lines for formal documents"]]);
  const ground = group<Ground>("background", "ground", [
    ["white", "white"], ["page", "off-white page"], ["clear", "none (see-through)"], ["board", "chalkboard"],
  ]);
  const more = el("details", "export-more");
  more.appendChild(el("summary", undefined, "more"));
  const padding = group("space around it", "padding", [["tight", "tight"], ["normal", "normal"], ["roomy", "roomy"]]);
  const scale = group("PNG size", "scale", [["1", "1x"], ["2", "2x", "sharp on slides"], ["3", "3x"], ["4", "4x", "print"]]);
  const text = group("SVG text", "text", [["letters", "letters", "can be searched and retyped; other programs may swap the font"], ["shapes", "shapes", "looks the same in every program"]]);
  const page = group<PagePreset>("PDF page", "page", [["fit", "the diagram's own size"], ["letter", "US Letter"], ["a4", "A4"], ["slide", "16:9 slide"]]);
  const orient = group("which way up", "orientation", [["landscape", "landscape"], ["portrait", "portrait"]]);
  more.append(padding, scale, text, page, orient);
  form.append(format, look, ground, more);

  const actions = el("div", "actions");
  const save = button("btn", "download");
  save.id = "export-download";
  const copy = button("btn-quiet", "copy");
  const close = button("btn-quiet", "close");
  actions.append(save, copy, close);
  const note = el("p", "note export-note");
  note.setAttribute("aria-live", "polite");
  dlg.append(title, stageBox, facts, form, actions, note);
  document.body.appendChild(dlg);

  let token = 0;
  async function refresh(): Promise<void> {
    const my = ++token;
    app.workspace.export = { ...c };
    app.touchWorkspace();
    scale.hidden = c.format !== "png";
    text.hidden = c.format !== "svg";
    page.hidden = c.format !== "pdf";
    orient.hidden = c.format !== "pdf" || c.page === "fit";
    copy.hidden = c.format === "pdf";
    copy.textContent = c.format === "png" ? "copy picture" : "copy SVG text";
    stageBox.dataset.ground = c.ground;
    const o = options();
    const { scene, qa } = exportScene(app.session.doc!, app.measurer, o);
    const svg = await sceneSvg(scene, o);
    if (my !== token) return;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const w = Math.round(scene.w * PX), h = Math.round(scene.h * PX);
    const inches = `${scene.w.toFixed(1)} x ${scene.h.toFixed(1)} in`;
    let size: string;
    if (c.format === "png") {
      const capped = w * h * c.scale * c.scale > MAX_PIXELS;
      size = `${Math.round(w * c.scale)} x ${Math.round(h * c.scale)} px${capped ? " (the largest this browser can make will be used)" : ""}`;
    } else if (c.format === "pdf" && c.page !== "fit") {
      const [a, b] = PAGES[c.page];
      const pw = c.orientation === "landscape" ? Math.max(a, b) : Math.min(a, b), ph = c.orientation === "landscape" ? Math.min(a, b) : Math.max(a, b);
      const fit = Math.min(1, (pw - 1) / scene.w, (ph - 1) / scene.h);
      size = `${pw} x ${ph} in page, diagram at ${Math.round(fit * 100)}%${fit < 0.6 ? ": small on this page; a bigger page or landscape reads better" : ""}`;
    } else size = `${w} x ${h} px, ${inches}`;
    const smallest = scene.texts.length ? Math.min(...scene.texts.map((t) => t.size)) : 0;
    facts.textContent = `${size}. Smallest text ${smallest}px. Layout check: ${qa.errors.length ? `${qa.errors.length} problem${qa.errors.length === 1 ? "" : "s"} (${qa.errors[0]})` : "pass"}.`;
  }

  const name = (): string => `${app.session.doc?.meta.id || "diagram"}.${c.format}`;
  save.addEventListener("click", () => {
    void (async () => {
      const doc = app.session.doc!;
      const o = options();
      save.disabled = true;
      try {
        if (c.format === "svg") {
          const { scene } = exportScene(doc, app.measurer, o);
          saveBlob(new Blob([await sceneSvg(scene, o)], { type: "image/svg+xml" }), name());
        } else if (c.format === "png") {
          saveBlob((await exportPng(doc, app.measurer, o)).blob, name());
        } else {
          note.textContent = "making the PDF";
          const { exportPdf } = await import("../export/pdf");
          saveBlob((await exportPdf(doc, app.measurer, o)).blob, name());
        }
        note.textContent = `saved ${name()}`;
        say(`exported ${name()}`);
      } catch (e) {
        note.textContent = `the export failed: ${e instanceof Error ? e.message : "unknown reason"}`;
      } finally {
        save.disabled = false;
      }
    })();
  });
  copy.addEventListener("click", () => {
    void (async () => {
      const doc = app.session.doc!;
      const o = options();
      try {
        if (c.format === "png") {
          const { blob } = await exportPng(doc, app.measurer, o);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          note.textContent = "copied the picture";
        } else {
          const { scene } = exportScene(doc, app.measurer, o);
          await navigator.clipboard.writeText(await sceneSvg(scene, o));
          note.textContent = "copied the SVG text";
        }
      } catch {
        note.textContent = "this browser wouldn't let the page copy that; download it instead";
      }
    })();
  });
  close.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => { dlg.remove(); if (dialog === dlg) dialog = null; });
  // a click on the backdrop closes it, like Escape
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.showModal();
  void refresh();
}
