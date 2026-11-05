# Chalk, repo ksyt-draw (chalk.kyleschlaepfer.com)

Diagram tool for Kyle Schlaepfer's KSyt channel site. Its name on the page is Chalk (one constant, `APP_NAME` in `src/play/main.ts`); the repo, the deploy and the message protocol keep the `ksyt-draw` name. v2: one diagram, two ways to edit it (write `.ksd` text, or draw on a canvas that writes the text for you), use-case, activity, class and flow diagrams, two looks (sketch like the videos, precision for formal documents), embeddable by iframe, exports to PNG, SVG and PDF, with the diagram reviewer's notation check. Read `ARCHITECTURE.md` first; the specs in `spec/` are the contract; the reasons are in `docs/revamp/ARCHITECTURE_DECISIONS.md`.

## Ground rules

- **Shapes are predefined; nobody draws freehand.** The pen engine (`src/core/pen.ts`) only renders shapes in the slide style. Draw places, connects, moves and resizes those shapes; it has no pencil.
- **Ports stay ports.** `src/core/pen.ts`, `pyrandom.ts`, `lint.ts` and the v1 parser `src/core/parse.ts` follow `reference/*.py` exactly. Change behavior in the Python reference first (it belongs to Kyle's other skills), regenerate fixtures with `npm run fixtures`, then match it here. Never hand-edit fixture JSON.
- **The v2 parser is a superset, not a port.** `src/core/doc/parse.ts` must read every v1 file exactly as the reference parser does and fail where it fails, with the same message on the same line, except that the two messages listing the diagram types also list class (`test/doc-parse.test.ts` holds it to that). New syntax goes there, never into `src/core/parse.ts`.
- **One geometry.** Where things are is decided once, in `src/core/geom/`. The write preview, the draw canvas, the embed and every export read the same resolved geometry; the two looks only change how it is inked. Fix a layout or routing problem there, never in one surface.
- **The text is the file.** Every edit in Draw becomes a targeted change to the source (`src/core/doc/sync.ts`); comments, order and spacing the author wrote are kept. Shapes the author has not placed are laid out automatically and hold still when something else changes.
- **Accuracy beats looks.** A diagram that teaches the wrong notation is worse than an ugly one. The lint never gets weaker to make a diagram pass.
- **Escape everything** that comes from diagram text before it reaches SVG or HTML. The URL hash is attacker-controlled.
- **House rules** (from `ksyt-web-design`): no em dashes anywhere (code strings, UI copy, docs); never describe the videos or the art as "hand-drawn" or "drawn by hand" (it's a hand-drawn *style*); fonts are Kalam (handwritten text, labels, buttons), Atkinson Hyperlegible Next (prose) and Atkinson Hyperlegible Mono (code) only; colors are theme roles from `ksyt.css`, never hex in components; no shadows, gradients, ALL CAPS, emoji or icon packs; severity and state are never shown by color alone.
- **UI copy sounds like Kyle:** short, plain, lowercase-ish handwritten labels ("next step", "describe this figure", "copy embed code").
- Keep `src/core/` free of DOM access so it runs in Node tests. DOM code lives in `src/embed/`, `src/play/` and `src/export/`.

## Commands

```
npm test            vitest: ports, both parsers, source sync, session, lint, layout, routing, SVG, describe, the syntax page
npm run test:e2e    playwright against the production build and its CSP: embed, write, draw, export, files (light, dark, phone, desktop)
npm run dev         vite dev server (tool at /, embed at /embed/)
npm run build       typecheck + build to dist/
npm run fixtures    regenerate fixtures from reference/*.py (needs python3)
npm run deploy      test, build, wrangler deploy (Kyle runs this; needs `npx wrangler login` once)

node scripts/gallery.mjs [outDir] [base url] [name filter]   every fixture, both looks, as SVG, PNG and PDF, with review sheets
node scripts/capture-ui.mjs [outDir] [base url]              the tool's views in light and dark at 1440, 820 and 390 px
```

The two scripts need a running server. Use a build (`npx vite preview`), not the dev server, when files are changing under it.

## Done means

`npm test` and `npm run test:e2e` pass, `npm run build` succeeds, and you've looked at the rendered fixtures (screenshots from the e2e run) in light and dark at phone and desktop widths. If you touched layout, routing, a look or the export pipeline, also run the gallery and look at the sheets: the layout check passing is not the same as the diagram reading well. Say what you couldn't verify.

## Where things come from

| Need | Source |
|---|---|
| Shape geometry | `reference/diagrams.py` (slide skill), converted per `spec/rendering.md`; lives in `src/core/geom/shape.ts` |
| Stroke algorithm | `reference/pen.py` → `src/core/pen.ts` (done, verified) |
| Rules and wording | `reference/review_diagrams.py` → `src/core/lint.ts`; rules for what the reviewer has no notion of (lanes, classes) are in `src/core/diagnostics.ts` |
| v1 text format | `reference/ksd_parse.py` → `src/core/parse.ts` |
| v2 text format | `spec/diagram-text.md` → `src/core/doc/parse.ts`, printed by `src/core/doc/print.ts`; the reference page `src/play/docs.html` is checked against the parser by `test/docs.test.ts` |
| Layout and line routing | `src/core/geom/layout.ts`, `route.ts`, `resolve.ts` |
| The two looks | `src/core/render/sketch.ts`, `precision.ts`, over `scene.ts` |
| Export files | `src/export/` (SVG, PNG, PDF with embedded fonts, SVG text as shapes) |
| Tokens, buttons, figure styles | `reference/ksyt.css` |
| Diagram rules for the web | `reference/diagrams-web.md` |
