/**
 * The .ksd language for CodeMirror: a line tokenizer for highlighting, block-aware indentation,
 * `#` comments, and completions that know the diagram type and what is already declared.
 */
import { StreamLanguage, indentService, type StreamParser } from "@codemirror/language";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { KINDS_FOR, TYPES, PROFILES, DESCRIBE_FIELDS, type ChalkDoc, type DiagramType } from "../../core/doc/types";
import { RELATIONS } from "../../core/doc/commands";

const HEADER = ["diagram", "id", "title", "profile", "desc", "narration", "direction", "legend", "lanes", "look"];
const PROSE = new Set(["title", "desc", "narration", "legend"]);
const BLOCKS = ["boundary", "partition", "lane", "swimlane", "class", "interface", "abstract", "describe", "layout"];
const LAYOUT = ["place", "size", "lane", "pool", "route", "label", "style"];
const LAYOUT_WORDS = new Set(["at", "length", "via", "from", "to", "straight", "elbow", "fill", "color", "weight", "top", "right", "bottom", "left"]);
const NODE_WORDS = new Set(["action", "process", "decision", "merge", "fork", "join", "initial", "final", "flow-final", "terminator", "io", "actor",
  "use-case", "usecase", "note", "start", "end"]);
const OPS = /^(?:-include->|-extend->|\.\.\|>|--\|>|<\|--|<\|\.\.|\.\.>|-->|->|o--|\*--|--o|--\*|--)(?=\s|$)/;

interface State { first: boolean; word: string; prose: boolean; label: boolean; depth: string[] }

