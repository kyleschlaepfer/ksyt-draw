# KSyt Draw

Diagrams for kyleschlaepfer.com: write a few lines of text, get a use-case, activity or flowchart diagram in the same style as the videos, embeddable in any page, with the same notation check as the slide reviewer.

**Status:** v1 built. Parser, linter, layout, SVG, QA, the embed page and the playground pass `npm test` (171) and `npm run test:e2e` (57). Deploy steps are at the end of `BUILD_BRIEF.md`.

## Start here

1. Create a GitHub repo named `ksyt-draw` and put this folder's contents at its root.
2. `npm install && npm test`.
3. `npx playwright install chromium` once, then `npm run test:e2e` (screenshots land in `test-results/`). Where the Playwright CDN is blocked, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` uses an installed Chrome.
4. `npx wrangler login` once, then `npm run deploy`.

## Map

| File | What it is |
|---|---|
| `ARCHITECTURE.md` | how the pieces fit, why, hosting, security, open decisions |
| `BUILD_BRIEF.md` | the build, in order, with acceptance checks |
| `CLAUDE.md` | standing rules for every Claude session here |
| `spec/` | the text format, rendering, embed protocol, lint port |
| `reference/` | Kyle's Python sources the TypeScript follows (read-only copies) |
| `fixtures/` | golden outputs from that Python (`npm run fixtures` regenerates) |
| `src/core/` | `pyrandom.ts`, `pen.ts` (done); the rest gets built here |
| `site/` | the component and host script for the kyleschlaepfer.com repo |
