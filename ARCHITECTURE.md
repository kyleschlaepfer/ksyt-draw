# KSyt Draw: architecture (v1 = embeddable diagrams)

2026-11-04. The diagram tool for kyleschlaepfer.com, starting with the part that can ship now: **text in, diagram out, embedded in any page.** The full drag-and-drop editor comes later and is built on the same core, so nothing here is throwaway.

## 1. What v1 is

A lesson page on kyleschlaepfer.com (or any page, like a professor's LMS) shows a live diagram: a use-case, activity or flowchart diagram, drawn in the same style as the videos, built from a few lines of text, optionally stepping through like a phased slide, with an optional panel that checks the notation using the same rules as `diagram-semantics-reviewer`.

```
diagram use-case
title Residents apply and track; paying the fee is always part of applying
actor resident "Resident"
boundary portal "Permit portal" {
  use-case apply "apply for permit"
  use-case pay "pay fee"
}
resident -- apply
apply -include-> pay
```

| In v1 | Later (same core) |
|---|---|
| `/embed/`: read-only diagram from text, build-up steps, lint panel, theme sync | `/` becomes the full editor: drag, resize, swimlanes, free text |
| `/`: a playground (text left, live preview right, lint, "copy embed code") | Structured Markdown export of diagrams and use-case descriptions |
| Families: flowchart, activity, use-case | Sequence, state, class, ERD (the reviewer already has their rules) |
| Download SVG | PNG/JPEG export at fit or 100% |
| No backend, no accounts | Worker + D1/R2 if saving across devices is ever needed |

**Not in v1:** freehand drawing (there is none, ever: shapes are predefined and the pen engine only renders them), editing by dragging, saving to an account.

## 2. System shape

```
kyleschlaepfer.com  (site repo, private, Astro)            draw.kyleschlaepfer.com  (this repo)
┌──────────────────────────────────────────────┐           ┌─────────────────────────────────────────┐
│ lessons/permits.mdx                          │           │ /embed/   index.html + embed.ts          │
│   <DiagramEmbed src="permit.ksd" caption=…/> │  iframe   │   reads #d=<compressed .ksd>             │
│ ┌──────────────────────────────────────────┐ │ ────────▶ │   parse → lint → layout → render → SVG   │
│ │ <iframe src="…/embed/#v=1&d=…&id=…">     │ │           │                                          │
│ └──────────────────────────────────────────┘ │ ◀──────── │   postMessage: ready, resize, step, lint │
│ figcaption + optional text alternative       │ ────────▶ │   postMessage: theme, step, load         │
│ small host script: resize + theme sync       │           │ /         playground (same core, no iframe)│
└──────────────────────────────────────────────┘           │ /assets/  JS, CSS, Kalam + Atkinson fonts │
                                                           └─────────────────────────────────────────┘
                                                             Cloudflare Workers, static assets only
```

Everything happens in the reader's browser. The diagram text travels in the URL **hash**, which browsers never send to the server, so there's no backend, no database, nothing logged, and every diagram is a shareable link.

## 3. Why these choices

| Decision | Why | Cost |
|---|---|---|
| Separate subdomain and repo | The site repo is private; this may go open source, and its AutEk vs. channel filing is open. Separate deploys, separate stack, isolated failures. | Styles shared by copying `ksyt.css` (enforced by a test later); no shared browser storage (nothing needs it). |
| iframe embed, not a script that injects into the page | Complete CSS/JS isolation both ways; works in an LMS that allows iframes; one origin to secure. | Height must be messaged (`resize`); theme must be messaged (`theme`). |
| Text format (`.ksd`), not JSON | Kyle writes it in a lesson file in seconds; reads like the diagram. | A parser to maintain (small; reference parser and fixtures provided). |
| Internal model = the reviewer's contract 1.0 | The linter is a port of `review_diagrams.py`'s `Review` class, checked against its real output. The future editor exports the same model. | None: it's already the house format. |
| Pen engine ported to TypeScript, bit-compatible | Same strokes as the slides: an element named `pay` wobbles identically in a video and on the site. Already ported and verified (45 tests). | Port must be kept in step with `pen.py`. |
| dagre for flow layout, a custom layout for use cases | Flows are layered graphs (dagre's job). Use-case diagrams aren't: actors outside, use cases inside a boundary, include/extend to the side. | Use-case layout is ~150 lines of our own code. |
| Vanilla TypeScript + Vite, no UI framework | The embed is one SVG and four buttons. Small bundle, fast first paint inside someone else's page. | The future editor may want a framework; it can add one in its own entry. |
| Cloudflare Workers static assets, no Worker script | Cloudflare's recommended path for new projects; static requests are free; `_headers` sets CSP and framing. | Wrangler config instead of Pages' dashboard flow. |

## 4. Repo layout (draw.kyleschlaepfer.com)

```
ksyt-draw/
├── CLAUDE.md                 rules for every Claude session in this repo
├── ARCHITECTURE.md           this file
├── spec/                     diagram-text.md, rendering.md, embed-protocol.md, lint.md
├── reference/                read-only Python sources the port follows (pen.py, figure.py, diagrams.py,
│                             review_diagrams.py, ksd_parse.py) + ksyt.css + diagrams-web.md
├── fixtures/                 golden outputs from the Python code (generate.py regenerates them)
├── src/
│   ├── core/                 pure TypeScript, no DOM: runs in Node tests and in the browser
│   │   ├── pyrandom.ts       DONE: CPython-compatible random + seed_for
│   │   ├── pen.ts            DONE: pen.py port
│   │   ├── model.ts          Diagram/Node/Edge types (contract 1.0 + web fields)
│   │   ├── parse.ts          .ksd → Diagram (matches reference/ksd_parse.py)
│   │   ├── lint.ts           port of review_diagrams.Review (matches fixtures/*.lint.json)
│   │   ├── measure.ts        Measurer interface (browser: canvas; tests: fixed-width stub)
│   │   ├── shapes.ts         one function per node kind and edge kind → Sketch + labels
│   │   ├── layout-flow.ts    dagre layout for flowchart/activity
│   │   ├── layout-usecase.ts actors / boundary / use cases
│   │   ├── scene.ts          Diagram + layout → Scene (elements, texts, steps, frame)
│   │   ├── svg.ts            Scene → SVG string (port of figure.Figure.svg; escapes all text)
│   │   ├── qa.ts             label collision check (port of figure.Figure.check, canvas raster)
│   │   ├── describe.ts       text alternative from the model
│   │   └── state.ts          hash ⇄ {ksd, step, theme, lint, qa, id}
│   ├── embed/                main.ts, embed.css (entry for embed/index.html)
│   └── play/                 main.ts, play.css (entry for index.html)
├── public/_headers           CSP, framing, caching (copied into dist/)
├── index.html                playground page → /
├── embed/index.html          embed page → /embed/
├── test/                     vitest (core) + playwright (embed, playground)
├── site/                     DiagramEmbed.astro + draw-host.ts to copy into the site repo
├── package.json, tsconfig.json, vite.config.ts   DONE: verified to typecheck, test and build
└── wrangler.jsonc            DONE: assets-only Worker, custom domain (passes wrangler deploy --dry-run)
```

## 5. Data flow inside the embed

1. `state.ts` reads the hash: `v=1&d=<lz-string>&id=&step=&theme=&lint=&qa=`.
2. `parse.ts` turns the text into a `Diagram` (contract 1.0 shape). A parse error renders a readable error card (line number and message) and posts `error`.
3. `lint.ts` reviews it (same rule IDs, severities and confidence as the Python reviewer).
4. Fonts load (`document.fonts.load` for Kalam 300 and 400) **before** measuring. Never measure with a fallback font.
5. `layout-*.ts` places nodes (inches), `shapes.ts` draws each node and edge as named `Sketch`es seeded from `<diagram_id>:<element id>`, plus labels.
6. `scene.ts` frames the ink tightly (0.2 in margin), tags every element and label with its build-up step.
7. `svg.ts` emits the SVG (role classes, never hex); `embed/main.ts` mounts it, adds step controls if the diagram has steps, the "describe this figure" details, the lint panel if `lint=1`, and posts `ready` and `resize`.

The playground runs steps 2 to 7 directly on every keystroke (debounced), without an iframe.

## 6. Hosting and deploy

- **Cloudflare Workers with static assets, no Worker script.** `wrangler.jsonc`:
  ```jsonc
  {
    "name": "ksyt-draw",
    "compatibility_date": "2026-11-01",
    "assets": { "directory": "./dist", "not_found_handling": "404-page" },
    "routes": [{ "pattern": "draw.kyleschlaepfer.com", "custom_domain": true }]
  }
  ```
  A custom domain creates the DNS record and certificate. Don't hand-create a `draw` CNAME first, or attaching it fails.
- **Headers** in `public/_headers` (Vite copies it to `dist/`; it applies to static responses): a strict CSP everywhere, `frame-ancestors 'none'` on the playground, `frame-ancestors *` and `connect-src 'none'` on `/embed/*`, and long caching for hashed `/assets/*`. When several rules match, Cloudflare combines them, so the `/embed/*` rule removes the general CSP (`! Content-Security-Policy`) before setting its own. Check the real headers with `curl -sI` after the first deploy.
- **Fonts** come from the `@fontsource` packages (imported in each page's entry), so Vite fingerprints them into `/assets/` and the CSP's `font-src 'self'` covers them. Nothing is loaded from a third-party CDN.
- **CI:** connect the repo to Workers Builds (build `npm ci && npm run build`, deploy `npx wrangler deploy`), or deploy from a laptop with `npx wrangler deploy`. Run `npm test` before either.
- **Preview:** `npx wrangler versions upload` gives a preview URL without touching production.

## 7. Security model

The hash is attacker-controllable (anyone can craft a link), so:

- **All text from the diagram is escaped** when it becomes SVG or HTML (`svg.ts` escapes `& < > " '`; DOM code uses `textContent`). No `innerHTML` with diagram content, ever. A test feeds `<script>`, `"><img onerror>` and `]]>` through every label path.
- **Strict CSP** (above): no inline script, no `eval`, no network calls from the embed (`connect-src 'none'`).
- **No state-changing actions in the embed**, so framing it anywhere carries no clickjacking risk worth blocking. The playground (which will grow into the editor) refuses framing.
- **postMessage:** the embed posts only non-sensitive data (`ready`, `resize`, `step`, `lint`) with target `*`; it accepts `theme`, `step` and `load` from its parent only (`event.source === window.parent`), validates their shape, and treats `load` text exactly like hash text. The host accepts messages only when `event.origin === "https://draw.kyleschlaepfer.com"` and `event.source` is one of its own iframes.
- **iframe attributes on the host:** `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"` (same-origin is needed so the embed loads its own fonts and its messages carry a real origin; it's safe because the frame is cross-origin), `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`.

## 8. How it connects to the rest of the system

| Piece | Relationship |
|---|---|
| `whiteboard-lecture-slides` | Source of `pen.py` and the UML primitives in `diagrams.py`. The port follows them; fixtures prove it. When `pen.py` changes: copy into `reference/`, rerun `fixtures/generate.py`, fix `pen.ts` until tests pass. |
| `diagram-semantics-reviewer` | Source of the rules. `lint.ts` is a port of `Review`; fixtures come from the real script. New rules land there first, then here. |
| `ksyt-web-design` | Source of tokens, `ksyt.css`, button and figure styles, the "describe this figure" pattern, and the house rules (no em dashes, never say "hand-drawn" about the videos or art, Kalam + Atkinson only). The embed copies `ksyt.css` rather than inventing styles. |
| Video workflow | A lesson that needs a diagram gets a `.ksd` file next to its lesson file; `DiagramEmbed` points at it. |

## 9. Decisions for Kyle (defaults chosen so work can start)

| # | Decision | Default in this plan | Alternative |
|---|---|---|---|
| D1 | Repo name and visibility | `ksyt-draw`, private until the editor is worth sharing | Public now, as the channel's open-source tool |
| D2 | Who may embed `/embed/` | Anyone (`frame-ancestors *`): professors can drop it into Canvas or a course site | Allowlist: `https://kyleschlaepfer.com https://*.kyleschlaepfer.com` |
| D3 | Subdomain | `draw.kyleschlaepfer.com` | `tools.` with `/draw/` under it |
| D4 | Build-up start state | Step 1 of N, like `ksyt.js` figures (reader clicks through) | Final state first, "replay" button |

## 10. Roadmap after v1

1. Editor at `/`: drag and resize existing nodes (layout overrides written back as `at X Y` lines, so text stays the source of truth), then free text and swimlanes.
2. Structured Markdown export (use-case descriptions, activity steps) from the same model.
3. More families: sequence, state, class, ERD; their rules already exist in `reference/review_diagrams.py`.
4. PNG export; then, only if needed, saved diagrams (Worker + D1).
