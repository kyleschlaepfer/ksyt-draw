import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseSource } from "../src/core/doc/parse";
import { CONTAINERS, DESCRIBE_FIELDS, PROFILES, TYPES } from "../src/core/doc/types";
import { RELATIONS } from "../src/core/doc/commands";
import { review } from "../src/core/diagnostics";
import { EXAMPLES } from "../src/play/examples";

// The syntax reference has to keep up with the code: every kind, operator, header word, rule, check
// code, message and embed parameter the code knows must appear in the docs, every example in the docs
// must parse, and the docs must keep the house rules. When one of these fails, fix the docs.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const docs = read("../src/play/docs.html");
const parseSrc = read("../src/core/doc/parse.ts");
const typesSrc = read("../src/core/doc/types.ts");
const rulesSrc = read("../src/core/diagnostics.ts");
const lintSrc = read("../src/core/lint.ts");
const qaSrc = read("../src/core/qa.ts");
const stateSrc = read("../src/core/state.ts");

const unescapeHtml = (s: string): string => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = unescapeHtml(docs);

/** The quoted strings in a pattern's first group: an array literal or a union type in the source. */
function quoted(src: string, re: RegExp): string[] {
  const m = re.exec(src);
  expect(m, String(re)).not.toBeNull();
  return m![1].match(/"[^"]+"/g)!.map((s) => s.slice(1, -1));
}
/** `const NAME = [...]` in the parser */
const list = (name: string): string[] => quoted(parseSrc, new RegExp(`const ${name}(?:: readonly string\\[\\])? = \\[([^\\]]+)\\]`));
/** `export type NAME = "a" | "b"` in the model */
const union = (name: string): string[] => quoted(typesSrc, new RegExp(`export type ${name} =([^;]+);`));
const code = (s: string): string => `<code>${s}</code>`;
/** The docs (entities decoded) contain this. Fails with one line, not with the whole reference. */
const has = (needle: string, what: string = needle): void => { expect(text.includes(needle), `the syntax reference is missing ${what}`).toBe(true); };
/** The docs as written (entities and all) match this. */
const matches = (re: RegExp, what: string): void => { expect(re.test(docs), `the syntax reference is missing ${what}`).toBe(true); };

// ---------------------------------------------------------------- the parser's messages
//
// The v2 parser reports through three calls and one object shape:
//   err(ln, MESSAGE, ...)          an error on a line
//   warn(ln, code, MESSAGE, ...)   a warning on a line
//   { ..., message: MESSAGE }      whole-file errors, and the layout warning that wraps what fail() says
//   fail(MESSAGE)                  inside the layout block; it reaches the user as `${msg}; the line is kept ...`
// MESSAGE is a string, a template, or a ternary of those, so the source is read as a syntax tree and
// every string a message can come out as is collected. The docs write '...' where the parser puts a
// quoted value (pyRepr), and an example where it puts a bare one (an id, an operator, a field).

type Piece = string | { hole: "repr" | "any" };
type Message = Piece[];
const REPR: Piece = { hole: "repr" }, ANY: Piece = { hole: "any" };

