import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The syntax reference has to keep up with the code: every kind, operator, rule and error the
// code knows must appear in the docs, and the docs must keep the house rules.
const docs = readFileSync(new URL("../src/play/docs.html", import.meta.url), "utf8");
const parseSrc = readFileSync(new URL("../src/core/parse.ts", import.meta.url), "utf8");
const lintSrc = readFileSync(new URL("../src/core/lint.ts", import.meta.url), "utf8");
const qaSrc = readFileSync(new URL("../src/core/qa.ts", import.meta.url), "utf8");
const text = docs.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

describe("the syntax reference covers the code", () => {
  it("names every node kind the parser accepts", () => {
    const kinds = /const KINDS: readonly string\[\] = \[([^\]]+)\]/.exec(parseSrc)![1].match(/"[^"]+"/g)!.map((s) => s.slice(1, -1));
    for (const k of [...kinds, "start", "end", "usecase", "boundary"]) expect(text, k).toContain(`<code>${k}</code>`);
  });
  it("names every edge operator", () => {
    for (const op of ["-include->", "-extend->", "..>", "-->", "->", "--"]) expect(text, op).toContain(`a ${op} b`);
  });
  it("names every header word, profile and direction", () => {
    for (const w of ["diagram flowchart", "diagram activity", "diagram use-case", "title", "id", "profile strict-uml", "profile uml-inspired",
      "profile general-diagram", "desc", "narration", "direction down", "direction right", "legend"]) expect(text, w).toContain(`<code>${w}`);
    for (const o of ["left", "right", "at X Y", "step"]) expect(text, o).toContain(`<code>${o}`);
  });
  it("names every lint rule id", () => {
    const ids = new Set<string>();
    for (const m of lintSrc.matchAll(/"([A-Z]+(?:-[A-Z]+)+)"/g)) ids.add(m[1]);
    for (const m of lintSrc.matchAll(/`\$\{pfx\}(-[A-Z-]+)`/g)) { ids.add("FLOW" + m[1]); ids.add("ACTIVITY" + m[1]); }
    ids.add("ACTIVITY-FORK-STRUCTURE");
    ids.add("ACTIVITY-JOIN-STRUCTURE");
    expect(ids.size).toBeGreaterThan(40);
    for (const id of ids) expect(text, id).toContain(`<code>${id}</code>`);
  });
  it("names every layout check code", () => {
    for (const m of qaSrc.matchAll(/`(LINE_THROUGH_TEXT|TEXT_OVERLAP|CLIP|SMALL_KALAM|PHONE_LEGIBILITY)/g)) expect(text).toContain(`<code>${m[1]}</code>`);
  });
  it("lists every parse error message", () => {
    const messages = [...parseSrc.matchAll(/new ParseError\([^,]+, ("[^"]+"|'[^']+'|`[^`]+`)\)/g)].map((m) => m[1].slice(1, -1));
    expect(messages.length).toBeGreaterThan(15);
    for (const msg of messages) {
      // template messages carry the value in pyRepr(...); the docs write '...' there
      const plain = msg.replace(/\$\{[^}]+\}/g, "'...'").replace(/''\.\.\.''/g, "'...'");
      const needle = plain.split("'...'")[0].trim();
      expect(text, msg).toContain(needle);
    }
  });
  it("names the embed parameters", () => {
    for (const p of ["v", "d", "id", "step", "theme", "lint", "qa", "tools"]) expect(text).toContain(`<td><code>${p}</code></td>`);
  });
  it("keeps the house rules on wording, headings and example buttons", () => {
    expect(docs).not.toContain("—");
    expect(docs.toLowerCase()).not.toMatch(/hand[- ]drawn|drawn by hand/);
    const levels = [...docs.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(2);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
    for (const ex of ["flowchart", "activity", "use-case"]) expect(docs).toContain(`data-example="${ex}"`);
    for (const id of docs.matchAll(/href="#(d-[a-z-]+)"/g)) expect(docs).toContain(`id="${id[1]}"`);
  });
});
