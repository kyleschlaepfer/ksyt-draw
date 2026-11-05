/**
 * The draw view's canvas: a pannable, zoomable workspace over the document's own coordinates.
 *
 * The canvas owns no geometry. Every frame, including each frame of a drag, it asks the core to
 * resolve a document (the session's, or a draft with the change in progress) and shows the result, so
 * what is on screen is exactly what the write preview, the embed and the exports will draw. A gesture
 * becomes one session edit when it ends: one undo step, one targeted change to the text.
 *
 * Layers, bottom to top: grid, the picture (containers, lines, shapes, text), invisible hit targets,
 * then the overlay (selection, handles, ports, guides) in screen space so its sizes ignore zoom.
 */
import type { ChalkDoc, DocEdge, DocNode, Look, Side } from "../../core/doc/types";
import { CONTAINERS, UNLABELED, cloneDoc } from "../../core/doc/types";
import * as cmd from "../../core/doc/commands";
import { PX } from "../../core/measure";
import { resolve, drawnPath, textRect, type EdgeGeom, type Geometry } from "../../core/geom/resolve";
import { nearestT, pointAt, routeEdge } from "../../core/geom/route";
import { SIDES, boxOf, contains, nodeSize, resizable, sideAnchor, type NodeGeom, type Pt } from "../../core/geom/shape";
import { bounds, snapGrid, snapMove, type Box, type Guide } from "../../core/geom/arrange";
import { paintContext, paintEdge, paintNode, textEl, type Element as SceneElement } from "../../core/render/scene";
import { elementMarkup, linePath, textMarkup } from "../../core/render/svg";
import type { App } from "../app";
import { KeyedLayer, parseSvg, svg } from "./dom";

export interface CanvasHost {
  say(msg: string): void;
  /** the selection, the document or the tool changed: refresh the panels around the canvas */
  changed(): void;
  /** open the in-place editor for a shape's text, a line's label or a class member */
  editText(target: EditTarget): void;
  /** the relationship new lines get (null: the usual one for the two shapes) */
  relation(): string | null;
}

export type EditTarget =
  | { type: "node"; uid: string; seed?: string }
  | { type: "edge"; uid: string; seed?: string }
  | { type: "member"; uid: string; index: number };

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const GRID = 0.125;
const MIN_ZOOM = 0.2, MAX_ZOOM = 4;

type Gesture =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { type: "marquee"; from: Pt; to: Pt; add: boolean }
  | { type: "move"; start: Pt; ids: string[]; boxes: Box[]; moved: boolean; clicked: string; wasSelected: boolean; dx: number; dy: number }
  | { type: "resize"; id: string; handle: Handle; box: Box; start: Pt; next: Box | null }
  | { type: "connect"; from: string; side: Side; at: Pt; target: string | null; targetSide: Side | null; ok: boolean; why: string }
  | { type: "reconnect"; edge: string; end: "from" | "to"; at: Pt; target: string | null; targetSide: Side | null; ok: boolean; why: string }
  | { type: "segment"; edge: string; index: number; points: Pt[]; start: Pt; horizontal: boolean; via: Pt[] | null }
  | { type: "via"; edge: string; index: number; via: Pt[]; moved: boolean }
  | { type: "label"; edge: string; moved: boolean; start: Pt; pos: { t: number; dx: number; dy: number } | null }
  | { type: "divider"; lane: string; start: Pt; base: number; value: number | null }
  | { type: "place"; kind: cmd.PaletteKind; at: Pt | null; sticky: boolean };

