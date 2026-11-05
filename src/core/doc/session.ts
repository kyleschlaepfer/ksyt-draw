/**
 * One open document, shared by the write and draw views.
 *
 * The session owns the text, the last valid document parsed from it, that document's resolved
 * geometry, and a single undo history. Both views change the document through it:
 *
 *   write   setText(): the text is parsed; if it is valid it becomes the document, if not the last
 *           valid document stays on screen and `inSync` is false until the text is fixed
 *   draw    edit(): a transaction clones the document, applies commands, keeps every other shape
 *           where it was, writes the change into the text with targeted edits, and records one
 *           undo step. Draw never edits while the text is out of sync, so it can't overwrite a
 *           newer draft.
 *
 * No DOM here: the session takes a measurer and runs in Node tests.
 */
import type { Measurer } from "../measure";
import { resolve, type Geometry } from "../geom/resolve";
import { adoptUids, parseSource, type ParsedSource } from "./parse";
import { syncSource } from "./sync";
import { cloneDoc, type ChalkDoc } from "./types";
import { EditError } from "./commands";

export interface HistoryEntry { text: string; selection: string[]; label: string }

export interface EditOptions {
  /** false for edits that are meant to move other shapes (tidy up, lane resize, direction) */
  hold?: boolean;
  /** uids selected after the edit (the draw view restores this on undo and redo) */
  select?: string[];
}

export interface EditResult {
  ok: boolean;
  message?: string;
  /** how many other shapes were placed where they already were, so the edit moved nothing but its own subject */
  held: number;
  /** the automatic layout as a whole moved by this much (inches); the canvas pans by it so nothing appears to move */
  shift?: [number, number];
}

export type Origin = "write" | "draw" | "load" | "history";
export type Listener = (origin: Origin) => void;

const TYPING_WINDOW = 1200;
const HISTORY_LIMIT = 300;
const EPS = 0.004;

export class Session {
  private current!: ParsedSource;
  private good: ParsedSource | null = null;
  private geo: Geometry | null = null;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  private lastWrite = 0;
  /** set by the last draw edit when the whole automatic layout slid; the canvas reads it once and pans to cancel it */
  lastShift: [number, number] | null = null;
  /** uids the draw view has selected; saved with each history entry */
  selection: string[] = [];

  constructor(text: string, private measurer: Measurer, private now: () => number = () => Date.now()) {
    this.load(text);
  }