function parserMessages(): Message[] {
  const sf = ts.createSourceFile("parse.ts", parseSrc, ts.ScriptTarget.Latest, true);
  const consts = new Map<string, ts.Expression[]>();
  const direct: ts.Expression[] = [];
  const failed: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, [...(consts.get(n.name.text) ?? []), n.initializer]);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const f = n.expression.text;
      if (f === "err" && n.arguments[1]) direct.push(n.arguments[1]);
      if (f === "warn" && n.arguments[2]) direct.push(n.arguments[2]);
      if (f === "fail" && n.arguments[0]) failed.push(n.arguments[0]);
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "message") direct.push(n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  expect(failed.length).toBeGreaterThan(0);

  /** every text an expression can produce, or null when it is not built from literals */
  const variants = (e: ts.Expression): Message[] | null => {
    if (ts.isParenthesizedExpression(e)) return variants(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [[e.text]];
    if (ts.isConditionalExpression(e)) {
      const a = variants(e.whenTrue), b = variants(e.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isIdentifier(e)) {
      // the layout warning's `msg` is whatever a fail() call passed
      if (e.text === "msg") return failed.flatMap((f) => variants(f) ?? [[ANY]]);
      const inits = consts.get(e.text);
      return inits && inits.length === 1 ? variants(inits[0]) : null;
    }
    if (ts.isTemplateExpression(e)) {
      let out: Message[] = [[e.head.text]];
      for (const span of e.templateSpans) {
        const fills = hole(span.expression);
        out = out.flatMap((m) => fills.map((f) => [...m, ...f, span.literal.text]));
      }
      return out;
    }
    return null;
  };
  const hole = (e: ts.Expression): Message[] => {
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "pyRepr") return [[REPR]];
    if (e.getText(sf) === 'DESCRIBE_FIELDS.join(", ")') return [[DESCRIBE_FIELDS.join(", ")]];
    return variants(e) ?? [[ANY]];
  };
  return direct.flatMap((e) => {
    const v = variants(e);
    // a message this can't read would go unchecked: teach variants() the new shape instead
    expect(v, `can't read the message ${e.getText(sf)}`).not.toBeNull();
    return v ?? [];
  });
}

const show = (m: Message): string => m.map((p) => (typeof p === "string" ? p : p.hole === "repr" ? "'...'" : "*")).join("");
/** The message as one whole table cell of the docs. */
const cell = (m: Message): RegExp =>
  new RegExp("<td>" + m.map((p) => (typeof p === "string" ? escapeRe(escapeHtml(p)) : p.hole === "repr" ? "'\\.\\.\\.'" : "[^<]+?")).join("") + "</td>");

// ---------------------------------------------------------------- the examples in the docs

const blocks = [...docs.matchAll(/<pre(?: data-ksd="([a-z-]+)")?><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => ({ type: m[1] as string | undefined, src: unescapeHtml(m[2]) }));
const whole = blocks.filter((b) => b.src.startsWith("diagram "));

describe("the syntax reference covers the code", () => {
  it("names every node kind, block word and alias the parser accepts", () => {
    const kinds = new Set([...list("KINDS"), ...union("NodeKind")]);
    expect(kinds.size).toBeGreaterThanOrEqual(18);
    // other spellings the parser reads, and the words that open the remaining blocks
    const words = ["start", "end", "usecase", "lane", "swimlane", "abstract", "describe", "layout"];
    for (const w of words) expect(new RegExp(`\\b${w}\\b`).test(parseSrc), `the parser no longer knows ${w}`).toBe(true);
    for (const k of [...kinds, ...words]) has(code(k));
  });
  it("names every edge operator, in every diagram type that offers it", () => {
    const ops = list("OPS");
    expect(ops.length).toBeGreaterThanOrEqual(14);
    for (const op of ops) has(code(`a ${op} b`));
    for (const options of Object.values(RELATIONS)) for (const r of options) has(code(`a ${r.op} b`));
    for (const r of RELATIONS.class) has(r.word);
    for (const k of union("EdgeKind")) if (k !== "arrow") has(k);
  });
  it("names every header word and each value it takes", () => {
    const words = [...list("HEADER"), ...list("HEADER_V2")];
    expect(words.length).toBeGreaterThanOrEqual(10);
    for (const w of words) has(`<code>${w} `);
    for (const t of TYPES) has(code(`diagram ${t}`));
    for (const p of PROFILES) has(code(`profile ${p}`));
    // the header words that take one of two values: `if (val !== "down" && val !== "right") { err(ln, "direction is ...`
    const choices = [...parseSrc.matchAll(/val !== "([a-z]+)" && val !== "([a-z]+)"\) \{ err\(ln, "([a-z]+) is /g)];
    expect(choices.map((m) => m[3]).sort()).toEqual(["direction", "lanes", "look"]);
    for (const [, a, b, w] of choices) for (const v of [a, b]) has(code(`${w} ${v}`));
  });
  it("names every option a node or class line takes", () => {
    for (const o of ["left", "right", "at X Y", "size W H", "step"]) has(`<code>${o}`);
    // the parser's own name for a class's options: unknown option ... (<<stereotype>>, at X Y, size W H)
    expect(parseSrc.includes("(<<stereotype>>, at X Y, size W H)"), "the parser's list of class options changed").toBe(true);
    for (const o of ["[<<stereotype>>]", "[at X Y]", "[size W H]"]) has(o);
  });
  it("names the parts of a class member", () => {
    for (const v of union("Visibility")) has(code(v));
    // parseMember reads the modifiers with /\{(static|abstract)\}/
    const mods = /\\\{\(([a-z|]+)\)\\\}/.exec(parseSrc)![1].split("|");
    expect(mods.length).toBe(2);
    for (const m of mods) has(code(`{${m}}`));
  });
  it("names every field of a use-case description", () => {
    expect(DESCRIBE_FIELDS.length).toBeGreaterThanOrEqual(9);
    for (const f of DESCRIBE_FIELDS) has(code(f));
  });
  it("names every line of the layout block and every value it takes", () => {
    const words = /unknown layout line \$\{pyRepr\(word\)\} \(([^)]+)\)/.exec(parseSrc)![1].split(", ");
    expect(words.length).toBeGreaterThanOrEqual(7);
    for (const w of words) has(`<code>${w} `);
    for (const name of ["SIDES", "COLORS", "FILLS", "WEIGHTS"]) for (const v of list(name)) has(code(v));
    const routes = /kind !== "([a-z]+)" && kind !== "([a-z]+)"/.exec(parseSrc)!.slice(1);
    for (const r of routes) has(code(r));
    // `#n` picks the n-th of several edges between the same two nodes
    expect(parseSrc.includes("#(?<n>[0-9]+)"), "the parser no longer reads #n after an edge").toBe(true);
    has(code("#2"));
  });
  it("names every notation rule id", () => {
    const ported = new Set<string>();
    for (const m of lintSrc.matchAll(/"([A-Z]+(?:-[A-Z]+)+)"/g)) ported.add(m[1]);
    for (const m of lintSrc.matchAll(/`\$\{pfx\}(-[A-Z-]+)`/g)) { ported.add("FLOW" + m[1]); ported.add("ACTIVITY" + m[1]); }
    ported.add("ACTIVITY-FORK-STRUCTURE");
    ported.add("ACTIVITY-JOIN-STRUCTURE");
    expect(ported.size).toBeGreaterThan(40);
    const v2 = new Set([...rulesSrc.matchAll(/"([A-Z]+(?:-[A-Z]+)+)"/g)].map((m) => m[1]));
    expect(v2.size).toBeGreaterThanOrEqual(12);
    for (const id of [...ported, ...v2]) has(code(id));
  });
  it("names every layout check code", () => {
    const codes = new Set([...qaSrc.matchAll(/\.push\(`([A-Z][A-Z_]+) /g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThanOrEqual(5);
    for (const c of codes) has(code(c));
  });
  it("lists every message the parser can produce, each as a table cell of its own", () => {
    const messages = parserMessages();
    expect(messages.length).toBeGreaterThan(50);
    const missing = [...new Set(messages.filter((m) => !cell(m).test(docs)).map(show))];
    expect(missing, "messages with no table cell in the syntax reference").toEqual([]);
    // a block left open is named by its kind, and both containers have a row
    for (const k of CONTAINERS) has(`<td>${k} '...' is never closed with }</td>`);
    // the warnings carry a code the issues panel shows
    const codes = new Set([...parseSrc.matchAll(/"([A-Z]+(?:-[A-Z]+)+)"/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThanOrEqual(2);
    for (const c of codes) has(`<td>${code(c)}</td>`);
  });
  it("names the embed parameters", () => {
    const params = new Set([...stateSrc.matchAll(/(?:p\.get|flag)\("([a-z]+)"/g)].map((m) => m[1]));
    expect(params.size).toBeGreaterThanOrEqual(9);
    for (const p of params) {
      has(`<td>${code(p)}</td>`);
      matches(new RegExp(`/embed/[^<]*(?:#|&amp;)${p}=`), `${p}= in the example embed link`);
    }
  });
});

describe("the examples in the syntax reference", () => {
  it("finds every code block", () => {
    expect(blocks.length).toBe(docs.match(/<pre/g)!.length);
  });
  it("every complete diagram is a clean file that passes the notation check", () => {
    expect(whole.length).toBeGreaterThanOrEqual(9);
    for (const b of whole) {
      expect(b.type, "a whole file needs no data-ksd").toBeUndefined();
      const p = parseSource(b.src + "\n");
      expect(p.diagnostics, b.src).toEqual([]);
      expect(p.doc, b.src).not.toBeNull();
      expect(review(p.doc!).findings.map((f) => f.rule_id), b.src).toEqual([]);
    }
  });
  it("every fragment parses inside a diagram of the type it is marked with", () => {
    const parts = blocks.filter((b) => b.type !== undefined);
    expect(parts.length).toBeGreaterThanOrEqual(8);
    for (const b of parts) {
      expect(TYPES as readonly string[], b.src).toContain(b.type);
      const p = parseSource(`diagram ${b.type}\ntitle t\n${b.src}\n`);
      expect(p.diagnostics.filter((d) => d.severity === "error"), b.src).toEqual([]);
    }
    // what is left is a grammar line or not .ksd at all
    for (const b of blocks) if (b.type === undefined && !whole.includes(b)) expect(b.src).toMatch(/^(?:<|\[|https:|import )/);
  });
  it("shows each loadable example exactly as its button loads it", () => {
    const shown = new Set(whole.map((b) => b.src.trim()));
    expect(Object.keys(EXAMPLES).sort()).toEqual(["activity", "class", "flowchart", "lanes", "use-case"]);
    for (const [key, src] of Object.entries(EXAMPLES)) {
      expect(docs, key).toContain(`data-example="${key}"`);
      expect(shown.has(src.trim()), `the ${key} example is not in the docs as written`).toBe(true);
    }
    for (const m of docs.matchAll(/data-example="([^"]*)"/g)) expect(Object.keys(EXAMPLES)).toContain(m[1]);
  });
});

describe("the syntax reference keeps the house rules", () => {
  it("wording", () => {
    expect(docs).not.toContain("\u2014");
    expect(docs.toLowerCase()).not.toMatch(/hand[- ]drawn|drawn by hand/);
    expect(docs).not.toMatch(/\p{Extended_Pictographic}/u);
    // no shouting: outside code, nothing longer than an initialism is in capitals
    const prose = docs.replace(/<pre[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "").replace(/<[^>]+>/g, " ");
    expect(prose.match(/\b[A-Z]{4,}\b/g) ?? []).toEqual([]);
  });
  it("headings step down one level at a time and every contents link lands", () => {
    const levels = [...docs.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(2);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
    const links = [...docs.matchAll(/href="#(d-[a-z-]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(18);
    for (const id of links) expect(docs, id).toContain(`id="${id}"`);
    // and every section is in the contents
    for (const m of docs.matchAll(/<section id="(d-[a-z-]+)"/g)) expect(docs, m[1]).toContain(`<li><a href="#${m[1]}">`);
  });
});
