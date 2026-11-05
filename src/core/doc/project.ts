/**
 * The native project file (.chalk.json): the diagram text, the document model parsed from it, and
 * the workspace state that isn't part of the diagram (the draw view's viewport, export settings).
 *
 * The .ksd text is complete on its own: everything Write and Draw can express, including hand-set
 * positions, sizes, routes, label positions and styles, is in it. The project file adds the model as
 * inspectable JSON (for other tools, and so identities survive a save) and the workspace.
 *
 * Reading is defensive: a project file is untrusted input. The text is always re-parsed by the same
 * parser as anything typed; if the text is missing or broken, the model is validated field by field
 * and printed back to text. Nothing from the file is used without going through one of those two.
 */
import { parseSource, type ParsedSource } from "./parse";
import { printDoc } from "./print";
import {
  DOC_FORMAT, DOC_VERSION, PROFILES, TYPES, newUid,
  type ChalkDoc, type DocEdge, type DocNode, type EdgeKind, type Member, type NodeKind, type UseCaseDoc,
} from "./types";

export const PROJECT_FORMAT = "chalk-project";
export const PROJECT_VERSION = 2;

export interface Workspace {
  view?: { x: number; y: number; zoom: number };
  export?: Record<string, string | number | boolean>;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  app: string;
  savedAt: string;
  /** the .ksd text: authoritative, with the author's comments and formatting */
  source: string;
  /** the canonical document parsed from the text, for inspection and other tools */
  model: ChalkDoc;
  workspace?: Workspace;
}

export function toProject(parsed: ParsedSource, workspace: Workspace = {}, savedAt = new Date().toISOString()): ProjectFile {
  if (!parsed.doc) throw new Error("only a valid diagram can be saved as a project");
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, app: "Chalk", savedAt, source: parsed.text, model: parsed.doc, workspace };
}

export class ProjectError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 4000): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e5 ? v : undefined);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** An identity from a file is kept only if it looks like one of ours and no other element has it. */
const UID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NODE_KINDS: readonly string[] = ["action", "process", "decision", "merge", "fork", "join", "initial", "final", "flow-final", "terminator", "io",
  "actor", "use-case", "note", "boundary", "partition", "class", "interface"];
const EDGE_KINDS: readonly string[] = ["arrow", "association", "include", "extend", "generalization", "realization", "dependency", "aggregation", "composition"];
const SIDES: readonly string[] = ["top", "right", "bottom", "left"];
const COLORS: readonly string[] = ["ink", "ink-2", "accent", "accent-strong", "terra"];
const FILLS: readonly string[] = ["none", "page", "wash"];
const WEIGHTS: readonly string[] = ["thin", "normal", "bold"];
const pick = <T extends string>(v: unknown, allowed: readonly string[]): T | undefined => (typeof v === "string" && allowed.includes(v) ? (v as T) : undefined);

