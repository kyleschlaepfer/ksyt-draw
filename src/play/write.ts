/**
 * The write view: the .ksd editor on the left, the live figure and its checks on the right.
 *
 * The text is the session's; this view only renders it. A mistake in the text never blanks the
 * figure: the last version that worked stays up, marked as out of date, with every bad line
 * underlined, and it catches up by itself when the text is fixed.
 */
import { buildHash } from "../core/state";
import { formatSource } from "../core/doc/sync";
import { allIssues, lineOf } from "../core/diagnostics";
import { firstError } from "../core/doc/parse";
import { mountFigure, type Mounted } from "../embed/figure";
import { downloadSvg } from "../embed/download";
import { TYPE_NAME, button, copyText, el, type App } from "./app";
import type { KsdEditor } from "./editor/editor";

export interface WriteView {
  /** the session changed: bring the editor and the figure up to date */
  refresh(textFromOutside: boolean): void;
  /** the view became visible (its figure may have been laid out at zero width) */
  shown(): void;
  focusLine(line: number): void;
  say(msg: string): void;
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

export function mountWrite(panel: HTMLElement, app: App): WriteView {
  const { session } = app;
  const editorPane = el("div", "play-editor");
  const head = el("div", "play-editor-head");
  const label = el("span", "play-editor-label", "diagram text");
  label.id = "ksd-label";
  const tidy = button("btn-quiet", "tidy", "put every line in its standard form (Shift+Alt+F)");
  const find = button("btn-quiet", "find", "find and replace (Ctrl+F)");
  const tools = el("span", "play-editor-tools");
  tools.append(tidy, find);
  head.append(label, tools);
  const editorHost = el("div", "play-editor-host");
  // until the editor's code arrives, the text is still there to read
  const placeholder = el("pre", "play-editor-loading", session.text);
  editorHost.appendChild(placeholder);
  const status = el("p", "play-status note");
  status.setAttribute("aria-live", "polite");
  const actions = el("div", "actions");
  const btnEmbed = button("btn", "copy embed code");
  const btnLink = button("btn-quiet", "copy link");
  const btnSite = button("btn-quiet", "copy for the site");
  const btnSvg = button("btn-quiet", "");
  const dlIcon = el("span", "icon icon-download");
  dlIcon.setAttribute("aria-hidden", "true");
  btnSvg.append(dlIcon, "download SVG");
  actions.append(btnEmbed, btnLink, btnSite, btnSvg);
  editorPane.append(head, editorHost, actions, status);

  const previewPane = el("div", "play-preview");
  previewPane.id = "preview";
  const stale = el("p", "note stale-note");
  stale.setAttribute("role", "status");
  stale.hidden = true;
  const figureHost = el("div", "play-figure");
  previewPane.append(stale, figureHost);
  panel.append(editorPane, previewPane);

  let editor: KsdEditor | null = null;
  let mounted: Mounted | null = null;
  let renderedFor: unknown = null;
  let renderedHidden = false;
  let timer: number | null = null;
  let cursorLine = 1;
  // the standing line (what the diagram is, how its checks went) gives way to a message for a few seconds
  let noticeUntil = 0, standing = "", noticeTimer = 0;
  const summary = (msg: string): void => { standing = msg; if (Date.now() >= noticeUntil) status.textContent = msg; };
  const say = (msg: string): void => {
    status.textContent = msg;
    noticeUntil = Date.now() + 5000;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { if (standing) status.textContent = standing; }, 5000);
  };

  const format = (): void => {
    const next = formatSource(session.parsed);
    if (next === session.text) { say("already tidy"); return; }
    session.setText(next, "tidy");
    say("tidied");
  };

  void import("./editor/editor").then(({ createEditor }) => {
    editorHost.replaceChildren();
    editor = createEditor(editorHost, {
      text: session.text, label: "diagram text",
      onChange: (text) => session.setText(text),
      onUndo: () => { if (!session.undo()) say("nothing to undo"); },
      onRedo: () => { if (!session.redo()) say("nothing to redo"); },
      onFormat: format,
      onCursor: (line) => { cursorLine = line; link(); },
      getDoc: () => session.doc,
    });
    editor.host.setAttribute("aria-labelledby", "ksd-label");
    schedule(0);
  });

