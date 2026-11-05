/**
 * .ksd text -> the canonical document, with a statement map and diagnostics.
 *
 * A superset of the v1 format (reference/ksd_parse.py, ported in ../parse.ts): every v1 file parses to
 * the same diagram, with the same messages on the same lines (test/doc-parse.test.ts checks both
 * against the fixtures). On top of v1 it reads partitions, classes with members, class relationships,
 * use-case descriptions and the managed `layout { }` block.
 *
 * Unlike v1 it does not stop at the first mistake: each bad line gets a diagnostic with a column
 * range and parsing goes on, so the editor can underline all of them. A document with any error has
 * `doc: null`; callers keep showing the last good one.
 */
import {
  CLASSIFIERS, DEFAULT_PROFILE, DESCRIBE_FIELDS, DESCRIBE_LIST, DOC_FORMAT, DOC_VERSION, PROFILES, TYPES, UNLABELED,
  defaultLabel, newUid,
  type ChalkDoc, type ColorRole, type DescribeField, type DiagramType, type DocEdge, type DocNode, type EdgeEnd, type EdgeKind,
  type FillRole, type Member, type NodeKind, type Profile, type Side, type UseCaseDoc, type Visibility, type Weight,
} from "./types";

export type DiagSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagSeverity;
  code: string;
  message: string;
  /** v1-compatible line: 1-based, or 0 for whole-file problems */
  line: number;
  /** where the editor underlines it: 1-based line, 0-based columns */
  at: { line: number; col: number; endCol: number };
  /** a node id or edge uid this is about, when there is one */
  ref?: string;
}

export type StmtKind =
  | "blank" | "comment" | "meta" | "step" | "decl" | "close" | "member" | "edge"
  | "describe-open" | "describe-field" | "describe-close"
  | "layout-open" | "layout-close" | "place" | "size" | "lane" | "pool" | "route" | "labelpos" | "style" | "bad";

export interface Stmt {
  /** 0-based line index */
  line: number;
  kind: StmtKind;
  /** uid of the node or edge this line belongs to */
  owner?: string;
  /** meta: the header word; describe-field: the field; member: its index */
  key?: string;
  /** nesting depth (blocks), for indentation */
  depth: number;
}

export interface ParsedSource {
  text: string;
  lines: string[];
  eol: "\n" | "\r\n";
  /** null when the text has an error */
  doc: ChalkDoc | null;
  stmts: Stmt[];
  diagnostics: Diagnostic[];
}

const KINDS: readonly string[] = ["action", "process", "decision", "merge", "fork", "join", "initial", "final", "flow-final",
  "terminator", "io", "actor", "use-case", "note"];
const HEADER: readonly string[] = ["diagram", "id", "profile", "title", "desc", "narration", "direction", "legend"];
const HEADER_V2: readonly string[] = ["lanes", "look"];
const SIDES: readonly string[] = ["top", "right", "bottom", "left"];
const COLORS: readonly string[] = ["ink", "ink-2", "accent", "accent-strong", "terra"];
const FILLS: readonly string[] = ["none", "page", "wash"];
const WEIGHTS: readonly string[] = ["thin", "normal", "bold"];

export const ID = "[A-Za-z][A-Za-z0-9_-]*";
const ID_RE = new RegExp(`^(?:${ID})$`);
const Q = `"((?:[^"\\\\]|\\\\.)*)"`;
const OPS = ["-include->", "-extend->", "..|>", "--|>", "<|--", "<|..", "..>", "-->", "->", "o--", "*--", "--o", "--*", "--"];
const OP_RE = OPS.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const NODE_RE = new RegExp(`^(?<kind>[a-z-]+)\\s+(?<id>${ID})(?:\\s+"(?<label>(?:[^"\\\\]|\\\\.)*)")?(?<rest>.*)$`);
const EDGE_RE = new RegExp(`^(?<a>${ID})\\s+(?:${Q}\\s+)?(?<op>${OP_RE})\\s+(?:${Q}\\s+)?(?<b>${ID})\\s*(?::\\s*(?<label>.*))?$`);
const BLOCK_RE = new RegExp(`^(${ID})\\s+${Q}\\s*\\{$`);
const CLASS_RE = new RegExp(`^(?<abs>abstract\\s+)?(?<kw>class|interface)\\s+(?<id>${ID})(?:\\s+"(?<label>(?:[^"\\\\]|\\\\.)*)")?(?<rest>.*)$`);
const REF_EDGE_RE = new RegExp(`^(?<a>${ID})\\s+(?<op>${OP_RE})\\s+(?<b>${ID})(?:\\s+#(?<n>[0-9]+))?(?<rest>.*)$`);
const NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const STEP_RE = /^[0-9]+$/;
const MULT_RE = /^(\*|[0-9]+(?:\.\.(?:[0-9]+|\*))?)(?:\s+(.*))?$/;

