/**
 * The write view's editor: CodeMirror 6 with the .ksd language, in the site's look.
 *
 * It lives in a shadow root on purpose. CodeMirror writes its styles at run time; in the main
 * document that needs a <style> element, which the page's Content-Security-Policy (style-src 'self')
 * refuses. Inside a shadow root it uses constructed stylesheets, which the policy allows, so the
 * policy stays strict. Theme tokens are CSS custom properties, which cross the shadow boundary.
 *
 * Undo and redo are not CodeMirror's: the session owns one history for both views, so Ctrl+Z here
 * can undo an edit made in the draw view and the other way round.
 */
import { EditorState, type Extension, Annotation, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, toggleComment } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import type { ChalkDoc } from "../../core/doc/types";
import type { Issue } from "../../core/diagnostics";
import { ksdCompletions, ksdIndent, ksdLanguage } from "./language";

export interface EditorOptions {
  text: string;
  label: string;
  onChange(text: string): void;
  onUndo(): void;
  onRedo(): void;
  onFormat(): void;
  /** the line the cursor is on changed (1-based) */
  onCursor?(line: number): void;
  getDoc(): ChalkDoc | null;
}

export interface KsdEditor {
  host: HTMLElement;
  view: EditorView;
  getText(): string;
  /** replace the text from outside (a draw edit, undo, a loaded file), changing as little as possible */
  setText(text: string): void;
  setIssues(issues: Issue[]): void;
  /** mark the lines that declare the element selected elsewhere (1-based), or none */
  setLinked(lines: number[]): void;
  revealLine(line: number): void;
  focus(): void;
  find(): void;
}

const external = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--ink-2)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--accent-strong)", fontWeight: "700" },
  { tag: t.typeName, color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--terra-ink)" },
  { tag: t.operator, color: "var(--ink)", fontWeight: "700" },
  { tag: t.number, color: "var(--accent-strong)" },
  { tag: [t.atom, t.meta], color: "var(--ink-2)" },
  { tag: t.propertyName, color: "var(--ink)" },
  { tag: t.function(t.variableName), color: "var(--accent-strong)" },
  { tag: t.invalid, color: "var(--terra-ink)", textDecoration: "underline wavy" },
]);

const theme = EditorView.theme({
  "&": {
    color: "var(--ink)", backgroundColor: "var(--page-2)", border: "1.5px solid var(--rule)", borderRadius: "6px",
    font: "0.95rem/1.5 var(--font-mono)", minHeight: "24rem", maxHeight: "70vh",
  },
  "&.cm-focused": { outline: "3px solid var(--accent-strong)", outlineOffset: "2px", borderColor: "var(--accent)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5", overflow: "auto" },
  ".cm-content": { padding: "0.5rem 0", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0 0.75rem 0 0.5rem" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--ink-2)", border: "0", borderRight: "1px dashed var(--rule)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.5rem 0 0.6rem", minWidth: "2.2em" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--wash) 45%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)", fontWeight: "700" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--wash)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "2px" },
  ".cm-matchingBracket": { backgroundColor: "var(--wash)", outline: "1px solid var(--accent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--wash) 70%, transparent)" },
  ".cm-linked": { backgroundColor: "color-mix(in srgb, var(--wash) 80%, transparent)", boxShadow: "inset 3px 0 0 var(--accent)" },
  ".cm-tooltip": { backgroundColor: "var(--page)", color: "var(--ink)", border: "1.5px solid var(--rule)", borderRadius: "6px", font: "0.95rem/1.4 var(--font-body)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", maxHeight: "16em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.2rem 0.6rem" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--wash)", color: "var(--ink)" },
  ".cm-completionDetail": { fontFamily: "var(--font-body)", fontStyle: "normal", color: "var(--ink-2)", marginLeft: "0.8em" },
  ".cm-completionIcon": { display: "none" },
  ".cm-diagnostic": { padding: "0.3rem 0.6rem", borderLeft: "0", fontFamily: "var(--font-body)" },
  ".cm-diagnostic-error": { borderLeft: "4px solid var(--terra-ink)" },
  ".cm-diagnostic-warning": { borderLeft: "4px double var(--terra)" },
  ".cm-diagnostic-info": { borderLeft: "4px dotted var(--ink-2)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--terra-ink)", textDecorationThickness: "1.5px", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline dashed var(--terra)", textUnderlineOffset: "3px" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted var(--ink-2)", textUnderlineOffset: "3px" },
  // gutter marks differ in shape as well as color: a filled square, a hollow square, a dot
  ".cm-lint-marker": { width: "0.7em", height: "0.7em", marginTop: "0.45em" },
  ".cm-lint-marker-error": { content: "none", backgroundColor: "var(--terra-ink)" },
  ".cm-lint-marker-warning": { content: "none", border: "2px solid var(--terra-ink)", boxSizing: "border-box" },
  ".cm-lint-marker-info": { content: "none", backgroundColor: "var(--ink-2)", borderRadius: "50%", transform: "scale(0.6)" },
  ".cm-panels": { backgroundColor: "var(--page)", color: "var(--ink)", borderTop: "1px dashed var(--rule)", fontFamily: "var(--font-body)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px dashed var(--rule)" },
  ".cm-search": { padding: "0.4rem 0.6rem", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" },
  ".cm-search label": { fontSize: "0.9rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" },
  ".cm-textfield": { font: "0.95rem var(--font-mono)", color: "var(--ink)", backgroundColor: "var(--page-2)", border: "1.5px solid var(--rule)", borderRadius: "4px", padding: "0.2rem 0.4rem" },
  ".cm-button": { font: "1.05rem/1 var(--font-hand)", color: "var(--ink)", background: "var(--wash)", backgroundImage: "none", border: "0", borderRadius: "0.5em", padding: "0.35rem 0.7rem", cursor: "pointer" },
  ".cm-panel button[name=close]": { font: "1.2rem var(--font-body)", color: "var(--ink-2)", background: "none", border: "0", cursor: "pointer" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--terra) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--terra) 55%, transparent)" },
});

