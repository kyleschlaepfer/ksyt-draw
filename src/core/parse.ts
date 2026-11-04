/**
 * Parser for the KSyt diagram text format (.ksd): a port of reference/ksd_parse.py.
 *
 * Same regexes, same checks in the same order, same messages (including Python's repr quoting),
 * so every fixture in fixtures/diagrams/ parses to its .json and every input in
 * fixtures/parse-errors.json fails on the same line. Keep it a port.
 */
import type { Diagram, DiagramEdge, DiagramNode, DiagramType, EdgeKind, EdgeStyle, NodeKind, ParseWarning, Profile } from "./model";

const TYPES: readonly string[] = ["flowchart", "activity", "use-case"];
const PROFILES: readonly string[] = ["strict-uml", "uml-inspired", "general-diagram"];
const DEFAULT_PROFILE: Record<DiagramType, Profile> = {
  flowchart: "general-diagram", activity: "uml-inspired", "use-case": "uml-inspired",
};
const KINDS: readonly string[] = ["action", "process", "decision", "merge", "fork", "join", "initial", "final", "flow-final",
  "terminator", "io", "actor", "use-case", "note"];
const UNLABELED: readonly string[] = ["initial", "final", "flow-final", "fork", "join", "merge"];

interface EdgeSpec { kind: EdgeKind; style: EdgeStyle; directed: boolean; meaning?: string }
const EDGE_OPS: Array<[string, EdgeSpec]> = [
  ["-include->", { kind: "include", style: "dashed-arrow", directed: true }],
  ["-extend->", { kind: "extend", style: "dashed-arrow", directed: true }],
  ["..>", { kind: "arrow", style: "dashed-arrow", directed: true, meaning: "proposed" }],
  ["-->", { kind: "arrow", style: "solid-arrow", directed: true }],
  ["->", { kind: "arrow", style: "solid-arrow", directed: true }],
  ["--", { kind: "association", style: "plain-line", directed: false }],
];
const ID = "[A-Za-z][A-Za-z0-9_-]*";
const ID_RE = new RegExp(`^(?:${ID})$`);
const NODE_RE = new RegExp(`^(?<kind>[a-z-]+)\\s+(?<id>${ID})(?:\\s+"(?<label>(?:[^"\\\\]|\\\\.)*)")?(?<rest>.*)$`);
const EDGE_RE = new RegExp(`^(?<a>${ID})\\s+(?<op>-include->|-extend->|\\.\\.>|-->|->|--)\\s+(?<b>${ID})\\s*(?::\\s*(?<label>.*))?$`);
const BOUNDARY_RE = new RegExp(`^(${ID})\\s+"((?:[^"\\\\]|\\\\.)*)"\\s*\\{$`);
const NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const STEP_RE = /^[0-9]+$/;
const HEADER: readonly string[] = ["diagram", "id", "profile", "title", "desc", "narration", "direction", "legend"];

export class ParseError extends Error {
  constructor(public line: number, public msg: string) {
    super(`line ${line}: ${msg}`);
    this.name = "ParseError";
  }
}

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

function unquote(s: string): string {
  return s.split('\\"').join('"').split("\\n").join("\n").split("\\\\").join("\\");
}

function noEmDash(text: string | null | undefined, line: number): void {
  if (text && text.includes("\u2014")) throw new ParseError(line, `em dash in ${pyRepr(text)} (house rule: no em dashes)`);
}

/** Python str.splitlines() boundaries. */
function splitLines(src: string): string[] {
  const out = src.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (out.length && out[out.length - 1] === "" && /[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]$/.test(src)) out.pop();
  return out;
}