/** Python repr() of a str, for the messages that use %r. */
export function pyRepr(s: unknown): string {
  if (typeof s !== "string") return String(s === undefined ? null : s).replace(/^null$/, "None");
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + q;
}

export function unquote(s: string): string {
  return s.split('\\"').join('"').split("\\n").join("\n").split("\\\\").join("\\");
}

/** Python str.splitlines() boundaries. */
export function splitLines(src: string): string[] {
  const out = src.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (out.length && out[out.length - 1] === "" && /[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]$/.test(src)) out.pop();
  return out;
}

interface OpSpec { kind: EdgeKind; directed: boolean; meaning?: string; navigable?: boolean; flip?: boolean; classOnly?: boolean; notClass?: boolean }

/** What an operator means depends on the diagram type (`..>` is a proposed path in a flow, a dependency between classes). */
export function opSpec(op: string, type: DiagramType): OpSpec {
  const cls = type === "class";
  switch (op) {
    case "-include->": return { kind: "include", directed: true, notClass: true };
    case "-extend->": return { kind: "extend", directed: true, notClass: true };
    case "..>": return cls ? { kind: "dependency", directed: true } : { kind: "arrow", directed: true, meaning: "proposed" };
    case "-->": case "->": return cls ? { kind: "association", directed: true, navigable: true } : { kind: "arrow", directed: true };
    case "--": return { kind: "association", directed: false };
    case "--|>": return { kind: "generalization", directed: true, classOnly: true };
    case "<|--": return { kind: "generalization", directed: true, flip: true, classOnly: true };
    case "..|>": return { kind: "realization", directed: true, classOnly: true };
    case "<|..": return { kind: "realization", directed: true, flip: true, classOnly: true };
    case "o--": return { kind: "aggregation", directed: false, classOnly: true };
    case "--o": return { kind: "aggregation", directed: false, flip: true, classOnly: true };
    case "*--": return { kind: "composition", directed: false, classOnly: true };
    case "--*": return { kind: "composition", directed: false, flip: true, classOnly: true };
  }
  return { kind: "arrow", directed: true };
}

/** The key a layout line uses to point at an edge: from, kind (with the flags that change the operator), to. */
export function edgeKey(e: Pick<DocEdge, "from" | "to" | "kind" | "meaning" | "navigable">): string {
  return `${e.from}|${e.kind}${e.meaning === "proposed" ? "?" : ""}${e.navigable ? ">" : ""}|${e.to}`;
}

