/**
 * Targeted source edits: given the parsed text and an edited document, write the edit back into the
 * text by changing only the lines that edit touches. Comments, blank lines, spacing and the order of
 * everything else stay exactly as the author left them.
 *
 * The rule for every statement is the same: print it for the old document and for the new one; if the
 * two prints are equal the source line is left alone (whatever its formatting), otherwise that one
 * line is replaced, removed or added.
 */
import { CLASSIFIERS, type ChalkDoc, type DocEdge, type DocNode } from "./types";
import type { ParsedSource, Stmt, StmtKind } from "./parse";
import {
  EDGE_FACETS, LAYOUT_NOTE, META_ORDER, NODE_FACETS, opensBlock, printDecl, printDescribe, printEdge, printEdgeLayout, printMember,
  printMeta, printNodeLayout, printPool, type LayoutFacet,
} from "./print";

interface Rec { text: string; stmt: Stmt | null; dead: boolean; before: string[]; after: string[] }

const indentOf = (s: string): string => /^[ \t]*/.exec(s)![0];
const dedent = (s: string): string => (s.startsWith("  ") ? s.slice(2) : s.startsWith("\t") ? s.slice(1) : s);

export function syncSource(prev: ParsedSource, next: ChalkDoc): string {
  const old = prev.doc;
  if (!old) throw new Error("syncSource needs a valid source to edit");
  const type = next.meta.type;
  const recs: Rec[] = prev.lines.map((text) => ({ text, stmt: null, dead: false, before: [], after: [] }));
  for (const s of prev.stmts) if (recs[s.line]) recs[s.line].stmt = s;
  const owned = (uid: string, kind: StmtKind): Stmt[] => prev.stmts.filter((s) => s.owner === uid && s.kind === kind);
  const kill = (s: Stmt | undefined): void => { if (s) recs[s.line].dead = true; };
  const setText = (s: Stmt, text: string): void => { recs[s.line].text = indentOf(recs[s.line].text) + text; };
  const layoutAdds: string[] = [];
  const pendingDescribes: string[][] = [];

  // ---- header
  for (const key of META_ORDER) {
    const was = printMeta(old.meta, key), now = printMeta(next.meta, key);
    if (was === now) continue;
    const have = prev.stmts.filter((s) => s.kind === "meta" && s.key === key);
    if (now === null) { have.forEach(kill); continue; }
    if (have.length) { setText(have[0], now); have.slice(1).forEach(kill); continue; }
    let anchor: Stmt | undefined;
    for (let i = META_ORDER.indexOf(key) - 1; i >= 0 && !anchor; i--) {
      const prior = prev.stmts.filter((s) => s.kind === "meta" && s.key === META_ORDER[i]);
      anchor = prior[prior.length - 1];
    }
    anchor = anchor ?? prev.stmts.find((s) => s.kind === "meta");
    if (anchor) recs[anchor.line].after.push(now);
    else recs[0]?.before.push(now);
  }

  const oldNodes = new Map(old.nodes.map((n) => [n.uid, n]));
  const newNodes = new Map(next.nodes.map((n) => [n.uid, n]));
  const declOf = (uid: string): Stmt | undefined => owned(uid, "decl")[0];
  const closeOf = (uid: string): Stmt | undefined => owned(uid, "close")[0];
  const nodeLines = (n: DocNode, indent: string): string[] => {
    const out = [indent + printDecl(n, type)];
    if (CLASSIFIERS.has(n.kind) && opensBlock(n)) {
      for (const m of n.members ?? []) out.push(`${indent}  ${printMember(m)}`);
      out.push(`${indent}}`);
    }
    return out;
  };
  const killNodeLines = (uid: string): void => {
    kill(declOf(uid));
    owned(uid, "member").forEach(kill);
    kill(closeOf(uid));
  };

  // ---- nodes that went away
  for (const n of old.nodes) {
    if (newNodes.has(n.uid)) continue;
    const d = declOf(n.uid), c = closeOf(n.uid);
    if ((n.kind === "boundary" || n.kind === "partition") && d && c) {
      for (let i = d.line + 1; i < c.line; i++) recs[i].text = dedent(recs[i].text);
    }
    killNodeLines(n.uid);
    for (const k of ["describe-open", "describe-field", "describe-close", "place", "size", "lane", "style"] as StmtKind[]) owned(n.uid, k).forEach(kill);
  }

  // ---- where new top-level node lines go: after the last top-level node line (or the header)
  const lastTopNode = (): number => {
    let at = -1;
    for (const s of prev.stmts) {
      if (recs[s.line].dead) continue;
      if ((s.kind === "decl" && s.depth === 0) || (s.kind === "close" && s.depth === 0) || (s.kind === "meta" && at < 0)) at = Math.max(at, s.line);
    }
    if (at < 0) return Math.max(0, recs.length - 1);
    // a top-level declaration may open a block: step to its close
    const s = recs[at].stmt;
    if (s && s.kind === "decl" && s.owner) { const c = closeOf(s.owner); if (c) return Math.max(at, c.line); }
    return at;
  };
  const insertInto = (parentId: string | undefined, lines: (indent: string) => string[]): void => {
    const parent = parentId ? next.nodes.find((p) => p.id === parentId) : undefined;
    const pClose = parent ? closeOf(parent.uid) : undefined;
    const pDecl = parent ? declOf(parent.uid) : undefined;
    if (parent && pClose && pDecl && !recs[pClose.line].dead) {
      recs[pClose.line].before.push(...lines(indentOf(recs[pDecl.line].text) + "  "));
      return;
    }
    const at = lastTopNode();
    const isMeta = recs[at]?.stmt?.kind === "meta";
    if (recs[at]) recs[at].after.push(...(isMeta ? [""] : []), ...lines(""));
  };

  // ---- nodes that stayed
  for (const n of next.nodes) {
    const was = oldNodes.get(n.uid);
    if (!was) continue;
    const d = declOf(n.uid);
    if (!d) continue;
    if ((was.parent ?? "") !== (n.parent ?? "")) {
      // moved between containers: its lines leave one block and join another
      killNodeLines(n.uid);
      insertInto(n.parent, (ind) => nodeLines(n, ind));
    } else {
      if (printDecl(was, old.meta.type) !== printDecl(n, type)) setText(d, printDecl(n, type));
      if (CLASSIFIERS.has(n.kind)) {
        const a = (was.members ?? []).map(printMember), b = (n.members ?? []).map(printMember);
        const rows = owned(n.uid, "member");
        if (opensBlock(was) !== opensBlock(n)) {
          rows.forEach(kill);
          kill(closeOf(n.uid));
          if (opensBlock(n)) recs[d.line].after.push(...b.map((s) => `${indentOf(recs[d.line].text)}  ${s}`), `${indentOf(recs[d.line].text)}}`);
        } else if (a.join("\n") !== b.join("\n")) {
          if (a.length === b.length && rows.length === a.length) {
            rows.forEach((r, i) => { if (a[i] !== b[i]) setText(r, b[i]); });
          } else {
            rows.forEach(kill);
            recs[d.line].after.push(...b.map((s) => `${indentOf(recs[d.line].text)}  ${s}`));
          }
        }
      }
    }
    // use-case description
    const dWas = printDescribe(was.describe ?? {}), dNow = printDescribe(n.describe ?? {});
    const open = owned(n.uid, "describe-open")[0];
    if (dWas.join("\n") !== dNow.join("\n") || (open && was.id !== n.id)) {
      if (open) {
        const ind = indentOf(recs[open.line].text);
        owned(n.uid, "describe-field").forEach(kill);
        if (!dNow.length) { kill(open); kill(owned(n.uid, "describe-close")[0]); }
        else { setText(open, `describe ${n.id} {`); recs[open.line].after.push(...dNow.map((s) => `${ind}  ${s}`)); }
      } else if (dNow.length) pendingDescribes.push(["", `describe ${n.id} {`, ...dNow.map((s) => "  " + s), "}"]);
    }
    // layout facets
    for (const f of NODE_FACETS) facet(printNodeLayout(was, f), printNodeLayout(n, f), owned(n.uid, f as StmtKind));
  }

  // ---- new nodes: containers first, each with the children that arrive with it
  const fresh = next.nodes.filter((n) => !oldNodes.has(n.uid));
  const freshIds = new Set(fresh.map((n) => n.id));
  for (const n of fresh) {
    if (n.parent && freshIds.has(n.parent)) continue; // printed inside its new parent below
    if (n.kind === "boundary" || n.kind === "partition") {
      insertInto(undefined, () => [
        printDecl(n, type),
        ...fresh.filter((c) => c.parent === n.id).flatMap((c) => nodeLines(c, "  ")),
        "}",
      ]);
    } else insertInto(n.parent, (ind) => nodeLines(n, ind));
  }
  for (const n of fresh) {
    for (const f of NODE_FACETS) { const s = printNodeLayout(n, f); if (s) layoutAdds.push(s); }
    const body = printDescribe(n.describe ?? {});
    if (body.length) pendingDescribes.push(["", `describe ${n.id} {`, ...body.map((s) => "  " + s), "}"]);
  }

  // ---- edges
  const oldEdges = new Map(old.edges.map((e) => [e.uid, e]));
  const newEdges = new Map(next.edges.map((e) => [e.uid, e]));
  for (const e of old.edges) {
    if (newEdges.has(e.uid)) continue;
    for (const k of ["edge", "route", "labelpos", "style"] as StmtKind[]) owned(e.uid, k).forEach(kill);
  }
  for (const e of next.edges) {
    const was = oldEdges.get(e.uid);
    if (!was) continue;
    const row = owned(e.uid, "edge")[0];
    if (row && printEdge(was, old.meta.type) !== printEdge(e, type)) setText(row, printEdge(e, type));
    for (const f of EDGE_FACETS) facet(printEdgeLayout(old, was, f), printEdgeLayout(next, e, f), owned(e.uid, f as StmtKind));
  }
  const freshEdges = next.edges.filter((e) => !oldEdges.has(e.uid));
  if (freshEdges.length) {
    let at = -1, afterNodes = false;
    for (const s of prev.stmts) if (s.kind === "edge" && !recs[s.line].dead) at = Math.max(at, s.line);
    if (at < 0) { at = lastTopNode(); afterNodes = true; }
    // new node lines queued on the same anchor must come before the lines that join them
    const lines = freshEdges.map((e: DocEdge) => printEdge(e, type));
    if (recs[at]) recs[at].after.push(...(afterNodes ? [""] : []), ...lines);
    for (const e of freshEdges) for (const f of EDGE_FACETS) { const s = printEdgeLayout(next, e, f); if (s) layoutAdds.push(s); }
  }

  // ---- the partition pool
  facet(printPool(old), printPool(next), prev.stmts.filter((s) => s.kind === "pool"));

  // ---- new description blocks, then the layout block, at the end of the file
  const tail: string[] = [];
  for (const block of pendingDescribes) tail.push(...block);
  let endTail: string[] = [];
  const layoutOpen = prev.stmts.find((s) => s.kind === "layout-open");
  const layoutClose = prev.stmts.find((s) => s.kind === "layout-close");
  if (layoutOpen && layoutClose) {
    recs[layoutClose.line].before.push(...layoutAdds.map((s) => "  " + s));
    const noted = recs[layoutOpen.line - 1]?.text.trim() === LAYOUT_NOTE;
    if (tail.length) recs[noted ? layoutOpen.line - 1 : layoutOpen.line].before.push(...tail.slice(1), "");
    // an emptied block goes away, with the note above it
    let live = recs[layoutClose.line].before.length;
    for (let i = layoutOpen.line + 1; i < layoutClose.line; i++) if (!recs[i].dead && recs[i].text.trim() !== "") live++;
    if (!live) {
      for (let i = layoutOpen.line; i <= layoutClose.line; i++) recs[i].dead = true;
      if (noted) recs[layoutOpen.line - 1].dead = true;
    }
  } else {
    if (layoutAdds.length) tail.push("", LAYOUT_NOTE, "layout {", ...layoutAdds.map((s) => "  " + s), "}");
    endTail = tail;
  }

  // partitions (and boundaries) that changed order: their blocks trade places as wholes, contents and comments included
  const blockOf = (n: DocNode): [number, number] | null => {
    const d = declOf(n.uid), c = closeOf(n.uid);
    return d && c && !recs[d.line].dead ? [d.line, c.line] : null;
  };
  const wasOrder = old.nodes.filter((n) => (n.kind === "partition" || n.kind === "boundary") && newNodes.has(n.uid) && blockOf(n));
  const nowOrder = next.nodes.filter((n) => wasOrder.some((w) => w.uid === n.uid)).map((n) => oldNodes.get(n.uid)!);
  const swapped = new Map<number, [number, number]>();
  if (wasOrder.some((n, i) => n.uid !== nowOrder[i].uid)) {
    wasOrder.forEach((n, i) => { swapped.set(blockOf(n)![0], blockOf(nowOrder[i])!); });
  }
  const emit = (r: Rec, into: string[]): void => {
    into.push(...r.before);
    if (!r.dead) into.push(r.text);
    into.push(...r.after);
  };
  let out: string[] = [];
  for (let i = 0; i < recs.length; i++) {
    const from = swapped.get(i);
    if (!from) { emit(recs[i], out); continue; }
    // the block that now belongs at this position; then skip the one that was here
    for (let k = from[0]; k <= from[1]; k++) emit(recs[k], out);
    const here = wasOrder.map(blockOf).find((b) => b![0] === i)!;
    i = here[1];
  }
  const trimEnd = () => { while (out.length && out[out.length - 1].trim() === "") out.pop(); };
  trimEnd();
  out.push(...endTail);
  // removing a block must not leave a double blank line behind (unless the author writes them)
  const authorDoubles = prev.lines.some((l, i) => i > 0 && l.trim() === "" && prev.lines[i - 1].trim() === "");
  if (!authorDoubles) out = out.filter((l, i) => !(l.trim() === "" && i > 0 && out[i - 1].trim() === ""));
  trimEnd();
  return out.join(prev.eol) + prev.eol;

  function facet(was: string | null, now: string | null, have: Stmt[]): void {
    if (was === now) return;
    if (now === null) { have.forEach(kill); return; }
    if (have.length) { setText(have[0], now); have.slice(1).forEach(kill); return; }
    layoutAdds.push(now);
  }
}


