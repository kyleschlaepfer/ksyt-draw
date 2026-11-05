/**
 * The contextual panel beside the canvas: what can be changed about whatever is selected, and the
 * diagram's own settings when nothing is. Every spatial action has a field here too (position, size,
 * container, which side a line attaches to), so the drawing can be edited without a pointer.
 *
 * Fields commit on change (Enter or leaving the field), never per keystroke, so typing is never
 * interrupted by a redraw; the panel rebuilds after a commit and puts the focus back where it was.
 */
import {
  CLASSIFIERS, CONTAINERS, DEFAULT_PROFILE, PROFILES, TYPES, UNLABELED, edgeOp,
  type ChalkDoc, type DocEdge, type DocNode, type Member, type NodeKind, type Side, type UseCaseDoc,
} from "../../core/doc/types";
import * as cmd from "../../core/doc/commands";
import { parseMember } from "../../core/doc/parse";
import { printMember } from "../../core/doc/print";
import { isDashed } from "../../core/geom/resolve";
import { align, distribute, matchSize, type AlignHow, type Box } from "../../core/geom/arrange";
import { resizable } from "../../core/geom/shape";
import { TYPE_NAME, aftermath, button, el, type App } from "../app";
import type { Canvas } from "./canvas";

export interface InspectorHost { say(msg: string): void; canvas: Canvas; app: App }

const KIND_WORD: Partial<Record<NodeKind, string>> = {
  "use-case": "use case", "flow-final": "flow final", io: "input / output", initial: "start (initial node)", final: "end (final node)", partition: "partition (swimlane)",
  boundary: "system boundary",
};
const kindWord = (k: NodeKind): string => KIND_WORD[k] ?? k;
const num3 = (v: number): string => String(Math.round(v * 100) / 100);

export class Inspector {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private key = "";
  private pending = 0;