/** One class member line: `+ name: Type`, `- total: Money = 0`, `+ pay(amount: Money): Receipt {abstract}`. */
export function parseMember(text: string): Member | null {
  let s = text.trim();
  if (!s) return null;
  const m: Member = { kind: "attribute", name: "" };
  for (;;) {
    const mod = /\s*\{(static|abstract)\}\s*$/.exec(s) ?? /^\{(static|abstract)\}\s*/.exec(s);
    if (!mod) break;
    if (mod[1] === "static") m.static = true;
    else m.abstract = true;
    s = (s.slice(0, mod.index) + s.slice(mod.index + mod[0].length)).trim();
  }
  const vis = /^([+\-#~])\s*/.exec(s);
  if (vis) { m.visibility = vis[1] as Visibility; s = s.slice(vis[0].length); }
  const open = s.indexOf("(");
  if (open >= 0) {
    const close = s.lastIndexOf(")");
    if (close < open) return null;
    m.kind = "operation";
    m.name = s.slice(0, open).trim();
    m.params = s.slice(open + 1, close).trim();
    const after = s.slice(close + 1).trim();
    if (after) {
      if (!after.startsWith(":")) return null;
      m.type = after.slice(1).trim();
    }
  } else {
    const colon = s.indexOf(":");
    if (colon >= 0) { m.name = s.slice(0, colon).trim(); m.type = s.slice(colon + 1).trim(); }
    else m.name = s.trim();
  }
  if (!m.name || /\s/.test(m.name)) return null;
  if (m.type === "") delete m.type;
  return m;
}

function parseEnd(text: string | undefined): EdgeEnd | undefined {
  if (text === undefined) return undefined;
  const s = unquote(text).trim();
  if (!s) return undefined;
  const m = MULT_RE.exec(s);
  if (m) return m[2] ? { mult: m[1], role: m[2].trim() } : { mult: m[1] };
  return { role: s };
}

type Block =
  | { type: "container"; id: string; kind: "boundary" | "partition"; line: number; uid: string }
  | { type: "class"; uid: string; line: number; id: string }
  | { type: "describe"; uid: string | null; line: number; id: string; doc: UseCaseDoc }
  | { type: "layout"; line: number };

interface PendingLayout { stmt: Stmt; ln: number; apply: (doc: ChalkDoc, fail: (msg: string) => void) => void }

export function parseSource(text: string): ParsedSource {
  const lines = splitLines(text);
  const eol: "\n" | "\r\n" = /\r\n/.test(text) ? "\r\n" : "\n";
  const stmts: Stmt[] = [];
  const diagnostics: Diagnostic[] = [];
  const nodes: DocNode[] = [];
  const edges: DocEdge[] = [];
  const ids = new Set<string>();
  const byId = new Map<string, DocNode>();
  const pending: PendingLayout[] = [];
  const blocks: Block[] = [];
  let pool: ChalkDoc["pool"];

  let claimed: DiagramType | null = null;
  let profile: Profile | null = null;
  let title: string | null = null;
  let diagramId = "diagram";
  let desc = "", narration = "", legend: string | null = null;
  let direction: "down" | "right" = "down";
  let lanes: "vertical" | "horizontal" | undefined;
  let look: "sketch" | "precision" | undefined;
  let step = 0;
  let seenBody = false;
  let fatal = false;

  const rangeOf = (ln: number, needle?: string): { line: number; col: number; endCol: number } => {
    const raw = lines[ln - 1] ?? "";
    const start = raw.length - raw.trimStart().length;
    if (needle) {
      const i = raw.indexOf(needle);
      if (i >= 0) return { line: ln, col: i, endCol: i + needle.length };
    }
    return { line: ln, col: start, endCol: Math.max(start + 1, raw.trimEnd().length) };
  };
  const err = (ln: number, message: string, needle?: string, code = "PARSE"): void => {
    diagnostics.push({ severity: "error", code, message, line: ln, at: rangeOf(Math.max(1, ln), needle) });
  };
  const warn = (ln: number, code: string, message: string, needle?: string, ref?: string): void => {
    diagnostics.push({ severity: "warning", code, message, line: ln, at: rangeOf(Math.max(1, ln), needle), ...(ref ? { ref } : {}) });
  };
  /** returns true when the text is clean */
  const noEmDash = (t: string | null | undefined, ln: number): boolean => {
    if (t && t.includes("\u2014")) { err(ln, `em dash in ${pyRepr(t)} (house rule: no em dashes)`, "\u2014"); return false; }
    return true;
  };
  const container = (): Extract<Block, { type: "container" }> | null => {
    const b = blocks[blocks.length - 1];
    return b && b.type === "container" ? b : null;
  };
  const numbers = (toks: string[], n: number): number[] | null => {
    if (toks.length < n || !toks.slice(0, n).every((t) => NUM_RE.test(t))) return null;
    return toks.slice(0, n).map(parseFloat);
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const line = lines[i].trim();
    const depth = blocks.length;
    const push = (kind: StmtKind, extra: Partial<Stmt> = {}): Stmt => {
      const s: Stmt = { line: i, kind, depth, ...extra };
      stmts.push(s);
      return s;
    };
    if (!line) { push("blank"); continue; }
    // inside a class, #name is a protected member (UML); "# text" with a space is still a comment
    const inClass = blocks.length > 0 && blocks[blocks.length - 1].type === "class";
    if (line.startsWith("#") && !(inClass && /^#[A-Za-z_]/.test(line))) { push("comment"); continue; }
    const word = line.split(/\s/, 1)[0];
    const val = line.slice(word.length).trim();

    if (claimed === null) {
      if (word !== "diagram") { err(ln, "the first line must be: diagram flowchart | activity | use-case | class"); fatal = true; push("bad"); break; }
      if (!(TYPES as readonly string[]).includes(val)) {
        err(ln, `unknown diagram type ${pyRepr(val)} (flowchart, activity, use-case, class)`, val || undefined);
        fatal = true; push("bad"); break;
      }
      claimed = val as DiagramType;
      push("meta", { key: "diagram" });
      continue;
    }
    if ((HEADER.includes(word) || HEADER_V2.includes(word)) && !seenBody) {
      const s = push("meta", { key: word });
      if (word === "diagram") { err(ln, "diagram declared twice"); s.kind = "bad"; }
      else if (word === "id") {
        if (!ID_RE.test(val)) { err(ln, "id must be a slug (letters, digits, - or _)"); s.kind = "bad"; }
        else diagramId = val;
      } else if (word === "profile") {
        if (!(PROFILES as readonly string[]).includes(val)) { err(ln, `unknown profile ${pyRepr(val)}`, val || undefined); s.kind = "bad"; }
        else profile = val as Profile;
      } else if (word === "direction") {
        if (val !== "down" && val !== "right") { err(ln, "direction is down or right"); s.kind = "bad"; }
        else direction = val;
      } else if (word === "lanes") {
        if (val !== "vertical" && val !== "horizontal") { err(ln, "lanes is vertical or horizontal"); s.kind = "bad"; }
        else lanes = val;
      } else if (word === "look") {
        if (val !== "sketch" && val !== "precision") { err(ln, "look is sketch or precision"); s.kind = "bad"; }
        else look = val;
      } else if (word === "narration") {
        if (noEmDash(val, ln)) narration = (narration + " " + val).trim();
      } else if (word === "legend") {
        if (noEmDash(val, ln)) legend = val;
      } else if (noEmDash(val, ln)) {
        if (word === "title") title = val;
        else desc = val;
      }
      continue;
    }
    seenBody = true;
    const top = blocks[blocks.length - 1];

    // ---- inside a class block: members until the closing brace
    if (top && top.type === "class") {
      if (line === "}") { blocks.pop(); push("close", { owner: top.uid, depth: depth - 1 }); continue; }
      const node = nodes.find((n) => n.uid === top.uid)!;
      if (!noEmDash(line, ln)) { push("bad"); continue; }
      const m = parseMember(line);
      if (!m) { err(ln, "can't read this member: write + name: Type or + name(params): Type"); push("bad"); continue; }
      node.members = node.members ?? [];
      node.members.push(m);
      push("member", { owner: top.uid, key: String(node.members.length - 1) });
      continue;
    }
    // ---- inside a describe block: one field per line
    if (top && top.type === "describe") {
      if (line === "}") {
        blocks.pop();
        push("describe-close", { owner: top.uid ?? undefined, depth: depth - 1 });
        const target = byId.get(top.id);
        if (target) target.describe = top.doc;
        continue;
      }
      if (!(DESCRIBE_FIELDS as readonly string[]).includes(word)) {
        err(ln, `unknown description field ${pyRepr(word)} (${DESCRIBE_FIELDS.join(", ")})`, word);
        push("bad"); continue;
      }
      if (!noEmDash(val, ln)) { push("bad"); continue; }
      if (!val) { err(ln, `${word} needs some text after it`); push("bad"); continue; }
      const f = word as DescribeField;
      if (DESCRIBE_LIST.has(f)) {
        const list = (top.doc[f] as string[] | undefined) ?? [];
        list.push(val);
        (top.doc as Record<string, unknown>)[f] = list;
      } else (top.doc as Record<string, unknown>)[f] = val;
      push("describe-field", { owner: top.uid ?? undefined, key: f });
      continue;
    }
    // ---- inside the layout block: geometry and style the draw view manages
    if (top && top.type === "layout") {
      if (line === "}") { blocks.pop(); push("layout-close", { depth: depth - 1 }); continue; }
      const toks = val === "" ? [] : val.split(/\s+/);
      if (word === "pool") {
        const p: NonNullable<ChalkDoc["pool"]> = {};
        let k = 0, ok = true;
        while (k < toks.length && ok) {
          if (toks[k] === "at") {
            const n = numbers(toks.slice(k + 1), 2);
            if (!n) ok = false; else { p.x = n[0]; p.y = n[1]; k += 3; }
          } else if (toks[k] === "length") {
            const n = numbers(toks.slice(k + 1), 1);
            if (!n || n[0] <= 0) ok = false; else { p.length = n[0]; k += 2; }
          } else ok = false;
        }
        if (!ok) { err(ln, "pool syntax: pool [at X Y] [length L]"); push("bad"); continue; }
        pool = p;
        push("pool");
        continue;
      }
      if (word === "place" || word === "size" || word === "lane") {
        const id = toks[0];
        const want = word === "lane" ? 1 : 2;
        const n = id && ID_RE.test(id) ? numbers(toks.slice(1), want) : null;
        if (!n || toks.length !== want + 1 || (word !== "place" && n.some((v) => v <= 0))) {
          err(ln, word === "place" ? "place syntax: place <id> X Y" : word === "size" ? "size syntax: size <id> W H" : "lane syntax: lane <id> <thickness>");
          push("bad"); continue;
        }
        const s = push(word);
        pending.push({ stmt: s, ln, apply: (doc, fail) => {
          const node = doc.nodes.find((x) => x.id === id);
          if (!node) return fail(`layout names ${pyRepr(id)}, which isn't declared`);
          s.owner = node.uid;
          if (word === "place") {
            if (node.place) return fail(`${id} is placed twice`);
            node.place = { x: n[0], y: n[1] };
          } else if (word === "size") node.size = { w: n[0], h: n[1] };
          else if (node.kind !== "partition") return fail(`${id} is not a partition`);
          else node.thickness = n[0];
        } });
        continue;
      }
      if (word === "route" || word === "label" || word === "style") {
        const em = REF_EDGE_RE.exec(val);
        if (em) {
          const g = em.groups!;
          const spec = opSpec(g.op, claimed);
          const from = spec.flip ? g.b : g.a, to = spec.flip ? g.a : g.b;
          const key = edgeKey({ from, to, kind: spec.kind, meaning: spec.meaning, navigable: spec.navigable });
          const nth = g.n ? parseInt(g.n, 10) : 1;
          const rest = g.rest.trim() === "" ? [] : g.rest.trim().split(/\s+/);
          const find = (doc: ChalkDoc): DocEdge | undefined => doc.edges.filter((e) => edgeKey(e) === key)[nth - 1];
          const missing = `layout names the line ${g.a} ${g.op} ${g.b}${g.n ? ` #${g.n}` : ""}, which isn't declared`;
          if (word === "route") {
            const kind = rest[0];
            if (kind !== "straight" && kind !== "elbow") { err(ln, "route syntax: route a -> b straight|elbow [from <side>] [to <side>] [via X Y, X Y]"); push("bad"); continue; }
            const route: NonNullable<DocEdge["route"]> = { kind };
            let k = 1, ok = true;
            while (k < rest.length && ok) {
              if ((rest[k] === "from" || rest[k] === "to") && SIDES.includes(rest[k + 1])) { route[rest[k] as "from" | "to"] = rest[k + 1] as Side; k += 2; }
              else if (rest[k] === "via") {
                const pts = rest.slice(k + 1).join(" ").split(",").map((p) => p.trim().split(/\s+/));
                if (!pts.length || !pts.every((p) => p.length === 2 && p.every((t) => NUM_RE.test(t)))) ok = false;
                else route.via = pts.map((p) => [parseFloat(p[0]), parseFloat(p[1])] as [number, number]);
                k = rest.length;
              } else ok = false;
            }
            if (!ok) { err(ln, "route syntax: route a -> b straight|elbow [from <side>] [to <side>] [via X Y, X Y]"); push("bad"); continue; }
            const s = push("route");
            pending.push({ stmt: s, ln, apply: (doc, fail) => { const e = find(doc); if (!e) return fail(missing); s.owner = e.uid; e.route = route; } });
          } else if (word === "label") {
            const n = numbers(rest, 3);
            if (!n || rest.length !== 3) { err(ln, "label syntax: label a -> b <t> <dx> <dy>"); push("bad"); continue; }
            const s = push("labelpos");
            pending.push({ stmt: s, ln, apply: (doc, fail) => {
              const e = find(doc); if (!e) return fail(missing);
              s.owner = e.uid; e.labelPos = { t: Math.max(0, Math.min(1, n[0])), dx: n[1], dy: n[2] };
            } });
          } else {
            const st: NonNullable<DocEdge["style"]> = {};
            let ok = rest.length > 0 && rest.length % 2 === 0;
            for (let k = 0; ok && k < rest.length; k += 2) {
              if (rest[k] === "color" && COLORS.includes(rest[k + 1])) st.color = rest[k + 1] as ColorRole;
              else if (rest[k] === "weight" && WEIGHTS.includes(rest[k + 1])) st.weight = rest[k + 1] as Weight;
              else ok = false;
            }
            if (!ok) { err(ln, "line style syntax: style a -> b [color ink|ink-2|accent|accent-strong|terra] [weight thin|normal|bold]"); push("bad"); continue; }
            const s = push("style");
            pending.push({ stmt: s, ln, apply: (doc, fail) => { const e = find(doc); if (!e) return fail(missing); s.owner = e.uid; e.style = st; } });
          }
          continue;
        }
        if (word === "style" && toks.length >= 3 && ID_RE.test(toks[0])) {
          const id = toks[0];
          const st: NonNullable<DocNode["style"]> = {};
          const rest = toks.slice(1);
          let ok = rest.length % 2 === 0;
          for (let k = 0; ok && k < rest.length; k += 2) {
            if (rest[k] === "fill" && FILLS.includes(rest[k + 1])) st.fill = rest[k + 1] as FillRole;
            else if (rest[k] === "color" && COLORS.includes(rest[k + 1])) st.color = rest[k + 1] as ColorRole;
            else if (rest[k] === "weight" && WEIGHTS.includes(rest[k + 1])) st.weight = rest[k + 1] as Weight;
            else ok = false;
          }
          if (ok) {
            const s = push("style");
            pending.push({ stmt: s, ln, apply: (doc, fail) => {
              const node = doc.nodes.find((x) => x.id === id);
              if (!node) return fail(`layout names ${pyRepr(id)}, which isn't declared`);
              s.owner = node.uid; node.style = st;
            } });
            continue;
          }
        }
        err(ln, word === "style"
          ? "style syntax: style <id> [fill none|page|wash] [color ...] [weight thin|normal|bold]"
          : `${word} syntax: ${word} a -> b ...`);
        push("bad");
        continue;
      }
      err(ln, `unknown layout line ${pyRepr(word)} (place, size, lane, pool, route, label, style)`, word);
      push("bad");
      continue;
    }

    // ---- the body
    if (line === "}") {
      const b = blocks.pop();
      if (!b) { err(ln, "} without an open boundary"); push("bad"); continue; }
      push("close", { owner: (b as { uid: string }).uid, depth: depth - 1 });
      continue;
    }
    if (word === "step") {
      if (!STEP_RE.test(val)) { err(ln, "step takes a whole number"); push("bad"); continue; }
      step = parseInt(val, 10);
      push("step");
      continue;
    }
    if (word === "boundary") {
      const m = BLOCK_RE.exec(val);
      if (!m) { err(ln, 'boundary syntax: boundary <id> "title" {'); push("bad"); continue; }
      if (container()) { err(ln, "boundaries can't nest"); push("bad"); blocks.push({ type: "container", id: m[1], kind: "boundary", line: ln, uid: "" }); continue; }
      const bid = m[1], btitle = unquote(m[2]);
      if (!noEmDash(btitle, ln)) { push("bad"); blocks.push({ type: "container", id: bid, kind: "boundary", line: ln, uid: "" }); continue; }
      const uid = newUid();
      if (ids.has(bid)) { err(ln, `duplicate id ${pyRepr(bid)}`, bid); push("bad"); }
      else {
        ids.add(bid);
        const node: DocNode = { uid, id: bid, kind: "boundary", label: btitle, step };
        nodes.push(node); byId.set(bid, node);
        push("decl", { owner: uid });
      }
      blocks.push({ type: "container", id: bid, kind: "boundary", line: ln, uid });
      continue;
    }
    const em = EDGE_RE.exec(line);
    if (em) {
      const g = em.groups!;
      // groups 2 and 4 are the quoted end adornments (unnamed, because Q is reused)
      const endA = em[2], endB = em[4];
      const spec = opSpec(g.op, claimed);
      if (spec.classOnly && claimed !== "class") { err(ln, `${g.op} belongs to class diagrams`, g.op); push("bad"); continue; }
      if (spec.notClass && claimed === "class") { err(ln, `${g.op} belongs to use-case diagrams`, g.op); push("bad"); continue; }
      if ((endA !== undefined || endB !== undefined) && claimed !== "class") {
        err(ln, "multiplicities and role names at a line's ends belong to class diagrams"); push("bad"); continue;
      }
      const label = (g.label || "").trim() || null;
      if (!noEmDash(label, ln) || !noEmDash(endA, ln) || !noEmDash(endB, ln)) { push("bad"); continue; }
      const from = spec.flip ? g.b : g.a, to = spec.flip ? g.a : g.b;
      const e: DocEdge = { uid: newUid("e"), id: `e${edges.length + 1}`, kind: spec.kind, from, to, label, directed: spec.directed, step };
      if (spec.meaning !== undefined) e.meaning = spec.meaning;
      if (spec.navigable) e.navigable = true;
      const ea = parseEnd(spec.flip ? endB : endA), eb = parseEnd(spec.flip ? endA : endB);
      if (ea || eb) e.ends = { ...(ea ? { from: ea } : {}), ...(eb ? { to: eb } : {}) };
      edges.push(e);
      push("edge", { owner: e.uid });
      continue;
    }
    if (word === "partition" || word === "lane" || word === "swimlane") {
      const m = BLOCK_RE.exec(val);
      if (!m) { err(ln, 'partition syntax: partition <id> "name" {'); push("bad"); continue; }
      if (claimed !== "activity" && claimed !== "flowchart") {
        err(ln, "partitions belong to activity diagrams and flowcharts", word); push("bad");
        blocks.push({ type: "container", id: m[1], kind: "partition", line: ln, uid: "" }); continue;
      }
      if (container()) { err(ln, "partitions can't nest"); push("bad"); blocks.push({ type: "container", id: m[1], kind: "partition", line: ln, uid: "" }); continue; }
      const pid = m[1], ptitle = unquote(m[2]);
      if (!noEmDash(ptitle, ln)) { push("bad"); blocks.push({ type: "container", id: pid, kind: "partition", line: ln, uid: "" }); continue; }
      const uid = newUid();
      if (ids.has(pid)) { err(ln, `duplicate id ${pyRepr(pid)}`, pid); push("bad"); }
      else {
        ids.add(pid);
        const node: DocNode = { uid, id: pid, kind: "partition", label: ptitle, step };
        nodes.push(node); byId.set(pid, node);
        push("decl", { owner: uid });
      }
      blocks.push({ type: "container", id: pid, kind: "partition", line: ln, uid });
      continue;
    }
    if (word === "layout" && val === "{") {
      if (blocks.length) { err(ln, "the layout block can't sit inside another block"); push("bad"); }
      else push("layout-open");
      blocks.push({ type: "layout", line: ln });
      continue;
    }
    if (word === "describe") {
      const m = new RegExp(`^(${ID})\\s*\\{$`).exec(val);
      if (!m) { err(ln, "describe syntax: describe <use-case id> {"); push("bad"); continue; }
      if (claimed !== "use-case") { err(ln, "describe belongs to use-case diagrams", word); push("bad"); blocks.push({ type: "describe", uid: null, line: ln, id: m[1], doc: {} }); continue; }
      const target = byId.get(m[1]);
      if (!target) { err(ln, `describe names ${pyRepr(m[1])}, which isn't declared above it`, m[1]); push("bad"); }
      else if (target.kind !== "use-case") { err(ln, `${m[1]} is not a use case`, m[1]); push("bad"); }
      else if (target.describe) { err(ln, `${m[1]} is described twice`, m[1]); push("bad"); }
      else push("describe-open", { owner: target.uid });
      const usable = !!target && target.kind === "use-case" && !target.describe;
      blocks.push({ type: "describe", uid: usable ? target!.uid : null, line: ln, id: usable ? m[1] : "", doc: {} });
      continue;
    }
    const cm = claimed === "class" ? CLASS_RE.exec(line) : null;
    if (cm) {
      const g = cm.groups!;
      const kind: NodeKind = g.kw === "interface" ? "interface" : "class";
      let rest = g.rest.trim();
      const opens = rest.endsWith("{");
      if (opens) rest = rest.slice(0, -1).trim();
      const node: DocNode = { uid: newUid(), id: g.id, kind, label: g.label !== undefined ? unquote(g.label) : g.id, step };
      if (g.abs) node.abstract = true;
      let ok = noEmDash(node.label, ln);
      const st = /^(?:<<|\u00ab)\s*([^>\u00bb]+?)\s*(?:>>|\u00bb)\s*/.exec(rest);
      if (st) { node.stereotype = st[1]; rest = rest.slice(st[0].length).trim(); ok = noEmDash(node.stereotype, ln) && ok; }
      const toks = rest === "" ? [] : rest.split(/\s+/);
      let k = 0;
      while (ok && k < toks.length) {
        if (toks[k] === "at") {
          const n = numbers(toks.slice(k + 1), 2);
          if (!n) { err(ln, "at takes two numbers in inches: at X Y"); ok = false; } else { node.place = { x: n[0], y: n[1] }; node.inline = true; k += 3; }
        } else if (toks[k] === "size") {
          const n = numbers(toks.slice(k + 1), 2);
          if (!n || n.some((v) => v <= 0)) { err(ln, "size takes two numbers in inches: size W H"); ok = false; } else { node.size = { w: n[0], h: n[1] }; node.inline = true; k += 3; }
        } else { err(ln, `unknown option ${pyRepr(toks[k])} (<<stereotype>>, at X Y, size W H)`, toks[k]); ok = false; }
      }
      if (ok && ids.has(g.id)) { err(ln, `duplicate id ${pyRepr(g.id)}`, g.id); ok = false; }
      if (ok) {
        ids.add(g.id);
        nodes.push(node); byId.set(g.id, node);
        push("decl", { owner: node.uid });
      } else push("bad");
      if (opens) blocks.push({ type: "class", uid: ok ? node.uid : "", line: ln, id: g.id });
      if (opens && !ok) nodes.push({ ...node, uid: "", id: "" }); // a sink for the members of a bad block, dropped below
      continue;
    }
    const nm = NODE_RE.exec(line);
    if (!nm) { err(ln, "can't read this line"); push("bad"); continue; }
    const g = nm.groups!;
    let kind: string = g.kind === "usecase" ? "use-case" : g.kind;
    let dflt: string | null | undefined;
    if (kind === "start" || kind === "end") {
      if (claimed === "use-case" || claimed === "class") {
        err(ln, claimed === "class" ? "start/end don't exist in class diagrams" : "start/end don't exist in use-case diagrams", g.kind);
        push("bad"); continue;
      }
      kind = claimed === "flowchart" ? "terminator" : kind === "start" ? "initial" : "final";
      dflt = claimed === "flowchart" ? g.kind : null;
    }
    if (!KINDS.includes(kind)) {
      err(ln, `unknown kind ${pyRepr(g.kind)}`, g.kind);
      push("bad"); continue;
    }
    const nid = g.id;
    if (ids.has(nid)) { err(ln, `duplicate id ${pyRepr(nid)}`, nid); push("bad"); continue; }
    let label: string | null;
    if (g.label !== undefined) label = unquote(g.label);
    else if (dflt !== undefined) label = dflt;
    else label = UNLABELED.has(kind) ? null : nid.replace(/[-_]+/g, " ");
    if (!noEmDash(label, ln)) { push("bad"); continue; }
    const node: DocNode = { uid: newUid(), id: nid, kind: kind as NodeKind, label, step };
    const rest = g.rest.trim() === "" ? [] : g.rest.trim().split(/\s+/);
    let k = 0, ok = true;
    while (k < rest.length) {
      const tok = rest[k];
      if (tok === "left" || tok === "right") { node.side = tok; k += 1; }
      else if (tok === "at") {
        const n = numbers(rest.slice(k + 1), 2);
        if (!n) { err(ln, "at takes two numbers in inches: at X Y"); ok = false; break; }
        node.place = { x: n[0], y: n[1] }; node.inline = true; k += 3;
      } else if (tok === "size") {
        const n = numbers(rest.slice(k + 1), 2);
        if (!n || n.some((v) => v <= 0)) { err(ln, "size takes two numbers in inches: size W H"); ok = false; break; }
        node.size = { w: n[0], h: n[1] }; node.inline = true; k += 3;
      } else { err(ln, `unknown option ${pyRepr(tok)} (left, right, at X Y)`, tok); ok = false; break; }
    }
    if (!ok) { push("bad"); continue; }
    const c = container();
    if (c && c.uid) node.parent = c.id;
    ids.add(nid);
    nodes.push(node); byId.set(nid, node);
    push("decl", { owner: node.uid });
  }

  const realNodes = nodes.filter((n) => n.uid !== "");
  if (!fatal) {
    if (claimed === null) diagnostics.push({ severity: "error", code: "PARSE", message: "empty diagram", line: 0, at: { line: 1, col: 0, endCol: 1 } });
    for (const b of blocks) {
      const what = b.type === "container" ? `${b.kind} ${pyRepr(b.id)}` : b.type === "class" ? `class ${pyRepr(b.id)}` : b.type === "describe" ? "describe" : "layout";
      diagnostics.push({ severity: "error", code: "PARSE", message: `${what} is never closed with }`, line: 0, at: rangeOf(b.line) });
    }
    if (claimed !== null && !title) {
      diagnostics.push({
        severity: "error", code: "PARSE", message: "a diagram needs a title: one line saying what it shows (its finding, not its topic)",
        line: 0, at: rangeOf(1),
      });
    }
  }

  let doc: ChalkDoc | null = null;
  if (claimed !== null && title && !diagnostics.some((d) => d.severity === "error")) {
    doc = {
      format: DOC_FORMAT, version: DOC_VERSION,
      meta: {
        id: diagramId, type: claimed, profile: profile ?? DEFAULT_PROFILE[claimed], title, desc, narration, legend, direction,
        ...(lanes ? { lanes } : {}), ...(look ? { look } : {}),
      },
      nodes: realNodes, edges,
      ...(pool ? { pool } : {}),
    };
    for (const p of pending) {
      p.apply(doc, (msg) => {
        diagnostics.push({ severity: "warning", code: "LAYOUT-UNKNOWN-REF", message: `${msg}; the line is kept but does nothing`, line: p.ln, at: rangeOf(p.ln) });
      });
    }
    for (const e of doc.edges) {
      const row = stmts.find((s) => s.kind === "edge" && s.owner === e.uid)!;
      for (const end of ["from", "to"] as const) {
        if (!ids.has(e[end])) warn(row.line + 1, "PARSE-UNKNOWN-NODE", `${pyRepr(e[end])} isn't declared, so this line has a loose end`, e[end], e.uid);
      }
    }
  }
  return { text, lines, eol, doc, stmts, diagnostics };
}

/** The first error, in v1's shape (line 0 for whole-file problems). */
export function firstError(p: ParsedSource): Diagnostic | null {
  return p.diagnostics.find((d) => d.severity === "error") ?? null;
}

export class ParseError extends Error {
  constructor(public line: number, public msg: string) {
    super(`line ${line}: ${msg}`);
    this.name = "ParseError";
  }
}

/** Parse or throw the first error, for callers that only want a document. */
export function parseDoc(text: string): ChalkDoc {
  const p = parseSource(text);
  const e = firstError(p);
  if (e || !p.doc) throw new ParseError(e?.line ?? 0, e?.message ?? "empty diagram");
  return p.doc;
}

/**
 * Give a freshly parsed document the identities of the one it replaces: nodes match by id, lines by
 * their ends and kind (the n-th of several). Selection, undo and saved state survive a re-parse.
 */
export function adoptUids(p: ParsedSource, from: ChalkDoc | null): ParsedSource {
  if (!p.doc || !from) return p;
  const map = new Map<string, string>();
  const nodeUid = new Map(from.nodes.map((n) => [n.id, n.uid]));
  for (const n of p.doc.nodes) {
    const u = nodeUid.get(n.id);
    if (u) { map.set(n.uid, u); n.uid = u; }
  }
  const pools = new Map<string, string[]>();
  for (const e of from.edges) {
    const k = edgeKey(e);
    const a = pools.get(k) ?? [];
    a.push(e.uid);
    pools.set(k, a);
  }
  for (const e of p.doc.edges) {
    const u = pools.get(edgeKey(e))?.shift();
    if (u) { map.set(e.uid, u); e.uid = u; }
  }
  for (const s of p.stmts) if (s.owner && map.has(s.owner)) s.owner = map.get(s.owner);
  for (const d of p.diagnostics) if (d.ref && map.has(d.ref)) d.ref = map.get(d.ref);
  return p;
}

export { CLASSIFIERS, defaultLabel };