const setLinked = StateEffect.define<number[]>();
const linkedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLinked)) continue;
      const b = new RangeSetBuilder<Decoration>();
      for (const n of [...e.value].sort((a, c) => a - c)) {
        if (n >= 1 && n <= tr.state.doc.lines) b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, Decoration.line({ class: "cm-linked" }));
      }
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const SEVERITY: Record<string, CmDiagnostic["severity"]> = {
  error: "error", critical: "error", major: "warning", warning: "warning", minor: "warning", suggestion: "info", unverified: "info",
};
const WORD: Record<string, string> = { syntax: "mistake", reference: "loose end", notation: "notation", layout: "layout", accessibility: "accessibility", practice: "practice" };

export function createEditor(parent: HTMLElement, o: EditorOptions): KsdEditor {
  const host = document.createElement("div");
  host.className = "ksd-editor";
  const root = host.attachShadow({ mode: "open" });
  parent.appendChild(host);
  let lastLine = -1;
  const run = (fn: () => void) => () => { fn(); return true; };
  const extensions: Extension[] = [
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), EditorState.allowMultipleSelections.of(false),
    indentUnit.of("  "), EditorState.tabSize.of(2), indentOnInput(), ksdIndent, bracketMatching(), closeBrackets(),
    ksdLanguage, syntaxHighlighting(highlight), theme, linkedField,
    autocompletion({ override: [ksdCompletions({ getDoc: o.getDoc })], icons: false }),
    lintGutter(), search({ top: true }), highlightSelectionMatches(),
    EditorView.contentAttributes.of({ "aria-label": o.label, spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
    keymap.of([
      { key: "Mod-z", run: run(o.onUndo), preventDefault: true },
      { key: "Mod-y", run: run(o.onRedo), preventDefault: true },
      { key: "Mod-Shift-z", run: run(o.onRedo), preventDefault: true },
      { key: "Shift-Alt-f", run: run(o.onFormat), preventDefault: true },
      { key: "Mod-/", run: toggleComment },
      ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...lintKeymap,
      // the default keys, minus CodeMirror's own history (the session's is the only one)
      ...defaultKeymap.filter((k) => k.key !== "Mod-z" && k.key !== "Mod-y" && k.key !== "Mod-u"),
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) o.onChange(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const line = u.state.doc.lineAt(u.state.selection.main.head).number;
        if (line !== lastLine) { lastLine = line; o.onCursor?.(line); }
      }
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: o.text, extensions }), parent: root, root });

  return {
    host, view,
    getText: () => view.state.doc.toString(),
    setText(text) {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      // the smallest replacement: keep the common start and end, so the cursor and scroll stay put
      let a = 0;
      const max = Math.min(cur.length, text.length);
      while (a < max && cur.charCodeAt(a) === text.charCodeAt(a)) a++;
      let b = 0;
      while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
      view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) }, annotations: external.of(true) });
    },
    setIssues(issues) {
      const doc = view.state.doc;
      const list: CmDiagnostic[] = [];
      for (const i of issues) {
        if (!i.at || i.at.line < 1 || i.at.line > doc.lines) continue;
        const line = doc.line(i.at.line);
        const from = Math.min(line.to, line.from + i.at.col), to = Math.max(from, Math.min(line.to, line.from + i.at.endCol));
        const what = i.source === "syntax" ? "" : ` (${i.rule_id})`;
        list.push({
          from, to: to === from ? Math.min(line.to, from + 1) : to, severity: SEVERITY[i.severity] ?? "info", source: WORD[i.source],
          message: `${i.severity}: ${i.problem}${what}${i.fix ? `\nfix: ${i.fix}` : ""}`,
        });
      }
      view.dispatch(setDiagnostics(view.state, list));
    },
    setLinked(lines) { view.dispatch({ effects: setLinked.of(lines) }); },
    revealLine(line) {
      if (line < 1 || line > view.state.doc.lines) return;
      const l = view.state.doc.line(line);
      view.dispatch({ selection: { anchor: l.from + (l.text.length - l.text.trimStart().length), head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
      view.focus();
    },
    focus: () => view.focus(),
    find: () => { openSearchPanel(view); },
  };
}
