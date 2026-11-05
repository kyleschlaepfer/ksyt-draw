/**
 * The tool page at / (spec/embed-protocol.md §5), laid out like a page on kyleschlaepfer.com:
 * wordmark, the tool's name and one line on what it does, three views in a nav row (write, draw,
 * the syntax), a footer with the theme switch. State lives in the hash: d (the diagram) and tab.
 */
import "@fontsource/kalam/300.css";
import "@fontsource/kalam/400.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "../embed/embed.css";
import "./strokes.css";
import "./play.css";
import docsHtml from "./docs.html?raw";
import markSvg from "./art/mark.svg?raw";
import { parse, ParseError } from "../core/parse";
import { buildHash, parseHash } from "../core/state";
import { canvasMeasurer, loadFonts, type FontStatus } from "../embed/measure-dom";
import { errorCard, mountFigure, svgElementFrom, type Mounted } from "../embed/figure";
import { downloadSvg } from "../embed/download";
import { makeTabs } from "./tabs";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";
import { mountDraw } from "./draw";

/** The tool's name. One place to change it. */
export const APP_NAME = "Chalk";
const SITE = "https://kyleschlaepfer.com";
const REPO = "https://github.com/kyleschlaepfer/ksyt-draw";

const TYPE_NAME: Record<string, string> = { flowchart: "Flowchart", activity: "Activity diagram", "use-case": "Use-case diagram" };
type Tab = "write" | "draw" | "syntax";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------- hash state (d plus tab) ----------
function tabFromHash(): Tab {
  const t = new URLSearchParams(location.hash.slice(1)).get("tab");
  if (t === "draw") return "draw";
  if (t === "syntax" || t === "docs") return "syntax";
  return "write";
}
function writeHash(ksd: string, tab: Tab): void {
  let h = buildHash({ d: ksd });
  if (tab !== "write") h += `&tab=${tab}`;
  history.replaceState(null, "", "#" + h);
}

// ---------- theme switch (a per-viewer convenience; the embed follows the host instead) ----------
const THEME_KEY = "ksyt-theme";
function applyTheme(t: string | null): void {
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-set]")) {
    b.setAttribute("aria-pressed", String(b.dataset.themeSet === (t ?? "system")));
  }
}

// ---------- page ----------
document.title = APP_NAME;
const app = document.getElementById("app") as HTMLElement;

const skip = el("a", "skip-link", "skip to content");
skip.href = "#main";

const header = el("header", "site-header");
const wrapHead = el("div", "wrap");
const wordmark = el("a", "wordmark");
wordmark.href = SITE;
const mark = svgElementFrom(markSvg);
mark.setAttribute("aria-hidden", "true");
mark.removeAttribute("role");
mark.removeAttribute("aria-labelledby");
wordmark.append(mark, "kyle schlaepfer");
wrapHead.appendChild(wordmark);
header.appendChild(wrapHead);

const main = el("main", "wrap");
main.id = "main";
const intro = el("div", "tool-intro");
const h1 = el("h1", undefined, APP_NAME);
h1.append(" ", el("small", "status", "(beta)"));
intro.append(
  h1,
  el("p", "tool-line", "A few lines of text, and you get a use-case, activity or flow diagram in the same style as the videos, with the same notation check the videos get."),
);
const meta = el("p", "meta");
meta.append(el("span", undefined, "use case, activity, flowchart"), el("span", undefined, "nothing leaves your browser; the link is the file"));
intro.appendChild(meta);
main.appendChild(intro);

