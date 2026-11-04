/**
 * The playground (spec/embed-protocol.md §5): a textarea and the live figure, lint and QA always on,
 * copy buttons for the link, the iframe and the site component. State lives in the hash.
 */
import "@fontsource/kalam/300.css";
import "@fontsource/kalam/400.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "../embed/embed.css";
import "./play.css";
import { parse, ParseError } from "../core/parse";
import { buildHash, parseHash } from "../core/state";
import { canvasMeasurer, loadFonts, type FontStatus } from "../embed/measure-dom";
import { errorCard, mountFigure, type Mounted } from "../embed/figure";
import { downloadSvg } from "../embed/download";

const EXAMPLE = `diagram use-case
id permit-portal
title Residents apply and track; paying the fee is always part of applying
narration Apply for permit includes pay fee. Request fee waiver extends pay fee, but only for some residents.

actor resident "Resident"
actor clerk "Permit clerk" right
boundary portal "Permit portal" {
  use-case apply "apply for permit"
  use-case track "track status"
  use-case review "review application"
  use-case pay "pay fee"
  use-case waiver "request fee waiver"
}

resident -- apply
resident -- track
clerk -- review
apply -include-> pay
waiver -extend-> pay
`;

const TYPE_NAME: Record<string, string> = { flowchart: "Flowchart", activity: "Activity diagram", "use-case": "Use-case diagram" };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const app = document.getElementById("app") as HTMLElement;
const head = el("header", "play-head");
head.append(el("h1", undefined, "KSyt Draw"), el("p", "note", "a few lines of text in, a diagram out. Everything stays in this page; the link holds the diagram."));
const grid = el("div", "play");
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
grid.append(editor, preview);
const help = el("details", "play-help");
help.appendChild(el("summary", undefined, "how to write one"));
help.appendChild(el("p", undefined, "First line: diagram flowchart, activity or use-case. Then a title (what the figure shows). Nodes are kind id \"label\"; edges are a -> b, a -- b, a -include-> b, a -extend-> b, a ..> b, with : label after. Use step N to reveal parts one click at a time. Use cases go inside boundary id \"System\" { ... }."));
const pre = el("pre");
pre.textContent = EXAMPLE;
help.appendChild(pre);
app.replaceChildren(head, grid, help);

const initial = parseHash(location.hash);
ta.value = initial.d ?? EXAMPLE;

let fontStatus: FontStatus | null = null;
let mounted: Mounted | null = null;
let timer: number | null = null;
let renderToken = 0;

function say(msg: string): void {
  status.textContent = msg;
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const ksd = ta.value;
  history.replaceState(null, "", "#" + buildHash({ d: ksd }));
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
  mounted = mountFigure(preview, d, canvasMeasurer, {
    initialStep: keep, lint: true, qa: true, containerWidth: Math.max(100, preview.clientWidth), fontStatus, idPrefix: d.diagram_id || "fig",
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
  if (s.d && s.d !== ta.value) { ta.value = s.d; void render(); }
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

void render();
