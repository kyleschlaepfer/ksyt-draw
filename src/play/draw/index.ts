/**
 * The draw view, a workspace that fills the window: one bar of tools across the top, the shape library
 * down the left, the canvas, the properties on the right when asked for, and a status strip. What is
 * selected gets its everyday actions in a small bar beside it on the canvas. It edits the same document
 * as the write view, through the same session, so the two can't disagree.
 */
import { CLASSIFIERS, CONTAINERS, KINDS_FOR, UNLABELED, edgeOp, type ChalkDoc, type DiagramType } from "../../core/doc/types";
import * as cmd from "../../core/doc/commands";
import { firstError, parseMember } from "../../core/doc/parse";
import { printMember } from "../../core/doc/print";
import { NODE_PX, PRECISION_SCALE, PX, SMALL_PX } from "../../core/measure";
import { drawnPath, textRect } from "../../core/geom/resolve";
import { pathLength, pointAt } from "../../core/geom/route";
import { locate, review, type RuleFinding } from "../../core/diagnostics";
import { sortFindings, statusWords } from "../../core/lint";
import { svgElementFrom } from "../../embed/figure";
import shrugSvg from "../art/shrug-neutral.svg?raw";
import { TYPE_NAME, aftermath, button, el, menuButton, type App } from "../app";
import { Canvas, type EditTarget } from "./canvas";
import { svg } from "./dom";
import { icon } from "./icons";
import { Inspector } from "./inspector";
import { InlineEditor } from "./inline-edit";

interface PaletteItem { kind: cmd.PaletteKind; word: string; help: string }

const HELP: Record<string, [word: string, help: string]> = {
  start: ["start", "where the flow starts"], end: ["end", "where the flow ends"],
  process: ["process", "a step, square box"], action: ["action", "a step, rounded box"],
  decision: ["decision", "a question, diamond; label each exit"], merge: ["merge", "paths rejoin, small empty diamond"],
  io: ["input / output", "a parallelogram"], terminator: ["terminator", "a pill with your own word"],
  fork: ["fork", "a bar: everything after it happens at once"], join: ["join", "a bar that waits for every path"],
  "flow-final": ["flow final", "this path ends, the activity goes on"], partition: ["partition", "a swimlane: who does these actions"],
  actor: ["actor", "a role outside the system, stick figure"], "use-case": ["use case", "a goal, ellipse, inside the system"],
  boundary: ["system boundary", "the box the use cases live in"], class: ["class", "a class with attributes and operations"],
  interface: ["interface", "operations a class can implement"], note: ["note", "graphite handwriting, no box"],
};

function paletteFor(type: DiagramType): PaletteItem[] {
  const kinds: cmd.PaletteKind[] = type === "flowchart" ? ["start", "process", "decision", "io", "merge", "terminator", "end", "partition", "note"]
    : type === "activity" ? ["start", "action", "decision", "merge", "fork", "join", "flow-final", "end", "partition", "note"]
    : [...KINDS_FOR[type]];
  return kinds.map((kind) => ({ kind, word: HELP[kind][0], help: HELP[kind][1] }));
}

/** Small recognizable previews. They are controls, not alternate rendering geometry. */
function paletteGlyph(kind: cmd.PaletteKind): SVGSVGElement {
  const out = svg("svg", { class: "palette-glyph", viewBox: "0 0 48 34", width: 48, height: 34 });
  out.setAttribute("aria-hidden", "true");
  const line = (x1: number, y1: number, x2: number, y2: number) => svg("line", { x1, y1, x2, y2 });
  if (kind === "actor") out.append(svg("circle", { cx: 24, cy: 7, r: 4 }), line(24, 11, 24, 22), line(15, 15, 33, 15), line(24, 22, 17, 31), line(24, 22, 31, 31));
  else if (kind === "use-case") out.append(svg("ellipse", { cx: 24, cy: 17, rx: 20, ry: 11 }));
  else if (kind === "decision" || kind === "merge") out.append(svg("path", { d: "M24 3 L44 17 L24 31 L4 17 Z" }));
  else if (kind === "start" || kind === "initial") out.append(svg("circle", { cx: 24, cy: 17, r: 7, class: "glyph-fill" }));
  else if (kind === "end" || kind === "final") out.append(svg("circle", { cx: 24, cy: 17, r: 9 }), svg("circle", { cx: 24, cy: 17, r: 5, class: "glyph-fill" }));
  else if (kind === "flow-final") out.append(svg("circle", { cx: 24, cy: 17, r: 8 }), line(18, 11, 30, 23), line(30, 11, 18, 23));
  else if (kind === "fork" || kind === "join") out.append(svg("rect", { x: 7, y: 14, width: 34, height: 6, rx: 2, class: "glyph-fill" }));
  else if (kind === "io") out.append(svg("path", { d: "M10 5 H43 L37 29 H4 Z" }));
  else if (kind === "terminator" || kind === "action") out.append(svg("rect", { x: 5, y: 6, width: 38, height: 22, rx: kind === "action" ? 7 : 11 }));
  else if (kind === "note") out.append(svg("path", { d: "M9 4 H35 L41 10 V30 H9 Z M35 4 V10 H41" }));
  else if (kind === "boundary" || kind === "partition") out.append(svg("rect", { x: 4, y: 4, width: 40, height: 26 }), line(kind === "partition" ? 15 : 4, 4, kind === "partition" ? 15 : 44, kind === "partition" ? 30 : 10));
  else if (kind === "class" || kind === "interface") out.append(svg("rect", { x: 6, y: 3, width: 36, height: 28 }), line(6, 13, 42, 13), line(6, 22, 42, 22), ...(kind === "interface" ? [svg("text", { x: 24, y: 11, "text-anchor": "middle" })] : []));
  else out.append(svg("rect", { x: 5, y: 6, width: 38, height: 22, rx: 2 }));
  return out;
}