/** Which layout facets exist, for callers that list them. */
export type { LayoutFacet };

/**
 * Tidy a file in place: canonical spelling and indentation for every statement, with comments, blank
 * lines and order untouched. A file with a mistake is only re-indented.
 */
export function formatSource(p: ParsedSource): string {
  const d = p.doc;
  const out: string[] = [];
  const members = new Map<string, number>();
  for (let i = 0; i < p.lines.length; i++) {
    const s = p.stmts.find((x) => x.line === i);
    const raw = p.lines[i].trim();
    if (!s) { out.push(raw); continue; }
    const ind = "  ".repeat(s.depth);
    let text = raw;
    if (d && s.owner) {
      const n = d.nodes.find((x) => x.uid === s.owner);
      const e = d.edges.find((x) => x.uid === s.owner);
      if (s.kind === "decl" && n) text = printDecl(n, d.meta.type);
      else if (s.kind === "member" && n) {
        const k = members.get(n.uid) ?? 0;
        members.set(n.uid, k + 1);
        if (n.members?.[k]) text = printMember(n.members[k]);
      } else if (s.kind === "edge" && e) text = printEdge(e, d.meta.type);
      else if (n && (s.kind === "place" || s.kind === "size" || s.kind === "lane" || s.kind === "style")) text = printNodeLayout(n, s.kind as LayoutFacet) ?? raw;
      else if (e && (s.kind === "route" || s.kind === "labelpos" || s.kind === "style")) text = printEdgeLayout(d, e, s.kind as LayoutFacet) ?? raw;
    }
    out.push(s.kind === "blank" ? "" : ind + text);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join(p.eol) + p.eol;
}
