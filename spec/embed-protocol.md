# Embed protocol (v1)

How a page puts a diagram on screen and talks to it. Two sides: the **embed** (`https://chalk.kyleschlaepfer.com/embed/`) and the **host** (any page with the iframe; on kyleschlaepfer.com that is `site/DiagramEmbed.astro` and `site/draw-host.ts`).

The protocol did not change in Chalk v2. The version is still `v=1`, the messages are the same, and every v1 link and iframe keeps working. v2 adds one optional hash parameter, `look`. The diagram text in `d` may now use the v2 format (`spec/diagram-text.md`), which is a superset of v1.

## 1. The URL

```
https://chalk.kyleschlaepfer.com/embed/#v=1&d=<lz>&id=<instance>&step=0&theme=auto&lint=0&qa=0&tools=1&look=sketch
```

Everything is in the hash, which is never sent to the server. `parseHash()` and `buildHash()` in `src/core/state.ts` read and write it.

| Param | Values | Default | Meaning |
|---|---|---|---|
| `v` | `1` | required | protocol version. Unknown version: error card |
| `d` | `LZString.compressToEncodedURIComponent(ksdText)` | required | the diagram text |
| `id` | slug | `""` | echoed in every message so a page with several embeds can tell them apart |
| `step` | integer or `all` | `0` | first visible build-up step |
| `theme` | `auto`, `light`, `dark` | `auto` | `auto` follows `prefers-color-scheme` until the host sends `theme` |
| `lint` | `0`, `1` | `0` | show the notation findings panel |
| `qa` | `0`, `1` | `0` | add layout check findings to the panel (implies `lint=1`) |
| `tools` | `0`, `1` | `1` | footer: "open in playground" link and "download SVG" |
| `look` | `sketch`, `precision` | not set | which look to draw in. Not set, or any other value: the diagram's own `look` line decides, and without one it is `sketch` |

- **Build and read the hash only with `URLSearchParams`.** lz-string's URI alphabet includes `+` and `$`; `URLSearchParams` encodes them on the way out (`%2B`, `%24`) and decodes them on the way in. Hand-built strings break: a raw `+` reads back as a space. `test/state.test.ts` round-trips a diagram whose compressed form contains `+`.
- `buildHash()` writes `v` and `d`, then only the values that differ from the defaults.
- `hashchange` re-renders.
- Size: lz-string keeps a typical 20-line diagram under 1 KB of URL. Above about 8 KB, hosts should use the `load` message instead.

Error cards, in place of the figure:

| When | Card |
|---|---|
| `v` is missing or not `1` | "This link uses an embed version this page doesn't know." |
| `d` is missing or cannot be decoded | "This link doesn't contain a diagram." |
| the text has a mistake | "This diagram has a mistake in its text." with the first error and its line |

The embed has no last good version to fall back on, so it shows the first error. The tool page keeps the last figure that worked.

## 2. Messages

Every message is a plain object. Embed to host:

```ts
{ source: "ksyt-draw", v: 1, id: string, type: "ready",  steps: number, step: number, title: string }
{ source: "ksyt-draw", v: 1, id: string, type: "resize", height: number }          // CSS px of the whole embed document
{ source: "ksyt-draw", v: 1, id: string, type: "step",   step: number, steps: number }
{ source: "ksyt-draw", v: 1, id: string, type: "lint",   status: string, counts: { critical: number, major: number, minor: number, suggestion: number } }
{ source: "ksyt-draw", v: 1, id: string, type: "error",  message: string, line: number | null }
```

- `steps` is the highest step number (0 when there are no steps). `status` is the notation check's status (`pass`, `pass-with-notes`, `changes-required`, `blocked`). In v2 it counts the v2 rules too (`spec/lint.md`).
- Sent with `window.parent.postMessage(msg, "*")`: nothing in them is private, and the embed may be framed anywhere. Not sent when the page is not framed (`window.parent === window`).
- `resize` fires after first render, after every step change or panel toggle, and from a `ResizeObserver` on `document.documentElement` (one per animation frame, only when the height changed by 1 px or more).

Host to embed:

