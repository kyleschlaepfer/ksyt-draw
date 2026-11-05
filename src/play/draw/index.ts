/**
 * The draw view: a shape palette down the left like a list, a compact toolbar, the canvas, a
 * properties panel that floats over its corner, and a status line. It edits the same document as
 * the write view, through the same session, so the two can't disagree.
 */
import { CLASSIFIERS, CONTAINERS, KINDS_FOR, type ChalkDoc, type DiagramType } from "../../core/doc/types";
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

export function mountDraw(panel: HTMLElement, app: App): { refresh(): void; shown(): void; say(msg: string): void } {
  const { session } = app;
  // ---------- layout ----------
  const rail = el("div", "draw-side");
  const main = el("div", "draw-main");
  const context = el("div", "draw-context");
  const contextWords = el("div", "draw-context-words");
  const contextType = el("strong", "draw-type");
  const contextTitle = el("span", "draw-title");
  contextWords.append(contextType, contextTitle);
  const changeType = button("btn-quiet", "change type", "start a new diagram in another notation; undo restores this one");
  changeType.addEventListener("click", () => document.getElementById("new-diagram")?.click());
  context.append(contextWords, changeType);
  const toolbar = el("div", "draw-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "drawing tools");
  const banner = el("p", "note stale-note draw-banner");
  banner.setAttribute("role", "status");
  banner.hidden = true;
  const stage = el("div", "draw-stage");
  const status = el("p", "play-status note");
  status.setAttribute("aria-live", "polite");
  const proposal = el("div", "draw-proposal");
  proposal.hidden = true;
  // what the check found, each finding a way to the shapes it is about
  const found = el("details", "draw-findings");
  found.hidden = true;
  main.append(context, toolbar, banner, stage, proposal, status, found);
  panel.replaceChildren(rail, main);

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
  });
  const inspector = new Inspector({ say, canvas, app });
  stage.append(canvas.root);
  panel.appendChild(inspector.root);
  canvas.insetRight = 0;

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
  shapes.append(el("h2", undefined, "shape library"), el("p", "note", "drag a symbol in, or choose it and click the canvas"));
  const palette = el("div", "draw-palette");
  shapes.appendChild(palette);
  const lines = el("section", "draw-sec");
  const relPalette = el("div", "relation-palette");
  const relSel = el("select");
  relSel.id = "draw-relation";
  const relField = el("label", "draw-field");
  relField.append(el("span", undefined, "port drags use"), relSel);
  lines.append(el("h2", undefined, "relationships"), el("p", "note", "choose a line and then choose its source and target, or drag a shape's connection dot"), relPalette, relField);
  relSel.addEventListener("change", () => { relation = relSel.value || null; });
  rail.append(shapes, lines);

  let paletteType: DiagramType | null = null;
  function buildPalette(type: DiagramType): void {
    paletteType = type;
    palette.replaceChildren();
    for (const item of paletteFor(type)) {
      const b = button("draw-shape", item.word, item.help);
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
    const usual = el("option", undefined, "the usual for the two shapes");
    usual.value = "";
    relSel.appendChild(usual);
    relPalette.replaceChildren();
    for (const r of cmd.RELATIONS[type]) {
      const o = el("option", undefined, r.word); o.value = r.op; o.title = r.help; relSel.appendChild(o);
      const b = button("draw-relation-tool", r.word, `${r.help}. Choose source and target.`);
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
    const move = (e: PointerEvent): void => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) dragged = true;
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
      else { say(`click the canvas to place the ${item.word} (Shift+click keeps placing, Escape stops)`); canvas.root.focus({ preventScroll: true }); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ---------- the toolbar ----------
  const tool = (word: string, title: string, run: () => void, id?: string): HTMLButtonElement => {
    const b = button("btn-quiet", word, title);
    if (id) b.id = id;
    b.addEventListener("click", run);
    return b;
  };
  const libraryBtn = tool("library", "show or hide the shape library", () => {
    const shown = panel.classList.toggle("library-collapsed") === false;
    libraryBtn.setAttribute("aria-expanded", String(shown));
    say(shown ? "shape library shown" : "shape library hidden");
  }, "draw-library");
  libraryBtn.setAttribute("aria-expanded", "true");
  const selectBtn = tool("select", "leave insertion or connector mode (Escape)", () => {
    canvas.stopPlacing();
    if (canvas.connecting) canvas.stopConnectTool("selection tool"); else say("selection tool");
    canvas.root.focus({ preventScroll: true });
  }, "draw-select");
  const undoBtn = tool("undo", "undo (Ctrl+Z)", () => { say(session.undo() ? "undone" : "nothing to undo"); }, "draw-undo");
  const redoBtn = tool("redo", "redo (Ctrl+Y)", () => { say(session.redo() ? "redone" : "nothing to redo"); }, "draw-redo");
  const zoomOut = tool("−", "zoom out (Ctrl+-)", () => canvas.zoomBy(1 / 1.2));
  zoomOut.setAttribute("aria-label", "zoom out");
  const zoomLabel = tool("100%", "back to actual size (Ctrl+0)", () => canvas.zoomTo(1), "draw-zoom");
  const zoomIn = tool("+", "zoom in (Ctrl++)", () => canvas.zoomBy(1.2));
  zoomIn.setAttribute("aria-label", "zoom in");
  const fitBtn = tool("fit", "show the whole diagram (Ctrl+1)", () => canvas.fit());
  const snapBtn = tool("snap to grid", "keep shapes on an eighth-inch grid (hold Alt to place freely)", () => {
    canvas.gridSnap = !canvas.gridSnap;
    snapBtn.setAttribute("aria-pressed", String(canvas.gridSnap));
    say(canvas.gridSnap ? "snapping to the grid" : "placing freely; shapes still line up with their neighbours");
  });
  snapBtn.setAttribute("aria-pressed", "false");
  const tidy = menuButton(button("btn-quiet", "tidy up", "hand shapes and lines back to automatic layout"), () => {
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
  const sep = (): HTMLElement => { const s = el("span", "toolbar-sep"); s.setAttribute("aria-hidden", "true"); return s; };
  toolbar.append(libraryBtn, selectBtn, sep(), undoBtn, redoBtn, sep(), zoomOut, zoomLabel, zoomIn, fitBtn, sep(), snapBtn, tidy);

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
    canvas.endProposal();
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
    found.replaceChildren(el("summary", undefined, `what the check found (${list.length})`), ul);
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
      stage.replaceChildren(empty);
      listFindings();
      say("");
      return;
    }
    if (!stage.contains(canvas.root)) stage.replaceChildren(canvas.root);
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
