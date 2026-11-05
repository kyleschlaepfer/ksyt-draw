/**
 * Editing text where it is: a field laid over the shape (or line label, or class row) being edited.
 *
 * The field is created once when editing starts and removed when it ends. Nothing redraws it while
 * the author types, so the caret, the selection and every keystroke are the browser's own. The
 * document changes once, when the edit is committed: Enter or clicking away commits, Escape cancels,
 * Shift+Enter starts a new line where the text allows one.
 */
export interface InlineSpec {
  /** the box to cover, in pixels inside the stage */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  multiline: boolean;
  fontPx: number;
  family: "hand" | "body" | "mono";
  align: "center" | "left";
  /** where the caret starts: everything selected, or at the end (after a typed character) */
  caret: "all" | "end";
  label: string;
  commit(text: string): void;
  done(): void;
}

const FAMILY = { hand: "var(--font-hand)", body: "var(--font-body)", mono: "var(--font-mono)" };

export class InlineEditor {
  private field: HTMLTextAreaElement | null = null;
  private spec: InlineSpec | null = null;
  private ruler: CanvasRenderingContext2D | null = null;

  constructor(private stage: HTMLElement) {}

  get active(): boolean { return this.field !== null; }

  open(spec: InlineSpec): void {
    this.close(true);
    const f = document.createElement("textarea");
    f.className = `draw-inline draw-inline-${spec.align}`;
    f.value = spec.text;
    f.rows = 1;
    f.spellcheck = false;
    f.setAttribute("aria-label", spec.label);
    f.setAttribute("autocapitalize", "off");
    f.style.font = `${Math.max(9, spec.fontPx).toFixed(1)}px/1.25 ${FAMILY[spec.family]}`;
    this.field = f;
    this.spec = spec;
    this.stage.appendChild(f);
    this.size();
    f.addEventListener("input", () => this.size());
    f.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.isComposing) return;
      if (ev.key === "Escape") { ev.preventDefault(); this.close(false); }
      else if (ev.key === "Enter" && !(spec.multiline && ev.shiftKey)) { ev.preventDefault(); this.close(true); }
    });
    for (const type of ["pointerdown", "dblclick", "wheel", "keyup"]) f.addEventListener(type, (ev) => ev.stopPropagation());
    f.addEventListener("blur", () => this.close(true));
    f.focus({ preventScroll: true });
    if (spec.caret === "all") f.select(); else f.setSelectionRange(f.value.length, f.value.length);
  }

  /** Fit the field to its text, growing from the middle of the box it covers. */
  private size(): void {
    const f = this.field, s = this.spec;
    if (!f || !s) return;
    if (!this.ruler) this.ruler = document.createElement("canvas").getContext("2d");
    let textW = 0;
    if (this.ruler) {
      this.ruler.font = getComputedStyle(f).font;
      for (const line of f.value.split("\n")) textW = Math.max(textW, this.ruler.measureText(line).width);
    }
    const w = Math.max(s.w, textW + 28, 64);
    f.style.width = `${w}px`;
    f.style.height = "auto";
    const h = Math.max(f.scrollHeight + 2, s.fontPx * 1.25 + 10);
    f.style.height = `${h}px`;
    f.style.left = `${s.align === "center" ? s.x + s.w / 2 - w / 2 : s.x}px`;
    f.style.top = `${s.y + s.h / 2 - h / 2}px`;
  }

  /** End the edit. Safe to call twice: removing the field blurs it, which would otherwise commit again. */
  close(commit: boolean): void {
    const f = this.field, s = this.spec;
    if (!f || !s) return;
    this.field = null;
    this.spec = null;
    const text = f.value;
    f.remove();
    s.done();
    if (commit && text !== s.text) s.commit(text);
  }
}