```ts
{ source: "ksyt-draw-host", v: 1, type: "theme", theme: "light" | "dark" }
{ source: "ksyt-draw-host", v: 1, type: "step",  step: number | "all" }
{ source: "ksyt-draw-host", v: 1, type: "load",  ksd: string }                     // replaces the hash's diagram
```

The embed ignores any message where `event.source !== window.parent`, where `source`, `v` or `type` do not match, or where a field has the wrong type. `load` text goes through exactly the same parse, escape and render path as hash text.

There is no message that sets the look. A host that wants another look changes the hash, which re-renders.

## 3. Host rules

```html
<iframe
  class="ksyt-draw-frame"
  src="https://chalk.kyleschlaepfer.com/embed/#v=1&d=...&id=permit-portal"
  title="Use-case diagram: residents apply and track; paying the fee is always part of applying"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
  style="width:100%;height:360px;border:0;display:block"></iframe>
```

- Accept a message only when `event.origin === "https://chalk.kyleschlaepfer.com"` and `event.source` is the `contentWindow` of one of your `.ksyt-draw-frame` iframes; match on `event.source`, not just `id`.
- On `resize`: set that iframe's `style.height` to `height + "px"`.
- On `ready`: send the current theme. On kyleschlaepfer.com the theme is `<html data-theme="light|dark">` or, without the attribute, `prefers-color-scheme`. Watch both (a `MutationObserver` on the attribute, a `matchMedia` listener) and send `theme` to every embed when they change.
- Give the iframe a real `title` (screen readers announce it) and keep a visible caption outside it: the claim, one sentence.
- An LMS or plain HTML page can paste the iframe alone; it works without any host script (fixed height, follows the system theme).

The site component `site/DiagramEmbed.astro` takes `ksd`, `caption`, `title`, `height`, `lint`, `step` and `origin`. It has no `look` prop yet, so on the site the look comes from the diagram's own `look` line.

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

- Background `var(--page)` for the theme in force, so there is never a white flash in dark mode; `color-scheme` is set to match.
- No margin around the document; 8 px inner padding. Styles come from a copy of `ksyt.css` (buttons `.btn` and `.btn-quiet`, `.note`, `figure.fig`, `.ksyt-fig` role fills, theme tokens and `[data-theme]` handling).
- Lint panel rows: `severity · rule_id · location`, then the problem and the smallest fix in Atkinson Hyperlegible Next. Severity is spelled out, never color alone.
- A right-running flow turns top-down when the frame is too narrow for its labels, and back when it widens.
- A figure that would still shrink its text too far keeps a minimum width and scrolls sideways, with a note that says so.
- "open in playground" opens `https://chalk.kyleschlaepfer.com/#v=1&d=<same>` in a new tab.
- "download SVG" saves `<diagram id>.svg`: a self-contained file in the look and theme on screen, on the page color, with its fonts inside. It is written by the export pipeline (`src/embed/download.ts`, `src/export/svg.ts`). It is not the page's SVG with a stylesheet, as it was in v1.

## 5. The tool page (`/`)

Still called "playground" in the embed's footer link. Its name on the page is Chalk.

- Three views in one row: write, draw, the syntax. A document bar beside them: new, open, save, export.
- **write:** the editor and the live figure, using the same core as the embed (no iframe). The figure is redrawn 150 ms after the last keystroke. Under it: the notation check with the layout check always on. Buttons: `copy embed code` (the iframe snippet above with the current `d`, the diagram's id and its title), `copy link` (the tool page's URL), `copy for the site` (the import line and the `<DiagramEmbed ...>` line), `download SVG`.
- **draw:** the same diagram on a canvas. Every change is written back into the text.
- **the syntax:** the reference, `src/play/docs.html`.
- The page starts with the hash's `d`, else the local draft, else the permit-portal example.
- The hash carries `d` and, when the view is not write, `tab=draw` or `tab=syntax`. It is rewritten with `history.replaceState` after each change, so the URL can be shared. Once the compressed text is over 8,000 characters the link stops carrying the diagram; the local draft and a saved file still hold it.
- Neither `copy embed code` nor `copy link` adds `look`. A diagram that should always be drawn in the precision look says so in its own text, with a `look precision` line.

How to use the tool page is in `docs/GUIDE.md`.
