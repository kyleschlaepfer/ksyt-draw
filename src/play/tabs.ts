/**
 * Accessible tabs: real tab semantics, arrow keys, roving focus, hidden panels.
 * The active tab is told by shape and an underline as well as color.
 */
export interface TabSpec { id: string; label: string; panel: HTMLElement }

export interface TabSet {
  root: HTMLElement;
  list: HTMLElement;
  select(id: string, focus?: boolean): void;
  current(): string;
}

export function makeTabs(ids: TabSpec[], o: { label: string; cls: string; onChange?: (id: string) => void }): TabSet {
  const root = document.createElement("div");
  root.className = o.cls;
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", o.label);
  list.className = `${o.cls}-list`;
  const buttons = new Map<string, HTMLButtonElement>();
  let active = ids[0].id;
  for (const t of ids) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.id = `tab-${t.id}`;
    b.setAttribute("aria-controls", t.panel.id);
    b.textContent = t.label;
    b.className = `${o.cls}-tab`;
    t.panel.setAttribute("role", "tabpanel");
    t.panel.setAttribute("aria-labelledby", b.id);
    t.panel.tabIndex = 0;
    b.addEventListener("click", () => select(t.id, false));
    buttons.set(t.id, b);
    list.appendChild(b);
  }
  list.addEventListener("keydown", (ev) => {
    const order = ids.map((t) => t.id);
    const i = order.indexOf(active);
    let next: string | null = null;
    if (ev.key === "ArrowRight") next = order[(i + 1) % order.length];
    else if (ev.key === "ArrowLeft") next = order[(i - 1 + order.length) % order.length];
    else if (ev.key === "Home") next = order[0];
    else if (ev.key === "End") next = order[order.length - 1];
    if (next) { ev.preventDefault(); select(next, true); }
  });
  function select(id: string, focus = false): void {
    if (!buttons.has(id)) return;
    const changed = id !== active;
    active = id;
    for (const t of ids) {
      const on = t.id === id;
      const b = buttons.get(t.id)!;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
    }
    if (focus) buttons.get(id)!.focus();
    if (changed) o.onChange?.(id);
  }
  root.appendChild(list);
  for (const t of ids) root.appendChild(t.panel);
  select(active);
  return { root, list, select, current: () => active };
}
