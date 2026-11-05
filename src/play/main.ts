/**
 * The tool page at / (spec/embed-protocol.md §5), laid out like a page on kyleschlaepfer.com:
 * wordmark, the tool's name and one line on what it does, three views in a nav row (write, draw,
 * the syntax) with the document's new / open / save / export beside them, a footer with the theme
 * switch.
 *
 * One Session holds the open diagram for both views. It is kept in this browser as a local draft,
 * and short diagrams also ride in the link (the hash: d and tab), so a link is still a file.
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
import { buildHash, compress, parseHash } from "../core/state";
import { Session } from "../core/doc/session";
import { canvasMeasurer, loadFonts } from "../embed/measure-dom";
import { svgElementFrom } from "../embed/figure";
import { makeTabs } from "./tabs";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";
import { el, type App, type Tab } from "./app";
import { mountWrite, type WriteView } from "./write";
import { mountFiles } from "./files";
import { keepPrevious, loadDraft, saveDraft } from "./storage";

/** The tool's name. One place to change it. */
export const APP_NAME = "Chalk";
const SITE = "https://kyleschlaepfer.com";
const REPO = "https://github.com/kyleschlaepfer/ksyt-draw";
/** Above this many characters of compressed text the link stops carrying the diagram; the local draft still does. */
const LINK_LIMIT = 8000;

// ---------- hash state (d plus tab) ----------
function tabFromHash(): Tab {
  const t = new URLSearchParams(location.hash.slice(1)).get("tab");
  if (t === "draw") return "draw";
  if (t === "syntax" || t === "docs") return "syntax";
  return "write";
}
function writeHash(ksd: string, tab: Tab): boolean {
  const fits = compress(ksd).length <= LINK_LIMIT;
  let h = fits ? buildHash({ d: ksd }) : "v=1";
  if (tab !== "write") h += `&tab=${tab}`;
  history.replaceState(null, "", "#" + h);
  return fits;
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
const appRoot = document.getElementById("app") as HTMLElement;

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
  el("p", "tool-line", "Write a few lines of text or draw it yourself, and you get a use-case, activity, class or flow diagram in the same style as the videos, with the same notation check the videos get."),
);
const meta = el("p", "meta");
meta.append(el("span", undefined, "use case, activity, class, flowchart"), el("span", undefined, "nothing leaves your browser; the link is the file"));
intro.appendChild(meta);
main.appendChild(intro);

const writePanel = el("div", "play");
writePanel.id = "panel-write";
const drawPanel = el("div", "draw-editor");
drawPanel.id = "panel-draw";
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
// the views and the document's actions share one row
const viewsRow = el("div", "views-row");
views.list.replaceWith(viewsRow);
viewsRow.appendChild(views.list);
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

appRoot.replaceChildren(skip, header, main, footer);
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
applyTheme(savedTheme);

// ---------- the document ----------
interface DrawView { refresh(): void; shown(): void; say(msg: string): void }
let write: WriteView | null = null;
let draw: DrawView | null = null;
let drawLoading = false;
let app: App | null = null;
let persistTimer: number | null = null;
let storageOk = true;

const currentTab = (): Tab => views.current() as Tab;
const say = (msg: string): void => { (currentTab() === "draw" && draw ? draw : write)?.say(msg); };

function persist(): void {
  if (!app) return;
  const inLink = writeHash(app.session.text, currentTab());
  const saved = saveDraft(app.session.text, app.workspace);
  if (!saved && storageOk) say(inLink ? "this browser won't keep a local copy; the link in the address bar holds the diagram" : "this browser won't keep a local copy and the diagram is too long for a link: use save");
  storageOk = saved;
}
function schedulePersist(): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => { persistTimer = null; persist(); }, 300);
}

function ensureDraw(): void {
  if (draw || drawLoading || !app) return;
  drawLoading = true;
  const a = app;
  void import("./draw/index").then(({ mountDraw }) => {
    draw = mountDraw(drawPanel, a);
    drawLoading = false;
    if (currentTab() === "draw") draw.shown();
  });
}

function onTab(tab: Tab): void {
  if (!app) return;
  writeHash(app.session.text, tab);
  if (tab === "draw") { ensureDraw(); draw?.shown(); }
  if (tab === "write") write?.shown();
}

async function start(): Promise<void> {
  const fonts = await loadFonts();
  const fromLink = parseHash(location.hash).d;
  const draft = loadDraft();
  // a link wins over the local draft; the draft it replaces is kept where "open" can find it
  if (fromLink && draft && draft.text !== fromLink) keepPrevious();
  const session = new Session(fromLink ?? draft?.text ?? DEFAULT_EXAMPLE, canvasMeasurer);
  app = {
    session, measurer: canvasMeasurer, fonts,
    workspace: (!fromLink || fromLink === draft?.text ? draft?.workspace : undefined) ?? {},
    showTab: (tab) => views.select(tab),
    currentTab,
    open: (text, label) => { session.setText(text, label); },
    touchWorkspace: schedulePersist,
  };
  const a = app;
  write = mountWrite(writePanel, a);
  const files = mountFiles(a, say, () => { void import("./export-dialog").then(({ openExportDialog }) => openExportDialog(a, say)); });
  viewsRow.appendChild(files.root);
  session.subscribe((origin) => {
    write?.refresh(origin !== "write");
    draw?.refresh();
    schedulePersist();
  });
  // late-arriving fonts change every measurement
  document.fonts?.addEventListener?.("loadingdone", () => { if (!fonts.ok) session.remeasure(); });

  window.addEventListener("hashchange", () => {
    const s = parseHash(location.hash);
    views.select(tabFromHash());
    if (s.d && s.d !== session.text) a.open(s.d, "open link");
  });

  // the reference's example buttons and its table of contents
  docsPanel.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>("button[data-example]");
    if (btn) {
      const ex = EXAMPLES[btn.dataset.example!];
      if (!ex) return;
      a.open(ex, `load the ${btn.dataset.example} example`);
      views.select("write");
      write?.say(`loaded the ${btn.dataset.example} example (undo brings back what was here)`);
      return;
    }
    const link = t.closest<HTMLAnchorElement>("a[href^='#d-']");
    if (link) {
      ev.preventDefault();
      const target = docsPanel.querySelector<HTMLElement>(link.getAttribute("href")!);
      if (target) {
        target.tabIndex = -1;
        target.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        target.focus({ preventScroll: true });
      }
    }
  });

  // a small scripting surface: read and replace the open diagram from the console or a test
  (window as unknown as { chalk: unknown }).chalk = {
    getText: () => session.text,
    setText: (text: string) => a.open(String(text), "script"),
    get valid() { return session.inSync; },
    undo: () => session.undo(),
    redo: () => session.redo(),
  };

  views.select(tabFromHash());
  if (currentTab() === "draw") ensureDraw();
  write.shown();
  persist();
}

void start();
