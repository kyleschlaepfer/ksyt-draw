/**
 * Host side of the KSyt Draw embed protocol (spec/embed-protocol.md). Copy to src/scripts/draw-host.ts
 * in the site repo; DiagramEmbed.astro imports it, and Astro includes it once per page.
 *
 * - resize: sets each iframe's height to what its embed reports (no inner scrollbar)
 * - theme: tells every embed the page's theme on `ready` and whenever it changes
 *   (<html data-theme="light|dark">, or prefers-color-scheme when the attribute is absent)
 *
 * A message is trusted only if it comes from one of this page's .ksyt-draw-frame iframes AND from
 * that iframe's own origin. No origin is hard-coded, so a dev embed on localhost works the same way.
 */
type Theme = "light" | "dark";

const SELECTOR = "iframe.ksyt-draw-frame";

function frames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(SELECTOR));
}

function originOf(frame: HTMLIFrameElement): string | null {
  try {
    return new URL(frame.src, location.href).origin;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function send(frame: HTMLIFrameElement, msg: Record<string, unknown>): void {
  const origin = originOf(frame);
  if (!origin || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ source: "ksyt-draw-host", v: 1, ...msg }, origin);
}

function syncTheme(): void {
  const theme = currentTheme();
  for (const f of frames()) send(f, { type: "theme", theme });
}

declare global {
  interface Window {
    __ksytDrawHost?: boolean;
  }
}

if (!window.__ksytDrawHost) {
  window.__ksytDrawHost = true;

  window.addEventListener("message", (event: MessageEvent) => {
    const frame = frames().find((f) => f.contentWindow === event.source);
    if (!frame || event.origin !== originOf(frame)) return;
    const m = event.data as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || m.source !== "ksyt-draw" || m.v !== 1) return;

    if (m.type === "resize" && typeof m.height === "number" && m.height > 0 && m.height < 10000) {
      frame.style.height = `${Math.ceil(m.height)}px`;
    } else if (m.type === "ready") {
      send(frame, { type: "theme", theme: currentTheme() });
    } else if (m.type === "error" && typeof m.message === "string") {
      frame.dataset.drawError = m.message; // visible in devtools; the embed shows the error itself
    }
  });

  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
}

export {};
