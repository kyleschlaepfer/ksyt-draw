# KSyt Draw

Diagrams for kyleschlaepfer.com: write a few lines of text, get a use-case, activity or flowchart diagram in the same style as the videos, embeddable in any page, with the same notation check as the slide reviewer.

**Status:** v1 scaffold. The pen engine port, build config and every test fixture are done and verified; the parser, linter, layout, embed and playground are specified and ready to build. See `BUILD_BRIEF.md`.

## Start here

1. Create a GitHub repo named `ksyt-draw` and put this folder's contents at its root.
2. `npm install && npm test` (45 tests should pass).
3. Open Claude Code in the repo and paste the prompt at the top of `BUILD_BRIEF.md`.
4. When it's done: `npx wrangler login` once, then `npm run deploy`.

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
