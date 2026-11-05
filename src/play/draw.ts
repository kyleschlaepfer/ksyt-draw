/**
 * The draw tab: place shapes, name them, connect them, drag them. It edits the same text as the
 * write tab: every change is parsed, changed in the model, written back with serialize() and drawn
 * again by the same core, so the drawing and the text can never disagree.
 */
import type { Diagram, DiagramEdge, DiagramNode, DiagramType, EdgeKind, NodeKind } from "../core/model";
import { parse, ParseError } from "../core/parse";
import { serialize } from "../core/serialize";
import { buildScene, type Scene } from "../core/scene";
import { sceneToSvg } from "../core/svg";
import { PX } from "../core/measure";
import { lint, statusWords } from "../core/lint";
import { checkScene } from "../core/qa";
import { canvasMeasurer } from "../embed/measure-dom";
import { errorCard, svgElementFrom } from "../embed/figure";

export interface DrawHost {
  getText(): string;
  setText(text: string): void;
}

interface PaletteItem { kind: string; word: string; help: string }
interface EdgeOption { op: string; word: string; kind: EdgeKind; style: DiagramEdge["style"]; directed: boolean; meaning?: string }

const PALETTE: Record<DiagramType, PaletteItem[]> = {
  flowchart: [
    { kind: "start", word: "start", help: "the pill the flow starts from" },
    { kind: "process", word: "process", help: "a step, square box" },
    { kind: "decision", word: "decision", help: "a question, diamond" },
    { kind: "io", word: "input / output", help: "a parallelogram" },
    { kind: "merge", word: "merge", help: "paths rejoin, small empty diamond" },
    { kind: "terminator", word: "terminator", help: "a pill with your own word" },
    { kind: "end", word: "end", help: "the pill the flow ends at" },
    { kind: "note", word: "note", help: "graphite handwriting, no box" },
  ],
  activity: [
    { kind: "start", word: "start", help: "the initial node, a solid dot" },
    { kind: "action", word: "action", help: "a step, rounded box" },
    { kind: "decision", word: "decision", help: "a question, diamond; label the exits [like this]" },
    { kind: "merge", word: "merge", help: "paths rejoin, small empty diamond" },
    { kind: "fork", word: "fork", help: "a bar: everything after it happens at once" },
    { kind: "join", word: "join", help: "a bar that waits for every path" },
    { kind: "flow-final", word: "flow final", help: "this path ends, the activity goes on" },
    { kind: "end", word: "end", help: "the final node, a bullseye" },
    { kind: "note", word: "note", help: "graphite handwriting, no box" },
  ],
  "use-case": [
    { kind: "actor", word: "actor", help: "a role, stick figure, outside the system" },
    { kind: "use-case", word: "use case", help: "a goal, ellipse, inside the system" },
    { kind: "boundary", word: "system boundary", help: "the box the use cases live in" },
    { kind: "note", word: "note", help: "graphite handwriting, no box" },
  ],
};

const EDGES: Record<DiagramType, EdgeOption[]> = {
  flowchart: [
    { op: "->", word: "then (arrow)", kind: "arrow", style: "solid-arrow", directed: true },
    { op: "..>", word: "proposed path (dashed arrow)", kind: "arrow", style: "dashed-arrow", directed: true, meaning: "proposed" },
  ],
  activity: [
    { op: "->", word: "then (arrow)", kind: "arrow", style: "solid-arrow", directed: true },
    { op: "..>", word: "proposed path (dashed arrow)", kind: "arrow", style: "dashed-arrow", directed: true, meaning: "proposed" },
  ],
  "use-case": [
    { op: "--", word: "uses (association)", kind: "association", style: "plain-line", directed: false },
    { op: "-include->", word: "always includes", kind: "include", style: "dashed-arrow", directed: true },
    { op: "-extend->", word: "sometimes extends", kind: "extend", style: "dashed-arrow", directed: true },
    { op: "->", word: "arrow (the check will flag it)", kind: "arrow", style: "solid-arrow", directed: true },
  ],
};