const parser: StreamParser<State> = {
  name: "ksd",
  startState: () => ({ first: true, word: "", prose: false, label: false, depth: [] }),
  copyState: (s) => ({ ...s, depth: [...s.depth] }),
  token(stream, s) {
    if (stream.sol()) { s.first = true; s.word = ""; s.prose = false; s.label = false; }
    if (stream.eatSpace()) return null;
    const top = s.depth[s.depth.length - 1];
    if (s.first && stream.peek() === "#" && !(top === "class" && /^#[A-Za-z_]/.test(stream.string.slice(stream.pos)))) {
      stream.skipToEnd();
      return "comment";
    }
    if (s.prose || s.label) { stream.skipToEnd(); return s.label ? "string" : null; }
    if (stream.eat("{")) { s.depth.push(s.word === "layout" ? "layout" : s.word === "describe" ? "describe" : s.word === "class" || s.word === "interface" || s.word === "abstract" ? "class" : "block"); return "bracket"; }
    if (stream.eat("}")) { s.depth.pop(); return "bracket"; }
    if (stream.peek() === '"') {
      stream.next();
      let esc = false;
      for (;;) {
        const ch = stream.next();
        if (ch === undefined) break;
        if (ch === '"' && !esc) break;
        esc = ch === "\\" && !esc;
      }
      return "string";
    }
    if (top === "class") {
      // members: visibility, name, then types
      if (stream.match(/^[+\-#~]/)) return "operator";
      if (stream.match(/^\{(?:static|abstract)\}/)) return "meta";
      if (stream.match(/^[A-Za-z_][\w]*(?=\s*\()/)) return "variableName.function";
      if (stream.match(/^[A-Za-z_][\w<>,\[\]]*/)) return s.first ? ((s.first = false), "propertyName") : "typeName";
      stream.next();
      return "punctuation";
    }
    if (stream.match(OPS)) { s.first = false; return "operator"; }
    if (!s.first && stream.match(/^:\s*/)) { s.label = true; return "punctuation"; }
    if (stream.match(/^-?\d+(?:\.\d+)?(?=[\s,]|$)/)) { s.first = false; return "number"; }
    if (stream.match(/^(?:<<|«)[^>»]*(?:>>|»)/)) return "meta";
    const m = stream.match(/^[A-Za-z][\w-]*/) as RegExpMatchArray | null;
    if (m) {
      const w = m[0];
      if (s.first) {
        s.first = false;
        s.word = w;
        if (top === "describe") { s.prose = true; return (DESCRIBE_FIELDS as readonly string[]).includes(w) ? "keyword" : "invalid"; }
        if (top === "layout") return LAYOUT.includes(w) ? "keyword" : "invalid";
        if (HEADER.includes(w) && !s.depth.length) { if (PROSE.has(w)) s.prose = true; return "keyword"; }
        if (w === "step" || BLOCKS.includes(w)) return "keyword";
        if (NODE_WORDS.has(w)) return "typeName";
        return "variableName";
      }
      if (s.word === "abstract" && (w === "class" || w === "interface")) return "keyword";
      if (top === "layout" && LAYOUT_WORDS.has(w)) return "atom";
      if (w === "left" || w === "right" || w === "at" || w === "size") return "atom";
      if (HEADER.includes(s.word)) return "atom";
      return "variableName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" }, closeBrackets: { brackets: ["{", '"'] } },
};

export const ksdLanguage = StreamLanguage.define(parser);

/** Lines inside a block sit two spaces in; a closing brace steps back out. */
export const ksdIndent = indentService.of((ctx, pos) => {
  const line = ctx.lineAt(pos, -1);
  let depth = 0;
  for (let n = 1; n < ctx.state.doc.lineAt(pos).number; n++) {
    const t = ctx.state.doc.line(n).text.trim();
    if (t.startsWith("#") && !/^#[A-Za-z_]/.test(t)) continue;
    if (t.endsWith("{")) depth++;
    else if (t === "}") depth = Math.max(0, depth - 1);
  }
  const here = ctx.state.doc.lineAt(pos).text.trim();
  if (here === "}") depth = Math.max(0, depth - 1);
  void line;
  return depth * 2;
});

const KIND_HELP: Record<string, string> = {
  process: "a step, square box", action: "a step, rounded box", decision: "a question, diamond; label its exits", merge: "paths rejoin, small empty diamond",
  terminator: "a pill with your own word", io: "input or output, parallelogram", start: "where the flow starts", end: "where the flow ends",
  fork: "a bar: everything after it happens at once", join: "a bar that waits for every path", "flow-final": "this path ends, the activity goes on",
  actor: "a role outside the system, stick figure", "use-case": "a goal, ellipse, inside the system", note: "graphite handwriting, no box",
  boundary: "the box the use cases live in", partition: "a swimlane: who does these actions", class: "a class with attributes and operations",
  interface: "an interface: operations a class can implement", initial: "the initial node, a solid dot", final: "the final node, a bullseye",
};
const HEADER_HELP: Record<string, string> = {
  diagram: "flowchart, activity, use-case or class (first line)", id: "a slug; seeds the pen wobble", title: "what the figure shows, one sentence",
  profile: "strict-uml, uml-inspired or general-diagram", desc: "the text alternative, in reading order", narration: "the words this diagram goes with",
  direction: "down or right", legend: "what the arrow styles mean", lanes: "vertical or horizontal partitions", look: "sketch or precision",
};
const DESCRIBE_HELP: Record<string, string> = {
  goal: "what the actor wants", primary: "the actor who starts it", supporting: "another actor who takes part", trigger: "the event that starts it",
  pre: "a state that must already hold", main: "one step of the main success scenario", alt: "an alternate or exception flow", post: "what is true afterwards",
  related: "a use case this one includes or extends",
};

function option(label: string, type: string, detail?: string, apply?: string): Completion {
  return { label, type, ...(detail ? { detail } : {}), ...(apply ? { apply } : {}) };
}

export interface CompleteContext { getDoc(): ChalkDoc | null }

/** Completions for the word at the cursor, by where on the line it is and which block it is in. */
export function ksdCompletions(app: CompleteContext): (ctx: CompletionContext) => CompletionResult | null {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    if (/^\s*#(?![A-Za-z_])/.test(before)) return null;
    const word = /[A-Za-z*<.o-][\w|>.<*-]*$/.exec(before);
    const from = word ? ctx.pos - word[0].length : ctx.pos;
    if (!word && !ctx.explicit) return null;
    const tokens = before.slice(0, before.length - (word ? word[0].length : 0)).trim().split(/\s+/).filter(Boolean);
    // what the text says so far: the type, the declared ids, the open block
    const doc = app.getDoc();
    let type: DiagramType = doc?.meta.type ?? "flowchart";
    const ids = new Set<string>(doc?.nodes.map((n) => n.id) ?? []);
    const stack: string[] = [];
    let body = false;
    for (let n = 1; n < line.number; n++) {
      const t = ctx.state.doc.line(n).text.trim();
      if (!t || (t.startsWith("#") && !/^#[A-Za-z_]/.test(t))) continue;
      const [w, second] = t.split(/\s+/);
      if (w === "diagram" && (TYPES as readonly string[]).includes(second)) type = second as DiagramType;
      if (!HEADER.includes(w)) body = true;
      if (t.endsWith("{")) stack.push(w === "abstract" ? "class" : w);
      else if (t === "}") stack.pop();
      else if (second && /^[A-Za-z][\w-]*$/.test(second) && (NODE_WORDS.has(w) || BLOCKS.includes(w))) ids.add(second);
      if (t.endsWith("{") && second && /^[A-Za-z][\w-]*$/.test(second) && w !== "describe") ids.add(second === "class" || second === "interface" ? t.split(/\s+/)[2] ?? second : second);
    }
    const top = stack[stack.length - 1];
    const idOptions = [...ids].sort().map((id) => option(id, "variable"));
    const ops = RELATIONS[type].map((r) => option(r.op, "operator", r.word));
    let options: Completion[] = [];

    if (top === "class" || top === "interface") return null;
    if (top === "describe") {
      if (tokens.length === 0) options = DESCRIBE_FIELDS.map((f) => option(f, "property", DESCRIBE_HELP[f]));
      else if (tokens[0] === "primary" || tokens[0] === "supporting") options = (doc?.nodes.filter((n) => n.kind === "actor") ?? []).map((n) => option(n.id, "variable", n.label ?? ""));
    } else if (top === "layout") {
      if (tokens.length === 0) options = LAYOUT.map((w) => option(w, "keyword"));
      else if (tokens.length === 1 || tokens.length === 3) options = idOptions;
      else if (tokens.length === 2 && ["route", "label", "style"].includes(tokens[0])) options = [...ops, ...["fill", "color", "weight"].map((w) => option(w, "keyword"))];
      else {
        const last = tokens[tokens.length - 1];
        if (last === "fill") options = ["none", "page", "wash"].map((w) => option(w, "enum"));
        else if (last === "color") options = ["ink", "ink-2", "accent", "accent-strong", "terra"].map((w) => option(w, "enum"));
        else if (last === "weight") options = ["thin", "normal", "bold"].map((w) => option(w, "enum"));
        else if (last === "from" || last === "to") options = ["top", "right", "bottom", "left"].map((w) => option(w, "enum"));
        else if (tokens[0] === "route") options = ["straight", "elbow", "from", "to", "via"].map((w) => option(w, "keyword"));
        else if (tokens[0] === "style") options = ["fill", "color", "weight"].map((w) => option(w, "keyword"));
      }
    } else if (tokens.length === 0) {
      if (line.number === 1 || !/^\s*diagram\b/m.test(ctx.state.doc.sliceString(0, line.from))) options = [option("diagram", "keyword", HEADER_HELP.diagram)];
      else {
        if (!body) options.push(...HEADER.filter((w) => w !== "diagram").map((w) => option(w, "keyword", HEADER_HELP[w])));
        const kinds: string[] = [...KINDS_FOR[type]].filter((k) => k !== "terminator" || type === "flowchart");
        const words = type === "class" ? ["class", "interface", "abstract class", "note"]
          : [...new Set([...(type === "use-case" ? [] : ["start", "end"]), ...kinds.filter((k) => k !== "initial" && k !== "final")])];
        options.push(...words.map((k) => option(k, "type", KIND_HELP[k.replace("abstract ", "")] ?? "")));
        options.push(option("step", "keyword", "everything after this appears at this build-up step"));
        if (type === "use-case") options.push(option("describe", "keyword", "a structured description of a use case"));
        options.push(option("layout", "keyword", "hand-set places, sizes, routes and styles", "layout {"));
        options.push(...idOptions);
      }
    } else if (tokens[0] === "diagram" && tokens.length === 1) options = TYPES.map((t) => option(t, "enum"));
    else if (tokens[0] === "profile" && tokens.length === 1) options = PROFILES.map((t) => option(t, "enum"));
    else if (tokens[0] === "direction" && tokens.length === 1) options = ["down", "right"].map((t) => option(t, "enum"));
    else if (tokens[0] === "look" && tokens.length === 1) options = ["sketch", "precision"].map((t) => option(t, "enum"));
    else if (tokens[0] === "lanes" && tokens.length === 1) options = ["vertical", "horizontal"].map((t) => option(t, "enum"));
    else if (tokens[0] === "describe" && tokens.length === 1) options = (doc?.nodes.filter((n) => n.kind === "use-case") ?? []).map((n) => option(n.id, "variable", n.label ?? ""));
    else if (ids.has(tokens[0]) && !NODE_WORDS.has(tokens[0])) {
      // an edge line: id, operator, id
      const hasOp = tokens.some((t) => OPS.test(t));
      if (!hasOp) options = ops;
      else if (!before.includes(" : ") && OPS.test(tokens[tokens.length - 1])) options = idOptions;
    } else if (NODE_WORDS.has(tokens[0]) && tokens.length >= 2) {
      options = [...(tokens[0] === "actor" ? ["left", "right"] : []), "at", "size"].map((w) => option(w, "keyword"));
    }
    if (!options.length) return null;
    return { from, options, validFor: /^[\w|>.<*-]*$/ };
  };
}