  /** Mark in the figure what the cursor's line declares. */
  function link(): void {
    if (!mounted) return;
    for (const g of mounted.svg.querySelectorAll(".is-linked")) g.classList.remove("is-linked");
    const stmt = session.parsed.stmts.find((s) => s.line === cursorLine - 1 && s.owner);
    const d = session.doc;
    if (!stmt || !d || !session.inSync) return;
    const name = d.nodes.find((n) => n.uid === stmt.owner)?.id ?? d.edges.find((e) => e.uid === stmt.owner)?.id;
    if (!name) return;
    for (const g of mounted.svg.querySelectorAll<SVGElement>("[data-name]")) {
      const n = g.getAttribute("data-name") ?? "";
      if (n === name || n.startsWith(name + ":")) g.classList.add("is-linked");
    }
  }

  function render(): void {
    const d = session.doc;
    const bad = firstError(session.parsed);
    stale.hidden = session.inSync || !d;
    if (bad && d) stale.textContent = `the text has a mistake${bad.at.line ? ` on line ${bad.at.line}` : ""}, so this is the last version that worked`;
    if (!d) {
      mounted = null;
      renderedFor = null;
      const card = el("div", "error-card");
      card.setAttribute("role", "alert");
      card.appendChild(el("h2", undefined, "This diagram has a mistake in its text."));
      if (bad) {
        const p = el("p");
        if (bad.line) p.append(`line ${bad.line}: `);
        p.appendChild(el("code", undefined, bad.message));
        card.appendChild(p);
      }
      figureHost.replaceChildren(card);
    } else if (renderedFor !== d || renderedHidden) {
      const keep = mounted?.step ?? 0;
      renderedHidden = panel.hidden || previewPane.clientWidth === 0;
      mounted = mountFigure(figureHost, d, app.measurer, {
        initialStep: keep, lint: true, qa: true, containerWidth: Math.max(100, previewPane.clientWidth || 800), fontStatus: app.fonts, idPrefix: d.meta.id || "fig",
      });
      renderedFor = d;
    }
    const issues = allIssues(session.parsed, session.inSync && mounted ? mounted.lint : null, session.inSync && mounted ? mounted.qa : null);
    editor?.setIssues(issues);
    if (bad) { noticeUntil = 0; summary(bad.line ? `line ${bad.line}: ${bad.message}` : bad.message); }
    else if (d && mounted) {
      const n = mounted.lint.findings.length, q = mounted.qa?.errors.length ?? 0;
      summary(`${TYPE_NAME[d.meta.type] ?? "diagram"}, ${d.nodes.length} nodes, ${d.edges.length} edges, notation check: ${mounted.lint.status}${n ? ` (${n})` : ""}${q ? `, layout: ${q} error${q === 1 ? "" : "s"}` : ""}`);
    }
    link();
  }

  function schedule(ms = 150): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; render(); }, ms);
  }

  // clicking a part of the figure goes to the line that declares it
  figureHost.addEventListener("click", (ev) => {
    const g = (ev.target as Element).closest?.("svg [data-name]");
    const d = session.doc;
    if (!g || !d || !editor) return;
    const name = (g.getAttribute("data-name") ?? "").split(":")[0];
    const owner = d.nodes.find((n) => n.id === name)?.uid ?? d.edges.find((e) => e.id === name)?.uid;
    const line = owner ? lineOf(session.parsed, owner) : null;
    if (line) editor.revealLine(line);
  });

  tidy.addEventListener("click", format);
  find.addEventListener("click", () => editor?.find());
  btnLink.addEventListener("click", () => void copyText(`${location.origin}/#${buildHash({ d: session.text })}`, "link", say));
  btnEmbed.addEventListener("click", () => {
    const d = session.doc;
    const title = d ? `${TYPE_NAME[d.meta.type] ?? "Diagram"}: ${d.meta.title}` : "Diagram";
    void copyText(embedSnippet(location.origin, session.text, d?.meta.id ?? "diagram", title), "embed code", say);
  });
  btnSite.addEventListener("click", () => {
    const d = session.doc;
    const id = d?.meta.id ?? "diagram";
    const name = camel(id);
    const caption = (d?.meta.title ?? "").replace(/"/g, "'");
    void copyText(`import ${name} from "../../diagrams/${id}.ksd?raw";\n<DiagramEmbed ksd={${name}} caption="${caption}" />`, "component line", say);
  });
  btnSvg.addEventListener("click", () => {
    if (mounted && session.doc) void downloadSvg(session.doc, mounted.scene.look, document.documentElement.getAttribute("data-theme")).then(() => say("downloaded the SVG"));
  });

  return {
    refresh(fromOutside) {
      if (fromOutside) editor?.setText(session.text);
      if (!editor) placeholder.textContent = session.text;
      schedule(fromOutside ? 0 : 150);
    },
    shown() { if (renderedHidden || renderedFor !== session.doc) schedule(0); },
    focusLine(line) { editor?.revealLine(line); },
    say,
  };
}