function relationGlyph(op: string): SVGSVGElement {
  const out = svg("svg", { class: "relation-glyph", viewBox: "0 0 48 18", width: 48, height: 18 });
  out.setAttribute("aria-hidden", "true");
  const dashed = op.startsWith("..") || op.includes("include") || op.includes("extend");
  const shaft = (x1 = 5, x2 = 43) => svg("line", { x1, y1: 9, x2, y2: 9, ...(dashed ? { "stroke-dasharray": "4 3" } : {}) });
  if (op.endsWith("|>")) {
    out.append(shaft(5, 35), svg("path", { d: "M35 3 L44 9 L35 15 Z" }));
  } else if (op.startsWith("o--") || op.startsWith("*--")) {
    out.append(svg("path", { d: "M4 9 L10 4 L16 9 L10 14 Z", ...(op.startsWith("*--") ? { class: "glyph-fill" } : {}) }), shaft(16, 44));
  } else if (op === "--") {
    out.append(shaft());
  } else {
    out.append(shaft(5, 38), svg("path", { d: "M37 5 L43 9 L37 13" }));
  }
  return out;
}

/** Per-viewer layout of the workspace: which side zones are open. Kept in this browser only. */
const PANELS_KEY = "chalk-draw-panels";
interface Panels { library: boolean; inspector: boolean }
function loadPanels(): Panels {
  const wide = typeof matchMedia === "function" ? matchMedia("(min-width: 64rem)").matches : true;
  const dflt = { library: wide, inspector: false };
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null") as Partial<Panels> | null;
    if (!v || typeof v !== "object") return dflt;
    // on a narrow screen the side zones lie over the canvas: they start closed whatever was remembered
    return { library: wide && v.library !== false, inspector: wide && v.inspector === true };
  } catch { return dflt; }
}
function savePanels(p: Panels): void {
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(p)); } catch { /* storage blocked: the layout is just not remembered */ }
}