const TEMPLATE: Record<DiagramType, string> = {
  flowchart: "diagram flowchart\ntitle What this flow shows\n\nstart begin\nend done\n\nbegin -> done\n",
  activity: "diagram activity\ntitle What this activity shows\n\nstart begin\nend done\n\nbegin -> done\n",
  "use-case": 'diagram use-case\ntitle Who uses the system for what\n\nactor actor1 "Actor 1"\nboundary system "System" {\n  use-case usecase1 "use case 1"\n}\n\nactor1 -- usecase1\n',
};

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UNLABELED = new Set(["initial", "final", "flow-final", "fork", "join", "merge"]);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const field = (labelText: string, input: HTMLElement): HTMLElement => {
  const w = el("label", "draw-field");
  w.append(el("span", undefined, labelText), input);
  return w;
};

type Selection = { type: "node"; id: string } | { type: "edge"; id: string } | null;

export function mountDraw(panel: HTMLElement, host: DrawHost): { refresh(): void } {
  // ---------- state ----------
  let d: Diagram | null = null;
  let scene: Scene | null = null;
  let svg: SVGSVGElement | null = null;
  let lastText = "";
  let selected: Selection = null;
  let connectFrom: string | null = null;
  let mode: "select" | "connect" = "select";
  const undo: string[] = [];

  // ---------- layout ----------
  const side = el("div", "draw-side");
  const main = el("div", "draw-main");
  const canvas = el("div", "draw-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "drawing");
  const status = el("p", "play-status");
  status.setAttribute("aria-live", "polite");
  main.append(canvas, status);
  panel.replaceChildren(side, main);

  // diagram section
  const typeSel = el("select");
  typeSel.id = "draw-type";
  for (const [v, w] of [["flowchart", "flowchart"], ["activity", "activity diagram"], ["use-case", "use-case diagram"]]) {
    const o = el("option", undefined, w);
    o.value = v;
    typeSel.appendChild(o);
  }
  const titleIn = el("input");
  titleIn.type = "text";
  titleIn.id = "draw-title";
  const idIn = el("input");
  idIn.type = "text";
  idIn.id = "draw-id";
  const startOver = el("button", "btn-quiet", "start over");
  startOver.type = "button";
  const undoBtn = el("button", "btn-quiet", "undo");
  undoBtn.type = "button";
  const diagramSec = el("section", "draw-sec");
  diagramSec.append(el("h2", undefined, "diagram"), field("type", typeSel), field("title", titleIn), field("id", idIn));
  const diagramActions = el("div", "actions");
  diagramActions.append(undoBtn, startOver);
  diagramSec.appendChild(diagramActions);

  // shapes
  const shapesSec = el("section", "draw-sec");
  shapesSec.append(el("h2", undefined, "shapes"), el("p", "note", "click to add, or drag onto the drawing"));
  const palette = el("div", "draw-palette");
  shapesSec.appendChild(palette);

  // connect
  const connectSec = el("section", "draw-sec");
  const edgeSel = el("select");
  edgeSel.id = "draw-edge-kind";
  const connectBtn = el("button", "btn", "connect two shapes");
  connectBtn.type = "button";
  connectSec.append(el("h2", undefined, "connect"), field("line", edgeSel), connectBtn);

  // selection
  const selSec = el("section", "draw-sec");
  selSec.id = "draw-selected";
  selSec.append(el("h2", undefined, "selected"), el("p", "note", "click a shape or a line"));

  side.append(diagramSec, shapesSec, connectSec, selSec);

  // ---------- helpers ----------
  const say = (msg: string) => { status.textContent = msg; };
  const type = (): DiagramType => d?.claimed_diagram_type ?? "flowchart";
  const node = (id: string) => d?.nodes.find((n) => n.id === id);
  const edge = (id: string) => d?.edges.find((e) => e.id === id);
  const pinned = () => !!d && d.nodes.some((n) => n.at);

  function newId(base: string): string {
    const used = new Set(d!.nodes.map((n) => n.id));
    let n = 1;
    while (used.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  }

  /** Scene point (inches) of a pointer event. */
  function scenePoint(ev: PointerEvent): [number, number] | null {
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const scale = r.width / svg.viewBox.baseVal.width;
    return [(ev.clientX - r.left) / scale / PX, (ev.clientY - r.top) / scale / PX];
  }
  const toLayout = (p: [number, number]): [number, number] => [p[0] - scene!.offset[0], p[1] - scene!.offset[1]];

  /** Pin every node where it is, so the picture stops moving when one node moves. */
  function freeze(): void {
    if (!d || !scene) return;
    for (const n of d.nodes) {
      if (n.kind === "boundary" || n.at) continue;
      const g = scene.nodes.find((g) => g.id === n.id);
      if (g) n.at = toLayout([g.cx, g.cy]);
    }
  }

  function commit(message?: string): void {
    if (!d) return;
    undo.push(lastText);
    if (undo.length > 50) undo.shift();
    const text = serialize(d);
    host.setText(text);
    lastText = text;
    render();
    if (message) say(message);
  }

  // ---------- rendering ----------
  function render(): void {
    if (!d) return;
    scene = buildScene(d, canvasMeasurer);
    svg = svgElementFrom(sceneToSvg(scene, { idPrefix: d.diagram_id || "fig" }));
    canvas.replaceChildren(svg);
    applySelection();
    const r = lint(d);
    const qa = checkScene(scene, { minDisplayPx: 2000 });
    const notes = [`notation check: ${statusWords(r.status)}${r.findings.length ? ` (${r.findings.length})` : ""}`];
    if (qa.errors.length) notes.push(`layout: ${qa.errors.length} error${qa.errors.length === 1 ? "" : "s"}`);
    if (!status.textContent || status.textContent.startsWith("notation")) say(notes.join(", "));
    renderPalette();
    renderSelection();
    typeSel.value = d.claimed_diagram_type;
    if (document.activeElement !== titleIn) titleIn.value = d.web.title;
    if (document.activeElement !== idIn) idIn.value = d.diagram_id;
    undoBtn.disabled = undo.length === 0;
  }

  function applySelection(): void {
    if (!svg) return;
    for (const g of svg.querySelectorAll(".is-selected")) g.classList.remove("is-selected");
    if (!selected) return;
    for (const g of svg.querySelectorAll<SVGElement>("[data-name]")) {
      const name = g.getAttribute("data-name") ?? "";
      if (name === selected.id || name.startsWith(selected.id + ":")) g.classList.add("is-selected");
    }
  }

  function renderPalette(): void {
    palette.replaceChildren();
    for (const item of PALETTE[type()]) {
      const b = el("button", "draw-shape", item.word);
      b.type = "button";
      b.title = item.help;
      b.dataset.kind = item.kind;
      b.addEventListener("pointerdown", (ev) => startPlacing(ev, item));
      palette.appendChild(b);
    }
    edgeSel.replaceChildren();
    for (const e of EDGES[type()]) {
      const o = el("option", undefined, e.word);
      o.value = e.op;
      edgeSel.appendChild(o);
    }
  }

  function renderSelection(): void {
    selSec.replaceChildren(el("h2", undefined, "selected"));
    if (!d || !selected) {
      selSec.appendChild(el("p", "note", "click a shape or a line"));
      return;
    }
    if (selected.type === "node") {
      const n = node(selected.id);
      if (!n) { selected = null; return renderSelection(); }
      selSec.appendChild(el("p", "note", `${n.kind} ${n.id}`));
      const idField = el("input");
      idField.type = "text";
      idField.value = n.id;
      idField.id = "draw-node-id";
      idField.addEventListener("change", () => renameNode(n.id, idField.value.trim()));
      selSec.appendChild(field("id", idField));
      if (!UNLABELED.has(n.kind)) {
        const lab = el("textarea");
        lab.id = "draw-node-label";
        lab.rows = 2;
        lab.value = n.label ?? "";
        lab.addEventListener("input", () => {
          const v = lab.value;
          if (v.includes("\u2014")) { say("no em dashes (house rule)"); return; }
          n.label = v === "" ? null : v;
          commit();
          say("");
        });
        selSec.appendChild(field("text", lab));
      }
      if (n.kind === "actor") {
        const s = el("select");
        s.id = "draw-node-side";
        for (const v of ["left", "right"]) { const o = el("option", undefined, v); o.value = v; s.appendChild(o); }
        s.value = n.side ?? "left";
        s.addEventListener("change", () => { n.side = s.value as "left" | "right"; commit(); });
        selSec.appendChild(field("stands on the", s));
      }
      const boundaries = d.nodes.filter((b) => b.kind === "boundary");
      if (n.kind !== "boundary" && boundaries.length) {
        const s = el("select");
        s.id = "draw-node-inside";
        const none = el("option", undefined, "outside");
        none.value = "";
        s.appendChild(none);
        for (const b of boundaries) { const o = el("option", undefined, b.label ?? b.id); o.value = b.id; s.appendChild(o); }
        s.value = n.inside ?? "";
        s.addEventListener("change", () => moveInside(n.id, s.value || null));
        selSec.appendChild(field("inside", s));
      }
      if (n.at) {
        const unpin = el("button", "btn-quiet", "let it find its own place");
        unpin.type = "button";
        unpin.addEventListener("click", () => { delete n.at; commit("unpinned"); });
        selSec.appendChild(unpin);
      }
    } else {
      const e = edge(selected.id);
      if (!e) { selected = null; return renderSelection(); }
      selSec.appendChild(el("p", "note", `${e.id}: ${e.from} to ${e.to}`));
      const kind = el("select");
      kind.id = "draw-edge-op";
      for (const o of EDGES[type()]) { const opt = el("option", undefined, o.word); opt.value = o.op; kind.appendChild(opt); }
      kind.value = opOf(e);
      kind.addEventListener("change", () => { applyOp(e, kind.value); commit(); });
      selSec.appendChild(field("line", kind));
      const lab = el("input");
      lab.type = "text";
      lab.id = "draw-edge-label";
      lab.value = e.label ?? "";
      lab.addEventListener("input", () => {
        if (lab.value.includes("\u2014")) { say("no em dashes (house rule)"); return; }
        e.label = lab.value.trim() || null;
        commit();
      });
      selSec.appendChild(field("label", lab));
      const swap = el("button", "btn-quiet", "swap ends");
      swap.type = "button";
      swap.addEventListener("click", () => { [e.from, e.to] = [e.to, e.from]; commit("swapped"); });
      selSec.appendChild(swap);
    }
    const del = el("button", "btn-quiet", "delete");
    del.type = "button";
    del.id = "draw-delete";
    del.addEventListener("click", deleteSelected);
    selSec.appendChild(del);
  }

  function opOf(e: DiagramEdge): string {
    if (e.kind === "include") return "-include->";
    if (e.kind === "extend") return "-extend->";
    if (e.kind === "association") return "--";
    return e.style === "dashed-arrow" ? "..>" : "->";
  }
  function applyOp(e: DiagramEdge, op: string): void {
    const o = EDGES[type()].find((x) => x.op === op) ?? EDGES[type()][0];
    e.kind = o.kind;
    e.style = o.style;
    e.directed = o.directed;
    if (o.meaning) e.meaning = o.meaning;
    else delete e.meaning;
  }

  // ---------- edits ----------
  function addNode(kind: string, at: [number, number] | null): void {
    if (!d) return;
    const t = type();
    let real: NodeKind;
    let label: string | null;
    if (kind === "start") { real = t === "flowchart" ? "terminator" : "initial"; label = t === "flowchart" ? "start" : null; }
    else if (kind === "end") { real = t === "flowchart" ? "terminator" : "final"; label = t === "flowchart" ? "end" : null; }
    else { real = kind as NodeKind; label = null; }
    const base = kind.replace(/[^a-z]/g, "") || "node";
    const id = newId(base);
    if (label === null && !UNLABELED.has(real)) {
      label = real === "boundary" ? "System" : real === "actor" ? `Actor ${id.replace(base, "")}` : `${kind.replace(/-/g, " ")} ${id.replace(base, "")}`;
    }
    const n: DiagramNode = { id, kind: real, label, step: 0 };
    if (at) {
      freeze();
      n.at = at;
    } else if (pinned() && scene) {
      // a frozen drawing: put the new shape under everything, in the middle
      const ns = scene.nodes.filter((g) => g.kind !== "boundary");
      const x = ns.length ? ns.reduce((s, g) => s + g.cx, 0) / ns.length : 1;
      const y = ns.length ? Math.max(...ns.map((g) => g.cy + g.h / 2)) + 0.9 : 1;
      n.at = toLayout([x, y]);
    }
    // use cases join the first boundary; boundaries open their own block
    const boundaries = d.nodes.filter((b) => b.kind === "boundary");
    if (real === "use-case" && boundaries.length) {
      const b = boundaries[0];
      n.inside = b.id;
      if (n.at && !insideBoundary(n.at, b.id)) delete n.inside;
    }
    if (n.inside) {
      let idx = d.nodes.findIndex((m) => m.id === n.inside);
      while (idx + 1 < d.nodes.length && d.nodes[idx + 1].inside === n.inside) idx++;
      d.nodes.splice(idx + 1, 0, n);
    } else d.nodes.push(n);
    selected = { type: "node", id };
    commit(`added ${kind} ${id}`);
    (document.getElementById("draw-node-label") as HTMLTextAreaElement | null)?.select();
  }

  function insideBoundary(at: [number, number], bid: string): boolean {
    const g = scene?.nodes.find((n) => n.id === bid);
    if (!g) return true;
    const p: [number, number] = [at[0] + scene!.offset[0], at[1] + scene!.offset[1]];
    return Math.abs(p[0] - g.cx) < g.w / 2 && Math.abs(p[1] - g.cy) < g.h / 2;
  }

  function moveInside(id: string, bid: string | null): void {
    if (!d) return;
    const n = node(id)!;
    d.nodes = d.nodes.filter((m) => m.id !== id);
    if (bid) {
      n.inside = bid;
      let idx = d.nodes.findIndex((m) => m.id === bid);
      while (idx + 1 < d.nodes.length && d.nodes[idx + 1].inside === bid) idx++;
      d.nodes.splice(idx + 1, 0, n);
    } else {
      delete n.inside;
      d.nodes.push(n);
    }
    commit();
  }

  function renameNode(oldId: string, newId: string): void {
    if (!d || newId === oldId) return;
    if (!ID_RE.test(newId)) { say("an id is a letter, then letters, digits, - or _"); renderSelection(); return; }
    if (d.nodes.some((n) => n.id === newId)) { say(`${newId} is already taken`); renderSelection(); return; }
    const n = node(oldId)!;
    n.id = newId;
    for (const m of d.nodes) if (m.inside === oldId) m.inside = newId;
    for (const e of d.edges) { if (e.from === oldId) e.from = newId; if (e.to === oldId) e.to = newId; }
    selected = { type: "node", id: newId };
    commit(`renamed ${oldId} to ${newId}`);
  }

  function addEdge(from: string, to: string): void {
    if (!d) return;
    const o = EDGES[type()].find((x) => x.op === edgeSel.value) ?? EDGES[type()][0];
    const e: DiagramEdge = { id: `e${d.edges.length + 1}`, kind: o.kind, from, to, label: null, style: o.style, directed: o.directed, step: 0 };
    if (o.meaning) e.meaning = o.meaning;
    d.edges.push(e);
    renumberEdges();
    selected = { type: "edge", id: e.id };
    commit(`connected ${from} ${o.op} ${to}`);
    if (type() !== "use-case" && node(from)?.kind === "decision") (document.getElementById("draw-edge-label") as HTMLInputElement | null)?.focus();
  }

  function renumberEdges(): void {
    d!.edges.forEach((e, i) => { e.id = `e${i + 1}`; });
  }

  function deleteSelected(): void {
    if (!d || !selected) return;
    if (selected.type === "node") {
      const id = selected.id;
      const n = node(id);
      if (n?.kind === "boundary") for (const m of d.nodes) if (m.inside === id) delete m.inside;
      d.nodes = d.nodes.filter((m) => m.id !== id);
      d.edges = d.edges.filter((e) => e.from !== id && e.to !== id);
      renumberEdges();
      selected = null;
      commit(`deleted ${id}`);
    } else {
      const id = selected.id;
      d.edges = d.edges.filter((e) => e.id !== id);
      renumberEdges();
      selected = null;
      commit(`deleted ${id}`);
    }
  }

  function moveNode(id: string, dx: number, dy: number): void {
    if (!d || !scene) return;
    const n = node(id);
    if (!n || n.kind === "boundary") return;
    freeze();
    const g = scene.nodes.find((x) => x.id === id)!;
    const base = n.at ?? toLayout([g.cx, g.cy]);
    n.at = [base[0] + dx, base[1] + dy];
    commit();
  }

  // ---------- pointer: select, drag, connect ----------
  let drag: { id: string; sx: number; sy: number; moved: boolean; targets: SVGElement[] } | null = null;

  function elementAt(target: EventTarget | null): Selection {
    const g = (target as Element | null)?.closest?.("[data-name]") as SVGElement | null;
    if (!g || !d) return null;
    const name = (g.getAttribute("data-name") ?? "").split(":")[0];
    if (d.nodes.some((n) => n.id === name)) return { type: "node", id: name };
    if (d.edges.some((e) => e.id === name)) return { type: "edge", id: name };
    return null;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!svg || !d) return;
    const hit = elementAt(ev.target);
    if (mode === "connect") {
      if (hit?.type !== "node") return;
      if (!connectFrom) { connectFrom = hit.id; say(`now click the second shape (${hit.id} is the first)`); return; }
      if (connectFrom === hit.id) { say("pick a different second shape"); return; }
      const from = connectFrom;
      connectFrom = null;
      mode = "select";
      connectBtn.textContent = "connect two shapes";
      addEdge(from, hit.id);
      return;
    }
    selected = hit;
    applySelection();
    renderSelection();
    if (hit?.type === "node" && node(hit.id)?.kind !== "boundary") {
      const targets = Array.from(svg.querySelectorAll<SVGElement>("[data-name]")).filter((g) => {
        const name = g.getAttribute("data-name") ?? "";
        return name === hit.id || name.startsWith(hit.id + ":");
      });
      drag = { id: hit.id, sx: ev.clientX, sy: ev.clientY, moved: false, targets };
      canvas.setPointerCapture(ev.pointerId);
    }
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drag || !svg) return;
    const r = svg.getBoundingClientRect();
    const scale = r.width / svg.viewBox.baseVal.width;
    const dx = (ev.clientX - drag.sx) / scale, dy = (ev.clientY - drag.sy) / scale;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    for (const t of drag.targets) t.setAttribute("transform", `translate(${dx} ${dy})`);
  });
  const endDrag = (ev: PointerEvent) => {
    if (!drag || !svg) return;
    const r = svg.getBoundingClientRect();
    const scale = r.width / svg.viewBox.baseVal.width;
    const dx = (ev.clientX - drag.sx) / scale / PX, dy = (ev.clientY - drag.sy) / scale / PX;
    const id = drag.id, moved = drag.moved;
    drag = null;
    if (moved) moveNode(id, dx, dy);
    else render();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", () => {
    (document.getElementById("draw-node-label") as HTMLTextAreaElement | null)?.focus();
  });
  canvas.addEventListener("keydown", (ev) => {
    if (!selected) return;
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); deleteSelected(); return; }
    if (selected.type !== "node") return;
    const step = ev.shiftKey ? 0.5 : 0.1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) { ev.preventDefault(); moveNode(selected.id, ...moves[ev.key]); }
  });

  // palette: click adds, drag places
  let placing: { item: PaletteItem; ghost: HTMLElement; moved: boolean } | null = null;
  function startPlacing(ev: PointerEvent, item: PaletteItem): void {
    if (!d) return;
    ev.preventDefault();
    const ghost = el("div", "draw-ghost", item.word);
    document.body.appendChild(ghost);
    ghost.style.left = `${ev.clientX + 8}px`;
    ghost.style.top = `${ev.clientY + 8}px`;
    placing = { item, ghost, moved: false };
    const sx = ev.clientX, sy = ev.clientY;
    const move = (e: PointerEvent) => {
      if (!placing) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) placing.moved = true;
      placing.ghost.style.left = `${e.clientX + 8}px`;
      placing.ghost.style.top = `${e.clientY + 8}px`;
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!placing) return;
      placing.ghost.remove();
      const { item: it, moved } = placing;
      placing = null;
      const r = svg?.getBoundingClientRect();
      const over = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (moved && over) addNode(it.kind, toLayout(scenePoint(e)!));
      else if (!moved) addNode(it.kind, null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---------- sidebar controls ----------
  typeSel.addEventListener("change", () => {
    if (!d) return;
    d.claimed_diagram_type = typeSel.value as DiagramType;
    d.notation_profile = ({ flowchart: "general-diagram", activity: "uml-inspired", "use-case": "uml-inspired" } as const)[d.claimed_diagram_type];
    commit(`now a ${typeSel.options[typeSel.selectedIndex].text}`);
  });
  titleIn.addEventListener("input", () => {
    if (!d) return;
    if (titleIn.value.includes("\u2014")) { say("no em dashes (house rule)"); return; }
    if (!titleIn.value.trim()) { say("a diagram needs a title"); return; }
    d.web.title = titleIn.value.trim();
    commit();
  });
  idIn.addEventListener("change", () => {
    if (!d) return;
    if (!ID_RE.test(idIn.value.trim())) { say("an id is a letter, then letters, digits, - or _"); idIn.value = d.diagram_id; return; }
    d.diagram_id = idIn.value.trim();
    commit();
  });
  startOver.addEventListener("click", () => {
    undo.push(lastText);
    host.setText(TEMPLATE[type()]);
    selected = null;
    refresh();
    say("started over (undo brings it back)");
  });
  undoBtn.addEventListener("click", doUndo);
  function doUndo(): void {
    const prev = undo.pop();
    if (prev === undefined) return;
    host.setText(prev);
    selected = null;
    lastText = "";
    refresh();
    say("undone");
  }
  panel.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !(ev.target as HTMLElement).matches("input, textarea")) { ev.preventDefault(); doUndo(); }
    if (ev.key === "Escape") { mode = "select"; connectFrom = null; connectBtn.textContent = "connect two shapes"; selected = null; applySelection(); renderSelection(); say(""); }
  });
  connectBtn.addEventListener("click", () => {
    if (mode === "connect") { mode = "select"; connectFrom = null; connectBtn.textContent = "connect two shapes"; say(""); return; }
    mode = "connect";
    connectFrom = null;
    connectBtn.textContent = "cancel connecting";
    say("click the first shape");
  });

  // ---------- refresh from the text ----------
  function refresh(): void {
    const text = host.getText();
    if (text === lastText && d) return;
    lastText = text;
    try {
      d = parse(text);
    } catch (e) {
      d = null;
      scene = null;
      svg = null;
      canvas.replaceChildren(errorCard("The text has a mistake. Fix it on the write tab first.", e instanceof ParseError ? e.msg : String(e), e instanceof ParseError ? e.line : null));
      say("");
      renderSelection();
      return;
    }
    if (selected && !(selected.type === "node" ? node(selected.id) : edge(selected.id))) selected = null;
    render();
  }

  return { refresh };
}
