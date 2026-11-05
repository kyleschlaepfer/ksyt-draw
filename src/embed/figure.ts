/**
 * Mount a diagram in the page: the SVG, build-up controls, "describe this figure", and the lint panel.
 * Shared by the embed and the playground. Everything from the diagram reaches the DOM as textContent.
 */
import type { Finding, LintResult } from "../core/model";
import type { ChalkDoc, Look } from "../core/doc/types";
import type { Measurer } from "../core/measure";
import { PX } from "../core/measure";
import { resolve, type Geometry } from "../core/geom/resolve";
import { buildScene, type Scene } from "../core/render/scene";
import { sceneToSvg } from "../core/render/svg";
import { describeItems } from "../core/describe";
import { sortFindings, statusWords } from "../core/lint";
import { review } from "../core/diagnostics";
import { checkScene, type QaReport } from "../core/qa";
import type { FontStatus } from "./measure-dom";

export interface FigureOptions {
  initialStep?: number | "all";
  lint?: boolean;
  qa?: boolean;
  /** width available for the figure, CSS px */
  containerWidth: number;
  fontStatus?: FontStatus;
  idPrefix?: string;
  /** sketch or precision; default is the document's own look */
  look?: Look;
  onStep?: (step: number, steps: number) => void;
}

export interface Mounted {
  root: HTMLElement;
  figure: HTMLElement;
  svg: SVGSVGElement;
  diagram: ChalkDoc;
  scene: Scene;
  geometry: Geometry;
  lint: LintResult;
  qa: QaReport | null;
  steps: number;
  step: number;
  setStep(s: number | "all"): void;
  /** width the SVG wants at 1:1, CSS px */
  naturalWidth: number;
}

/** The scale below which the smallest label in a scene drops under 13 px. */
export function minScale(sc: Scene): number {
  const smallest = sc.texts.length ? Math.min(...sc.texts.map((t) => t.size)) : 22;
  return 13 / smallest;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Build the scene, switching a right-running flow to top-down when it would shrink labels under 13 px. */
export function sceneFor(d: ChalkDoc, m: Measurer, containerWidth: number, look?: Look): { scene: Scene; geometry: Geometry } {
  let geometry = resolve(d, m);
  let scene = buildScene(d, geometry, m, { look });
  if (d.meta.type !== "use-case" && geometry.direction === "right" && containerWidth / (scene.w * PX) < minScale(scene)) {
    geometry = resolve(d, m, { direction: "down" });
    scene = buildScene(d, geometry, m, { look });
  }
  return { scene, geometry };
}

export function svgElementFrom(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("the figure did not render");
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

export function mountFigure(host: HTMLElement, d: ChalkDoc, m: Measurer, o: FigureOptions): Mounted {
  const { scene, geometry } = sceneFor(d, m, o.containerWidth, o.look);
  const lintResult = review(d);
  const qa = o.qa ? checkScene(scene, { minDisplayPx: Math.max(1, Math.min(o.containerWidth, scene.w * PX)) }) : null;
  const svg = svgElementFrom(sceneToSvg(scene, { idPrefix: o.idPrefix ?? "fig" }));

  const root = el("div", "embed-root");
  const figure = el("figure", "fig");
  figure.setAttribute("tabindex", "0");
  figure.setAttribute("aria-label", d.meta.title);
  const stage = el("div", "fig-stage");
  // legibility floor: the figure never shrinks so far that a label drops under 13 px; on a phone it scrolls sideways instead
  const floorPx = Math.ceil(scene.w * PX * minScale(scene));
  svg.style.minWidth = `${floorPx}px`;
  stage.appendChild(svg);
  figure.appendChild(stage);
  if (floorPx > o.containerWidth) figure.appendChild(el("p", "note scroll-note", "wider than the screen: scroll sideways"));

  const steps = scene.steps;
  let step = 0;
  const parts = Array.from(svg.querySelectorAll<SVGElement>("[data-step]"));
  let status: HTMLElement | null = null;
  let back: HTMLButtonElement | null = null;
  let next: HTMLButtonElement | null = null;
  let all: HTMLButtonElement | null = null;

  const apply = () => {
    for (const p of parts) {
      const k = Number(p.getAttribute("data-step"));
      const hidden = k > step;
      p.classList.toggle("is-hidden", hidden);
      if (hidden) p.setAttribute("aria-hidden", "true");
      else p.removeAttribute("aria-hidden");
    }
    if (status) status.textContent = `step ${step + 1} of ${steps + 1}`;
    if (back) back.disabled = step <= 0;
    if (next) next.disabled = step >= steps;
    if (all) all.disabled = step >= steps;
  };
  const setStep = (s: number | "all") => {
    const n = s === "all" ? steps : Math.max(0, Math.min(steps, Math.trunc(s)));
    const changed = n !== step;
    step = n;
    apply();
    if (changed) o.onStep?.(step, steps);
  };

  if (steps > 0) {
    figure.classList.add("phased");
    const controls = el("div", "phase-controls");
    back = el("button", "btn-quiet", "back");
    back.type = "button";
    status = el("span", "phase-status");
    status.setAttribute("aria-live", "polite");
    next = el("button", "btn", "next step");
    next.type = "button";
    all = el("button", "btn-quiet", "show all");
    all.type = "button";
    back.addEventListener("click", () => setStep(step - 1));
    next.addEventListener("click", () => setStep(step + 1));
    all.addEventListener("click", () => setStep("all"));
    controls.append(back, status, next, all);
    figure.appendChild(controls);
    figure.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight") { setStep(step + 1); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft") { setStep(step - 1); ev.preventDefault(); }
    });
    const init = o.initialStep ?? 0;
    step = init === "all" ? steps : Math.max(0, Math.min(steps, init));
    apply();
  }

  // describe this figure
  const details = el("details");
  details.appendChild(el("summary", undefined, "describe this figure"));
  const described = describeItems(d);
  details.appendChild(el("p", "describe-intro", described.intro));
  const list = el(described.ordered ? "ol" : "ul");
  for (const item of described.items) list.appendChild(el("li", undefined, item));
  details.appendChild(list);
  figure.appendChild(details);
  root.appendChild(figure);

  if (o.lint) root.appendChild(lintPanel(d, lintResult, qa, o.fontStatus));

  host.replaceChildren(root);
  return {
    root, figure, svg, diagram: d, scene, geometry, lint: lintResult, qa, steps,
    get step() { return step; }, setStep, naturalWidth: scene.w * PX,
  };
}