export class Canvas {
  readonly root: HTMLDivElement;
  readonly svgEl: SVGSVGElement;
  view = { x: 48, y: 48, zoom: 1 };
  /** uids of selected shapes and lines */
  selection = new Set<string>();
  gridSnap = false;
  private world: SVGGElement;
  private grid: SVGRectElement;
  private gridPattern: SVGPatternElement;
  private layers: { containers: KeyedLayer; edges: KeyedLayer; nodes: KeyedLayer; texts: KeyedLayer; hits: KeyedLayer };
  private ghost: SVGGElement;
  private overlay: SVGGElement;
  private doc: ChalkDoc | null = null;
  private geo: Geometry | null = null;
  private gesture: Gesture | null = null;
  private guides: Guide[] = [];
  private hover: string | null = null;
  private space = false;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; cx: number; cy: number; vx: number; vy: number } | null = null;
  private paintCache = new Map<string, string>();
  private fitted = false;
  private locked = false;

  constructor(private app: App, private host: CanvasHost) {
    this.root = document.createElement("div");
    this.root.className = "draw-canvas";
    this.root.tabIndex = 0;
    this.root.setAttribute("role", "application");
    this.root.setAttribute("aria-roledescription", "drawing canvas");
    this.root.setAttribute("aria-label", "drawing canvas: Tab steps through the shapes, arrows nudge, Enter edits text, Delete removes, Escape lets go");
    this.svgEl = svg("svg", { class: "draw-svg ksyt-fig", width: "100%", height: "100%" });
    this.svgEl.setAttribute("aria-hidden", "true");
    const defs = svg("defs");
    this.gridPattern = svg("pattern", { id: "draw-grid", patternUnits: "userSpaceOnUse", width: 24, height: 24 });
    this.gridPattern.appendChild(svg("circle", { cx: 1, cy: 1, r: 1, class: "grid-dot" }));
    defs.appendChild(this.gridPattern);
    this.grid = svg("rect", { width: "100%", height: "100%", fill: "url(#draw-grid)", class: "grid" });
    this.world = svg("g", { class: "world" });
    const layer = (cls: string): KeyedLayer => { const g = svg("g", { class: cls }); this.world.appendChild(g); return new KeyedLayer(g); };
    this.layers = { containers: layer("layer-containers"), edges: layer("layer-edges"), nodes: layer("layer-nodes"), texts: layer("layer-texts"), hits: layer("layer-hits") };
    this.ghost = svg("g", { class: "ghost" });
    this.world.appendChild(this.ghost);
    this.overlay = svg("g", { class: "overlay" });
    this.svgEl.append(defs, this.grid, this.world, this.overlay);
    this.root.appendChild(this.svgEl);
    this.bind();
  }

  // ---------------------------------------------------------------- coordinates
  private rect(): DOMRect { return this.svgEl.getBoundingClientRect(); }
  /** client pixels -> document inches */
  toWorld(clientX: number, clientY: number): Pt {
    const r = this.rect();
    return [(clientX - r.left - this.view.x) / this.view.zoom / PX, (clientY - r.top - this.view.y) / this.view.zoom / PX];
  }
  /** document inches -> pixels inside the canvas */
  toScreen(p: Pt): Pt { return [p[0] * PX * this.view.zoom + this.view.x, p[1] * PX * this.view.zoom + this.view.y]; }
  /** screen pixels as a length in inches */
  private px(n: number): number { return n / this.view.zoom / PX; }

  private get look(): Look { return this.app.session.doc?.meta.look ?? "sketch"; }
  get geometry(): Geometry | null { return this.geo; }
  get shownDoc(): ChalkDoc | null { return this.doc; }
  node(uid: string): DocNode | undefined { return this.app.session.doc?.nodes.find((n) => n.uid === uid); }
  edge(uid: string): DocEdge | undefined { return this.app.session.doc?.edges.find((e) => e.uid === uid); }
  private geomOf(uid: string): NodeGeom | undefined {
    const n = this.doc?.nodes.find((x) => x.uid === uid);
    return n ? this.geo?.nodes.get(n.id) : undefined;
  }
  private edgeGeom(uid: string): EdgeGeom | undefined { return this.geo?.edges.find((e) => e.uid === uid); }
  selectedNodes(): DocNode[] { return (this.app.session.doc?.nodes ?? []).filter((n) => this.selection.has(n.uid)); }
  selectedEdges(): DocEdge[] { return (this.app.session.doc?.edges ?? []).filter((e) => this.selection.has(e.uid)); }

  // ---------------------------------------------------------------- showing a document
  /** The session changed (or the view was shown): draw its document. */
  refresh(): void {
    const s = this.app.session;
    this.gesture = this.gesture?.type === "place" ? this.gesture : null;
    this.guides = [];
    const d = s.doc;
    if (d) {
      const ids = new Set([...d.nodes.map((n) => n.uid), ...d.edges.map((e) => e.uid)]);
      const keep = (s.selection.length ? s.selection : [...this.selection]).filter((u) => ids.has(u));
      this.selection = new Set(keep);
      s.selection = keep;
    } else this.selection.clear();
    // the whole automatic layout slid (a wider box re-centered its column): pan by the same amount, so nothing appears to move
    if (s.lastShift && this.fitted) {
      this.view = { ...this.view, x: this.view.x - s.lastShift[0] * PX * this.view.zoom, y: this.view.y - s.lastShift[1] * PX * this.view.zoom };
      s.lastShift = null;
      this.applyView();
    }
    s.lastShift = null;
    this.show(d, s.geometry);
    if (!this.fitted && this.root.clientWidth > 0 && s.geometry) {
      this.fitted = true;
      const saved = this.app.workspace.view;
      if (saved) this.view = { ...saved }; else this.fit(1);
      this.applyView();
    }
  }

  private show(d: ChalkDoc | null, geo: Geometry | null): void {
    this.doc = d;
    this.geo = geo;
    this.paint();
    this.drawOverlay();
  }

  /** Show what an edit would give without making it (tidy up asks before it keeps the result). The canvas waits. */
  propose(edit: (draft: ChalkDoc) => void): void {
    this.selection.clear();
    this.locked = true;
    this.preview(edit, new Set(), true);
    this.root.classList.add("is-waiting");
  }
  endProposal(): void {
    this.locked = false;
    this.root.classList.remove("is-waiting");
  }

  /** Resolve a draft of the document (a gesture in progress) and show it, without touching the session. */
  private preview(edit: (draft: ChalkDoc) => void, moved: Set<string> = new Set(), full = false): void {
    const base = this.app.session;
    if (!base.doc || !base.geometry) return;
    const draft = cloneDoc(base.doc);
    try { edit(draft); } catch { return; }
    const big = draft.nodes.length > 60;
    const geo = resolve(draft, this.app.measurer, big && !full ? { partial: { from: base.geometry, moved } } : {});
    this.show(draft, geo);
  }

  private paint(): void {
    const d = this.doc, geo = this.geo;
    if (!d || !geo) { for (const l of Object.values(this.layers)) l.clear(); return; }
    const look = this.look;
    const ctx = paintContext(geo);
    const uidOfNode = new Map(d.nodes.map((n) => [n.id, n.uid]));
    const cached = (key: string, make: () => SceneElement): string => {
      const hit = this.paintCache.get(key);
      if (hit) return hit;
      const markup = elementMarkup(make());
      this.paintCache.set(key, markup);
      return markup;
    };
    if (this.paintCache.size > 4000) this.paintCache.clear();
    const containers: Array<[string, string]> = [], nodes: Array<[string, string]> = [];
    for (const id of geo.order) {
      const g = geo.nodes.get(id)!;
      const isContainer = g.shape === "container" || g.shape === "lane";
      const sig = `${look}|${geo.id}|n|${JSON.stringify([g.id, g.kind, g.cx, g.cy, g.w, g.h, g.style, g.header, g.horizontal, g.vertical, g.cls?.dividers, ctx.firstLane.has(g.id)])}`;
      const markup = cached(sig, () => ({ name: g.id, kind: isContainer ? "container" : "node", step: 0, paints: paintNode(g, look, ctx) }));
      (isContainer ? containers : nodes).push([uidOfNode.get(id) ?? id, markup]);
    }
    const edges: Array<[string, string]> = geo.edges.map((e) => {
      const sig = `${look}|${geo.id}|e|${JSON.stringify([e.id, e.kind, e.points, e.smooth, e.dashed, e.directed, e.style])}`;
      return [e.uid, cached(sig, () => ({ name: e.id, kind: "edge", step: 0, paints: paintEdge(e, look, ctx) }))];
    });
    this.layers.containers.update(containers);
    this.layers.edges.update(edges);
    this.layers.nodes.update(nodes);
    this.layers.texts.update(geo.texts.map((t) => [t.name, textMarkup(textEl(this.app.measurer, t, look))]));
    this.layers.hits.update(this.hitTargets(d, geo));
  }

  /** Invisible shapes that take the pointer: generous around thin lines and small dots, exact on big shapes. */
  private hitTargets(d: ChalkDoc, geo: Geometry): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const f = (v: number): string => (v * PX).toFixed(1);
    const uid = new Map(d.nodes.map((n) => [n.id, n.uid]));
    for (const id of geo.order) {
      const g = geo.nodes.get(id)!;
      const u = uid.get(id)!;
      const [x0, y0, x1, y1] = boxOf(g);
      if (g.shape === "container") {
        out.push([`c:${u}`, `<g data-uid="${u}" data-container="1"><rect class="hit-line" x="${f(x0)}" y="${f(y0)}" width="${f(g.w)}" height="${f(g.h)}"/>` +
          `<rect class="hit" x="${f(x0)}" y="${f(y0)}" width="${f(Math.min(g.w, g.tw + 0.4))}" height="${f(g.header ?? 0.3)}"/></g>`]);
      } else if (g.shape === "lane") {
        const hd = g.header ?? 0;
        const head = g.horizontal ? `x="${f(x0)}" y="${f(y0)}" width="${f(hd)}" height="${f(g.h)}"` : `x="${f(x0)}" y="${f(y0)}" width="${f(g.w)}" height="${f(hd)}"`;
        const div = g.horizontal ? `M${f(x0)} ${f(y1)} L${f(x1)} ${f(y1)}` : `M${f(x1)} ${f(y0)} L${f(x1)} ${f(y1)}`;
        out.push([`c:${u}`, `<g data-uid="${u}" data-container="1"><rect class="hit" ${head}/><path class="hit-line divider ${g.horizontal ? "row" : "col"}" data-divider="${u}" d="${div}"/></g>`]);
      }
    }
    for (const e of geo.edges) {
      out.push([`e:${e.uid}`, `<path class="hit-line" data-uid="${e.uid}" d="${linePath(drawnPath(e), false)}"/>`]);
    }
    for (const id of geo.order) {
      const g = geo.nodes.get(id)!;
      if (g.shape === "container" || g.shape === "lane") continue;
      const u = uid.get(id)!;
      const [x0, y0] = boxOf(g);
      let shape: string;
      if (g.shape === "diamond") shape = `<polygon class="hit" points="${f(g.cx)},${f(y0)} ${f(g.cx + g.w / 2)},${f(g.cy)} ${f(g.cx)},${f(g.cy + g.h / 2)} ${f(x0)},${f(g.cy)}"/>`;
      else if (g.shape === "ellipse") shape = `<ellipse class="hit" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.w / 2)}" ry="${f(g.h / 2)}"/>`;
      else if (g.shape === "circle") shape = `<circle class="hit" cx="${f(g.cx)}" cy="${f(g.cy)}" r="${f(Math.max(g.w / 2, 0.16))}"/>`;
      else {
        // a bar is too thin to grab: its target is a comfortable band around it
        const padX = g.shape === "bar" && g.vertical ? 0.1 : 0, padY = g.shape === "bar" && !g.vertical ? 0.1 : 0;
        shape = `<rect class="hit" x="${f(x0 - padX)}" y="${f(y0 - padY)}" width="${f(g.w + 2 * padX)}" height="${f(g.h + 2 * padY)}"/>`;
      }
      out.push([`n:${u}`, `<g data-uid="${u}">${shape}</g>`]);
    }
    for (const t of geo.texts) {
      const m = /^(e[0-9]+):(label|stereotype|from-|to-)/.exec(t.name);
      if (!m) continue;
      const e = geo.edges.find((x) => x.id === m[1]);
      if (!e || geo.nodes.has(m[1])) continue;
      const r = textRect(t, 0.04);
      out.push([`l:${t.name}`, `<rect class="hit" data-uid="${e.uid}" ${m[2] === "label" ? 'data-label="1" ' : ""}x="${f(r[0])}" y="${f(r[1])}" width="${f(r[2] - r[0])}" height="${f(r[3] - r[1])}"/>`]);
    }
    return out;
  }

  // ---------------------------------------------------------------- the overlay (screen space)
  drawOverlay(): void {
    const o: SVGElement[] = [];
    const geo = this.geo, d = this.doc;
    this.root.classList.toggle("is-panning", this.gesture?.type === "pan" || this.space);
    if (!geo || !d) { this.overlay.replaceChildren(); return; }
    const S = (p: Pt): Pt => this.toScreen(p);
    const g = this.gesture;
    const quiet = !!g && g.type !== "place";

    for (const gl of this.guides) {
      const a = S(gl.axis === "x" ? [gl.at, gl.from] : [gl.from, gl.at]), b = S(gl.axis === "x" ? [gl.at, gl.to] : [gl.to, gl.at]);
      o.push(svg("line", { class: "guide", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    const nodes = d.nodes.filter((n) => this.selection.has(n.uid));
    for (const n of nodes) {
      const ng = geo.nodes.get(n.id);
      if (!ng) continue;
      const [x0, y0] = S([ng.cx - ng.w / 2, ng.cy - ng.h / 2]), [x1, y1] = S([ng.cx + ng.w / 2, ng.cy + ng.h / 2]);
      const pad = n.kind === "partition" ? -2 : 5;
      o.push(svg("rect", { class: "sel", x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad, rx: 3 }));
      if (nodes.length === 1 && this.selection.size === 1 && (resizable(n.kind) || (n.kind === "boundary")) && (!g || g.type === "resize")) {
        const hs: Array<[Handle, number, number]> = n.kind === "fork" || n.kind === "join"
          ? (ng.vertical ? [["n", (x0 + x1) / 2, y0 - pad], ["s", (x0 + x1) / 2, y1 + pad]] : [["w", x0 - pad, (y0 + y1) / 2], ["e", x1 + pad, (y0 + y1) / 2]])
          : [["nw", x0 - pad, y0 - pad], ["n", (x0 + x1) / 2, y0 - pad], ["ne", x1 + pad, y0 - pad], ["e", x1 + pad, (y0 + y1) / 2],
            ["se", x1 + pad, y1 + pad], ["s", (x0 + x1) / 2, y1 + pad], ["sw", x0 - pad, y1 + pad], ["w", x0 - pad, (y0 + y1) / 2]];
        for (const [h, x, y] of hs) o.push(svg("rect", { class: `handle h-${h}`, "data-handle": h, x: x - 5, y: y - 5, width: 10, height: 10, rx: 2 }));
      }
    }
    // ports: on the shape under the pointer, or the one selected shape
    const portOn = !quiet || g?.type === "connect" || g?.type === "reconnect"
      ? (g?.type === "connect" || g?.type === "reconnect" ? g.target : this.hover ?? (nodes.length === 1 && this.selection.size === 1 ? nodes[0].uid : null))
      : null;
    const pn = portOn ? d.nodes.find((n) => n.uid === portOn) : undefined;
    const pg = pn ? geo.nodes.get(pn.id) : undefined;
    if (pn && pg && !CONTAINERS.has(pn.kind) && pn.kind !== "note" && this.app.session.inSync) {
      for (const side of SIDES) {
        const p = S(sideAnchor(pg, side, 0, this.px(15)));
        const active = (g?.type === "connect" || g?.type === "reconnect") && g.targetSide === side;
        o.push(svg("circle", { class: `port${active ? " is-on" : ""}`, "data-port": side, "data-uid": pn.uid, cx: p[0], cy: p[1], r: active ? 8 : 6 }));
      }
    }
    // a selected line: its ends, and the handles that bend it
    const edges = d.edges.filter((e) => this.selection.has(e.uid));
    for (const e of edges) {
      const eg = geo.edges.find((x) => x.uid === e.uid);
      if (!eg) continue;
      const path = drawnPath(eg).map(S);
      o.push(svg("path", { class: "sel-line", d: "M" + path.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") }));
      if (edges.length !== 1 || this.selection.size !== 1 || (g && !["segment", "via", "reconnect", "label"].includes(g.type))) continue;
      const pts = eg.points.map(S);
      if (eg.routeKind === "elbow" && !eg.smooth) {
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 26) continue;
          const horiz = Math.abs(a[1] - b[1]) < 0.5;
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          o.push(svg("rect", { class: `seg ${horiz ? "seg-h" : "seg-v"}`, "data-seg": i, x: mx - (horiz ? 9 : 4), y: my - (horiz ? 4 : 9), width: horiz ? 18 : 8, height: horiz ? 8 : 18, rx: 3 }));
        }
      } else if (!eg.smooth || e.route) {
        for (let i = 1; i + 1 < pts.length; i++) o.push(svg("circle", { class: "via", "data-via": i - 1, cx: pts[i][0], cy: pts[i][1], r: 6 }));
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 40) continue;
          o.push(svg("circle", { class: "mid", "data-mid": i, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: 5 }));
        }
      }
      o.push(svg("circle", { class: "end", "data-end": "from", cx: pts[0][0], cy: pts[0][1], r: 7 }));
      o.push(svg("circle", { class: "end", "data-end": "to", cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 7 }));
    }
    if (g?.type === "marquee") {
      const a = S(g.from), b = S(g.to);
      o.push(svg("rect", { class: "marquee", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }));
    }
    if (g?.type === "connect" || g?.type === "reconnect") {
      const line = this.previewRoute(g);
      if (line) o.push(svg("path", { class: `preview${g.ok || !g.target ? "" : " is-bad"}`, d: "M" + line.map(S).map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") }));
      const tg = g.target ? this.geomOf(g.target) : undefined;
      if (tg) {
        const [x0, y0] = S([tg.cx - tg.w / 2, tg.cy - tg.h / 2]), [x1, y1] = S([tg.cx + tg.w / 2, tg.cy + tg.h / 2]);
        o.push(svg("rect", { class: `target${g.ok ? "" : " is-bad"}`, x: x0 - 6, y: y0 - 6, width: x1 - x0 + 12, height: y1 - y0 + 12, rx: 5 }));
      }
    }
    this.overlay.replaceChildren(...o);
  }

  /** The path a line being drawn or re-attached would take, through the real router. */
  private previewRoute(g: Extract<Gesture, { type: "connect" | "reconnect" }>): Pt[] | null {
    const geo = this.geo, d = this.doc;
    if (!geo || !d) return null;
    const loose: NodeGeom = { uid: "", id: "", kind: "note", label: null, lines: [], step: 0, cx: g.at[0], cy: g.at[1], w: 0.02, h: 0.02, shape: "circle", minW: 0, minH: 0, tw: 0, th: 0, placed: true, sized: false };
    const solid = [...geo.nodes.values()].filter((n) => n.shape !== "container" && n.shape !== "lane");
    const flow = d.meta.type === "flowchart" || d.meta.type === "activity" ? geo.direction : "none";
    const kind = d.meta.type === "use-case" ? "straight" : "elbow";
    const target = g.target ? this.geomOf(g.target) : undefined;
    if (g.type === "connect") {
      const from = this.geomOf(g.from);
      if (!from) return null;
      return routeEdge({ from, to: target ?? loose, kind, fromSide: kind === "elbow" ? g.side : undefined, ...(g.targetSide ? { toSide: g.targetSide } : {}), gapFrom: 0.04, gapTo: 0.04, obstacles: solid, flow }).points;
    }
    const e = d.edges.find((x) => x.uid === g.edge);
    if (!e) return null;
    const other = geo.nodes.get(g.end === "from" ? e.to : e.from);
    if (!other) return null;
    const moving = target ?? loose;
    const side = g.targetSide ?? undefined;
    return routeEdge({
      from: g.end === "from" ? moving : other, to: g.end === "from" ? other : moving, kind: e.route?.kind ?? kind,
      ...(g.end === "from" ? (side ? { fromSide: side } : {}) : side ? { toSide: side } : {}), gapFrom: 0.04, gapTo: 0.04, obstacles: solid, flow,
    }).points;
  }

  // ---------------------------------------------------------------- the viewport
  private applyView(): void {
    const { x, y, zoom } = this.view;
    this.world.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${zoom.toFixed(4)})`);
    // the dot grid: one dot per quarter inch, thinned out when zoomed far out
    let step = 24 * zoom;
    while (step < 14) step *= 2;
    this.gridPattern.setAttribute("width", String(step));
    this.gridPattern.setAttribute("height", String(step));
    this.gridPattern.setAttribute("patternTransform", `translate(${x % step} ${y % step})`);
    this.drawOverlay();
    this.app.workspace.view = { x: Math.round(x), y: Math.round(y), zoom: Math.round(zoom * 1000) / 1000 };
    this.app.touchWorkspace();
    this.host.changed();
  }

  /** Zoom by a factor, keeping the point under (cx, cy) (canvas pixels; default the middle) where it is. */
  zoomBy(factor: number, cx = this.root.clientWidth / 2, cy = this.root.clientHeight / 2): void {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * factor));
    const k = z / this.view.zoom;
    this.view = { x: cx - (cx - this.view.x) * k, y: cy - (cy - this.view.y) * k, zoom: z };
    this.applyView();
  }
  zoomTo(z: number): void { this.zoomBy(z / this.view.zoom); }

  /** Show the whole diagram, no larger than `maxZoom`. */
  fit(maxZoom = 1.5): void {
    const geo = this.app.session.geometry;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!geo || !w || !h) return;
    const [x0, y0, x1, y1] = geo.bounds;
    const pad = 56;
    const z = Math.max(MIN_ZOOM, Math.min(maxZoom, (w - 2 * pad) / ((x1 - x0) * PX || 1), (h - 2 * pad) / ((y1 - y0) * PX || 1)));
    this.view = { zoom: z, x: (w - (x1 - x0) * PX * z) / 2 - x0 * PX * z, y: Math.max(pad * 0.6, (h - (y1 - y0) * PX * z) / 2) - y0 * PX * z };
    this.applyView();
  }

  /** The middle of what is on screen, in document inches. */
  center(): Pt {
    const r = this.rect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ---------------------------------------------------------------- selection
  select(uids: string[], add = false): void {
    if (!add) this.selection.clear();
    for (const u of uids) this.selection.add(u);
    this.app.session.selection = [...this.selection];
    this.drawOverlay();
    this.host.changed();
  }
  private toggle(uid: string): void {
    if (this.selection.has(uid)) this.selection.delete(uid); else this.selection.add(uid);
    this.app.session.selection = [...this.selection];
    this.drawOverlay();
    this.host.changed();
  }

  /** The shape under a document point (topmost, containers last). */
  private nodeAt(p: Pt, except?: string): string | null {
    const geo = this.geo, d = this.doc;
    if (!geo || !d) return null;
    for (let i = geo.order.length - 1; i >= 0; i--) {
      const g = geo.nodes.get(geo.order[i])!;
      if (g.shape === "container" || g.shape === "lane" || g.uid === except) continue;
      if (contains(g, p[0], p[1], Math.max(0.06, this.px(6)))) return g.uid;
    }
    return null;
  }

  /** The container a document point falls in: the partition or boundary whose box holds it. */
  containerAt(p: Pt, geo = this.app.session.geometry): string | undefined {
    if (!geo) return undefined;
    for (const g of geo.nodes.values()) {
      if (g.shape !== "container" && g.shape !== "lane") continue;
      const [x0, y0, x1, y1] = boxOf(g);
      if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return g.id;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- pointer
  private bind(): void {
    const r = this.root;
    r.addEventListener("pointerdown", (ev) => this.down(ev));
    r.addEventListener("pointermove", (ev) => this.move(ev));
    r.addEventListener("pointerup", (ev) => this.up(ev));
    r.addEventListener("pointercancel", (ev) => this.cancel(ev));
    r.addEventListener("lostpointercapture", (ev) => { if (this.gesture && this.gesture.type !== "place") this.cancel(ev); });
    r.addEventListener("dblclick", (ev) => this.dbl(ev));
    r.addEventListener("wheel", (ev) => this.wheel(ev), { passive: false });
    r.addEventListener("keydown", (ev) => this.key(ev));
    r.addEventListener("keyup", (ev) => { if (ev.key === " ") { this.space = false; this.drawOverlay(); } });
    r.addEventListener("blur", () => { this.space = false; });
    r.addEventListener("contextmenu", (ev) => { if (this.gesture) ev.preventDefault(); });
    r.addEventListener("pointerleave", () => { if (!this.gesture && this.hover) { this.hover = null; this.drawOverlay(); } });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (!this.fitted) this.refresh(); else this.drawOverlay(); }).observe(r);
  }

  private schedule(fn: () => void): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(fn);
  }

  private down(ev: PointerEvent): void {
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ev.pointerType === "touch" && this.pointers.size === 2) {
      // two fingers: pinch to zoom, drag to pan; whatever one finger had started is dropped
      if (this.gesture && this.gesture.type !== "place") { this.gesture = null; this.guides = []; this.show(this.app.session.doc, this.app.session.geometry); }
      const [a, b] = [...this.pointers.values()];
      const rc = this.rect();
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view.zoom, cx: (a.x + b.x) / 2 - rc.left, cy: (a.y + b.y) / 2 - rc.top, vx: this.view.x, vy: this.view.y };
      return;
    }
    const t = ev.target as Element;
    const p = this.toWorld(ev.clientX, ev.clientY);
    this.root.focus({ preventScroll: true });
    if (this.locked && !(ev.button === 1 || this.space)) return;
    const capture = (): void => { try { this.root.setPointerCapture(ev.pointerId); } catch { /* the pointer is already gone */ } };
    if (ev.button === 1 || (ev.button === 0 && this.space)) {
      ev.preventDefault();
      capture();
      this.gesture = { type: "pan", sx: ev.clientX, sy: ev.clientY, vx: this.view.x, vy: this.view.y };
      this.drawOverlay();
      return;
    }
    if (ev.button !== 0) return;
    if (this.gesture?.type === "place") { this.placeAt(p, ev.shiftKey); return; }
    const editable = this.app.session.inSync;
    const handle = t.getAttribute("data-handle") as Handle | null;
    const only = this.selection.size === 1 ? [...this.selection][0] : null;
    if (handle && only && editable) {
      const g = this.geomOf(only);
      if (g) { capture(); this.gesture = { type: "resize", id: only, handle, box: { id: only, cx: g.cx, cy: g.cy, w: g.w, h: g.h }, start: p, next: null }; }
      return;
    }
    const port = t.getAttribute("data-port") as Side | null;
    if (port && editable) {
      capture();
      this.gesture = { type: "connect", from: t.getAttribute("data-uid")!, side: port, at: p, target: null, targetSide: null, ok: false, why: "" };
      this.host.say("drag to the shape this line goes to");
      this.drawOverlay();
      return;
    }
    const end = t.getAttribute("data-end") as "from" | "to" | null;
    if (end && only && editable) {
      capture();
      this.gesture = { type: "reconnect", edge: only, end, at: p, target: null, targetSide: null, ok: false, why: "" };
      this.drawOverlay();
      return;
    }
    const eg = only ? this.edgeGeom(only) : undefined;
    if (eg && editable && t.hasAttribute("data-seg")) {
      const i = Number(t.getAttribute("data-seg"));
      const a = eg.points[i], b = eg.points[i + 1];
      capture();
      this.gesture = { type: "segment", edge: only!, index: i, points: eg.points.map((q) => [q[0], q[1]] as Pt), start: p, horizontal: Math.abs(a[1] - b[1]) < 1e-6, via: null };
      return;
    }
    if (eg && editable && (t.hasAttribute("data-via") || t.hasAttribute("data-mid"))) {
      const via = eg.points.slice(1, -1).map((q) => [q[0], q[1]] as Pt);
      let index: number;
      if (t.hasAttribute("data-mid")) { index = Number(t.getAttribute("data-mid")); via.splice(index, 0, p); }
      else index = Number(t.getAttribute("data-via"));
      capture();
      this.gesture = { type: "via", edge: only!, index, via, moved: t.hasAttribute("data-mid") };
      return;
    }
    const divider = t.getAttribute("data-divider");
    if (divider && editable) {
      const g = this.geomOf(divider);
      if (g) { capture(); this.gesture = { type: "divider", lane: divider, start: p, base: g.horizontal ? g.h : g.w, value: null }; }
      return;
    }
    const hit = t.closest("[data-uid]");
    const uid = hit?.getAttribute("data-uid") ?? null;
    if (uid) {
      const was = this.selection.has(uid);
      if (ev.shiftKey) this.toggle(uid);
      else if (!was) this.select([uid]);
      const n = this.node(uid);
      if (hit!.hasAttribute("data-label") && editable && !ev.shiftKey) {
        capture();
        this.gesture = { type: "label", edge: uid, moved: false, start: p, pos: null };
        return;
      }
      if (n && n.kind !== "partition" && editable && this.selection.has(uid)) {
        const ids = this.movingIds();
        const boxes = ids.map((id) => this.geomOf(id)).filter((g): g is NodeGeom => !!g).map((g) => ({ id: g.uid, cx: g.cx, cy: g.cy, w: g.w, h: g.h }));
        capture();
        this.gesture = { type: "move", start: p, ids, boxes, moved: false, clicked: uid, wasSelected: was, dx: 0, dy: 0 };
      }
      return;
    }
    if (ev.pointerType === "touch") {
      capture();
      this.gesture = { type: "pan", sx: ev.clientX, sy: ev.clientY, vx: this.view.x, vy: this.view.y };
      if (!ev.shiftKey) this.select([]);
      return;
    }
    capture();
    if (!ev.shiftKey) this.select([]);
    this.gesture = { type: "marquee", from: p, to: p, add: ev.shiftKey };
  }

  /** The shapes a drag moves: the selected ones, plus everything inside a selected boundary. */
  private movingIds(): string[] {
    const d = this.app.session.doc;
    if (!d) return [];
    const out = new Set<string>();
    for (const n of d.nodes) {
      if (!this.selection.has(n.uid) || n.kind === "partition") continue;
      out.add(n.uid);
      if (n.kind === "boundary") for (const c of d.nodes) if (c.parent === n.id) out.add(c.uid);
    }
    return [...out];
  }

  private move(ev: PointerEvent): void {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const rc = this.rect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinch.zoom * (dist / this.pinch.dist)));
      const k = z / this.pinch.zoom;
      const cx = (a.x + b.x) / 2 - rc.left, cy = (a.y + b.y) / 2 - rc.top;
      this.view = { zoom: z, x: cx - (this.pinch.cx - this.pinch.vx) * k, y: cy - (this.pinch.cy - this.pinch.vy) * k };
      this.applyView();
      return;
    }
    const g = this.gesture;
    const p = this.toWorld(ev.clientX, ev.clientY);
    if (!g && this.locked) return;
    if (!g) {
      // show the ports of the shape the pointer is on or just beside
      const over = this.nodeAt(p) ?? (this.hover && this.near(this.hover, p) ? this.hover : null);
      if (over !== this.hover) { this.hover = over; this.drawOverlay(); }
      return;
    }
    switch (g.type) {
      case "pan":
        this.view = { ...this.view, x: g.vx + ev.clientX - g.sx, y: g.vy + ev.clientY - g.sy };
        this.applyView();
        break;
      case "marquee":
        g.to = p;
        this.drawOverlay();
        break;
      case "place":
        g.at = p;
        this.schedule(() => this.drawGhost());
        break;
      case "move": {
        let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
        if (!g.moved && Math.hypot(dx, dy) * PX * this.view.zoom < 4) return;
        g.moved = true;
        this.guides = [];
        if (!ev.altKey && g.boxes.length) {
          const all = bounds(g.boxes);
          if (this.gridSnap) {
            dx = snapGrid(all.cx + dx, GRID) - all.cx;
            dy = snapGrid(all.cy + dy, GRID) - all.cy;
          }
          const moving = new Set(g.ids);
          const still = [...(this.app.session.geometry?.nodes.values() ?? [])].filter((n) => !moving.has(n.uid) && n.shape !== "container" && n.shape !== "lane")
            .map((n) => ({ id: n.uid, cx: n.cx, cy: n.cy, w: n.w, h: n.h }));
          const s = snapMove(all, still, dx, dy, this.px(6));
          dx = s.dx; dy = s.dy;
          this.guides = s.guides;
        }
        g.dx = dx; g.dy = dy;
        this.schedule(() => this.previewMove(g));
        break;
      }
      case "resize": {
        g.next = this.resized(g, p, ev.altKey);
        const next = g.next;
        this.schedule(() => this.preview((d) => cmd.resizeNode(d, g.id, { x: next.cx, y: next.cy, w: next.w, h: next.h }), new Set([this.node(g.id)?.id ?? ""])));
        break;
      }
      case "connect":
      case "reconnect": {
        g.at = p;
        const from = g.type === "connect" ? g.from : undefined;
        const target = this.nodeAt(p, from);
        g.target = target;
        g.targetSide = null;
        g.ok = false;
        g.why = "";
        if (target) {
          const tg = this.geomOf(target)!;
          // near one of the target's ports: attach to that side; anywhere else on it: let the router choose
          for (const side of SIDES) {
            const sp = sideAnchor(tg, side, 0, this.px(15));
            if (Math.hypot(sp[0] - p[0], sp[1] - p[1]) < this.px(13)) g.targetSide = side;
          }
          const d = this.app.session.doc!;
          const e = g.type === "reconnect" ? d.edges.find((x) => x.uid === g.edge) : undefined;
          const other = g.type === "connect" ? g.from : d.nodes.find((n) => n.id === (g.end === "from" ? e?.to : e?.from))?.uid ?? "";
          const can = cmd.canConnect(d, g.type === "reconnect" && g.end === "from" ? target : other, g.type === "reconnect" && g.end === "from" ? other : target);
          g.ok = can.ok;
          g.why = can.why ?? "";
        }
        this.host.say(g.target ? (g.ok ? "let go to connect" : g.why) : "drag to a shape");
        this.schedule(() => this.drawOverlay());
        break;
      }
      case "segment": {
        const d = g.horizontal ? p[1] - g.start[1] : p[0] - g.start[0];
        const pts = g.points.map((q) => [q[0], q[1]] as Pt);
        const shift = (q: Pt): void => { if (g.horizontal) q[1] += d; else q[0] += d; };
        const n = pts.length;
        if (n === 2) {
          // a straight run slides sideways: two corners carry it
          const [a, b] = pts;
          const s = Math.min(0.22, Math.hypot(b[0] - a[0], b[1] - a[1]) / 3);
          const ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1]);
          const c1: Pt = [a[0] + ux * s, a[1] + uy * s], c2: Pt = [b[0] - ux * s, b[1] - uy * s];
          shift(c1); shift(c2);
          g.via = [c1, c2];
        } else {
          if (g.index > 0) shift(pts[g.index]); else pts.splice(1, 0, ((): Pt => { const q: Pt = [pts[0][0], pts[0][1]]; shift(q); return q; })());
          const j = g.index > 0 ? g.index + 1 : g.index + 2;
          if (j < pts.length - 1) shift(pts[j]); else pts.splice(pts.length - 1, 0, ((): Pt => { const q: Pt = [pts[pts.length - 1][0], pts[pts.length - 1][1]]; shift(q); return q; })());
          g.via = pts.slice(1, -1);
        }
        const via = g.via;
        this.schedule(() => this.previewRouteEdit(g.edge, { kind: "elbow", via }));
        break;
      }
      case "via": {
        g.moved = true;
        g.via[g.index] = this.gridSnap && !ev.altKey ? [snapGrid(p[0], GRID), snapGrid(p[1], GRID)] : p;
        const via = g.via.map((q) => [q[0], q[1]] as [number, number]);
        this.schedule(() => this.previewRouteEdit(g.edge, { kind: "straight", via }));
        break;
      }
      case "label": {
        if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * PX * this.view.zoom < 4) return;
        g.moved = true;
        const eg = this.app.session.geometry?.edges.find((x) => x.uid === g.edge);
        if (!eg) return;
        const path = drawnPath(eg);
        const { t } = nearestT(path, p);
        const on = pointAt(path, t).p;
        g.pos = { t, dx: p[0] - on[0], dy: p[1] - on[1] };
        const pos = g.pos;
        this.schedule(() => this.preview((d) => cmd.patchEdge(d, g.edge, { labelPos: pos }), new Set(), true));
        break;
      }
      case "divider": {
        const lane = this.app.session.geometry?.nodes.get(this.node(g.lane)?.id ?? "");
        if (!lane) return;
        const d = lane.horizontal ? p[1] - g.start[1] : p[0] - g.start[0];
        let v = Math.max(lane.minW, g.base + d);
        if (this.gridSnap && !ev.altKey) v = Math.max(lane.minW, snapGrid(v, GRID));
        g.value = v;
        this.schedule(() => this.preview((draft) => this.resizeLane(draft, g.lane, v), new Set(), true));
        break;
      }
    }
  }

  private near(uid: string, p: Pt): boolean {
    const g = this.geomOf(uid);
    if (!g) return false;
    const pad = this.px(26);
    return Math.abs(p[0] - g.cx) <= g.w / 2 + pad && Math.abs(p[1] - g.cy) <= g.h / 2 + pad;
  }

  private previewMove(g: Extract<Gesture, { type: "move" }>): void {
    const moved = new Set<string>();
    this.preview((d) => {
      for (const b of g.boxes) {
        const n = d.nodes.find((x) => x.uid === b.id);
        if (!n) continue;
        moved.add(n.id);
        if (n.kind === "boundary") { if (n.size) n.place = { x: b.cx + g.dx, y: b.cy + g.dy }; }
        else cmd.moveNode(d, b.id, b.cx + g.dx, b.cy + g.dy);
      }
    }, moved);
  }

  private previewRouteEdit(edge: string, route: NonNullable<DocEdge["route"]>): void {
    const eg = this.app.session.geometry?.edges.find((x) => x.uid === edge);
    this.preview((d) => {
      const e = d.edges.find((x) => x.uid === edge);
      // the ends keep the sides they had, so the line doesn't flip while it is being bent
      if (e) cmd.patchEdge(d, edge, { route: { ...route, ...(route.kind === "elbow" && eg ? { from: e.route?.from ?? eg.fromSide, to: e.route?.to ?? eg.toSide } : {}) } });
    }, new Set(), true);
  }

  /** The box a resize handle gives: the opposite side stays put (Alt: the center does), never below the text's room. */
  private resized(g: Extract<Gesture, { type: "resize" }>, p: Pt, fromCenter: boolean): Box {
    const geo = this.geomOf(g.id);
    const minW = geo?.minW ?? 0.4, minH = geo?.minH ?? 0.3;
    const b = g.box;
    let x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2, y0 = b.cy - b.h / 2, y1 = b.cy + b.h / 2;
    const dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    const sn = (v: number): number => (this.gridSnap ? snapGrid(v, GRID) : v);
    if (g.handle.includes("w")) { x0 = Math.min(sn(x0 + dx), x1 - minW); if (fromCenter) x1 = b.cx + (b.cx - x0); }
    if (g.handle.includes("e")) { x1 = Math.max(sn(x1 + dx), x0 + minW); if (fromCenter) x0 = b.cx - (x1 - b.cx); }
    if (g.handle.includes("n")) { y0 = Math.min(sn(y0 + dy), y1 - minH); if (fromCenter) y1 = b.cy + (b.cy - y0); }
    if (g.handle.includes("s")) { y1 = Math.max(sn(y1 + dy), y0 + minH); if (fromCenter) y0 = b.cy - (y1 - b.cy); }
    return { id: b.id, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  /** Give a partition a new thickness; the lanes after it, and what is placed in them, shift to stay beside it. */
  resizeLane(d: ChalkDoc, uid: string, value: number): void {
    const geo = this.app.session.geometry;
    const lane = d.nodes.find((n) => n.uid === uid);
    if (!geo || !lane) return;
    const lanes = d.nodes.filter((n) => n.kind === "partition");
    const g0 = geo.nodes.get(lane.id)!;
    const horizontal = !!g0.horizontal;
    const delta = value - (horizontal ? g0.h : g0.w);
    // every lane keeps the thickness it shows now, so only this one changes
    for (const l of lanes) {
      const lg = geo.nodes.get(l.id);
      if (lg && l.thickness === undefined) l.thickness = Math.round((horizontal ? lg.h : lg.w) * 1000) / 1000;
    }
    lane.thickness = Math.round(value * 1000) / 1000;
    const after = new Set(lanes.slice(lanes.indexOf(lane) + 1).map((l) => l.id));
    for (const n of d.nodes) {
      if (!n.parent || !after.has(n.parent) || !n.place) continue;
      if (horizontal) n.place.y = Math.round((n.place.y + delta) * 1000) / 1000; else n.place.x = Math.round((n.place.x + delta) * 1000) / 1000;
    }
  }

  private up(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    const g = this.gesture;
    if (!g || g.type === "place") return;
    this.gesture = null;
    this.guides = [];
    cancelAnimationFrame(this.frame);
    try { this.root.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    const s = this.app.session;
    const report = (r: { ok: boolean; message?: string; held: number }, done: string): void => {
      if (!r.ok) { this.host.say(r.message ?? "that didn't work"); this.refresh(); return; }
      this.host.say(r.held ? `${done}; ${r.held} other shape${r.held === 1 ? " now holds its" : "s now hold their"} place (tidy up lets them go)` : done);
    };
    switch (g.type) {
      case "pan":
        this.drawOverlay();
        break;
      case "marquee": {
        const x0 = Math.min(g.from[0], g.to[0]), x1 = Math.max(g.from[0], g.to[0]), y0 = Math.min(g.from[1], g.to[1]), y1 = Math.max(g.from[1], g.to[1]);
        const picked: string[] = [];
        if (x1 - x0 > this.px(3) || y1 - y0 > this.px(3)) {
          for (const n of this.geo?.nodes.values() ?? []) {
            if (n.shape === "lane" || n.shape === "container") continue;
            const [a, b, c, dd] = boxOf(n);
            if (a < x1 && c > x0 && b < y1 && dd > y0) picked.push(n.uid);
          }
          for (const e of this.geo?.edges ?? []) if (e.points.every((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1)) picked.push(e.uid);
        }
        this.select(picked, g.add);
        if (picked.length) this.host.say(`${picked.length} selected`);
        break;
      }
      case "move": {
        if (!g.moved) {
          // a plain click on one of several selected shapes narrows the selection to it
          if (!ev.shiftKey && g.wasSelected && this.selection.size > 1) this.select([g.clicked]);
          this.drawOverlay();
          break;
        }
        const before = s.geometry;
        const moves: string[] = [];
        const r = s.edit("move", (d) => {
          for (const b of g.boxes) {
            const n = d.nodes.find((x) => x.uid === b.id);
            if (!n) continue;
            if (n.kind === "boundary") { if (n.size) n.place = { x: round(b.cx + g.dx), y: round(b.cy + g.dy) }; continue; }
            cmd.moveNode(d, b.id, b.cx + g.dx, b.cy + g.dy);
          }
          // a shape belongs to the partition or boundary its center is dropped in
          for (const b of g.boxes) {
            const n = d.nodes.find((x) => x.uid === b.id);
            if (!n || CONTAINERS.has(n.kind)) continue;
            const draggedWith = n.parent && g.boxes.some((o) => d.nodes.find((x) => x.uid === o.id)?.id === n.parent);
            if (draggedWith) continue;
            const into = this.containerAt([b.cx + g.dx, b.cy + g.dy], before);
            if ((n.parent ?? undefined) !== into) {
              cmd.setParent(d, n.uid, into);
              const c = into ? d.nodes.find((x) => x.id === into) : undefined;
              moves.push(c ? `${n.label ?? n.id} is now in ${c.label ?? c.id}` : `${n.label ?? n.id} is outside every ${d.meta.type === "use-case" ? "boundary" : "partition"}`);
            }
          }
        }, { select: [...this.selection] });
        report(r, moves.length ? moves.join("; ") : g.boxes.length === 1 ? "moved" : `moved ${g.boxes.length} shapes`);
        break;
      }
      case "resize": {
        if (!g.next) { this.drawOverlay(); break; }
        // keep what the shape really became (the text sets a floor), not what the pointer asked for
        const shown = this.geomOf(g.id);
        const box = shown ? { x: shown.cx, y: shown.cy, w: shown.w, h: shown.h } : { x: g.next.cx, y: g.next.cy, w: g.next.w, h: g.next.h };
        report(s.edit("resize", (d) => cmd.resizeNode(d, g.id, box), { select: [g.id] }), "resized");
        break;
      }
      case "connect": {
        if (!g.target || !g.ok) { this.host.say(g.target ? g.why : "let go on a shape to connect"); this.refresh(); break; }
        let made = "";
        const r = s.edit("connect", (d) => {
          const e = cmd.addEdge(d, { from: g.from, to: g.target!, ...(this.host.relation() ? { op: this.host.relation()! } : {}) });
          made = e.uid;
          // the sides are only written down when they differ from what the router would pick anyway
          const flipped = e.from !== d.nodes.find((n) => n.uid === g.from)?.id;
          const want = { from: flipped ? g.targetSide ?? undefined : g.side, to: flipped ? g.side : g.targetSide ?? undefined };
          if (d.meta.type !== "use-case") {
            const auto = resolve(d, this.app.measurer).edges.find((x) => x.uid === e.uid);
            const keep = { ...(want.from && auto?.fromSide !== want.from ? { from: want.from } : {}), ...(want.to && auto?.toSide !== want.to ? { to: want.to } : {}) };
            if (keep.from || keep.to) e.route = { kind: "elbow", ...keep };
          }
        });
        if (r.ok && made) this.select([made]);
        report(r, "connected");
        if (r.ok && made && this.node(g.from)?.kind === "decision") this.host.editText({ type: "edge", uid: made });
        break;
      }
      case "reconnect": {
        if (!g.target || !g.ok) { this.host.say(g.target ? g.why : "the line stays where it was"); this.refresh(); break; }
        report(s.edit("reconnect", (d) => cmd.reconnect(d, g.edge, g.end, g.target!, g.targetSide ?? undefined), { select: [g.edge] }), "re-attached");
        break;
      }
      case "segment": {
        if (!g.via) { this.drawOverlay(); break; }
        const eg = s.geometry?.edges.find((x) => x.uid === g.edge);
        const via = g.via.map((q) => [q[0], q[1]] as [number, number]);
        report(s.edit("bend line", (d) => {
          const e = d.edges.find((x) => x.uid === g.edge);
          cmd.patchEdge(d, g.edge, { route: { kind: "elbow", via, ...(eg ? { from: e?.route?.from ?? eg.fromSide, to: e?.route?.to ?? eg.toSide } : {}) } });
        }, { select: [g.edge] }), "bent the line");
        break;
      }
      case "via": {
        if (!g.moved) { this.drawOverlay(); break; }
        const via = g.via.map((q) => [q[0], q[1]] as [number, number]);
        report(s.edit("bend line", (d) => cmd.patchEdge(d, g.edge, { route: { kind: "straight", via } }), { select: [g.edge] }), "bent the line");
        break;
      }
      case "label": {
        if (!g.moved || !g.pos) { this.drawOverlay(); break; }
        report(s.edit("move label", (d) => cmd.patchEdge(d, g.edge, { labelPos: g.pos }), { select: [g.edge] }), "moved the label");
        break;
      }
      case "divider": {
        if (g.value === null) { this.drawOverlay(); break; }
        const v = g.value;
        report(s.edit("resize partition", (d) => this.resizeLane(d, g.lane, v), { hold: false, select: [g.lane] }), "resized the partition");
        break;
      }
    }
  }

  private cancel(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    this.pinch = null;
    if (!this.gesture || this.gesture.type === "place") return;
    this.gesture = null;
    this.guides = [];
    cancelAnimationFrame(this.frame);
    this.show(this.app.session.doc, this.app.session.geometry);
  }

  private dbl(ev: MouseEvent): void {
    const t = ev.target as Element;
    if (!this.app.session.inSync) return;
    const only = this.selection.size === 1 ? [...this.selection][0] : null;
    if (t.hasAttribute("data-via") && only) {
      // double-click a bend to take it out
      const eg = this.edgeGeom(only);
      if (!eg) return;
      const via = eg.points.slice(1, -1).map((q) => [q[0], q[1]] as [number, number]);
      via.splice(Number(t.getAttribute("data-via")), 1);
      const r = this.app.session.edit("remove bend", (d) => cmd.patchEdge(d, only, { route: via.length ? { kind: "straight", via } : { kind: "straight" } }), { select: [only] });
      this.host.say(r.ok ? "removed the bend" : r.message ?? "");
      return;
    }
    const uid = t.closest("[data-uid]")?.getAttribute("data-uid");
    if (!uid) return;
    const n = this.node(uid);
    if (n) {
      if (n.kind === "class" || n.kind === "interface") {
        // a class: the row that was hit, or its name
        const g = this.geomOf(uid);
        const p = this.toWorld(ev.clientX, ev.clientY);
        const row = g?.cls?.rows.find((r) => r.role === "member" && Math.abs(g.cy - g.h / 2 + r.cy - p[1]) < 0.14);
        this.host.editText(row && row.index !== undefined ? { type: "member", uid, index: row.index } : { type: "node", uid });
      } else if (UNLABELED.has(n.kind)) this.host.say(`a ${n.kind.replace("-", " ")} has no text; its settings are in the panel`);
      else this.host.editText({ type: "node", uid });
    } else if (this.edge(uid)) this.host.editText({ type: "edge", uid });
  }

  private wheel(ev: WheelEvent): void {
    const r = this.rect();
    if (ev.ctrlKey || ev.metaKey) {
      // pinch on a trackpad, or Ctrl + wheel: zoom about the pointer
      ev.preventDefault();
      this.zoomBy(Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0022)), ev.clientX - r.left, ev.clientY - r.top);
      return;
    }
    // plain scrolling belongs to the page unless the canvas has the focus
    if (document.activeElement !== this.root) return;
    ev.preventDefault();
    const k = ev.deltaMode === 1 ? 24 : 1;
    this.view = { ...this.view, x: this.view.x - (ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) * k, y: this.view.y - (ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) * k };
    this.applyView();
  }

  // ---------------------------------------------------------------- keyboard
  private key(ev: KeyboardEvent): void {
    if (ev.target !== this.root || this.locked) return;
    const s = this.app.session;
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key;
    if (k === " ") { this.space = true; ev.preventDefault(); this.drawOverlay(); return; }
    if (k === "Escape") {
      if (this.gesture) { const was = this.gesture.type; this.gesture = null; this.guides = []; this.ghost.replaceChildren(); this.show(s.doc, s.geometry); this.host.say(was === "place" ? "stopped placing" : "cancelled"); this.host.changed(); }
      else if (this.selection.size) { this.select([]); this.host.say("nothing selected"); }
      return;
    }
    if (mod && k.toLowerCase() === "z") { ev.preventDefault(); this.host.say((ev.shiftKey ? s.redo() : s.undo()) ? (ev.shiftKey ? "redone" : "undone") : ev.shiftKey ? "nothing to redo" : "nothing to undo"); return; }
    if (mod && k.toLowerCase() === "y") { ev.preventDefault(); this.host.say(s.redo() ? "redone" : "nothing to redo"); return; }
    if (mod && k.toLowerCase() === "a") {
      ev.preventDefault();
      this.select([...(s.doc?.nodes.filter((n) => !CONTAINERS.has(n.kind)).map((n) => n.uid) ?? []), ...(s.doc?.edges.map((e) => e.uid) ?? [])]);
      return;
    }
    if (mod && (k === "0" || k === "1")) { ev.preventDefault(); if (k === "0") this.zoomTo(1); else this.fit(); return; }
    if (mod && (k === "=" || k === "+")) { ev.preventDefault(); this.zoomBy(1.2); return; }
    if (mod && k === "-") { ev.preventDefault(); this.zoomBy(1 / 1.2); return; }
    if (!s.inSync) return;
    if (mod && k.toLowerCase() === "c") { ev.preventDefault(); this.copy(); return; }
    if (mod && k.toLowerCase() === "x") { ev.preventDefault(); if (this.copy()) this.remove(); return; }
    if (mod && k.toLowerCase() === "v") { ev.preventDefault(); this.paste(); return; }
    if (mod && k.toLowerCase() === "d") { ev.preventDefault(); if (this.copy(true)) this.paste(true); return; }
    if (mod) return;
    if (k === "Delete" || k === "Backspace") { ev.preventDefault(); this.remove(); return; }
    if (k === "Tab") {
      // with a shape selected, Tab walks the shapes; with nothing selected it leaves the canvas as usual (Escape lets go)
      const order = s.doc?.nodes.filter((n) => n.kind !== "boundary").map((n) => n.uid) ?? [];
      if (!this.selection.size || !order.length) return;
      const cur = order.indexOf([...this.selection][0]);
      const next = (cur + (ev.shiftKey ? -1 : 1) + order.length) % order.length;
      ev.preventDefault();
      this.select([order[next]]);
      const n = this.node(order[next]);
      if (n) { this.reveal(order[next]); this.host.say(`${n.kind} ${n.label ? `"${n.label.replace(/\n/g, " ")}"` : n.id}`); }
      return;
    }
    const arrows: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) {
      const ids = this.movingIds();
      if (!ids.length) {
        // nothing selected: an arrow picks up the first shape, so the keyboard has a way in
        const first = s.doc?.nodes.find((n) => !CONTAINERS.has(n.kind));
        if (first && !this.selection.size) { ev.preventDefault(); this.select([first.uid]); this.reveal(first.uid); this.host.say(`${first.kind} ${first.label ?? first.id}`); }
        return;
      }
      ev.preventDefault();
      const step = ev.shiftKey ? 0.25 : this.gridSnap ? GRID : 0.05;
      const geo = s.geometry!;
      const r = s.edit("nudge", (d) => {
        for (const uid of ids) {
          const n = d.nodes.find((x) => x.uid === uid);
          const g = n ? geo.nodes.get(n.id) : undefined;
          if (!n || !g) continue;
          if (n.kind === "boundary") { if (n.size) n.place = { x: round(g.cx + arrows[k][0] * step), y: round(g.cy + arrows[k][1] * step) }; }
          else cmd.moveNode(d, uid, g.cx + arrows[k][0] * step, g.cy + arrows[k][1] * step);
        }
      }, { select: [...this.selection] });
      if (!r.ok) this.host.say(r.message ?? "");
      return;
    }
    const only = this.selection.size === 1 ? [...this.selection][0] : null;
    if (only && (k === "Enter" || k === "F2")) {
      ev.preventDefault();
      const n = this.node(only);
      if (n && UNLABELED.has(n.kind)) this.host.say(`a ${n.kind.replace("-", " ")} has no text`);
      else if (n) this.host.editText({ type: "node", uid: only });
      else this.host.editText({ type: "edge", uid: only });
      return;
    }
    // typing on a selected shape starts replacing its text
    if (only && k.length === 1 && !ev.altKey) {
      const n = this.node(only);
      if (n && !UNLABELED.has(n.kind) && n.kind !== "class" && n.kind !== "interface") { ev.preventDefault(); this.host.editText({ type: "node", uid: only, seed: k }); }
      else if (this.edge(only)) { ev.preventDefault(); this.host.editText({ type: "edge", uid: only, seed: k }); }
    }
  }

  /** Scroll the canvas so a shape is in view. */
  reveal(uid: string): void {
    const g = this.geomOf(uid);
    if (!g) return;
    const [sx, sy] = this.toScreen([g.cx, g.cy]);
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (sx > 40 && sx < w - 40 && sy > 40 && sy < h - 40) return;
    this.view = { ...this.view, x: this.view.x + w / 2 - sx, y: this.view.y + h / 2 - sy };
    this.applyView();
  }

  // ---------------------------------------------------------------- actions
  /** Delete what is selected. A deleted container frees what was in it; a deleted shape takes its lines. */
  remove(): void {
    const s = this.app.session;
    if (!this.selection.size) return;
    let freed = 0;
    const count = this.selection.size;
    const r = s.edit("delete", (d) => { freed = cmd.removeElements(d, this.selection).freed; }, { select: [] });
    if (!r.ok) { this.host.say(r.message ?? ""); return; }
    this.select([]);
    this.host.say(`deleted ${count === 1 ? "it" : `${count} things`}${freed ? `; ${freed} shape${freed === 1 ? "" : "s"} that ${freed === 1 ? "was" : "were"} inside stayed, outside any container` : ""}`);
  }

  private static clip: { fragment: cmd.Fragment; at: Map<string, { x: number; y: number }>; pastes: number } | null = null;

  copy(quiet = false): boolean {
    const d = this.app.session.doc, geo = this.app.session.geometry;
    if (!d || !geo || !this.selection.size) return false;
    const fragment = cmd.copyFragment(d, this.selection);
    if (!fragment.nodes.length) { if (!quiet) this.host.say("select a shape to copy"); return false; }
    const at = new Map<string, { x: number; y: number }>();
    for (const n of fragment.nodes) { const g = geo.nodes.get(n.id); if (g) at.set(n.uid, { x: g.cx, y: g.cy }); }
    Canvas.clip = { fragment, at, pastes: 0 };
    if (!quiet) this.host.say(`copied ${fragment.nodes.length} shape${fragment.nodes.length === 1 ? "" : "s"}`);
    return true;
  }

  paste(duplicate = false): void {
    const c = Canvas.clip;
    if (!c) { this.host.say("nothing copied yet"); return; }
    c.pastes += 1;
    const off = 0.3 * c.pastes;
    let made: { nodes: string[]; edges: string[] } = { nodes: [], edges: [] };
    const r = this.app.session.edit(duplicate ? "duplicate" : "paste", (d) => { made = cmd.pasteFragment(d, c.fragment, c.at, off, off); });
    if (!r.ok) { this.host.say(r.message ?? ""); return; }
    this.select([...made.nodes, ...made.edges]);
    this.host.say(`${duplicate ? "duplicated" : "pasted"} ${made.nodes.length} shape${made.nodes.length === 1 ? "" : "s"} with new ids`);
  }

  // ---------------------------------------------------------------- placing new shapes
  /** Arm a palette shape: it follows the pointer over the canvas and the next click (or the drop) places it. */
  beginPlace(kind: cmd.PaletteKind, sticky = false): void {
    this.gesture = { type: "place", kind, at: null, sticky };
    this.root.classList.add("is-placing");
    this.host.changed();
  }
  get placing(): cmd.PaletteKind | null { return this.gesture?.type === "place" ? this.gesture.kind : null; }
  stopPlacing(): void {
    if (this.gesture?.type !== "place") return;
    this.gesture = null;
    this.ghost.replaceChildren();
    this.root.classList.remove("is-placing");
    this.host.changed();
  }
  /** Track a drag that started on the palette. */
  placeMove(clientX: number, clientY: number): void {
    if (this.gesture?.type !== "place") return;
    const r = this.rect();
    const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    this.gesture.at = inside ? this.toWorld(clientX, clientY) : null;
    this.schedule(() => this.drawGhost());
  }
  placeDrop(clientX: number, clientY: number): boolean {
    const r = this.rect();
    if (this.gesture?.type !== "place") return false;
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    this.placeAt(this.toWorld(clientX, clientY), false);
    return true;
  }

  private drawGhost(): void {
    const g = this.gesture;
    const d = this.app.session.doc;
    if (g?.type !== "place" || !g.at || !d) { this.ghost.replaceChildren(); return; }
    const probe = cloneDoc(d);
    const n = cmd.addNode(probe, { kind: g.kind });
    const geom = nodeSize(this.app.measurer, n, this.app.session.geometry?.direction === "right");
    if (n.kind === "partition" || n.kind === "boundary") { geom.w = 2; geom.h = 1.5; geom.shape = "container"; geom.kind = "boundary"; }
    geom.cx = g.at[0]; geom.cy = g.at[1];
    const ctx = paintContext(this.app.session.geometry ?? resolve(d, this.app.measurer));
    const markup = elementMarkup({ name: "ghost", kind: "node", step: 0, paints: paintNode(geom, this.look, ctx) });
    this.ghost.replaceChildren(...parseSvg([markup]));
  }

  /** Add the armed shape at a document point. Other shapes stay exactly where they are. */
  placeAt(p: Pt, keepPlacing: boolean): void {
    const g = this.gesture;
    if (g?.type !== "place") return;
    const s = this.app.session;
    if (!s.inSync) { this.host.say("fix the text first: the drawing is showing the last version that worked"); return; }
    const at = this.gridSnap ? { x: snapGrid(p[0], GRID), y: snapGrid(p[1], GRID) } : { x: p[0], y: p[1] };
    let made = "", what = "";
    const container = g.kind === "partition" || g.kind === "boundary";
    const r = s.edit(`add ${g.kind}`, (d) => {
      const into = container ? undefined : this.containerAt([at.x, at.y]);
      const n = cmd.addNode(d, { kind: g.kind, ...(container ? {} : { at }), ...(into ? { parent: into } : {}) });
      made = n.uid;
      what = `${n.kind} ${n.id}${into ? ` in ${d.nodes.find((x) => x.id === into)?.label ?? into}` : ""}`;
    });
    if (!r.ok) { this.host.say(r.message ?? ""); return; }
    if (!(keepPlacing || g.sticky)) this.stopPlacing(); else this.gesture = g;
    this.select([made]);
    this.host.say(`added ${what}${r.held ? `; ${r.held} other shape${r.held === 1 ? " holds its" : "s hold their"} place` : ""}`);
  }
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
