/** What the views share: the open document, a status line, and small DOM helpers. */
import type { Session } from "../core/doc/session";
import type { Workspace } from "../core/doc/project";
import type { Measurer } from "../core/measure";
import type { FontStatus } from "../embed/measure-dom";

export type Tab = "write" | "draw" | "syntax";

export interface App {
  session: Session;
  measurer: Measurer;
  fonts: FontStatus;
  /** viewport and export settings: saved with the project and the local draft, not part of the diagram */
  workspace: Workspace;
  showTab(tab: Tab): void;
  currentTab(): Tab;
  /** replace the open diagram (undoable) */
  open(text: string, label: string): void;
  /** tell the views the workspace changed (so it gets saved) */
  touchWorkspace(): void;
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const button = (cls: string, text: string, title?: string): HTMLButtonElement => {
  const b = el("button", cls, text);
  b.type = "button";
  if (title) b.title = title;
  return b;
};

export const TYPE_NAME: Record<string, string> = { flowchart: "Flowchart", activity: "Activity diagram", "use-case": "Use-case diagram", class: "Class diagram" };

export async function copyText(text: string, what: string, say: (msg: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(`copied the ${what}`);
  } catch {
    say(`couldn't copy the ${what}; select it in the page instead`);
    window.prompt(`copy the ${what}`, text);
  }
}

/** A list of choices that opens under a button: arrow keys move, Escape closes, focus returns to the button. */
export function menuButton(trigger: HTMLButtonElement, items: () => Array<{ label: string; hint?: string; run(): void; disabled?: boolean }>): HTMLElement {
  const wrap = el("span", "menu");
  const list = el("div", "menu-list");
  list.setAttribute("role", "menu");
  list.hidden = true;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  const close = (focus = true): void => {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (focus) trigger.focus();
  };
  const outside = (ev: Event): void => { if (!wrap.contains(ev.target as Node)) close(false); };
  const open = (): void => {
    list.replaceChildren();
    for (const it of items()) {
      const b = button("menu-item", it.label);
      b.setAttribute("role", "menuitem");
      if (it.hint) b.appendChild(el("span", "menu-hint", it.hint));
      b.disabled = !!it.disabled;
      b.addEventListener("click", () => { close(); it.run(); });
      list.appendChild(b);
    }
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    (list.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus();
  };
  trigger.addEventListener("click", () => (list.hidden ? open() : close()));
  wrap.addEventListener("keydown", (ev) => {
    if (list.hidden) return;
    const btns = Array.from(list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (ev.key === "Home") { ev.preventDefault(); btns[0]?.focus(); }
    else if (ev.key === "End") { ev.preventDefault(); btns[btns.length - 1]?.focus(); }
    else if (ev.key === "Tab") close(false);
  });
  wrap.append(trigger, list);
  return wrap;
}