function findingRow(sev: string, rule: string, loc: string, problem: string, fix: string): HTMLLIElement {
  const li = el("li");
  const row = el("div", "row");
  const cells = [el("span", "sev", sev), el("span", "rule", rule), ...(loc ? [el("span", "loc", loc)] : [])];
  cells.forEach((c, i) => { if (i) row.appendChild(el("span", "sep", "\u00b7")); row.appendChild(c); });
  li.appendChild(row);
  if (problem) li.appendChild(el("p", undefined, problem));
  if (fix) li.appendChild(el("p", "fix", fix));
  return li;
}

export function lintPanel(d: ChalkDoc, r: LintResult, qa: QaReport | null, fonts?: FontStatus): HTMLElement {
  const panel = el("section", "lint");
  panel.setAttribute("aria-label", "notation check");
  panel.appendChild(el("h2", undefined, `notation check: ${statusWords(r.status)}`));
  const ul = el("ul");
  for (const f of sortFindings(r.findings) as Finding[]) ul.appendChild(findingRow(f.severity, f.rule_id, f.location, f.problem, f.minimal_fix));
  if (!r.findings.length) ul.appendChild(findingRow("pass", "no findings", `${r.inferred_family}`, "", ""));
  panel.appendChild(ul);
  if (qa) {
    panel.appendChild(el("h2", undefined, `layout check: ${qa.errors.length ? `${qa.errors.length} error${qa.errors.length === 1 ? "" : "s"}` : "pass"}`));
    const ql = el("ul");
    for (const e of qa.errors) {
      const [code, ...rest] = e.split(" ");
      ql.appendChild(findingRow("error", code, "", rest.join(" "), ""));
    }
    for (const w of qa.warnings) {
      const [code, ...rest] = w.split(" ");
      ql.appendChild(findingRow("warning", code, "", rest.join(" "), ""));
    }
    if (!qa.errors.length && !qa.warnings.length) ql.appendChild(findingRow("pass", "no collisions", "", "", ""));
    panel.appendChild(ql);
  }
  if (fonts && !fonts.ok) {
    panel.appendChild(el("p", "note", `font didn't load: ${fonts.missing.join(", ")}. The layout was measured with a fallback font.`));
  }
  panel.appendChild(el("p", "note lint-foot", `checked as ${d.meta.profile}`));
  return panel;
}

export function errorCard(title: string, detail?: string, line?: number | null): HTMLElement {
  const card = el("div", "error-card");
  card.setAttribute("role", "alert");
  card.appendChild(el("h2", undefined, title));
  if (detail) {
    const p = el("p");
    if (line) {
      p.append(`line ${line}: `);
      const c = el("code", undefined, detail);
      p.appendChild(c);
    } else p.textContent = detail;
    card.appendChild(p);
  }
  return card;
}
