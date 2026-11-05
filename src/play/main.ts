/**
 * The playground page (spec/embed-protocol.md §5), laid out as a folder with two tabs:
 *   write: the text playground (sub-tab "playground") and the syntax reference (sub-tab "the syntax")
 *   draw:  empty for now; the drag and drop editor goes here
 * State lives in the hash: d (the diagram) and tab (play, docs, draw).
 */
import "@fontsource/kalam/300.css";
import "@fontsource/kalam/400.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "../embed/embed.css";
import "./play.css";
import docsHtml from "./docs.html?raw";
import { parse, ParseError } from "../core/parse";
import { buildHash, parseHash } from "../core/state";
import { canvasMeasurer, loadFonts, type FontStatus } from "../embed/measure-dom";
import { errorCard, mountFigure, type Mounted } from "../embed/figure";
import { downloadSvg } from "../embed/download";
import { makeTabs } from "./tabs";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";

const TYPE_NAME: Record<string, string> = { flowchart: "Flowchart", activity: "Activity diagram", "use-case": "Use-case diagram" };
type Tab = "play" | "docs" | "draw";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------- hash state (d plus tab) ----------
function tabFromHash(): Tab {
  const t = new URLSearchParams(location.hash.slice(1)).get("tab");
  return t === "docs" || t === "draw" ? t : "play";
}
function writeHash(ksd: string, tab: Tab): void {
  let h = buildHash({ d: ksd });
  if (tab !== "play") h += `&tab=${tab}`;
  history.replaceState(null, "", "#" + h);
}

// ---------- page ----------
const app = document.getElementById("app") as HTMLElement;
const head = el("header", "play-head");
head.append(el("h1", undefined, "KSyt Draw"), el("p", "note", "a few lines of text in, a diagram out. Everything stays in this page; the link holds the diagram."));

// playground sub-panel
const playPanel = el("div", "play");
playPanel.id = "sub-play";
const editor = el("div", "play-editor");
const label = el("label", undefined, "diagram text");
label.htmlFor = "ksd";
const ta = el("textarea");
ta.id = "ksd";
ta.spellcheck = false;
ta.setAttribute("autocapitalize", "off");
ta.setAttribute("autocomplete", "off");
const status = el("p", "play-status");
status.setAttribute("aria-live", "polite");
const actions = el("div", "actions");
const btnLink = el("button", "btn-quiet", "copy link");
const btnEmbed = el("button", "btn", "copy embed code");
const btnSite = el("button", "btn-quiet", "copy for the site");
const btnSvg = el("button", "btn-quiet", "download SVG");
for (const b of [btnLink, btnEmbed, btnSite, btnSvg]) b.type = "button";
actions.append(btnLink, btnEmbed, btnSite, btnSvg);
editor.append(label, ta, actions, status);
const preview = el("div", "play-preview");
preview.id = "preview";
playPanel.append(editor, preview);

// docs sub-panel: static authored content, never diagram text
const docsPanel = el("div", "docs");
docsPanel.id = "sub-docs";
docsPanel.innerHTML = docsHtml;

// draw panel: empty on purpose
const drawPanel = el("div", "draw-empty");
drawPanel.id = "panel-draw";
drawPanel.append(
  el("p", "note", "nothing here yet."),
  el("p", undefined, "This tab is for the drag and drop editor: the same shapes, placed by hand, saved back to the text on the write tab."),
);

const writePanel = el("div", "write-panel");
writePanel.id = "panel-write";
const subTabs = makeTabs(
  [{ id: "play", label: "playground", panel: playPanel }, { id: "docs", label: "the syntax", panel: docsPanel }],
  { label: "write", cls: "subtabs", onChange: (id) => { onTab(id as Tab); } },
);
writePanel.appendChild(subTabs.root);
const folder = makeTabs(
  [{ id: "write", label: "write", panel: writePanel }, { id: "draw", label: "draw", panel: drawPanel }],
  { label: "KSyt Draw", cls: "folder", onChange: (id) => { onTab(id === "draw" ? "draw" : (subTabs.current() as Tab)); } },
);
app.replaceChildren(head, folder.root);

let fontStatus: FontStatus | null = null;
let mounted: Mounted | null = null;
let timer: number | null = null;
let renderToken = 0;
let renderedHidden = false;

function currentTab(): Tab {
  return folder.current() === "draw" ? "draw" : (subTabs.current() as Tab);
}
function showTab(tab: Tab): void {
  if (tab === "draw") folder.select("draw");
  else { folder.select("write"); subTabs.select(tab); }
}
function onTab(tab: Tab): void {
  writeHash(ta.value, tab);
  if (tab === "play" && renderedHidden) void render();
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
  renderedHidden = playPanel.hidden || preview.clientWidth === 0;
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
  if (s.d && s.d !== ta.value) { ta.value = s.d; void render(); }
});

// the reference's example buttons and its table of contents
docsPanel.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest<HTMLButtonElement>("button[data-example]");
  if (btn) {
    const ex = EXAMPLES[btn.dataset.example!];
    if (!ex) return;
    ta.value = ex;
    showTab("play");
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

function header(key: string): string | undefined {
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
  const id = header("id") ?? "diagram";
  const type = header("diagram") ?? "";
  const title = `${TYPE_NAME[type] ?? "Diagram"}: ${header("title") ?? ""}`;
  void copy(embedSnippet(location.origin, ta.value, id, title), "embed code");
});
btnSite.addEventListener("click", () => {
  const id = header("id") ?? "diagram";
  const name = camel(id);
  const caption = (header("title") ?? "").replace(/"/g, "'");
  void copy(`import ${name} from "../../diagrams/${id}.ksd?raw";\n<DiagramEmbed ksd={${name}} caption="${caption}" />`, "component line");
});
btnSvg.addEventListener("click", () => { if (mounted) void downloadSvg(mounted.scene); });

// start: the diagram from the link, else the example; the tab from the link
const initial = parseHash(location.hash);
ta.value = initial.d ?? DEFAULT_EXAMPLE;
showTab(tabFromHash());
void render();
