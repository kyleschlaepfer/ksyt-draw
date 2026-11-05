/**
 * Arranging shapes: snapping a drag to its neighbours' edges and centers, to a grid, and the align,
 * distribute and match-size actions. Pure geometry on boxes, so it is tested without a browser.
 */
export interface Box { id: string; cx: number; cy: number; w: number; h: number }

export interface Guide { axis: "x" | "y"; at: number; from: number; to: number }

export interface SnapResult { dx: number; dy: number; guides: Guide[] }

const edgesX = (b: Box): number[] => [b.cx - b.w / 2, b.cx, b.cx + b.w / 2];
const edgesY = (b: Box): number[] => [b.cy - b.h / 2, b.cy, b.cy + b.h / 2];

/** The box around several boxes. */
export function bounds(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.cx - b.w / 2)), x1 = Math.max(...boxes.map((b) => b.cx + b.w / 2));
  const y0 = Math.min(...boxes.map((b) => b.cy - b.h / 2)), y1 = Math.max(...boxes.map((b) => b.cy + b.h / 2));
  return { id: "", cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/**
 * Adjust a drag so the moving box lines up with a still one: left, center or right edges within
 * `tol` inches snap together, and likewise top, middle and bottom. Returns the corrected offset and
 * the guide lines to show.
 */
export function snapMove(moving: Box, still: Box[], dx: number, dy: number, tol: number): SnapResult {
  const m: Box = { ...moving, cx: moving.cx + dx, cy: moving.cy + dy };
  let bestX: { d: number; at: number; other: Box } | null = null, bestY: { d: number; at: number; other: Box } | null = null;
  for (const o of still) {
    for (const a of edgesX(m)) for (const b of edgesX(o)) {
      const d = b - a;
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d) - 1e-9)) bestX = { d, at: b, other: o };
    }
    for (const a of edgesY(m)) for (const b of edgesY(o)) {
      const d = b - a;
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d) - 1e-9)) bestY = { d, at: b, other: o };
    }
  }
  const out: SnapResult = { dx: dx + (bestX?.d ?? 0), dy: dy + (bestY?.d ?? 0), guides: [] };
  const end: Box = { ...moving, cx: moving.cx + out.dx, cy: moving.cy + out.dy };
  if (bestX) {
    const o = bestX.other;
    out.guides.push({ axis: "x", at: bestX.at, from: Math.min(end.cy - end.h / 2, o.cy - o.h / 2), to: Math.max(end.cy + end.h / 2, o.cy + o.h / 2) });
  }
  if (bestY) {
    const o = bestY.other;
    out.guides.push({ axis: "y", at: bestY.at, from: Math.min(end.cx - end.w / 2, o.cx - o.w / 2), to: Math.max(end.cx + end.w / 2, o.cx + o.w / 2) });
  }
  return out;
}

/** Round a center to the grid. */
export const snapGrid = (v: number, grid: number): number => Math.round(v / grid) * grid;

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** New centers that line the boxes up on one edge or center line of their shared bounds. */
export function align(boxes: Box[], how: AlignHow): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;
  const all = bounds(boxes);
  for (const b of boxes) {
    let x = b.cx, y = b.cy;
    if (how === "left") x = all.cx - all.w / 2 + b.w / 2;
    else if (how === "right") x = all.cx + all.w / 2 - b.w / 2;
    else if (how === "center") x = all.cx;
    else if (how === "top") y = all.cy - all.h / 2 + b.h / 2;
    else if (how === "bottom") y = all.cy + all.h / 2 - b.h / 2;
    else y = all.cy;
    out.set(b.id, { x, y });
  }
  return out;
}

/** New centers that put equal gaps between the boxes along one axis; the outer two stay where they are. */
export function distribute(boxes: Box[], axis: "x" | "y"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 3) return out;
  const size = (b: Box): number => (axis === "x" ? b.w : b.h), pos = (b: Box): number => (axis === "x" ? b.cx : b.cy);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) / 2 - (pos(first) - size(first) / 2);
  const gap = (span - sorted.reduce((s, b) => s + size(b), 0)) / (sorted.length - 1);
  let at = pos(first) - size(first) / 2;
  for (const b of sorted) {
    const c = at + size(b) / 2;
    out.set(b.id, axis === "x" ? { x: c, y: b.cy } : { x: b.cx, y: c });
    at += size(b) + gap;
  }
  return out;
}

/** The size that makes every box as wide (or tall) as the largest. */
export function matchSize(boxes: Box[], what: "width" | "height"): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  if (boxes.length < 2) return out;
  const w = Math.max(...boxes.map((b) => b.w)), h = Math.max(...boxes.map((b) => b.h));
  for (const b of boxes) out.set(b.id, what === "width" ? { w, h: b.h } : { w: b.w, h });
  return out;
}
