/** Small SVG and DOM helpers for the draw view. Nothing from the diagram is ever set as HTML. */
const NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * Turn SVG markup from the core writer (which escapes every string) into elements. The markup is
 * parsed as an SVG document, never as HTML, so nothing in it can run.
 */
export function parseSvg(markup: string[]): SVGElement[] {
  if (!markup.length) return [];
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup.join("")}</svg>`, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new Error("the drawing did not render");
  return Array.from(root.children).map((c) => document.importNode(c, true) as unknown as SVGElement);
}

/**
 * Keep a layer's children equal to a keyed list of markup, touching only what changed: an element
 * whose markup is the same as last time is left alone (it keeps its place, its listeners' targets and
 * any transform), so a drag repaints the few shapes that moved and nothing else.
 */
export class KeyedLayer {
  private items = new Map<string, { markup: string; el: SVGElement }>();
  private order: string[] = [];
  constructor(public g: SVGGElement) {}

  update(list: Array<[key: string, markup: string]>, decorate?: (el: SVGElement, key: string) => void): void {
    const seen = new Set<string>();
    const fresh: Array<[string, string]> = [];
    for (const [key, markup] of list) {
      seen.add(key);
      const have = this.items.get(key);
      if (!have || have.markup !== markup) fresh.push([key, markup]);
    }
    const made = parseSvg(fresh.map(([, m]) => m));
    fresh.forEach(([key, markup], i) => {
      const el = made[i];
      decorate?.(el, key);
      const have = this.items.get(key);
      if (have) have.el.replaceWith(el);
      this.items.set(key, { markup, el });
    });
    for (const [key, it] of [...this.items]) {
      if (!seen.has(key)) { it.el.remove(); this.items.delete(key); }
    }
    const order = list.map(([k]) => k);
    if (order.length !== this.order.length || order.some((k, i) => k !== this.order[i])) {
      for (const k of order) this.g.appendChild(this.items.get(k)!.el);
      this.order = order;
    }
  }

  get(key: string): SVGElement | undefined { return this.items.get(key)?.el; }
  clear(): void { this.g.replaceChildren(); this.items.clear(); this.order = []; }
}