export function mountDraw(panel: HTMLElement, app: App): { refresh(): void; shown(): void; say(msg: string): void } {
  const { session } = app;
  // ---------- layout: a bar across the top, the library, the canvas, the properties, a status strip ----------
  // The canvas is the workspace; everything else is a thin edge around it or lies over it on demand.
  const bar = el("div", "draw-bar");
  const toolbar = el("div", "draw-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "drawing tools");
  const context = el("div", "draw-context");
  const contextType = el("strong", "draw-type");
  const contextTitle = el("span", "draw-title");
  context.append(contextType, contextTitle);
  const rail = el("div", "draw-side");
  rail.setAttribute("aria-label", "shape library");
  rail.setAttribute("role", "region");
  const stage = el("div", "draw-stage");
  const banner = el("p", "note stale-note draw-banner");
  banner.setAttribute("role", "status");
  banner.hidden = true;
  const proposal = el("div", "draw-proposal");
  proposal.hidden = true;
  const foot = el("div", "draw-foot");
  const status = el("p", "play-status note");
  status.setAttribute("aria-live", "polite");
  // what the check found: a count in the status strip that opens into a list over the canvas
  const found = el("details", "draw-findings");
  found.hidden = true;
  foot.append(status, found);
  // the canvas's direct actions for what is selected, beside the selection
  const selbar = el("div", "draw-selbar");
  selbar.setAttribute("role", "toolbar");
  selbar.setAttribute("aria-label", "selection");
  selbar.hidden = true;
  bar.append(toolbar);
  panel.replaceChildren(bar, rail, stage, foot);

  let sayTimer = 0;
  const summary = (): string => {
    const d = session.doc;
    if (!d) return "";
    const r = review(d);
    return `notation check: ${statusWords(r.status)}${r.findings.length ? ` (${r.findings.length})` : ""}`;
  };
  const say = (msg: string): void => {
    status.textContent = msg || summary();
    window.clearTimeout(sayTimer);
    // a message steps aside for the standing summary after a while
    if (msg) sayTimer = window.setTimeout(() => { status.textContent = summary(); }, 6000);
  };

  let relation: string | null = null;
  const inline = new InlineEditor(stage);
  let hidden: SVGElement[] = [];
  const canvas: Canvas = new Canvas(app, {
    say,
    changed: () => chrome(),
    editText: (t) => editText(t),
    relation: () => relation,
    framed: () => placeSelbar(),
  });
  const inspector = new Inspector({ say, canvas, app, close: () => setPanels({ inspector: false }) });
  stage.append(canvas.root, banner, proposal, selbar);
  panel.appendChild(inspector.root);

  // ---------- the side zones: open, closed, remembered ----------
  let panels = loadPanels();
  function setPanels(p: Partial<Panels>, remember = true): void {
    panels = { ...panels, ...p };
    panel.classList.toggle("library-collapsed", !panels.library);
    inspector.setOpen(panels.inspector);
    libraryBtn.setAttribute("aria-expanded", String(panels.library));
    propsBtn.setAttribute("aria-expanded", String(panels.inspector));
    if (remember) savePanels(panels);
  }

  // undo and redo work from anywhere in the view, not only on the canvas: after a click in the panel or the
  // palette, or when the control that was clicked is gone and nothing has the focus, the keys still mean
  // the drawing. A field that is being typed in keeps them for its own text.
  document.addEventListener("keydown", (ev) => {
    if (ev.target === canvas.root || canvas.waiting || !(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    const t = ev.target as HTMLElement;
    if (!panel.getClientRects().length || (t !== document.body && !panel.contains(t))) return;
    if (t instanceof HTMLTextAreaElement || t.isContentEditable || (t instanceof HTMLInputElement && t.type !== "checkbox")) return;
    ev.preventDefault();
    const redo = k === "y" || ev.shiftKey;
    say((redo ? session.redo() : session.undo()) ? (redo ? "redone" : "undone") : redo ? "nothing to redo" : "nothing to undo");
    // the control the keys were pressed on may be gone once the panel is rebuilt: the canvas takes over
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!panel.contains(document.activeElement)) canvas.root.focus({ preventScroll: true }); }));
  });

  // ---------- the palette ----------
  const shapes = el("section", "draw-sec");
  shapes.append(el("h2", undefined, "shapes"));
  const palette = el("div", "draw-palette");
  shapes.appendChild(palette);
  const lines = el("section", "draw-sec");
  const relPalette = el("div", "relation-palette");
  const relSel = el("select");
  relSel.id = "draw-relation";
  const relField = el("label", "draw-field");
  relField.append(el("span", undefined, "dragging from a dot makes"), relSel);
  lines.append(el("h2", undefined, "lines"), relPalette, relField);
  relSel.addEventListener("change", () => { relation = relSel.value || null; });
  const hint = el("p", "note draw-hint", "Drag a shape in, or choose it and click. Choose a line, then click two shapes, or drag from a shape's dot.");
  rail.append(shapes, lines, hint);

  let paletteType: DiagramType | null = null;
  function buildPalette(type: DiagramType): void {
    paletteType = type;
    palette.replaceChildren();
    for (const item of paletteFor(type)) {
      const b = button("draw-shape", item.word, `${item.word}: ${item.help}`);
      b.replaceChildren(paletteGlyph(item.kind), el("span", undefined, item.word));
      b.dataset.kind = item.kind;
      b.addEventListener("pointerdown", (ev) => startPlacing(ev, item));
      b.addEventListener("keydown", (ev) => {
        // the keyboard's way to place: the shape goes to the middle of what is on screen
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        canvas.beginPlace(item.kind);
        canvas.placeAt(canvas.center(), false);
        canvas.root.focus({ preventScroll: true });
      });
      palette.appendChild(b);
    }
    relSel.replaceChildren();
    const usual = el("option", undefined, "the usual one");
    usual.value = "";
    relSel.appendChild(usual);
    relPalette.replaceChildren();
    for (const r of cmd.RELATIONS[type]) {
      const o = el("option", undefined, r.word); o.value = r.op; o.title = r.help; relSel.appendChild(o);
      const b = button("draw-relation-tool", r.word, `${r.word}: ${r.help}. Then click the source and the target.`);
      b.dataset.op = r.op;
      b.setAttribute("aria-pressed", "false");
      b.replaceChildren(relationGlyph(r.op), el("span", undefined, r.word));
      b.addEventListener("click", () => {
        if (canvas.connecting && relation === r.op) { canvas.stopConnectTool(); return; }
        relation = r.op;
        relSel.value = r.op;
        canvas.beginConnectTool(r.op);
      });
      relPalette.appendChild(b);
    }
    relation = null;
  }

  function startPlacing(ev: PointerEvent, item: PaletteItem): void {
    if (ev.button !== 0) return;
    if (!session.inSync) { say("fix the text first: the drawing is showing the last version that worked"); return; }
    ev.preventDefault();
    const sx = ev.clientX, sy = ev.clientY;
    let dragged = false;
    const again = canvas.placing === item.kind;
    canvas.beginPlace(item.kind, true);
    // on a narrow screen the library lies over the canvas: it steps aside once the shape is on its way
    const overlaid = matchMedia("(max-width: 63.99rem)").matches;
    const move = (e: PointerEvent): void => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) { if (!dragged && overlaid) setPanels({ library: false }, false); dragged = true; }
      if (dragged) canvas.placeMove(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dragged) {
        // a drag: dropped on the canvas it lands there; dropped anywhere else it is called off
        if (e.type === "pointercancel" || !canvas.placeDrop(e.clientX, e.clientY)) { canvas.stopPlacing(); say("dropped outside the canvas: nothing added"); }
        else canvas.stopPlacing();
      } else if (again) { canvas.stopPlacing(); say("stopped placing"); }
      else {
        if (overlaid) setPanels({ library: false }, false);
        say(`click the canvas to place the ${item.word}; it stays chosen until Escape`);
        canvas.root.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ---------- the toolbar: one row, words beside small glyphs; the words go first when room runs short ----------
  const tool = (word: string, title: string, run: () => void, o: { id?: string; glyph?: string; keep?: boolean } = {}): HTMLButtonElement => {
    const b = button(`btn-quiet tb${o.keep ? " tb-keep" : ""}`, "", title);
    if (o.id) b.id = o.id;
    if (o.glyph) b.appendChild(icon(o.glyph));
    b.appendChild(el("span", "tb-word", word));
    b.setAttribute("aria-label", word);
    b.addEventListener("click", run);
    return b;
  };
  const libraryBtn = tool("shapes", "show or hide the shape library", () => {
    setPanels({ library: !panels.library });
    say(panels.library ? "shape library shown" : "shape library hidden");
  }, { id: "draw-library", glyph: "shapes", keep: true });
  const selectBtn = tool("select", "the pointer: select, move and resize (Escape)", () => {
    canvas.stopPlacing();
    if (canvas.connecting) canvas.stopConnectTool("selection tool"); else say("selection tool");
    canvas.root.focus({ preventScroll: true });
  }, { id: "draw-select", glyph: "pointer" });
  const undoBtn = tool("undo", "undo (Ctrl+Z)", () => { say(session.undo() ? "undone" : "nothing to undo"); }, { id: "draw-undo", glyph: "undo" });
  const redoBtn = tool("redo", "redo (Ctrl+Y)", () => { say(session.redo() ? "redone" : "nothing to redo"); }, { id: "draw-redo", glyph: "redo" });
  const zoomOut = tool("zoom out", "zoom out (Ctrl+-)", () => canvas.zoomStep(1 / 1.2), { glyph: "minus" });
  zoomOut.classList.add("tb-icon");
  const zoomLabel = button("btn-quiet tb tb-zoom", "100%", "back to actual size (Ctrl+0)");
  zoomLabel.id = "draw-zoom";
  zoomLabel.addEventListener("click", () => canvas.zoomStep(1 / canvas.view.zoom));
  const zoomIn = tool("zoom in", "zoom in (Ctrl++)", () => canvas.zoomStep(1.2), { glyph: "plus" });
  zoomIn.classList.add("tb-icon");
  const fitBtn = tool("fit", "show the whole diagram (Ctrl+1)", () => canvas.fit(), { glyph: "fit" });
  const snapBtn = tool("snap", "keep shapes on an eighth-inch grid (hold Alt to place freely)", () => {
    canvas.gridSnap = !canvas.gridSnap;
    snapBtn.setAttribute("aria-pressed", String(canvas.gridSnap));
    say(canvas.gridSnap ? "snapping to the grid" : "placing freely; shapes still line up with their neighbours");
  }, { glyph: "grid" });
  snapBtn.setAttribute("aria-label", "snap to grid");
  snapBtn.setAttribute("aria-pressed", "false");
  const tidyBtn = tool("tidy up", "hand shapes and lines back to automatic layout", () => {}, { glyph: "tidy", keep: true });
  const tidy = menuButton(tidyBtn, () => {
    const d = session.doc;
    const sel = canvas.selectedNodes().filter((n) => n.place || n.size), selE = canvas.selectedEdges().filter((e) => e.route || e.labelPos);
    const any = !!d && (d.nodes.some((n) => n.place || n.size || n.thickness) || d.edges.some((e) => e.route || e.labelPos) || !!d.pool);
    return [
      { label: "the whole diagram", hint: any ? "automatic layout for everything; you see it before it is kept" : "nothing is placed by hand", disabled: !any || !session.inSync, run: () => propose("tidy up", (x) => {
        for (const n of x.nodes) { delete n.place; delete n.size; delete n.thickness; delete n.inline; }
        for (const e of x.edges) { delete e.route; delete e.labelPos; }
        delete x.pool;
      }) },
      { label: "what is selected", hint: sel.length + selE.length ? `${sel.length + selE.length} placed or routed by hand` : "nothing selected is placed by hand", disabled: !(sel.length + selE.length) || !session.inSync, run: () => propose("tidy up selection", (x) => {
        for (const n of sel) cmd.releaseNode(x, n.uid);
        for (const e of selE) cmd.patchEdge(x, e.uid, { route: null, labelPos: null });
      }) },
      { label: "only the lines", hint: "every route and label goes back to the router", disabled: !d?.edges.some((e) => e.route || e.labelPos) || !session.inSync, run: () => propose("reset routes", (x) => {
        for (const e of x.edges) { delete e.route; delete e.labelPos; }
      }) },
    ];
  });
  const propsBtn = tool("properties", "show or hide the properties of what is selected", () => {
    setPanels({ inspector: !panels.inspector });
    say(panels.inspector ? "properties shown" : "properties hidden");
  }, { id: "draw-properties", glyph: "panel", keep: true });
  const moreBtn = tool("more", "the diagram's type, theme and other settings", () => {}, { glyph: "more" });
  moreBtn.classList.add("tb-icon");
  const theme = (t: string): void => { document.querySelector<HTMLButtonElement>(`[data-theme-set="${t}"]`)?.click(); };
  // on a phone the bar keeps only what is used most; the rest is here (and pinching zooms)
  const narrow = (): boolean => matchMedia("(max-width: 34rem)").matches;
  const more = menuButton(moreBtn, () => [
    ...(narrow() ? [
      { label: "redo", hint: session.redoLabel ? `redo ${session.redoLabel}` : "nothing to redo", disabled: !session.canRedo, run: () => redoBtn.click() },
      { label: canvas.gridSnap ? "stop snapping to the grid" : "snap to the grid", run: () => snapBtn.click() },
    ] : []),
    { label: "start another kind of diagram", hint: "a new, blank diagram; undo brings this one back", run: () => document.getElementById("new-diagram")?.click() },
    { label: "diagram settings", hint: "title, id, which way it runs, how it is drawn", run: () => { canvas.select([]); setPanels({ inspector: true }); } },
    { label: "light theme", run: () => theme("light") },
    { label: "dark theme", run: () => theme("dark") },
    { label: "follow the system theme", run: () => theme("system") },
  ]);
  more.classList.add("menu-end");
  const sep = (cls = ""): HTMLElement => { const s = el("span", `toolbar-sep ${cls}`); s.setAttribute("aria-hidden", "true"); return s; };
  for (const b of [redoBtn, zoomOut, zoomIn, snapBtn]) b.classList.add("tb-narrow-hide");
  const grow = el("span", "toolbar-grow");
  toolbar.append(libraryBtn, context, sep(), selectBtn, sep(), undoBtn, redoBtn, sep(), zoomOut, zoomLabel, zoomIn, fitBtn, sep("tb-narrow-hide"), snapBtn, tidy, grow, propsBtn, more);
  setPanels(panels, false);

  // ---------- the selection's own actions, beside it on the canvas ----------
  let selKey = "";
  function buildSelbar(): void {
    const d = session.doc;
    const nodes = canvas.selectedNodes(), edges = canvas.selectedEdges();
    const key = `${session.text.length}|${nodes.map((n) => n.uid + n.label).join(",")}|${edges.map((e) => e.uid + e.kind + e.navigable + e.meaning).join(",")}|${session.inSync}`;
    if (key === selKey) return;
    selKey = key;
    selbar.replaceChildren();
    if (!d || !session.inSync || nodes.length + edges.length === 0) return;
    const act = (word: string, glyph: string, run: () => void, title = word): HTMLButtonElement => {
      const b = button("btn-quiet sb", "", title);
      b.append(icon(glyph), el("span", "tb-word", word));
      b.setAttribute("aria-label", word);
      b.addEventListener("click", run);
      return b;
    };
    const remove = act("delete", "trash", () => canvas.remove(), "delete (Delete)");
    if (edges.length === 1 && nodes.length === 0) {
      const e = edges[0];
      const rels = cmd.RELATIONS[d.meta.type];
      const op = edgeOp(e, d.meta.type) === "->" && d.meta.type === "class" ? "-->" : edgeOp(e, d.meta.type);
      const pick = el("select", "sb-select");
      pick.setAttribute("aria-label", "what the line means");
      pick.title = "what the line means";
      for (const r of rels) { const o = el("option", undefined, r.word); o.value = r.op; o.title = r.help; pick.appendChild(o); }
      pick.value = rels.some((r) => r.op === op) ? op : rels[0].op;
      pick.addEventListener("change", () => {
        const r = session.edit("change relationship", (x) => cmd.setRelation(x, e.uid, pick.value), { select: [e.uid] });
        const w = rels.find((x) => x.op === pick.value);
        say(r.ok ? `now ${w?.word}: ${w?.help}` : r.message ?? "");
      });
      selbar.append(
        pick,
        act("label", "pencil", () => editText({ type: "edge", uid: e.uid }), "write the line's label (Enter)"),
        act("swap ends", "swap", () => { const r = session.edit("swap ends", (x) => cmd.swapEnds(x, e.uid), { select: [e.uid] }); say(r.ok ? "swapped the ends" : r.message ?? ""); }),
        remove,
      );
    } else if (nodes.length === 1 && edges.length === 0) {
      const n = nodes[0];
      if (!UNLABELED.has(n.kind)) selbar.append(act(CLASSIFIERS.has(n.kind) ? "name" : "text", "pencil", () => editText({ type: "node", uid: n.uid }), "write in the shape (Enter or double-click)"));
      selbar.append(remove);
    } else {
      selbar.append(el("span", "sb-count", `${nodes.length + edges.length} selected`), remove);
    }
    selbar.append(act("properties", "panel", () => setPanels({ inspector: true }), "all of its properties"));
  }
  function placeSelbar(): void {
    // a drag redraws the overlay every frame: the bar does no work until it is over
    if (canvas.busy) { selbar.hidden = true; return; }
    buildSelbar();
    const box = canvas.selectionBox();
    // it steps aside while the pointer is on another shape, so that shape's connection dots are free to use
    const elsewhere = canvas.hovered !== null && !canvas.selection.has(canvas.hovered);
    if (!box || !selbar.childElementCount || inline.active || canvas.busy || elsewhere) { selbar.hidden = true; return; }
    selbar.hidden = false;
    const w = selbar.offsetWidth, h = selbar.offsetHeight;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    let x = (box.x0 + box.x1) / 2 - w / 2;
    // above the selection, clear of its connection dots, or below it when there is no room above
    let y = box.y0 - h - 28;
    if (y < 8) y = box.y1 + 28;
    x = Math.max(8, Math.min(sw - w - 8, x));
    y = Math.max(8, Math.min(sh - h - 8, y));
    selbar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ---------- a previewed change: look first, then keep it or put it back ----------
  let pending: { label: string; fn: (d: ChalkDoc) => void } | null = null;
  const keep = button("btn", "keep it");
  const back = button("btn-quiet", "put it back");
  const proposalText = el("span", "note");
  proposal.append(proposalText, keep, back);
  function propose(label: string, fn: (d: ChalkDoc) => void): void {
    pending = { label, fn };
    canvas.propose(fn);
    proposalText.textContent = "This is what tidying gives.";
    proposal.hidden = false;
    keep.focus();
  }
  function settle(apply: boolean): void {
    const p = pending;
    pending = null;
    proposal.hidden = true;
    canvas.endProposal(apply);
    if (p && apply) {
      const r = session.edit(p.label, p.fn, { hold: false });
      say(r.ok ? "tidied (undo puts it back the way you had it)" : r.message ?? "");
    } else { canvas.refresh(); say("left as it was"); }
    canvas.root.focus({ preventScroll: true });
  }
  keep.addEventListener("click", () => settle(true));
  back.addEventListener("click", () => settle(false));
  proposal.addEventListener("keydown", (ev) => { if (ev.key === "Escape") settle(false); });

  // ---------- editing text in place ----------
  function editText(t: EditTarget): void {
    const d = session.doc, geo = session.geometry;
    if (!d || !geo || !session.inSync) return;
    const z = canvas.view.zoom;
    const precise = (d.meta.look ?? "sketch") === "precision";
    const family = precise ? "body" : "hand";
    const scale = precise ? PRECISION_SCALE : 1;
    const hide = (names: (name: string) => boolean): void => {
      hidden = Array.from(canvas.root.querySelectorAll<SVGElement>(".layer-texts text")).filter((x) => names(x.getAttribute("data-name") ?? ""));
      for (const x of hidden) x.style.visibility = "hidden";
    };
    const done = (): void => { for (const x of hidden) x.style.visibility = ""; hidden = []; canvas.root.focus({ preventScroll: true }); };
    const box = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number; w: number; h: number } => {
      const a = canvas.toScreen([x0, y0]), b = canvas.toScreen([x1, y1]);
      return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
    };
    if (t.type === "node") {
      const n = d.nodes.find((x) => x.uid === t.uid), g = n ? geo.nodes.get(n.id) : undefined;
      if (!n || !g) return;
      canvas.select([n.uid]);
      const title = CONTAINERS.has(n.kind);
      const small = n.kind === "actor" || n.kind === "note" || title;
      let r = box(g.cx - g.w / 2, g.cy - g.h / 2, g.cx + g.w / 2, g.cy + g.h / 2);
      if (n.kind === "partition") r = g.horizontal ? box(g.cx - g.w / 2, g.cy - g.h / 2, g.cx - g.w / 2 + (g.header ?? 0.4), g.cy + g.h / 2) : box(g.cx - g.w / 2, g.cy - g.h / 2, g.cx + g.w / 2, g.cy - g.h / 2 + (g.header ?? 0.4));
      else if (n.kind === "boundary") r = box(g.cx - g.w / 2 + 0.1, g.cy - g.h / 2 + 0.02, g.cx - g.w / 2 + 0.3 + g.tw, g.cy - g.h / 2 + 0.38);
      else if (n.kind === "actor") r = box(g.cx - g.w / 2, g.cy - g.h / 2 + (g.figH ?? 0.85), g.cx + g.w / 2, g.cy + g.h / 2);
      else if (CLASSIFIERS.has(n.kind)) {
        const row = g.cls?.rows.find((x) => x.role === "name");
        r = box(g.cx - g.w / 2, g.cy - g.h / 2 + (row?.cy ?? 0.2) - 0.16, g.cx + g.w / 2, g.cy - g.h / 2 + (row?.cy ?? 0.2) + 0.16);
      }
      hide((name) => name.startsWith(n.id + ":") && !/:m[0-9]+$|:stereotype$|:note$/.test(name));
      inline.open({
        ...r, text: t.seed ?? n.label ?? "", multiline: !title && !CLASSIFIERS.has(n.kind), fontPx: (small ? SMALL_PX : NODE_PX) * scale * z, family,
        align: n.kind === "boundary" ? "left" : "center", caret: t.seed ? "end" : "all", label: `text of ${n.kind} ${n.id}`,
        commit: (text) => {
          const res = session.edit("edit text", (x) => cmd.setLabel(x, n.uid, text), { select: [n.uid] });
          say(res.ok ? aftermath(res) : res.message ?? "");
        },
        done,
      });
      return;
    }
    if (t.type === "member") {
      const n = d.nodes.find((x) => x.uid === t.uid), g = n ? geo.nodes.get(n.id) : undefined;
      const row = g?.cls?.rows.find((x) => x.index === t.index), m = n?.members?.[t.index];
      if (!n || !g || !row || !m) return;
      hide((name) => name === `${n.id}:m${t.index}`);
      inline.open({
        ...box(g.cx - g.w / 2 + 0.06, g.cy - g.h / 2 + row.cy - 0.14, g.cx + g.w / 2 - 0.06, g.cy - g.h / 2 + row.cy + 0.14),
        text: printMember(m), multiline: false, fontPx: SMALL_PX * scale * z, family, align: "left", caret: "all", label: `${m.kind} of ${n.id}`,
        commit: (text) => {
          const members = [...(n.members ?? [])];
          if (!text.trim()) members.splice(t.index, 1);
          else {
            const parsed = parseMember(text);
            if (!parsed) { say("can't read that member: write + name: Type or + name(params): Type"); return; }
            members[t.index] = parsed;
          }
          const res = session.edit("edit member", (x) => cmd.patchNode(x, n.uid, { members }), { select: [n.uid] });
          say(res.ok ? "" : res.message ?? "");
        },
        done,
      });
      return;
    }
    const e = d.edges.find((x) => x.uid === t.uid), eg = geo.edges.find((x) => x.uid === t.uid);
    if (!e || !eg) return;
    canvas.select([e.uid]);
    const spec = geo.texts.find((x) => x.name === `${eg.id}:label`);
    let r: { x: number; y: number; w: number; h: number };
    if (spec) { const tr = textRect(spec, 0.03); r = box(tr[0], tr[1], tr[2], tr[3]); }
    else {
      const path = drawnPath(eg);
      const mid = pointAt(path, pathLength(path) > 1.2 && d.nodes.find((n) => n.id === e.from)?.kind === "decision" ? 0.3 : 0.5).p;
      r = box(mid[0] - 0.3, mid[1] - 0.14, mid[0] + 0.3, mid[1] + 0.14);
    }
    hide((name) => name === `${eg.id}:label`);
    inline.open({
      ...r, text: t.seed ?? e.label ?? "", multiline: false, fontPx: SMALL_PX * scale * z, family, align: "center", caret: t.seed ? "end" : "all",
      label: `label of the line from ${e.from} to ${e.to}`,
      commit: (text) => { const res = session.edit("edit label", (x) => cmd.setLabel(x, e.uid, text), { select: [e.uid] }); say(res.ok ? "" : res.message ?? ""); },
      done,
    });
  }

  // ---------- the notation check's findings ----------
  let foundKey = "";
  function listFindings(): void {
    const d = session.doc;
    const list = d ? (sortFindings(review(d).findings) as RuleFinding[]) : [];
    const key = JSON.stringify(list.map((f) => [f.severity, f.rule_id, f.location, f.problem]));
    found.hidden = !list.length;
    if (key === foundKey) return;
    foundKey = key;
    if (!d || !list.length) { found.replaceChildren(); return; }
    const ul = el("ul");
    for (const f of list) {
      const at = locate(f, d);
      const uids = [...at.nodes.map((id) => d.nodes.find((n) => n.id === id)?.uid ?? ""), ...at.edges].filter((u) => u);
      const li = el("li");
      const head = el("p", "row");
      head.append(el("span", "sev", f.severity), el("span", "sep", "·"), el("span", undefined, f.problem));
      li.appendChild(head);
      if (f.minimal_fix) li.appendChild(el("p", "fix note", f.minimal_fix));
      if (uids.length) {
        const show = button("btn-quiet", "show it", "select what this is about on the canvas");
        show.addEventListener("click", () => {
          // the document may have changed since the list was made
          const live = uids.filter((u) => session.doc?.nodes.some((n) => n.uid === u) || session.doc?.edges.some((e) => e.uid === u));
          if (!live.length) return;
          canvas.select(live);
          canvas.reveal(live[0]);
        });
        li.appendChild(show);
      }
      ul.appendChild(li);
    }
    const head = el("summary");
    head.append(icon("flag"), el("span", undefined, `what the check found (${list.length})`));
    found.replaceChildren(head, ul);
  }

  // ---------- keeping the frame up to date ----------
  function chrome(): void {
    const d = session.doc;
    contextType.textContent = d ? TYPE_NAME[d.meta.type] : "Draw";
    contextTitle.textContent = d?.meta.title ?? "";
    undoBtn.disabled = !session.canUndo;
    redoBtn.disabled = !session.canRedo;
    undoBtn.title = session.undoLabel ? `undo ${session.undoLabel} (Ctrl+Z)` : "nothing to undo";
    redoBtn.title = session.redoLabel ? `redo ${session.redoLabel} (Ctrl+Y)` : "nothing to redo";
    zoomLabel.textContent = `${Math.round(canvas.view.zoom * 100)}%`;
    for (const b of palette.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(canvas.placing === b.dataset.kind));
    for (const b of relPalette.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(canvas.connecting && relation === b.dataset.op));
    selectBtn.setAttribute("aria-pressed", String(!canvas.placing && !canvas.connecting));
    inspector.update();
    placeSelbar();
  }

  function refresh(): void {
    if (panel.hidden) { stale = true; return; }
    stale = false;
    if (pending) { pending = null; proposal.hidden = true; canvas.endProposal(); }
    if (inline.active) inline.close(false);
    const d = session.doc;
    const bad = firstError(session.parsed);
    banner.hidden = session.inSync || !d;
    if (bad && d) {
      banner.replaceChildren(`The text has a mistake${bad.at.line ? ` on line ${bad.at.line}` : ""}, so this is the last version that worked, and it can't be changed here until the text is fixed. `);
      const fix = button("btn-quiet", "fix it in write");
      fix.addEventListener("click", () => app.showTab("write"));
      banner.appendChild(fix);
    }
    stage.classList.toggle("is-readonly", !session.inSync);
    if (!d) {
      // the empty state: the narrator, one line, one link that fixes it
      const empty = el("div", "empty-state");
      const who = el("div", "narrator");
      who.setAttribute("aria-hidden", "true");
      const art = svgElementFrom(shrugSvg);
      art.removeAttribute("role");
      art.removeAttribute("aria-labelledby");
      who.appendChild(art);
      const words = el("div");
      const detail = el("p", "note");
      if (bad) { detail.append(bad.line ? `line ${bad.line}: ` : ""); detail.appendChild(el("code", undefined, bad.message)); }
      const fix = button("btn-quiet", "fix it in write");
      fix.addEventListener("click", () => app.showTab("write"));
      words.append(el("p", "hand", "The text has a mistake, so there's nothing to draw yet."), detail, fix);
      empty.append(who, words);
      stage.replaceChildren(empty, banner);
      listFindings();
      say("");
      return;
    }
    if (!stage.contains(canvas.root)) stage.replaceChildren(canvas.root, banner, proposal, selbar);
    if (paletteType !== d.meta.type) buildPalette(d.meta.type);
    canvas.refresh();
    chrome();
    listFindings();
    if (!status.textContent || status.textContent.startsWith("notation check")) say("");
  }

  let stale = true;
  refresh();
  return {
    refresh,
    shown: () => { if (stale) refresh(); else { canvas.refresh(); chrome(); } },
    say,
  };
}