/** Rebuild a document from untrusted JSON, keeping only fields of the right type. Throws when it isn't a document at all. */
export function sanitizeDoc(raw: unknown): ChalkDoc {
  if (!isObj(raw) || !isObj(raw.meta) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new ProjectError("this file doesn't hold a diagram");
  const m = raw.meta;
  const type = pick<ChalkDoc["meta"]["type"]>(m.type, TYPES);
  const title = str(m.title);
  if (!type || !title) throw new ProjectError("the diagram in this file has no type or title");
  const doc: ChalkDoc = {
    format: DOC_FORMAT, version: DOC_VERSION,
    meta: {
      id: str(m.id) && ID_RE.test(m.id as string) ? (m.id as string) : "diagram", type,
      profile: pick(m.profile, PROFILES) ?? (type === "flowchart" ? "general-diagram" : "uml-inspired"),
      title, desc: str(m.desc) ?? "", narration: str(m.narration) ?? "", legend: str(m.legend) ?? null,
      direction: m.direction === "right" ? "right" : "down",
      ...(m.lanes === "vertical" || m.lanes === "horizontal" ? { lanes: m.lanes } : {}),
      ...(m.look === "sketch" || m.look === "precision" ? { look: m.look } : {}),
    },
    nodes: [], edges: [],
  };
  const ids = new Set<string>(), uids = new Set<string>();
  const uidOf = (v: unknown, prefix?: "n" | "e"): string => {
    const u = str(v, 40);
    const out = u && UID_RE.test(u) && !uids.has(u) ? u : newUid(prefix);
    uids.add(out);
    return out;
  };
  for (const r of raw.nodes as unknown[]) {
    if (!isObj(r)) continue;
    const id = str(r.id, 80), kind = pick<NodeKind>(r.kind, NODE_KINDS);
    if (!id || !ID_RE.test(id) || !kind || ids.has(id)) continue;
    // kinds the text format only allows in their own diagram type
    if ((kind === "class" || kind === "interface") && type !== "class") continue;
    if (kind === "partition" && type !== "activity" && type !== "flowchart") continue;
    ids.add(id);
    const n: DocNode = { uid: uidOf(r.uid), id, kind, label: r.label === null ? null : str(r.label) ?? null, step: Math.max(0, Math.trunc(num(r.step) ?? 0)) };
    const parent = str(r.parent, 80);
    if (parent && ID_RE.test(parent)) n.parent = parent;
    if (r.side === "left" || r.side === "right") n.side = r.side;
    if (isObj(r.place) && num(r.place.x) !== undefined && num(r.place.y) !== undefined) n.place = { x: num(r.place.x)!, y: num(r.place.y)! };
    if (isObj(r.size) && (num(r.size.w) ?? 0) > 0 && (num(r.size.h) ?? 0) > 0) n.size = { w: num(r.size.w)!, h: num(r.size.h)! };
    if ((num(r.thickness) ?? 0) > 0) n.thickness = num(r.thickness)!;
    if (isObj(r.style)) {
      const st = { ...(pick(r.style.fill, FILLS) ? { fill: pick(r.style.fill, FILLS) } : {}), ...(pick(r.style.color, COLORS) ? { color: pick(r.style.color, COLORS) } : {}), ...(pick(r.style.weight, WEIGHTS) ? { weight: pick(r.style.weight, WEIGHTS) } : {}) };
      if (Object.keys(st).length) n.style = st as DocNode["style"];
    }
    const stereo = str(r.stereotype, 80);
    if (stereo && !/[<>«»\n]/.test(stereo)) n.stereotype = stereo;
    if (r.abstract === true) n.abstract = true;
    if (Array.isArray(r.members)) {
      const ms: Member[] = [];
      for (const x of r.members as unknown[]) {
        if (!isObj(x)) continue;
        const name = str(x.name, 200);
        if (!name || /\s/.test(name)) continue;
        const mm: Member = { kind: x.kind === "operation" ? "operation" : "attribute", name };
        if (pick(x.visibility, ["+", "-", "#", "~"])) mm.visibility = x.visibility as Member["visibility"];
        const params = str(x.params, 400), ty = str(x.type, 200);
        if (mm.kind === "operation") mm.params = (params ?? "").replace(/\n/g, " ");
        if (ty) mm.type = ty.replace(/\n/g, " ");
        if (x.static === true) mm.static = true;
        if (x.abstract === true) mm.abstract = true;
        ms.push(mm);
      }
      if (ms.length) n.members = ms;
    }
    if (isObj(r.describe)) {
      const u: UseCaseDoc = {};
      const line = (v: unknown): string | undefined => str(v)?.replace(/\s+/g, " ").trim() || undefined;
      for (const k of ["goal", "primary", "trigger"] as const) { const v = line(r.describe[k]); if (v) u[k] = v; }
      for (const k of ["supporting", "pre", "main", "alt", "post", "related"] as const) {
        const a = r.describe[k];
        if (Array.isArray(a)) { const list = a.map(line).filter((s): s is string => !!s); if (list.length) u[k] = list; }
      }
      if (Object.keys(u).length) n.describe = u;
    }
    doc.nodes.push(n);
  }
  for (const r of raw.edges as unknown[]) {
    if (!isObj(r)) continue;
    const kind = pick<EdgeKind>(r.kind, EDGE_KINDS), from = str(r.from, 80), to = str(r.to, 80);
    if (!kind || !from || !to || !ID_RE.test(from) || !ID_RE.test(to)) continue;
    const classOnly = ["generalization", "realization", "dependency", "aggregation", "composition"].includes(kind);
    if ((classOnly && type !== "class") || ((kind === "include" || kind === "extend" || kind === "arrow") && type === "class")) continue;
    const e: DocEdge = {
      uid: uidOf(r.uid, "e"), id: `e${doc.edges.length + 1}`, kind, from, to,
      label: str(r.label)?.replace(/\s+/g, " ").trim() || null, directed: r.directed !== false, step: Math.max(0, Math.trunc(num(r.step) ?? 0)),
    };
    if (kind === "arrow" && r.meaning === "proposed") e.meaning = "proposed";
    if (kind === "association" && r.navigable === true) e.navigable = true;
    if (kind === "association" || kind === "aggregation" || kind === "composition") e.directed = !!e.navigable;
    if (isObj(r.ends)) {
      const end = (v: unknown) => (isObj(v) && (str(v.mult, 20) || str(v.role, 80)) ? { ...(str(v.mult, 20) ? { mult: str(v.mult, 20) } : {}), ...(str(v.role, 80) ? { role: str(v.role, 80) } : {}) } : undefined);
      const a = end(r.ends.from), b = end(r.ends.to);
      if (a || b) e.ends = { ...(a ? { from: a } : {}), ...(b ? { to: b } : {}) };
    }
    if (isObj(r.route) && (r.route.kind === "straight" || r.route.kind === "elbow")) {
      const via = Array.isArray(r.route.via) ? (r.route.via as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && num(p[0]) !== undefined && num(p[1]) !== undefined) : [];
      e.route = { kind: r.route.kind, ...(pick(r.route.from, SIDES) ? { from: pick(r.route.from, SIDES) } : {}), ...(pick(r.route.to, SIDES) ? { to: pick(r.route.to, SIDES) } : {}), ...(via.length ? { via } : {}) } as DocEdge["route"];
    }
    if (isObj(r.labelPos) && num(r.labelPos.t) !== undefined) e.labelPos = { t: Math.max(0, Math.min(1, num(r.labelPos.t)!)), dx: num(r.labelPos.dx) ?? 0, dy: num(r.labelPos.dy) ?? 0 };
    if (isObj(r.style)) {
      const st = { ...(pick(r.style.color, COLORS) ? { color: pick(r.style.color, COLORS) } : {}), ...(pick(r.style.weight, WEIGHTS) ? { weight: pick(r.style.weight, WEIGHTS) } : {}) };
      if (Object.keys(st).length) e.style = st as DocEdge["style"];
    }
    doc.edges.push(e);
  }
  for (const n of doc.nodes) if (n.parent && !doc.nodes.some((p) => p.id === n.parent && (p.kind === "boundary" || p.kind === "partition"))) delete n.parent;
  if (isObj(raw.pool)) {
    const p = { ...(num(raw.pool.x) !== undefined ? { x: num(raw.pool.x), y: num(raw.pool.y) ?? 0 } : {}), ...((num(raw.pool.length) ?? 0) > 0 ? { length: num(raw.pool.length) } : {}) };
    if (Object.keys(p).length) doc.pool = p as ChalkDoc["pool"];
  }
  return doc;
}

export interface OpenedFile {
  /** the text to load */
  source: string;
  /** a project's saved model, checked field by field: the identities the text's shapes and lines take back */
  identities?: ChalkDoc;
  workspace: Workspace;
  /** what kind of file it was, and anything the reader had to repair */
  kind: "ksd" | "project";
  notes: string[];
}

/** Open a file's text: a .ksd, or a project (current or older versions). Throws ProjectError with a readable reason. */
export function openFile(text: string): OpenedFile {
  const trimmed = text.replace(/^﻿/, "");
  if (!trimmed.trimStart().startsWith("{")) return { source: trimmed.replace(/\r\n/g, "\n"), workspace: {}, kind: "ksd", notes: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new ProjectError("this file isn't a diagram: it is neither .ksd text nor a Chalk project");
  }
  if (!isObj(raw)) throw new ProjectError("this file isn't a Chalk project");
  const notes: string[] = [];
  const version = num(raw.version) ?? 0;
  // version 1 never shipped as a file; a bare document (format chalk-doc) is accepted as a project without text
  if (raw.format === DOC_FORMAT) raw = { format: PROJECT_FORMAT, version: PROJECT_VERSION, model: raw };
  const proj = raw as Record<string, unknown>;
  if (proj.format !== PROJECT_FORMAT) throw new ProjectError("this file isn't a Chalk project");
  if (version > PROJECT_VERSION) notes.push(`this project was saved by a newer Chalk (format ${version}); anything this version doesn't know is ignored`);
  const workspace: Workspace = {};
  if (isObj(proj.workspace)) {
    const v = proj.workspace.view;
    if (isObj(v) && num(v.x) !== undefined && num(v.y) !== undefined && (num(v.zoom) ?? 0) > 0) workspace.view = { x: num(v.x)!, y: num(v.y)!, zoom: Math.max(0.1, Math.min(8, num(v.zoom)!)) };
    const ex = proj.workspace.export;
    if (isObj(ex)) {
      const out: Record<string, string | number | boolean> = {};
      for (const [k, val] of Object.entries(ex)) if (/^[a-z]+$/i.test(k) && (typeof val === "string" ? val.length < 40 : typeof val === "number" ? Number.isFinite(val) : typeof val === "boolean")) out[k] = val as string | number | boolean;
      workspace.export = out;
    }
  }
  const source = typeof proj.source === "string" && proj.source.length < 2_000_000 ? proj.source.replace(/\r\n/g, "\n") : null;
  if (source !== null) {
    const parsed = parseSource(source);
    if (parsed.doc) {
      // the saved identities come back with the text, wherever the model still matches it
      let identities: ChalkDoc | undefined;
      try { identities = sanitizeDoc(proj.model); } catch { /* the text alone is enough */ }
      return { source, workspace, kind: "project", notes, ...(identities ? { identities } : {}) };
    }
    notes.push("the text in this project has a mistake; the saved model was used instead");
  }
  const doc = sanitizeDoc(proj.model);
  const printed = printDoc(doc);
  if (!parseSource(printed).doc) throw new ProjectError("the diagram in this file can't be read");
  if (source === null) notes.push("this project had no text; it was rebuilt from the saved model");
  return { source: printed, workspace, kind: "project", notes };
}
