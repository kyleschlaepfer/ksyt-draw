/**
 * The precision look: the same geometry as the sketch look, drawn as crisp technical linework for
 * reports, papers and formal UML. Real strokes with exact corners, consistent weights, standard UML
 * line ends.
 */
import { catmull } from "../pen";
import type { EdgeGeom } from "../geom/resolve";
import { ACTOR_H, IO_SKEW, type NodeGeom, type Pt } from "../geom/shape";
import type { Paint, PaintContext, Role } from "./scene";
import { weightOf } from "./scene";
import { endDir, trim } from "./sketch";

/** Stroke widths, inches: about 2 px for shapes and 1.7 px for lines at 96 dpi. */
export const SHAPE_W = 0.021;
export const LINE_W = 0.018;
const DASH: [number, number] = [0.09, 0.065];

export function precisionNode(g: NodeGeom, ctx: PaintContext): Paint[] {
  const { cx, cy } = g;
  const x0 = cx - g.w / 2, y0 = cy - g.h / 2, x1 = cx + g.w / 2, y1 = cy + g.h / 2;
  const rect: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const stroke: Role = g.style?.color ?? "ink";
  const sw = SHAPE_W * weightOf(g.style?.weight);
  const f = g.style?.fill ?? "page";
  const fill: Role | undefined = f === "none" ? undefined : f === "wash" ? "wash" : "page";
  const closed = (pts: Pt[], r = 0): Paint => ({ t: "line", pts, closed: true, stroke, sw, ...(fill ? { fill } : {}), ...(r ? { r } : {}) });
  const seg = (a: Pt, b: Pt, color: Role = stroke, w = sw): Paint => ({ t: "line", pts: [a, b], stroke: color, sw: w });
  switch (g.kind) {
    case "process": return [closed(rect)];
    case "action": return [closed(rect, Math.min(0.14, g.h / 3))];
    case "terminator": return [closed(rect, g.h / 2)];
    case "io": return [closed([[x0 + IO_SKEW, y0], [x1, y0], [x1 - IO_SKEW, y1], [x0, y1]])];
    case "decision":
    case "merge": return [closed([[cx, y0], [x1, cy], [cx, y1], [x0, cy]])];
    case "initial": return [{ t: "ellipse", cx, cy, rx: g.w / 2, ry: g.h / 2, fill: stroke }];
    case "final": {
      const r = g.w / 2;
      return [{ t: "ellipse", cx, cy, rx: r, ry: r, stroke, sw, ...(fill ? { fill } : {}) }, { t: "ellipse", cx, cy, rx: r * 0.58, ry: r * 0.58, fill: stroke }];
    }
    case "flow-final": {
      const r = g.w / 2, o = r * 0.7071;
      return [{ t: "ellipse", cx, cy, rx: r, ry: r, stroke, sw, ...(fill ? { fill } : {}) }, seg([cx - o, cy - o], [cx + o, cy + o]), seg([cx + o, cy - o], [cx - o, cy + o])];
    }
    case "fork":
    case "join": return [{ t: "poly", pts: rect, fill: stroke }];
    case "actor": {
      const h = g.figH ?? ACTOR_H, top = y0;
      const r = h * 0.14, hy = top + r, neck = hy + r, hip = top + h * 0.62, arm = neck + h * 0.14;
      return [
        { t: "ellipse", cx, cy: hy, rx: r, ry: r, stroke, sw },
        seg([cx, neck], [cx, hip]), seg([cx - h * 0.26, arm], [cx + h * 0.26, arm]),
        seg([cx, hip], [cx - h * 0.22, top + h]), seg([cx, hip], [cx + h * 0.22, top + h]),
      ];
    }
    case "use-case": return [{ t: "ellipse", cx, cy, rx: g.w / 2, ry: g.h / 2, stroke, sw, ...(fill ? { fill } : {}) }];
    case "class":
    case "interface":
      return [closed(rect), ...(g.cls?.dividers ?? []).map((dy) => seg([x0, y0 + dy], [x1, y0 + dy], stroke, sw * 0.8))];
    case "note": return [];
    case "boundary": return [{ t: "line", pts: rect, closed: true, stroke: g.style?.color ?? "ink-2", sw: sw * 0.85 }];
    case "partition": {
      const c: Role = g.style?.color ?? "ink-2", w = sw * 0.85, hd = g.header ?? 0;
      const out: Paint[] = [];
      if (g.horizontal) {
        out.push(seg([x0, y0], [x0, y1], c, w), seg([x1, y0], [x1, y1], c, w), seg([x0, y1], [x1, y1], c, w), seg([x0 + hd, y0], [x0 + hd, y1], c, w));
        if (ctx.firstLane.has(g.id)) out.push(seg([x0, y0], [x1, y0], c, w));
      } else {
        out.push(seg([x0, y0], [x1, y0], c, w), seg([x0, y1], [x1, y1], c, w), seg([x1, y0], [x1, y1], c, w), seg([x0, y0 + hd], [x1, y0 + hd], c, w));
        if (ctx.firstLane.has(g.id)) out.push(seg([x0, y0], [x0, y1], c, w));
      }
      return out;
    }
  }
}