  // ---- reading
  get text(): string { return this.current.text; }
  /** the parse of the current text (its doc is null when the text has a mistake) */
  get parsed(): ParsedSource { return this.current; }
  /** the last valid document, or null if there has never been one */
  get doc(): ChalkDoc | null { return this.good?.doc ?? null; }
  /** the parse the last valid document came from */
  get source(): ParsedSource | null { return this.good; }
  get geometry(): Geometry | null { return this.geo; }
  /** is the document on screen the one the text describes? */
  get inSync(): boolean { return this.current.doc !== null; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | null { return this.past[this.past.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.future[this.future.length - 1]?.label ?? null; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(origin: Origin): void { for (const fn of [...this.listeners]) fn(origin); }

  /** Fonts arrived or changed: measure again. */
  remeasure(): void {
    if (this.good?.doc) this.geo = resolve(this.good.doc, this.measurer);
    this.emit("load");
  }

  private adopt(text: string): void {
    const parsed = adoptUids(parseSource(text), this.good?.doc ?? null);
    this.current = parsed;
    if (parsed.doc) {
      this.good = parsed;
      this.geo = resolve(parsed.doc, this.measurer);
    }
  }

  private remember(label: string): void {
    this.past.push({ text: this.current.text, selection: [...this.selection], label });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** Replace the document (open a file, a link, a template). The history starts over. */
  load(text: string): void {
    this.good = null;
    this.geo = null;
    this.past = [];
    this.future = [];
    this.selection = [];
    this.lastWrite = 0;
    this.adopt(text);
    this.emit("load");
  }

  /** The write view's edit. Typing within a short window is one undo step. */
  setText(text: string, label = "typing"): void {
    if (text === this.current.text) return;
    const t = this.now();
    const typing = label === "typing" && this.past.length > 0 && this.past[this.past.length - 1].label === "typing" && t - this.lastWrite < TYPING_WINDOW;
    if (!typing) this.remember(label);
    else this.future = [];
    this.lastWrite = t;
    this.adopt(text);
    this.emit("write");
  }

  /** The draw view's edit: one transaction, one undo step. */
  edit(label: string, fn: (draft: ChalkDoc) => void, o: EditOptions = {}): EditResult {
    if (!this.good?.doc || !this.inSync) return { ok: false, message: "fix the text first: the drawing is showing the last version that worked", held: 0 };
    const draft = cloneDoc(this.good.doc);
    try {
      fn(draft);
    } catch (e) {
      if (e instanceof EditError) return { ok: false, message: e.message, held: 0 };
      throw e;
    }
    const kept = o.hold === false ? { held: 0 } : this.holdStill(draft);
    const held = kept.held;
    const text = syncSource(this.good, draft);
    if (text === this.current.text) return { ok: true, held: 0 };
    const check = adoptUids(parseSource(text), draft);
    if (!check.doc) {
      // a command produced text the parser refuses: keep the document as it was and say why
      const first = check.diagnostics.find((d) => d.severity === "error");
      return { ok: false, message: first ? `that change can't be written as text (${first.message})` : "that change can't be written as text", held: 0 };
    }
    this.remember(label);
    this.lastWrite = 0;
    this.current = check;
    this.good = check;
    this.geo = resolve(check.doc, this.measurer);
    if (o.select) this.selection = o.select;
    this.lastShift = kept.shift ?? null;
    this.emit("draw");
    return { ok: true, held, ...(kept.shift ? { shift: kept.shift } : {}) };
  }

  /**
   * Nothing moves unless the author moves it: any automatic shape the edit would shift is placed
   * where it already is, and partitions keep their thickness. Returns how many shapes were held.
   */
  private holdStill(draft: ChalkDoc): { held: number; shift?: [number, number] } {
    const before = this.geo;
    if (!before) return { held: 0 };
    let held = 0;
    // a diagram with nothing placed by hand may slide as a whole (a wider box re-centers its column):
    // that is not a rearrangement, so nothing is pinned; the canvas pans to cancel it
    if (!draft.nodes.some((n) => n.place) && !draft.pool) {
      const after = resolve(draft, this.measurer);
      let shift: [number, number] | null = null, uniform = true;
      for (const n of draft.nodes) {
        const was = before.nodes.get(n.id), now = after.nodes.get(n.id);
        if (!was || !now || n.kind === "partition" || n.kind === "boundary") continue;
        const v: [number, number] = [now.cx - was.cx, now.cy - was.cy];
        if (!shift) shift = v;
        else if (Math.abs(v[0] - shift[0]) > EPS || Math.abs(v[1] - shift[1]) > EPS) { uniform = false; break; }
      }
      if (uniform && shift) return Math.abs(shift[0]) > EPS || Math.abs(shift[1]) > EPS ? { held: 0, shift } : { held: 0 };
    }
    for (let pass = 0; pass < 3; pass++) {
      const after = resolve(draft, this.measurer);
      let changed = 0;
      for (const n of draft.nodes) {
        const was = before.nodes.get(n.id), now = after.nodes.get(n.id);
        if (!was || !now) continue;
        if (n.kind === "partition") {
          const a = was.horizontal ? was.h : was.w, b = now.horizontal ? now.h : now.w;
          if (n.thickness === undefined && Math.abs(a - b) > EPS) { n.thickness = Math.round(a * 1000) / 1000; changed++; }
          continue;
        }
        if (n.kind === "boundary" || n.place) continue;
        if (Math.abs(was.cx - now.cx) > EPS || Math.abs(was.cy - now.cy) > EPS) {
          n.place = { x: Math.round(was.cx * 1000) / 1000, y: Math.round(was.cy * 1000) / 1000 };
          changed++;
          held++;
        }
      }
      if (!changed) break;
    }
    return { held };
  }

  private restore(e: HistoryEntry): void {
    this.adopt(e.text);
    this.selection = e.selection;
    this.lastWrite = 0;
  }

  undo(): boolean {
    const e = this.past.pop();
    if (!e) return false;
    this.future.push({ text: this.current.text, selection: [...this.selection], label: e.label });
    this.restore(e);
    this.emit("history");
    return true;
  }

  redo(): boolean {
    const e = this.future.pop();
    if (!e) return false;
    this.past.push({ text: this.current.text, selection: [...this.selection], label: e.label });
    this.restore(e);
    this.emit("history");
    return true;
  }
}
