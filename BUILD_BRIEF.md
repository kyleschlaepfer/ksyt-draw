# Build brief: KSyt Draw v1 (embeddable diagrams)

Paste this as the first message in a Claude Code session opened in this repo:

> Read CLAUDE.md, ARCHITECTURE.md, BUILD_BRIEF.md and everything in spec/. Then build v1 as BUILD_BRIEF.md describes, in its order, and stop when its acceptance checks pass. Don't ask me questions you can answer from the docs; list anything you had to decide in your final report.

## Already done (don't redo)

- `src/core/pyrandom.ts` and `src/core/pen.ts`: verified against Python (`npm test`, 45 passing).
- `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `public/_headers`: verified to install, typecheck, test, build and pass `wrangler deploy --dry-run` (with stub pages).
- All fixtures in `fixtures/`, generated from Kyle's real Python code.
- `site/DiagramEmbed.astro` and `site/draw-host.ts`: the host side for kyleschlaepfer.com (copied into the site repo later; not built here).

## Order of work

1. `npm install`, `npm test` (should be 45 passing before you start).
2. `src/core/model.ts`: types for the parsed diagram (`spec/diagram-text.md` output shape) and findings.
3. `src/core/parse.ts` + `test/parse.test.ts`: every `fixtures/diagrams/*.ksd` parses to its `.json` (deep equal); every `fixtures/parse-errors.json` input throws with the same line.
4. `src/core/lint.ts` + `test/lint.test.ts`: per `spec/lint.md`; full findings equal `*.lint.json`.
5. `src/core/measure.ts` (interface + test stub), `shapes.ts`, `layout-flow.ts`, `layout-usecase.ts`, `scene.ts`, `svg.ts`, `describe.ts`, `state.ts` per `spec/rendering.md` and `spec/embed-protocol.md`, with unit tests:
   - every fixture lays out with no node overlaps, every arrow ≥ 0.5 in, every node inside the frame;
   - use-case fixtures: actors outside the boundary (except `usecase-actor-inside`), use cases inside, «include» drawn from base to included;
   - fork/join bars span their branches;
   - SVG: every label escaped (test with `<script>`, `"><img onerror=x>`, `]]>` and `&` in labels and titles), role classes only (no `#` colors in non-standalone output), `data-step` on stepped parts, `<title>`/`<desc>` present;
   - `state.ts` round-trips `{d, id, step, theme, lint, qa, tools}` through the hash;
   - `describe.ts` output for `flow-approval` and `usecase-permit` reads correctly (snapshot, then read it yourself).
6. `src/core/qa.ts` (raster collision check) once rendering works in a browser.
7. `embed/index.html` + `src/embed/main.ts` + `src/embed/embed.css`: per `spec/embed-protocol.md` §1, §2, §4. Copy the needed parts of `reference/ksyt.css` into `embed.css` (tokens light and dark, `[data-theme]`, `.btn`, `.btn-quiet`, `.note`, `figure.fig`, `.ksyt-fig` role fills, `details` styling). `<noscript>`: "This diagram needs JavaScript." with a link to the playground.
8. `index.html` + `src/play/main.ts` + `src/play/play.css`: the playground (`spec/embed-protocol.md` §5).
9. `test/e2e/*.spec.ts` (Playwright, Chromium) with `playwright.config.ts` running `vite preview`:
   - a host page fixture (`test/e2e/host.html`, served by the preview or a tiny static server) with two embeds that checks: `ready` arrives with the right `id`; `resize` sets the iframe height so there's no inner scrollbar; sending `theme: dark` switches the embed background to the dark `--page`; `step` messages both ways; messages from a wrong source are ignored;
   - every fixture renders with zero QA errors at 1280 px, light and dark; screenshots saved under `test-results/`;
   - phone (375 px): `direction right` flows switch to top-down; labels never under 13 px for the fixtures;
   - build-up: `activity-parallel` starts at step 1 of 3, `next step` reveals the fork, `show all` shows everything, keyboard arrows work;
   - lint panel on `usecase-is-flow` with `lint=1` shows "blocked" and the rule id in text;
   - the playground: typing updates the preview, parse errors show their line, "copy embed code" produces an iframe whose `src` reproduces the same diagram;
   - XSS: a hash whose labels contain `<img src=x onerror=alert(1)>` renders the text literally, and no dialog opens.
10. `npm run build` and look at the screenshots. Fix what looks wrong against `reference/diagrams-web.md` §4 (no line through text, connectors end on outlines, labels beside lines, peers aligned, centered, tight frame).

## Acceptance checks (all must hold)

- `npm test`, `npm run test:e2e`, `npm run build` all pass.
- The nine fixtures render, lint with the expected verdicts (`spec/lint.md` table), and look like the slide style: Kalam text, pen strokes, charcoal on off-white, chalkboard in dark mode.
- The embed works as a bare iframe on a plain HTML page (no host script), and better with the host script (height, theme).
- No em dashes in any file you wrote (`grep -rnP '\x{2014}' src test embed index.html` returns nothing).
- Nothing in `src/core/` touches `window` or `document`.

## Final report (in the chat, short)

What was built; test counts; screenshots worth looking at (paths); every decision you made that the docs didn't settle; anything not verified (likely: real Cloudflare headers, Safari and Firefox, LMS iframe policies). Then the deploy steps for Kyle:

1. `npx wrangler login` (once).
2. `npm run deploy`.
3. `curl -sI https://chalk.kyleschlaepfer.com/embed/ | grep -i content-security` shows `frame-ancestors *`; `curl -sI https://chalk.kyleschlaepfer.com/` shows `frame-ancestors 'none'`.
4. Copy `site/DiagramEmbed.astro` and `site/draw-host.ts` into the site repo (`src/components/` and `src/scripts/`), `npm i lz-string` there, and use it in one lesson.
