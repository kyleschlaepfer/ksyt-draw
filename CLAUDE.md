# KSyt Draw (draw.kyleschlaepfer.com)

Diagram tool for Kyle Schlaepfer's KSyt channel site. v1: text in (`.ksd`), diagram out, embeddable by iframe, drawn in the same style as the videos, with the diagram reviewer's notation check. Read `ARCHITECTURE.md` first; the specs in `spec/` are the contract.

## Ground rules

- **Shapes are predefined; nobody draws freehand.** The pen engine (`src/core/pen.ts`) only renders shapes in the slide style.
- **Ports stay ports.** `src/core/pen.ts`, `pyrandom.ts`, `parse.ts` and `lint.ts` follow `reference/*.py` exactly. Change behavior in the Python reference first (it belongs to Kyle's other skills), regenerate fixtures with `npm run fixtures`, then match it here. Never hand-edit fixture JSON.
- **Accuracy beats looks.** A diagram that teaches the wrong notation is worse than an ugly one. The lint never gets weaker to make a diagram pass.
- **Escape everything** that comes from diagram text before it reaches SVG or HTML. The URL hash is attacker-controlled.
- **House rules** (from `ksyt-web-design`): no em dashes anywhere (code strings, UI copy, docs); never describe the videos or the art as "hand-drawn" or "drawn by hand" (it's a hand-drawn *style*); fonts are Kalam (handwritten text, labels, buttons), Atkinson Hyperlegible Next (prose) and Atkinson Hyperlegible Mono (code) only; colors are theme roles from `ksyt.css`, never hex in components; no shadows, gradients, ALL CAPS, emoji or icon packs; severity and state are never shown by color alone.
- **UI copy sounds like Kyle:** short, plain, lowercase-ish handwritten labels ("next step", "describe this figure", "copy embed code").
- Keep `src/core/` free of DOM access so it runs in Node tests. DOM code lives in `src/embed/` and `src/play/`.

## Commands

```
npm test            vitest: ports, parser, lint, layout, SVG, describe
npm run test:e2e    playwright: embed and playground in Chromium (light, dark, phone, desktop)
npm run dev         vite dev server (playground at /, embed at /embed/)
npm run build       typecheck + build to dist/
npm run fixtures    regenerate fixtures from reference/*.py (needs python3)
npm run deploy      test, build, wrangler deploy (Kyle runs this; needs `npx wrangler login` once)
```

## Done means

`npm test` and `npm run test:e2e` pass, `npm run build` succeeds, and you've looked at the rendered fixtures (screenshots from the e2e run) in light and dark at phone and desktop widths. Say what you couldn't verify.

## Where things come from

| Need | Source |
|---|---|
| Shape geometry | `reference/diagrams.py` (slide skill), converted per `spec/rendering.md` |
| Stroke algorithm | `reference/pen.py` → `src/core/pen.ts` (done, verified) |
| Rules and wording | `reference/review_diagrams.py` → `src/core/lint.ts` |
| Text format | `reference/ksd_parse.py` → `src/core/parse.ts` |
| Tokens, buttons, figure styles | `reference/ksyt.css` |
| Diagram rules for the web | `reference/diagrams-web.md` |