// write view
const writePanel = el("div", "play");
writePanel.id = "panel-write";
const editor = el("div", "play-editor");
const label = el("label", undefined, "diagram text");
label.htmlFor = "ksd";
const ta = el("textarea");
ta.id = "ksd";
ta.spellcheck = false;
ta.setAttribute("autocapitalize", "off");
ta.setAttribute("autocomplete", "off");
const status = el("p", "play-status note");
status.setAttribute("aria-live", "polite");
const actions = el("div", "actions");
const btnEmbed = el("button", "btn", "copy embed code");
const btnLink = el("button", "btn-quiet", "copy link");
const btnSite = el("button", "btn-quiet", "copy for the site");
const btnSvg = el("button", "btn-quiet");
const dlIcon = el("span", "icon icon-download");
dlIcon.setAttribute("aria-hidden", "true");
btnSvg.append(dlIcon, "download SVG");
for (const b of [btnLink, btnEmbed, btnSite, btnSvg]) b.type = "button";
actions.append(btnEmbed, btnLink, btnSite, btnSvg);
editor.append(label, ta, actions, status);
const preview = el("div", "play-preview");
preview.id = "preview";
writePanel.append(editor, preview);

// draw view
const drawPanel = el("div", "draw-editor");
drawPanel.id = "panel-draw";
let playDirty = false;
const draw = mountDraw(drawPanel, {
  getText: () => ta.value,
  setText: (t) => { ta.value = t; writeHash(t, currentTab()); playDirty = true; },
  goWrite: () => showTab("write"),
});

// the syntax view: static authored content, never diagram text
const docsPanel = el("div", "docs");
docsPanel.id = "panel-syntax";
docsPanel.innerHTML = docsHtml;

const views = makeTabs(
  [
    { id: "write", label: "write", panel: writePanel },
    { id: "draw", label: "draw", panel: drawPanel },
    { id: "syntax", label: "the syntax", panel: docsPanel },
  ],
  { label: "views", cls: "views", onChange: (id) => onTab(id as Tab) },
);
main.appendChild(views.root);

const footer = el("footer", "site-footer");
const wrapFoot = el("div", "wrap");
wrapFoot.appendChild(el("p", "note", "diagrams are checked with the same rules as the videos. If one gets flagged, that's the point."));
const siteLink = el("a", undefined, "kyleschlaepfer.com");
siteLink.href = SITE;
const repoLink = el("a", undefined, "source on GitHub");
repoLink.href = REPO;
const themeBar = el("div", "theme-switch");
themeBar.setAttribute("role", "group");
themeBar.setAttribute("aria-label", "theme");
for (const t of ["light", "dark", "system"]) {
  const b = el("button", "btn-quiet", t);
  b.type = "button";
  b.dataset.themeSet = t;
  b.addEventListener("click", () => {
    try { if (t === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked: follow the system */ }
    applyTheme(t === "system" ? null : t);
  });
  themeBar.appendChild(b);
}
wrapFoot.append(siteLink, repoLink, themeBar);
footer.appendChild(wrapFoot);

app.replaceChildren(skip, header, main, footer);
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
applyTheme(savedTheme);

// ---------- behavior ----------
let fontStatus: FontStatus | null = null;
let mounted: Mounted | null = null;
let timer: number | null = null;
let renderToken = 0;
let renderedHidden = false;

const currentTab = (): Tab => views.current() as Tab;
function showTab(tab: Tab): void {
  views.select(tab);
}
function onTab(tab: Tab): void {
  writeHash(ta.value, tab);
  if (tab === "draw") draw.refresh();
  if (tab === "write" && (renderedHidden || playDirty)) { playDirty = false; void render(); }
}

function say(msg: string): void {
  status.textContent = msg;
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const ksd = ta.value;
  writeHash(ksd, currentTab());
  let d;
  try {
    d = parse(ksd);
  } catch (e) {
    if (e instanceof ParseError) {
      mounted = null;
      preview.replaceChildren(errorCard("This diagram has a mistake in its text.", e.msg, e.line));
      say(e.line ? `line ${e.line}: ${e.msg}` : e.msg);
      return;
    }
    throw e;
  }
  if (!fontStatus) fontStatus = await loadFonts();
  if (token !== renderToken) return;
  const keep = mounted?.step ?? 0;
  renderedHidden = writePanel.hidden || preview.clientWidth === 0;
  mounted = mountFigure(preview, d, canvasMeasurer, {
    initialStep: keep, lint: true, qa: true, containerWidth: Math.max(100, preview.clientWidth || 800), fontStatus, idPrefix: d.diagram_id || "fig",
  });
  const n = mounted.lint.findings.length;
  say(`${TYPE_NAME[d.claimed_diagram_type] ?? "diagram"}, ${d.nodes.length} nodes, ${d.edges.length} edges, notation check: ${mounted.lint.status}${n ? ` (${n})` : ""}${mounted.qa?.errors.length ? `, layout: ${mounted.qa.errors.length} error${mounted.qa.errors.length === 1 ? "" : "s"}` : ""}`);
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; void render(); }, 150);
}