export function precisionEdge(e: EdgeGeom, _ctx: PaintContext): Paint[] {
  const stroke: Role = e.style?.color ?? "ink";
  const sw = LINE_W * weightOf(e.style?.weight);
  const path: Pt[] = e.smooth ? catmull(e.points, 0.03) : e.points;
  const tipTo = path[path.length - 1], tipFrom = path[0];
  const dTo = endDir(path, "end"), dFrom = endDir(path, "start");
  const shaft = (pts: Pt[]): Paint => ({ t: "line", pts, stroke, sw, ...(e.dashed ? { dash: DASH } : {}), ...(e.smooth ? {} : { r: 0.05 }) });
  const open = (tip: Pt, dir: Pt, len = 0.15, spread = 26): Paint => {
    const pt = (s: number): Pt => {
      const ang = Math.atan2(dir[1], dir[0]) + Math.PI + (s * spread * Math.PI) / 180;
      return [tip[0] + len * Math.cos(ang), tip[1] + len * Math.sin(ang)];
    };
    return { t: "line", pts: [pt(-1), tip, pt(1)], stroke, sw };
  };
  switch (e.kind) {
    case "arrow":
    case "include":
    case "extend":
    case "dependency":
      return [shaft(path), open(tipTo, dTo)];
    case "association":
      return e.directed ? [shaft(path), open(tipTo, dTo)] : [shaft(path)];
    case "generalization":
    case "realization": {
      const len = 0.18, half = 0.095;
      const base: Pt = [tipTo[0] - dTo[0] * len, tipTo[1] - dTo[1] * len];
      const a: Pt = [base[0] - dTo[1] * half, base[1] + dTo[0] * half], b: Pt = [base[0] + dTo[1] * half, base[1] - dTo[0] * half];
      return [shaft(trim(path, len, "end")), { t: "line", pts: [tipTo, a, b], closed: true, stroke, sw, fill: "page" }];
    }
    case "aggregation":
    case "composition": {
      const len = 0.25, half = 0.07;
      const out: Pt = [-dFrom[0], -dFrom[1]];
      const mid: Pt = [tipFrom[0] + out[0] * (len / 2), tipFrom[1] + out[1] * (len / 2)], far: Pt = [tipFrom[0] + out[0] * len, tipFrom[1] + out[1] * len];
      const a: Pt = [mid[0] - out[1] * half, mid[1] + out[0] * half], b: Pt = [mid[0] + out[1] * half, mid[1] - out[0] * half];
      return [shaft(trim(path, len, "start")), { t: "line", pts: [tipFrom, a, far, b], closed: true, stroke, sw, fill: e.kind === "composition" ? stroke : "page" }];
    }
  }
}
