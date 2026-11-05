# Chalk (ksyt-draw)

Chalk is the diagram tool for kyleschlaepfer.com. Write a few lines of text and get a use-case, activity, class or flow diagram, drawn in the same style as the videos or in a crisp look for formal documents. The repo, the deploy and the message protocol keep the name `ksyt-draw`.

- **Write.** The diagram is text (`.ksd`). The figure follows as you type, with completions and a notation check.
- **Draw.** The same diagram on a canvas. Place, connect, move, resize and restyle; every change is written back into the text.
- **Export.** PNG, SVG and PDF, made for slides and reports.
- **Embed.** A read-only figure in an iframe on any page.

Everything runs in the browser. There is no server side and no account. Shapes are predefined; nobody draws freehand.

## Start it

Needs Node and npm.

```
npm install
npm run dev
```

Vite prints the address, `http://localhost:5173` unless that port is taken. The tool is at `/` and the embed page at `/embed/`.

To check the code:

```
npm test
```

For the browser tests, install Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`. It builds the app first and tests the build under the production headers. Screenshots and traces land in `test-results/`. Where the Playwright download is blocked, set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | unit tests (vitest, Node only): ports, parser, sync, session, layout, router, render, checks |
| `npm run test:e2e` | browser tests (Playwright, Chromium) against the production build |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run preview` | serve `dist/` locally with the headers from `public/_headers` |
| `npm run fixtures` | regenerate `fixtures/` from `reference/*.py` (needs `python3`) |
| `npm run deploy` | unit tests, build, `wrangler deploy` (needs `npx wrangler login` once; Kyle runs this) |

## Where the docs are

| File | What it is |
|---|---|
| [`docs/GUIDE.md`](docs/GUIDE.md) | the user guide: write, draw, export, embed, keyboard |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | the working map of the code: pipeline, modules, tests, hosting, security |
| [`CLAUDE.md`](CLAUDE.md) | standing rules for work in this repo, and what "done" means |
| [`spec/diagram-text.md`](spec/diagram-text.md) | the `.ksd` text format |
| [`spec/rendering.md`](spec/rendering.md) | layout, routing, the two looks, the layout check |
| [`spec/lint.md`](spec/lint.md) | the notation check |
| [`spec/embed-protocol.md`](spec/embed-protocol.md) | the embed URL and messages |
| `src/play/docs.html` | the syntax reference shown in the app under write, "the syntax" |
| [`docs/revamp/ARCHITECTURE_DECISIONS.md`](docs/revamp/ARCHITECTURE_DECISIONS.md) | why v2 is built the way it is, decision by decision |
| [`docs/revamp/UX_DESIGN_SYSTEM.md`](docs/revamp/UX_DESIGN_SYSTEM.md) | how the tool looks and behaves |
| [`docs/revamp/UI_PRESERVATION_CONTRACT.md`](docs/revamp/UI_PRESERVATION_CONTRACT.md) | what had to stay the same from v1 |
| [`docs/revamp/BASELINE_AUDIT.md`](docs/revamp/BASELINE_AUDIT.md) | v1 as it was before the revival |
| [`docs/revamp/EXPORT_QUALITY_AUDIT.md`](docs/revamp/EXPORT_QUALITY_AUDIT.md) | a review of the exported files, with the gallery in `docs/revamp/gallery/` |
| `CONTINUE.MD` | the handoff note at the last checkpoint |
| `BUILD_BRIEF.md` | the v1 build brief, kept for its deploy steps |

## Where the code is

| Folder | What it holds |
|---|---|
| `src/core/` | everything without a DOM: the document, the parser, layout, routing, the two looks, the checks |
| `src/export/` | SVG, PNG and PDF writers |
| `src/embed/` | the embed page |
| `src/play/` | the tool page: draw, write (editor and the syntax), export |
| `test/` | unit tests; `test/e2e/` holds the browser tests |
| `fixtures/` | golden outputs from the Python reference; `fixtures/v2/` holds hand-written v2 examples |
| `reference/` | read-only Python and CSS sources the ports follow |
| `site/` | the component and host script to copy into the kyleschlaepfer.com repo |
| `scripts/` | scripts that drive a running app for screenshots and export galleries |
| `spec/` | the contract |