export function parse(src: string): Diagram {
  const dg: Diagram = {
    contract_version: "1.0", diagram_id: "diagram", claimed_diagram_type: null as unknown as DiagramType,
    notation_profile: null as unknown as Profile, narration_excerpt: "", legend: null, nodes: [], edges: [],
    web: { title: null as unknown as string, desc: "", direction: "down", warnings: [] },
  };
  let claimed: DiagramType | null = null;
  let profile: Profile | null = null;
  let title: string | null = null;
  const warnings: ParseWarning[] = [];
  const ids = new Set<string>();
  let step = 0;
  let boundary: string | null = null;
  let seenBody = false;
  const lines = splitLines(src);
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const word = line.split(/\s/, 1)[0];
    const val = line.slice(word.length).trim();
    if (claimed === null) {
      if (word !== "diagram") throw new ParseError(ln, "the first line must be: diagram flowchart | activity | use-case");
      if (!TYPES.includes(val)) throw new ParseError(ln, `unknown diagram type ${pyRepr(val)} (flowchart, activity, use-case)`);
      claimed = val as DiagramType;
      continue;
    }
    if (HEADER.includes(word) && !seenBody) {
      if (word === "diagram") throw new ParseError(ln, "diagram declared twice");
      if (word === "id") {
        if (!ID_RE.test(val)) throw new ParseError(ln, "id must be a slug (letters, digits, - or _)");
        dg.diagram_id = val;
      } else if (word === "profile") {
        if (!PROFILES.includes(val)) throw new ParseError(ln, `unknown profile ${pyRepr(val)}`);
        profile = val as Profile;
      } else if (word === "direction") {
        if (val !== "down" && val !== "right") throw new ParseError(ln, "direction is down or right");
        dg.web.direction = val;
      } else if (word === "narration") {
        noEmDash(val, ln);
        dg.narration_excerpt = (dg.narration_excerpt + " " + val).trim();
      } else if (word === "legend") {
        noEmDash(val, ln);
        dg.legend = val;
      } else {
        noEmDash(val, ln);
        if (word === "title") title = val;
        else dg.web.desc = val;
      }
      continue;
    }
    seenBody = true;
    if (line === "}") {
      if (boundary === null) throw new ParseError(ln, "} without an open boundary");
      boundary = null;
      continue;
    }
    if (word === "step") {
      if (!STEP_RE.test(val)) throw new ParseError(ln, "step takes a whole number");
      step = parseInt(val, 10);
      continue;
    }
    if (word === "boundary") {
      const m = BOUNDARY_RE.exec(val);
      if (!m) throw new ParseError(ln, 'boundary syntax: boundary <id> "title" {');
      if (boundary !== null) throw new ParseError(ln, "boundaries can't nest");
      const bid = m[1], btitle = unquote(m[2]);
      noEmDash(btitle, ln);
      if (ids.has(bid)) throw new ParseError(ln, `duplicate id ${pyRepr(bid)}`);
      ids.add(bid);
      dg.nodes.push({ id: bid, kind: "boundary", label: btitle, step });
      boundary = bid;
      continue;
    }
    const em = EDGE_RE.exec(line);
    if (em) {
      const g = em.groups!;
      const spec = EDGE_OPS.find(([op]) => op === g.op)![1];
      const label = (g.label || "").trim() || null;
      noEmDash(label, ln);
      const e: DiagramEdge = {
        id: `e${dg.edges.length + 1}`, kind: spec.kind, from: g.a, to: g.b, label, style: spec.style,
        directed: spec.directed, step,
      };
      if (spec.meaning !== undefined) e.meaning = spec.meaning;
      dg.edges.push(e);
      continue;
    }
    const nm = NODE_RE.exec(line);
    if (!nm) throw new ParseError(ln, "can't read this line");
    const g = nm.groups!;
    let kind: string = g.kind === "usecase" ? "use-case" : g.kind;
    let defaultLabel: string | null;
    if (kind === "start" || kind === "end") {
      if (claimed === "use-case") throw new ParseError(ln, "start/end don't exist in use-case diagrams");
      kind = claimed === "flowchart" ? "terminator" : kind === "start" ? "initial" : "final";
      defaultLabel = claimed === "flowchart" ? g.kind : null;
    } else {
      defaultLabel = "AUTO";
    }
    if (!KINDS.includes(kind)) throw new ParseError(ln, `unknown kind ${pyRepr(g.kind)}`);
    const nid = g.id;
    if (ids.has(nid)) throw new ParseError(ln, `duplicate id ${pyRepr(nid)}`);
    ids.add(nid);
    let label: string | null;
    if (g.label !== undefined) label = unquote(g.label);
    else if (defaultLabel === "AUTO") label = UNLABELED.includes(kind) ? null : nid.replace(/[-_]+/g, " ");
    else label = defaultLabel;
    noEmDash(label, ln);
    const node: DiagramNode = { id: nid, kind: kind as NodeKind, label, step };
    const rest = g.rest.trim() === "" ? [] : g.rest.trim().split(/\s+/);
    let k = 0;
    while (k < rest.length) {
      const tok = rest[k];
      if (tok === "left" || tok === "right") {
        node.side = tok;
        k += 1;
      } else if (tok === "at") {
        const nums = rest.slice(k + 1, k + 3);
        if (nums.length !== 2 || !nums.every((n) => NUM_RE.test(n))) {
          throw new ParseError(ln, "at takes two numbers in inches: at X Y");
        }
        node.at = [parseFloat(nums[0]), parseFloat(nums[1])];
        k += 3;
      } else {
        throw new ParseError(ln, `unknown option ${pyRepr(tok)} (left, right, at X Y)`);
      }
    }
    if (boundary !== null) node.inside = boundary;
    dg.nodes.push(node);
  }
  if (claimed === null) throw new ParseError(0, "empty diagram");
  if (boundary !== null) throw new ParseError(0, `boundary ${pyRepr(boundary)} is never closed with }`);
  if (!title) throw new ParseError(0, "a diagram needs a title: one line saying what it shows (its finding, not its topic)");
  dg.claimed_diagram_type = claimed;
  dg.notation_profile = profile ?? DEFAULT_PROFILE[claimed];
  dg.web.title = title;
  for (const e of dg.edges) {
    for (const end of ["from", "to"] as const) {
      if (!ids.has(e[end])) warnings.push({ code: "PARSE-UNKNOWN-NODE", edge: e.id, end, node: e[end] });
    }
  }
  dg.web.warnings = warnings;
  return dg;
}
