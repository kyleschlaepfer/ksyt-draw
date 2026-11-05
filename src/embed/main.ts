/**
 * The embed page (spec/embed-protocol.md): reads the hash, renders the diagram, talks to the host.
 */
import "@fontsource/kalam/300.css";
import "@fontsource/kalam/400.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "./embed.css";
import { firstError, parseSource } from "../core/doc/parse";
import { parseHash, buildHash, type HashState } from "../core/state";
import { severityCounts } from "../core/lint";
import { canvasMeasurer, loadFonts, type FontStatus } from "./measure-dom";
import { errorCard, mountFigure, sceneFor, type Mounted } from "./figure";
import { downloadSvg } from "./download";
import { resolve } from "../core/geom/resolve";

const app = document.getElementById("app") as HTMLElement;
const framed = window.parent !== window;

let state: HashState = parseHash(location.hash);
let loadedKsd: string | null = null;
let hostTheme: "light" | "dark" | null = null;
let mounted: Mounted | null = null;
let fontStatus: FontStatus | null = null;
let lastHeight = -1;
let renderToken = 0;

function post(msg: Record<string, unknown>): void {
  if (!framed) return;
  window.parent.postMessage({ source: "ksyt-draw", v: 1, id: state.id, ...msg }, "*");
}

function applyTheme(): void {
  const t = hostTheme ?? (state.theme === "auto" ? null : state.theme);
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}

function requestResize(): void {
  requestAnimationFrame(() => {
    const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (Math.abs(h - lastHeight) >= 1) {
      lastHeight = h;
      post({ type: "resize", height: h });
    }
  });
}

function showError(title: string, detail?: string, line?: number | null): void {
  mounted = null;
  app.replaceChildren(errorCard(title, detail, line));
  post({ type: "error", message: detail ? (line ? `line ${line}: ${detail}` : detail) : title, line: line ?? null });
  requestResize();
}

async function render(keepStep = false): Promise<void> {
  const token = ++renderToken;
  applyTheme();
  if (state.v !== 1) return showError("This link uses an embed version this page doesn't know.", `v=${state.v ?? "missing"}; this page speaks v=1.`);
  const ksd = loadedKsd ?? state.d;
  if (!ksd) return showError("This link doesn't contain a diagram.", state.undecodable ? "The d parameter could not be decoded." : undefined);
  const parsed = parseSource(ksd);
  const bad = firstError(parsed);
  if (bad || !parsed.doc) return showError("This diagram has a mistake in its text.", bad?.message ?? "empty diagram", bad?.line ?? 0);
  const d = parsed.doc;
  if (!fontStatus) fontStatus = await loadFonts();
  if (token !== renderToken) return;
  const previousStep = keepStep && mounted ? mounted.step : state.step;
  document.title = d.meta.title;
  const width = Math.max(100, app.clientWidth || document.documentElement.clientWidth - 16);
  mounted = mountFigure(app, d, canvasMeasurer, {
    initialStep: previousStep, lint: state.lint, qa: state.qa, containerWidth: width, fontStatus, idPrefix: d.meta.id || "fig", look: state.look ?? undefined,
    onStep: (step, steps) => { post({ type: "step", step, steps }); requestResize(); },
  });
  if (state.tools) {
    const foot = document.createElement("p");
    foot.className = "embed-foot";
    const open = document.createElement("a");
    open.href = `${location.origin}/#${buildHash({ d: ksd })}`;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "open in playground";
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "·";
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn-quiet";
    dl.textContent = "download SVG";
    const shown = mounted;
    dl.addEventListener("click", () => { void downloadSvg(shown.diagram, shown.scene.look, document.documentElement.getAttribute("data-theme")); });
    foot.append(open, sep, dl);
    mounted.root.appendChild(foot);
  }
  post({ type: "ready", steps: mounted.steps, step: mounted.step, title: d.meta.title });
  post({ type: "lint", status: mounted.lint.status, counts: severityCounts(mounted.lint.findings) });
  requestResize();
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent || !framed) return;
  const m = event.data as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || m.source !== "ksyt-draw-host" || m.v !== 1) return;
  if (m.type === "theme" && (m.theme === "light" || m.theme === "dark")) {
    hostTheme = m.theme;
    applyTheme();
    requestResize();
  } else if (m.type === "step" && (m.step === "all" || (typeof m.step === "number" && Number.isFinite(m.step)))) {
    mounted?.setStep(m.step as number | "all");
  } else if (m.type === "load" && typeof m.ksd === "string") {
    loadedKsd = m.ksd;
    void render();
  }
});

window.addEventListener("hashchange", () => {
  state = parseHash(location.hash);
  loadedKsd = null;
  void render();
});

// height follows the content; a width change can flip a right-running flow to top-down
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => requestResize()).observe(document.documentElement);
  let lastWidth = app.clientWidth;
  new ResizeObserver(() => {
    const w = app.clientWidth;
    if (w === lastWidth || !mounted) return;
    lastWidth = w;
    const d = mounted.diagram;
    // a right-running flow turns top-down when the frame gets too narrow for it, and back when it widens
    const narrow = d.meta.type !== "use-case" && sceneFor(d, canvasMeasurer, w).scene.direction !== resolve(d, canvasMeasurer).direction;
    const want = narrow ? "down" : resolve(d, canvasMeasurer).direction;
    if (want !== mounted.scene.direction) void render(true);
  }).observe(app);
}

void render();
