# Embed protocol (v1)

How a page puts a diagram on screen and talks to it. Two sides: the **embed** (`https://draw.kyleschlaepfer.com/embed/`) and the **host** (any page with the iframe; on kyleschlaepfer.com that's `site/DiagramEmbed.astro` + `site/draw-host.ts`).

## 1. The URL

```
https://draw.kyleschlaepfer.com/embed/#v=1&d=<lz>&id=<instance>&step=0&theme=auto&lint=0&qa=0&tools=1
```

Everything is in the **hash** (never sent to the server). Parse it with `new URLSearchParams(location.hash.slice(1))`.

| Param | Values | Default | Meaning |
|---|---|---|---|
| `v` | `1` | required | protocol version. Unknown version: error card |
| `d` | `LZString.compressToEncodedURIComponent(ksdText)` | required | the diagram text |
| `id` | slug | `""` | echoed in every message so a page with several embeds can tell them apart |
| `step` | integer or `all` | `0` | first visible build-up step |
| `theme` | `auto`, `light`, `dark` | `auto` | `auto` follows `prefers-color-scheme` until the host sends `theme` |
| `lint` | `0`, `1` | `0` | show the notation findings panel |
| `qa` | `0`, `1` | `0` | add layout QA findings to the panel (implies `lint=1`) |
| `tools` | `0`, `1` | `1` | footer: "open in playground" link + "download SVG" |

- **Build and read the hash only with `URLSearchParams`.** lz-string's URI alphabet includes `+` and `$`; `URLSearchParams` encodes them on the way out (`%2B`, `%24`) and decodes them on the way in. Hand-built strings break: a raw `+` reads back as a space. `test/state.test.ts` must round-trip a diagram whose compressed form contains `+`.
- `hashchange` re-renders. A missing or undecodable `d` shows a plain error card: "This link doesn't contain a diagram."
- Size: lz-string keeps a typical 20-line diagram under 1 KB of URL. Above about 8 KB, hosts should use the `load` message instead.

## 2. Messages

Every message is a plain object. Embed → host:

```ts
{ source: "ksyt-draw", v: 1, id: string, type: "ready",  steps: number, step: number, title: string }
{ source: "ksyt-draw", v: 1, id: string, type: "resize", height: number }          // CSS px of the whole embed document
{ source: "ksyt-draw", v: 1, id: string, type: "step",   step: number, steps: number }
{ source: "ksyt-draw", v: 1, id: string, type: "lint",   status: string, counts: { critical: number, major: number, minor: number, suggestion: number } }
{ source: "ksyt-draw", v: 1, id: string, type: "error",  message: string, line: number | null }
```

- `steps` is the highest step number (0 when there are no steps). `status` is the reviewer's status (`pass`, `pass-with-notes`, `changes-required`, `blocked`).
- Sent with `window.parent.postMessage(msg, "*")`: nothing in them is private, and the embed may be framed anywhere. Not sent when the page isn't framed (`window.parent === window`).
- `resize` fires after first render, after every step change or panel toggle, and from a `ResizeObserver` on `document.documentElement` (debounced to one per animation frame, only when the height changed by ≥ 1 px).

Host → embed:

```ts
{ source: "ksyt-draw-host", v: 1, type: "theme", theme: "light" | "dark" }
{ source: "ksyt-draw-host", v: 1, type: "step",  step: number | "all" }
{ source: "ksyt-draw-host", v: 1, type: "load",  ksd: string }                     // replaces the hash's diagram
```

The embed ignores any message where `event.source !== window.parent`, `source`/`v`/`type` don't match, or fields have the wrong type. `load` text goes through exactly the same parse, escape and render path as hash text.

## 3. Host rules

```html
<iframe
  class="ksyt-draw-frame"
  src="https://draw.kyleschlaepfer.com/embed/#v=1&d=...&id=permit-portal"
  title="Use-case diagram: residents apply and track; paying the fee is always part of applying"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
  style="width:100%;height:360px;border:0;display:block"></iframe>
```

- Accept a message only when `event.origin === "https://draw.kyleschlaepfer.com"` and `event.source` is the `contentWindow` of one of your `.ksyt-draw-frame` iframes; match on `event.source`, not just `id`.
- On `resize`: set that iframe's `style.height` to `height + "px"`.
- On `ready`: send the current theme. On kyleschlaepfer.com the theme is `<html data-theme="light|dark">` or, without the attribute, `prefers-color-scheme`. Watch both (a `MutationObserver` on the attribute, a `matchMedia` listener) and send `theme` to every embed when they change.
- Give the iframe a real `title` (screen readers announce it) and keep a visible caption outside it: the claim, one sentence.
- An LMS or plain HTML page can paste the iframe alone; it works without any host script (fixed height, follows the system theme).

## 4. What the embed page looks like

```
┌───────────────────────────────────────────────┐
│  [ diagram SVG, centered, max 100% wide ]      │
│                                                │
│  back · step 2 of 3 · next step · show all     │  only when steps > 0
│  ▸ describe this figure                        │  always
│  ┌ notation check: pass with notes ─────────┐  │  lint=1
│  │ minor · UC-ASSOC-DIRECTED · member→borrow │  │
│  └──────────────────────────────────────────┘  │
│  open in playground · download SVG             │  tools=1, graphite, small
└───────────────────────────────────────────────┘
```

- Background `var(--page)` for the theme in force (so there's never a white flash in dark mode); set `color-scheme` to match.
- No margin around the document; 8 px inner padding. Styles come from a copy of `ksyt.css` (buttons `.btn` / `.btn-quiet`, `.note`, `figure.fig`, `.ksyt-fig` role fills, theme tokens and `[data-theme]` handling).
- Lint panel rows: `severity · rule_id · location`, then the problem and the minimal fix in Atkinson Hyperlegible Next. Severity is spelled out (never color alone).
- "open in playground" opens `https://draw.kyleschlaepfer.com/#d=<same>` in a new tab.

## 5. Playground (`/`)

- Two panes (stacked under 48 rem): a textarea (Atkinson Hyperlegible Mono, line numbers optional) and the live preview using the same core (no iframe). Debounce 150 ms.
- Below the preview: the lint panel with QA always on, and parse errors with their line.
- Buttons: `copy link` (playground URL), `copy embed code` (the iframe snippet above with the current `d` and the diagram's title), `copy for the site` (the `<DiagramEmbed ...>` line), `download SVG`.
- The textarea starts with the hash's `d`, else the permit-portal example.
- State lives in the hash (`history.replaceState` on edit), so the URL is always shareable.