ta.addEventListener("input", schedule);
window.addEventListener("hashchange", () => {
  const s = parseHash(location.hash);
  showTab(tabFromHash());
  if (s.d && s.d !== ta.value) { ta.value = s.d; void render(); if (currentTab() === "draw") draw.refresh(); }
});

// the reference's example buttons and its table of contents
docsPanel.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest<HTMLButtonElement>("button[data-example]");
  if (btn) {
    const ex = EXAMPLES[btn.dataset.example!];
    if (!ex) return;
    ta.value = ex;
    showTab("write");
    void render().then(() => { say(`loaded the ${btn.dataset.example} example`); ta.focus(); });
    return;
  }
  const a = t.closest<HTMLAnchorElement>("a[href^='#d-']");
  if (a) {
    ev.preventDefault();
    const target = docsPanel.querySelector<HTMLElement>(a.getAttribute("href")!);
    if (target) {
      target.tabIndex = -1;
      target.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
  }
});

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(`copied the ${what}`);
  } catch {
    say(`couldn't copy the ${what}; select it in the page instead`);
    window.prompt(`copy the ${what}`, text);
  }
}

function header_(key: string): string | undefined {
  return ta.value.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(key + " "))?.slice(key.length + 1).trim();
}

export function embedSnippet(origin: string, ksd: string, id: string, title: string): string {
  const src = `${origin}/embed/#${buildHash({ d: ksd, id })}`;
  const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return [
    "<iframe",
    '  class="ksyt-draw-frame"',
    `  src="${attr(src)}"`,
    `  title="${attr(title)}"`,
    '  loading="lazy"',
    '  referrerpolicy="strict-origin-when-cross-origin"',
    '  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"',
    '  style="width:100%;height:360px;border:0;display:block"></iframe>',
  ].join("\n");
}

const camel = (slug: string) => slug.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[0-9]/, "_$&") || "diagram";

btnLink.addEventListener("click", () => void copy(`${location.origin}/#${buildHash({ d: ta.value })}`, "link"));
btnEmbed.addEventListener("click", () => {
  const id = header_("id") ?? "diagram";
  const type = header_("diagram") ?? "";
  const title = `${TYPE_NAME[type] ?? "Diagram"}: ${header_("title") ?? ""}`;
  void copy(embedSnippet(location.origin, ta.value, id, title), "embed code");
});
btnSite.addEventListener("click", () => {
  const id = header_("id") ?? "diagram";
  const name = camel(id);
  const caption = (header_("title") ?? "").replace(/"/g, "'");
  void copy(`import ${name} from "../../diagrams/${id}.ksd?raw";\n<DiagramEmbed ksd={${name}} caption="${caption}" />`, "component line");
});
btnSvg.addEventListener("click", () => { if (mounted) void downloadSvg(mounted.scene); });

// start: the diagram from the link, else the example; the view from the link
const initial = parseHash(location.hash);
ta.value = initial.d ?? DEFAULT_EXAMPLE;
showTab(tabFromHash());
if (currentTab() === "draw") draw.refresh();
void render();