  constructor(private host: InspectorHost) {
    this.root = el("aside", "draw-inspector");
    this.root.setAttribute("aria-label", "properties");
    const head = el("div", "inspector-head");
    const toggle = button("btn-quiet inspector-toggle", "properties");
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", () => {
      const open = this.root.classList.toggle("is-collapsed") === false;
      toggle.setAttribute("aria-expanded", String(open));
    });
    head.appendChild(toggle);
    this.body = el("div", "inspector-body");
    this.root.append(head, this.body);
  }

  /** Something changed: rebuild after the browser has finished moving the focus, then give it back. */
  update(force = false): void {
    const s = this.host.app.session;
    const key = `${s.inSync}|${[...this.host.canvas.selection].join(",")}|${s.text.length}:${hash(s.text)}`;
    if (key === this.key && !force) return;
    this.key = key;
    cancelAnimationFrame(this.pending);
    this.pending = requestAnimationFrame(() => {
      const active = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement : null;
      const field = active?.getAttribute("data-field");
      const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
      this.build();
      if (!field) return;
      const again = this.body.querySelector<HTMLElement>(`[data-field="${field.replace(/"/g, "")}"]`);
      if (!again) return;
      again.focus({ preventScroll: true });
      if (caret && (again instanceof HTMLTextAreaElement || (again instanceof HTMLInputElement && again.type === "text"))) {
        try { again.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field after all */ }
      }
    });
  }

  private edit(label: string, fn: (d: ChalkDoc) => void, done?: string, hold = true): void {
    const r = this.host.app.session.edit(label, fn, { select: [...this.host.canvas.selection], hold });
    this.host.say(r.ok ? [done ?? "", aftermath(r)].filter((x) => x).join("; ") : r.message ?? "that didn't work");
    if (!r.ok) this.update(true);
  }

  // ---- small controls
  private field(label: string, control: HTMLElement, key: string): HTMLElement {
    const w = el("label", "draw-field");
    control.setAttribute("data-field", key);
    w.append(el("span", undefined, label), control);
    return w;
  }
  private text(value: string, onChange: (v: string) => void, multiline = false): HTMLInputElement | HTMLTextAreaElement {
    const i = multiline ? el("textarea") : el("input");
    if (i instanceof HTMLInputElement) i.type = "text"; else i.rows = Math.min(8, Math.max(2, value.split("\n").length));
    i.value = value;
    i.spellcheck = false;
    i.addEventListener("change", () => onChange(i.value));
    if (i instanceof HTMLInputElement) i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); i.blur(); i.focus(); } });
    return i;
  }
  private number(value: number, onChange: (v: number) => void, min?: number): HTMLInputElement {
    const i = el("input");
    i.type = "number";
    i.step = "0.05";
    if (min !== undefined) i.min = String(min);
    i.value = num3(value);
    i.addEventListener("change", () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onChange(v); else i.value = num3(value); });
    return i;
  }
  private select(options: Array<[value: string, word: string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = el("select");
    for (const [v, w] of options) { const o = el("option", undefined, w); o.value = v; s.appendChild(o); }
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  private check(label: string, value: boolean, onChange: (v: boolean) => void, key: string): HTMLElement {
    const w = el("label", "draw-check");
    const i = el("input");
    i.type = "checkbox";
    i.checked = value;
    i.setAttribute("data-field", key);
    i.addEventListener("change", () => onChange(i.checked));
    w.append(i, el("span", undefined, label));
    return w;
  }
  private row(...children: HTMLElement[]): HTMLElement {
    const r = el("div", "inspector-row");
    r.append(...children);
    return r;
  }
  private section(title: string, open: boolean, ...children: HTMLElement[]): HTMLElement {
    const d = el("details", "inspector-section");
    d.open = open;
    d.appendChild(el("summary", undefined, title));
    d.append(...children);
    return d;
  }
  private act(word: string, run: () => void, title?: string): HTMLButtonElement {
    const b = button("btn-quiet", word, title);
    b.setAttribute("data-field", `act:${word}`);
    b.addEventListener("click", run);
    return b;
  }

  // ---- building
  private build(): void {
    const s = this.host.app.session;
    const d = s.doc;
    this.body.replaceChildren();
    if (!d) return;
    const nodes = this.host.canvas.selectedNodes(), edges = this.host.canvas.selectedEdges();
    const out: HTMLElement[] = [];
    if (!s.inSync) out.push(el("p", "note", "The text has a mistake, so nothing here can be changed until it is fixed."));
    if (nodes.length + edges.length === 0) out.push(...this.document(d));
    else if (nodes.length === 1 && edges.length === 0) out.push(...this.node(d, nodes[0]));
    else if (edges.length === 1 && nodes.length === 0) out.push(...this.edge(d, edges[0]));
    else out.push(...this.many(d, nodes, edges));
    this.body.append(...out);
    if (!s.inSync) for (const c of this.body.querySelectorAll<HTMLInputElement>("input, select, textarea, button")) c.disabled = true;
  }

  private styleControls(style: { fill?: string; color?: string; weight?: string } | undefined, fill: boolean, set: (st: Record<string, string | undefined>) => void, key: string): HTMLElement {
    const cur = style ?? {};
    const controls: HTMLElement[] = [];
    if (fill) controls.push(this.field("fill", this.select([["", "page (default)"], ["wash", "wash"], ["none", "none (see-through)"]], cur.fill ?? "", (v) => set({ ...cur, fill: v || undefined })), `${key}:fill`));
    controls.push(this.field("color", this.select([["", "ink (default)"], ["ink-2", "graphite"], ["accent", "green"], ["accent-strong", "dark green"], ["terra", "terracotta"]],
      cur.color ?? "", (v) => set({ ...cur, color: v || undefined })), `${key}:color`));
    controls.push(this.field("weight", this.select([["thin", "thin"], ["", "normal"], ["bold", "bold"]], cur.weight ?? "", (v) => set({ ...cur, weight: v || undefined })), `${key}:weight`));
    return this.section("look", !!style, this.row(...controls));
  }

  private document(d: ChalkDoc): HTMLElement[] {
    const m = d.meta;
    const lanes = d.nodes.some((n) => n.kind === "partition");
    const out: HTMLElement[] = [el("h2", undefined, "diagram")];
    out.push(this.field("type", this.select(TYPES.map((t) => [t, TYPE_NAME[t].toLowerCase()]), m.type, (v) => this.edit("change type", (x) => cmd.patchMeta(x, { type: v as ChalkDoc["meta"]["type"] }), `now a ${TYPE_NAME[v].toLowerCase()}`, false)), "doc:type"));
    out.push(this.field("title: what it shows", this.text(m.title, (v) => this.edit("edit title", (x) => cmd.patchMeta(x, { title: v })), true), "doc:title"));
    out.push(this.field("id", this.text(m.id, (v) => this.edit("edit id", (x) => cmd.patchMeta(x, { id: v.trim() }))), "doc:id"));
    if (m.type !== "use-case") {
      out.push(this.field("runs", this.select([["down", "top to bottom"], ["right", "left to right"]], lanes && m.lanes ? (m.lanes === "horizontal" ? "right" : "down") : m.direction,
        (v) => this.edit("change direction", (x) => cmd.patchMeta(x, { direction: v as "down" | "right", ...(lanes ? { lanes: null } : {}) }), "turned the flow; shapes you placed by hand stayed where they were", false)), "doc:direction"));
    }
    out.push(this.field("drawn as", this.select([["", "sketch (like the videos)"], ["precision", "precision (crisp, for reports)"]], m.look === "precision" ? "precision" : "",
      (v) => this.edit("change look", (x) => cmd.patchMeta(x, { look: v ? "precision" : null }))), "doc:look"));
    out.push(this.section("more", false,
      this.field("checked as", this.select(PROFILES.map((p) => [p, p + (p === DEFAULT_PROFILE[m.type] ? " (usual)" : "")]), m.profile, (v) => this.edit("change profile", (x) => cmd.patchMeta(x, { profile: v as ChalkDoc["meta"]["profile"] }))), "doc:profile"),
      this.field("narration: the words it goes with", this.text(m.narration, (v) => this.edit("edit narration", (x) => cmd.patchMeta(x, { narration: v })), true), "doc:narration"),
      this.field("described as (text alternative)", this.text(m.desc, (v) => this.edit("edit description", (x) => cmd.patchMeta(x, { desc: v })), true), "doc:desc"),
    ));
    const placed = d.nodes.filter((n) => n.place || n.size).length, routed = d.edges.filter((e) => e.route || e.labelPos).length;
    out.push(el("p", "note", placed || routed
      ? `${placed} shape${placed === 1 ? "" : "s"} placed by hand, ${routed} line${routed === 1 ? "" : "s"} routed by hand. Everything else is laid out for you.`
      : "Everything is laid out for you. Drag a shape and only that shape becomes yours to place."));
    return out;
  }

  private node(d: ChalkDoc, n: DocNode): HTMLElement[] {
    const geo = this.host.app.session.geometry?.nodes.get(n.id);
    const out: HTMLElement[] = [el("h2", undefined, kindWord(n.kind))];
    const group = cmd.KIND_GROUPS.filter((g) => g.includes(n.kind)).flat().filter((k, i, a) => a.indexOf(k) === i);
    const offered = group.filter((k) => (d.meta.type === "flowchart" ? k !== "action" : k !== "process" && k !== "io" && k !== "terminator") || k === n.kind);
    if (offered.length > 1) {
      out.push(this.field("kind", this.select(offered.map((k) => [k, kindWord(k)]), n.kind, (v) => this.edit("change kind", (x) => cmd.changeKind(x, n.uid, v as NodeKind), `now a ${kindWord(v as NodeKind)}`)), "node:kind"));
    }
    if (!UNLABELED.has(n.kind)) {
      const single = CONTAINERS.has(n.kind) || CLASSIFIERS.has(n.kind);
      out.push(this.field(CLASSIFIERS.has(n.kind) ? "name" : n.kind === "partition" ? "who" : "text", this.text(n.label ?? "", (v) => this.edit("edit text", (x) => cmd.setLabel(x, n.uid, v)), !single), "node:label"));
    } else out.push(el("p", "note", `A ${kindWord(n.kind)} has no text.`));
    out.push(this.field("id (the name in the text)", this.text(n.id, (v) => this.edit("rename", (x) => cmd.renameId(x, n.uid, v.trim()), `renamed to ${v.trim()}`)), "node:id"));

    if (n.kind === "actor") out.push(this.field("stands on the", this.select([["left", "left"], ["right", "right"]], n.side ?? "left", (v) => this.edit("change side", (x) => cmd.patchNode(x, n.uid, { side: v as "left" | "right" }), undefined, false)), "node:side"));

    if (CLASSIFIERS.has(n.kind)) out.push(...this.classFields(n));
    if (n.kind === "use-case") out.push(this.describe(d, n));

    if (n.kind === "partition") {
      const lanes = d.nodes.filter((x) => x.kind === "partition");
      const i = lanes.indexOf(n);
      const horizontal = !!geo?.horizontal;
      if (geo) out.push(this.field(horizontal ? "height (in)" : "width (in)", this.number(horizontal ? geo.h : geo.w, (v) => this.edit("resize partition", (x) => this.host.canvas.resizeLane(x, n.uid, Math.max(geo.minW, v)), "resized the partition", false), 1), "lane:size"));
      out.push(this.row(
        this.act(horizontal ? "move up" : "move left", () => this.edit("move partition", (x) => { this.fixLanes(x); cmd.movePartition(x, n.uid, -1); this.shiftLaneMembers(x); }, "moved the partition", false)),
        this.act(horizontal ? "move down" : "move right", () => this.edit("move partition", (x) => { this.fixLanes(x); cmd.movePartition(x, n.uid, 1); this.shiftLaneMembers(x); }, "moved the partition", false)),
      ));
      (out[out.length - 1].children[0] as HTMLButtonElement).disabled = i <= 0;
      (out[out.length - 1].children[1] as HTMLButtonElement).disabled = i >= lanes.length - 1;
      const inside = d.nodes.filter((x) => x.parent === n.id).length;
      out.push(this.row(
        this.act("duplicate", () => this.duplicateLane(n)),
        this.act("delete", () => this.host.canvas.remove(), inside ? `its ${inside} shape${inside === 1 ? "" : "s"} stay, outside any partition` : undefined),
      ));
      out.push(el("p", "note", inside ? `${inside} shape${inside === 1 ? "" : "s"} inside. Deleting the partition keeps them, without an owner.` : "Nothing inside yet: drag shapes in, or drop new ones on it."));
      return out;
    }

    // place and size
    const containers = d.nodes.filter((c) => CONTAINERS.has(c.kind));
    if (!CONTAINERS.has(n.kind) && containers.length) {
      out.push(this.field("inside", this.select([["", d.meta.type === "use-case" ? "outside the boundary" : "no partition"], ...containers.map((c) => [c.id, c.label ?? c.id] as [string, string])], n.parent ?? "",
        (v) => this.edit("move into container", (x) => { cmd.setParent(x, n.uid, v || undefined); cmd.releaseNode(x, n.uid, "place"); }, v ? `now in ${d.nodes.find((c) => c.id === v)?.label ?? v}` : "now outside", false)), "node:parent"));
    }
    if (geo && n.kind !== "boundary") {
      const pos = this.row(
        this.field("x (in)", this.number(geo.cx, (v) => this.edit("move", (x) => cmd.moveNode(x, n.uid, v, geo.cy), "moved")), "node:x"),
        this.field("y (in)", this.number(geo.cy, (v) => this.edit("move", (x) => cmd.moveNode(x, n.uid, geo.cx, v), "moved")), "node:y"),
      );
      const controls: HTMLElement[] = [pos];
      if (resizable(n.kind)) {
        const bar = n.kind === "fork" || n.kind === "join";
        controls.push(this.row(
          ...(bar && geo.vertical ? [] : [this.field(bar ? "length (in)" : "width (in)", this.number(geo.w, (v) => this.edit("resize", (x) => cmd.resizeNode(x, n.uid, { x: geo.cx, y: geo.cy, w: Math.max(v, geo.minW), h: geo.h }), "resized"), 0.2), "node:w")]),
          ...(bar && !geo.vertical ? [] : [this.field(bar ? "length (in)" : "height (in)", this.number(geo.h, (v) => this.edit("resize", (x) => cmd.resizeNode(x, n.uid, { x: geo.cx, y: geo.cy, w: geo.w, h: Math.max(v, geo.minH) }), "resized"), 0.2), "node:h")]),
        ));
      }
      const acts: HTMLElement[] = [];
      if (n.place) acts.push(this.act("let it find its own place", () => this.edit("release place", (x) => cmd.releaseNode(x, n.uid, "place"), "back to automatic placing", false)));
      if (n.size) acts.push(this.act("fit to its text", () => this.edit("release size", (x) => cmd.releaseNode(x, n.uid, "size"), "sized to its text")));
      if (acts.length) controls.push(this.row(...acts));
      controls.push(el("p", "note", n.place ? "Placed by hand: it stays here until you move it or let it go." : "Placed for you: it follows the layout until you drag it."));
      out.push(this.section("place and size", true, ...controls));
    } else if (geo && n.kind === "boundary") {
      const acts: HTMLElement[] = [];
      if (n.size) acts.push(this.act("fit to what's inside", () => this.edit("release size", (x) => cmd.releaseNode(x, n.uid, "both"), "the boundary fits its contents again", false)));
      out.push(this.section("place and size", true, el("p", "note", n.size ? "Sized by hand." : "Fits what is inside it. Drag a handle to size it yourself; drag it to move everything inside."), ...acts));
    }
    if (n.kind !== "note") out.push(this.styleControls(n.style, !["initial", "fork", "join", "actor", "boundary"].includes(n.kind), (st) => this.edit("change look", (x) => cmd.patchNode(x, n.uid, { style: st })), "node:style"));
    out.push(this.row(this.act("delete", () => this.host.canvas.remove())));
    return out;
  }

  /** Before lanes change order, pin each one's thickness so only the order changes. */
  private fixLanes(x: ChalkDoc): void {
    const geo = this.host.app.session.geometry;
    for (const l of x.nodes) {
      const g = l.kind === "partition" ? geo?.nodes.get(l.id) : undefined;
      if (g && l.thickness === undefined) l.thickness = Math.round((g.horizontal ? g.h : g.w) * 1000) / 1000;
    }
  }
  /** After lanes change order, shapes placed by hand travel with their lane. */
  private shiftLaneMembers(x: ChalkDoc): void {
    const geo = this.host.app.session.geometry;
    if (!geo) return;
    const lanes = x.nodes.filter((n) => n.kind === "partition");
    const first = lanes.map((l) => geo.nodes.get(l.id)).filter((g) => !!g).sort((a, b) => (a!.horizontal ? a!.cy - b!.cy : a!.cx - b!.cx))[0];
    if (!first) return;
    const horizontal = !!first.horizontal;
    let at = horizontal ? first.cy - first.h / 2 : first.cx - first.w / 2;
    for (const l of lanes) {
      const g = geo.nodes.get(l.id);
      if (!g) continue;
      const was = horizontal ? g.cy - g.h / 2 : g.cx - g.w / 2;
      const delta = at - was;
      if (Math.abs(delta) > 1e-6) {
        for (const n of x.nodes) {
          if (n.parent !== l.id || !n.place) continue;
          if (horizontal) n.place.y = Math.round((n.place.y + delta) * 1000) / 1000; else n.place.x = Math.round((n.place.x + delta) * 1000) / 1000;
        }
      }
      at += l.thickness ?? (horizontal ? g.h : g.w);
    }
  }

  private duplicateLane(n: DocNode): void {
    const s = this.host.app.session;
    const d = s.doc, geo = s.geometry;
    if (!d || !geo) return;
    const g = geo.nodes.get(n.id);
    const fragment = cmd.copyFragment(d, [n.uid]);
    const at = new Map<string, { x: number; y: number }>();
    for (const m of fragment.nodes) { const mg = geo.nodes.get(m.id); if (mg) at.set(m.uid, { x: mg.cx, y: mg.cy }); }
    let made: string[] = [];
    const r = s.edit("duplicate partition", (x) => {
      this.fixLanes(x);
      // the copy goes to the end; its shapes keep their place inside it
      const lanes = x.nodes.filter((l) => l.kind === "partition");
      const last = geo.nodes.get(lanes[lanes.length - 1].id)!;
      const horizontal = !!g?.horizontal;
      const end = horizontal ? last.cy + last.h / 2 : last.cx + last.w / 2, start = g ? (horizontal ? g.cy - g.h / 2 : g.cx - g.w / 2) : 0;
      const res = cmd.pasteFragment(x, fragment, at, horizontal ? 0 : end - start, horizontal ? end - start : 0);
      made = res.nodes;
      const copy = x.nodes.find((l) => l.uid === res.nodes[0]);
      if (copy && n.label) copy.label = `${n.label} copy`;
    }, { hold: false });
    if (r.ok && made.length) this.host.canvas.select([made[0]]);
    this.host.say(r.ok ? "duplicated the partition and what was in it" : r.message ?? "");
  }

  private classFields(n: DocNode): HTMLElement[] {
    const members = n.members ?? [];
    const set = (next: Member[], done?: string): void => this.edit("edit members", (x) => cmd.patchNode(x, n.uid, { members: next }), done);
    const rows: HTMLElement[] = [];
    members.forEach((m, i) => {
      const input = this.text(printMember(m), (v) => {
        if (!v.trim()) { set(members.filter((_, j) => j !== i), "removed the member"); return; }
        const parsed = parseMember(v);
        if (!parsed) { this.host.say("can't read that member: write + name: Type or + name(params): Type"); this.update(true); return; }
        set(members.map((x, j) => (j === i ? parsed : x)));
      });
      input.classList.add("mono");
      input.setAttribute("aria-label", `${m.kind} ${i + 1}`);
      input.setAttribute("data-field", `class:m${i}`);
      const up = this.act("↑", () => set(swap(members, i, i - 1)), "move up");
      up.setAttribute("aria-label", "move up");
      up.setAttribute("data-field", `class:up${i}`);
      up.disabled = i === 0 || members[i - 1].kind !== m.kind;
      const rm = this.act("remove", () => set(members.filter((_, j) => j !== i), "removed the member"));
      rm.setAttribute("data-field", `class:rm${i}`);
      const r = el("div", "member-row");
      r.append(input, up, rm);
      rows.push(r);
    });
    const names = new Set(members.map((m) => m.name));
    const fresh = (base: string): string => { let k = 1; while (names.has(`${base}${k}`)) k++; return `${base}${k}`; };
    const adds = this.row(
      this.act("add attribute", () => { const at = members.filter((m) => m.kind === "attribute").length; set([...members.slice(0, at), { kind: "attribute", visibility: "+", name: fresh("attribute"), type: "Type" }, ...members.slice(at)], "added an attribute"); }),
      this.act("add operation", () => set([...members, { kind: "operation", visibility: "+", name: fresh("operation"), params: "", type: "void" }], "added an operation")),
    );
    return [
      this.section("attributes and operations", true, el("p", "note", "one per line: + name: Type, or + name(params): Type. End with {static} or {abstract} when it is."), ...rows, adds),
      this.row(
        this.field("stereotype", this.text(n.stereotype ?? "", (v) => this.edit("edit stereotype", (x) => cmd.patchNode(x, n.uid, { stereotype: v.trim() || null }))), "class:stereotype"),
        ...(n.kind === "class" ? [this.check("abstract", !!n.abstract, (v) => this.edit("change abstract", (x) => cmd.patchNode(x, n.uid, { abstract: v })), "class:abstract")] : []),
      ),
    ];
  }

  private describe(d: ChalkDoc, n: DocNode): HTMLElement {
    const u: UseCaseDoc = n.describe ?? {};
    const actors = d.nodes.filter((a) => a.kind === "actor");
    const put = (patch: Partial<UseCaseDoc>): void => this.edit("edit description", (x) => cmd.patchNode(x, n.uid, { describe: { ...u, ...patch } }));
    const lines = (v: string): string[] => v.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const one = (v: string): string => v.replace(/\s+/g, " ").trim();
    const list = (label: string, key: "supporting" | "pre" | "main" | "alt" | "post" | "related"): HTMLElement =>
      this.field(label, this.text((u[key] ?? []).join("\n"), (v) => put({ [key]: lines(v) }), true), `uc:${key}`);
    return this.section("description", !!n.describe,
      el("p", "note", "A structured description of this use case. Fill in what you know; nothing is made up for you."),
      this.field("goal", this.text(u.goal ?? "", (v) => put({ goal: one(v) })), "uc:goal"),
      this.field("primary actor", this.select([["", "not said"], ...actors.map((a) => [a.id, a.label ?? a.id] as [string, string]),
        ...(u.primary && !actors.some((a) => a.id === u.primary) ? [[u.primary, u.primary] as [string, string]] : [])], u.primary ?? "", (v) => put({ primary: v })), "uc:primary"),
      list("supporting actors, one per line", "supporting"),
      this.field("trigger: the event that starts it", this.text(u.trigger ?? "", (v) => put({ trigger: one(v) })), "uc:trigger"),
      list("preconditions: what already holds, one per line", "pre"),
      list("main success scenario, one step per line", "main"),
      list("alternate and exception flows, one per line", "alt"),
      list("postconditions, one per line", "post"),
      list("related use cases, one per line", "related"),
    );
  }

  private edge(d: ChalkDoc, e: DocEdge): HTMLElement[] {
    const name = (id: string): string => (d.nodes.find((n) => n.id === id)?.label ?? id).replace(/\n/g, " ");
    const out: HTMLElement[] = [el("h2", undefined, "line"), el("p", "note", `${name(e.from)} to ${name(e.to)}`)];
    const rels = cmd.RELATIONS[d.meta.type];
    const op = edgeOp(e, d.meta.type) === "->" && d.meta.type === "class" ? "-->" : edgeOp(e, d.meta.type);
    out.push(this.field("what it means", this.select(rels.map((r) => [r.op, r.word]), rels.some((r) => r.op === op) ? op : rels[0].op,
      (v) => this.edit("change relationship", (x) => cmd.setRelation(x, e.uid, v), `now ${rels.find((r) => r.op === v)?.word}: ${rels.find((r) => r.op === v)?.help}`)), "edge:op"));
    out.push(el("p", "note", `Drawn ${isDashed(e) ? "dashed" : "solid"}: the line's pattern and its ends are part of what it means, so they change with the meaning, not on their own.`));
    out.push(this.field(d.meta.type === "class" ? "name" : "label", this.text(e.label ?? "", (v) => this.edit("edit label", (x) => cmd.setLabel(x, e.uid, v))), "edge:label"));
    if (d.meta.type === "class" && (e.kind === "association" || e.kind === "aggregation" || e.kind === "composition")) {
      const ends = e.ends ?? {};
      const put = (end: "from" | "to", patch: { mult?: string; role?: string }): void =>
        this.edit("edit line end", (x) => cmd.patchEdge(x, e.uid, { ends: { ...ends, [end]: { ...(ends[end] ?? {}), ...patch } } }));
      for (const end of ["from", "to"] as const) {
        out.push(this.row(
          this.field(`how many at ${name(e[end])}`, this.text(ends[end]?.mult ?? "", (v) => put(end, { mult: v.trim() })), `edge:${end}-mult`),
          this.field("role there", this.text(ends[end]?.role ?? "", (v) => put(end, { role: v.trim() })), `edge:${end}-role`),
        ));
      }
      out.push(el("p", "note", "how many: 1, 0..1, *, 1..*"));
    }
    const geo = this.host.app.session.geometry?.edges.find((x) => x.uid === e.uid);
    const sideSel = (end: "from" | "to"): HTMLElement => this.field(`${end === "from" ? "leaves" : "arrives at"} ${name(e[end])} on its`,
      this.select([["", `any side (now ${geo?.[end === "from" ? "fromSide" : "toSide"] ?? "auto"})`], ["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"]], e.route?.[end] ?? "", (v) => {
        this.edit("change line side", (x) => {
          const cur = x.edges.find((y) => y.uid === e.uid)!;
          const next = { kind: cur.route?.kind ?? (d.meta.type === "use-case" ? "straight" : "elbow"), ...cur.route, [end]: (v || undefined) as Side | undefined };
          if (!next.from) delete next.from;
          if (!next.to) delete next.to;
          delete next.via;
          cmd.patchEdge(x, e.uid, { route: next.from || next.to || cur.route ? next : null });
        });
      }), `edge:side-${end}`);
    const routeWord = e.route ? (e.route.via?.length ? "bent by hand" : "pinned by hand") : "found for you";
    out.push(this.section("route", true,
      this.field("runs", this.select([["", `automatic${e.route ? "" : ` (${geo?.routeKind === "straight" ? "straight" : "elbow"})`}`], ["elbow", "elbow: right angles"], ["straight", "straight"]], e.route?.kind ?? "",
        (v) => this.edit("change route", (x) => cmd.patchEdge(x, e.uid, { route: v ? { kind: v as "elbow" | "straight" } : null }))), "edge:route"),
      this.row(sideSel("from"), sideSel("to")),
      this.row(
        ...(e.route ? [this.act("reset route", () => this.edit("reset route", (x) => cmd.patchEdge(x, e.uid, { route: null }), "the router has this line again"))] : []),
        ...(e.labelPos ? [this.act("reset label", () => this.edit("reset label", (x) => cmd.patchEdge(x, e.uid, { labelPos: null }), "the label is placed for you again"))] : []),
        this.act("swap ends", () => this.edit("swap ends", (x) => cmd.swapEnds(x, e.uid), "swapped the ends")),
      ),
      el("p", "note", `This route is ${routeWord}. Drag a handle on the line to bend it; drag an end to attach it somewhere else.`),
    ));
    out.push(this.styleControls(e.style, false, (st) => this.edit("change look", (x) => cmd.patchEdge(x, e.uid, { style: st })), "edge:style"));
    out.push(this.row(this.act("delete", () => this.host.canvas.remove())));
    return out;
  }

  private many(d: ChalkDoc, nodes: DocNode[], edges: DocEdge[]): HTMLElement[] {
    const out: HTMLElement[] = [el("h2", undefined, `${nodes.length + edges.length} selected`)];
    const geo = this.host.app.session.geometry;
    const movable = nodes.filter((n) => !CONTAINERS.has(n.kind));
    const boxes: Box[] = movable.map((n) => geo?.nodes.get(n.id)).filter((g) => !!g).map((g) => ({ id: g!.uid, cx: g!.cx, cy: g!.cy, w: g!.w, h: g!.h }));
    const move = (label: string, to: Map<string, { x: number; y: number }>): void =>
      this.edit(label, (x) => { for (const [uid, p] of to) cmd.moveNode(x, uid, p.x, p.y); }, `${label}: one step to undo`);
    if (boxes.length >= 2) {
      const al = (how: AlignHow, word: string): HTMLButtonElement => this.act(word, () => move(`align ${how}`, align(boxes, how)));
      out.push(this.section("align", true, this.row(al("left", "left"), al("center", "center"), al("right", "right")), this.row(al("top", "top"), al("middle", "middle"), al("bottom", "bottom"))));
      const dist = this.row(
        this.act("across", () => move("distribute across", distribute(boxes, "x")), "equal gaps left to right"),
        this.act("down", () => move("distribute down", distribute(boxes, "y")), "equal gaps top to bottom"),
      );
      for (const b of dist.querySelectorAll("button")) b.disabled = boxes.length < 3;
      out.push(this.section("space evenly", true, dist));
      const sizable = movable.filter((n) => resizable(n.kind) && n.kind !== "fork" && n.kind !== "join");
      const sb: Box[] = sizable.map((n) => geo?.nodes.get(n.id)).filter((g) => !!g).map((g) => ({ id: g!.uid, cx: g!.cx, cy: g!.cy, w: g!.w, h: g!.h }));
      const size = (what: "width" | "height"): void => {
        const to = matchSize(sb, what);
        this.edit(`match ${what}`, (x) => { for (const b of sb) { const s = to.get(b.id)!; cmd.resizeNode(x, b.id, { x: b.cx, y: b.cy, w: s.w, h: s.h }); } }, `matched ${what}s`);
      };
      if (sb.length >= 2) out.push(this.section("same size", true, this.row(this.act("width", () => size("width")), this.act("height", () => size("height")))));
    }
    const placed = movable.filter((n) => n.place);
    if (placed.length) out.push(this.row(this.act("let them find their own places", () => this.edit("release places", (x) => { for (const n of placed) cmd.releaseNode(x, n.uid, "place"); }, "back to automatic placing", false))));
    out.push(this.row(this.act("duplicate", () => { if (this.host.canvas.copy(true)) this.host.canvas.paste(true); }), this.act("delete", () => this.host.canvas.remove())));
    return out;
  }
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const out = [...a];
  if (j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
