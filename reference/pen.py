"""Hand-drawn pen strokes as pure geometry.

A Sketch collects filled polygons (inches, slide coordinates) with a color.
deck.py turns each Sketch into one editable PowerPoint freeform per color.

Every stroke is a centerline through hand-placed control points (Catmull-Rom
smoothed) with its own pressure profile: tapered start, slight width
variation, tapered or blunt end, round caps. Seeds auto-increment per Sketch,
so geometry is deterministic: the same code always draws the same strokes.
"""
import functools
import math
import random

# Palette
CH = "242B27"      # charcoal pen (default)
GR = "69736C"      # graphite: side notes, dimension lines, boundaries, hatching
GREEN = "256B4A"   # the one accent: useful output, correct path, key word
DKG = "184C36"     # dark green
WASH = "DCEBDF"    # pale green highlighter wash
TERRA = "C77859"   # rare second accent: loss / waste, only when it earns its place
BG = "FAFAF6"      # warm off-white page

PEN = 0.032        # default stroke width in inches (about 2.3 pt)


# ---------------- geometry helpers ----------------
def catmull(points, step=0.018):
    """Uniform Catmull-Rom spline through points, sampled about every `step` inches."""
    points = list(points)
    if len(points) < 3:
        (x0, y0), (x1, y1) = points[0], points[-1]
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / step))
        return [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]
    pts = [points[0]] + points + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        n = max(3, int(math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                       + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(points[-1])
    return out


def xf(points, dx=0.0, dy=0.0, s=1.0, ang=0.0):
    """Scale, rotate (degrees, clockwise on screen) then translate points."""
    a = math.radians(ang)
    c, sn = math.cos(a), math.sin(a)
    return [(dx + s * (x * c - y * sn), dy + s * (x * sn + y * c)) for x, y in points]


def rigid(points, pivot, dx, dy, rot):
    """Rotate points about pivot by rot degrees, then translate."""
    a = math.radians(rot)
    c, s = math.cos(a), math.sin(a)
    px, py = pivot
    return [(px + (x - px) * c - (y - py) * s + dx, py + (x - px) * s + (y - py) * c + dy) for x, y in points]


def ellipse_pts(cx, cy, rx, ry, start=0.0, sweep=380, n=9, wobble=0.05, seed=0, rot=0.0):
    """Loose ellipse control points. sweep > 360 gives a natural overshoot."""
    rng = random.Random(seed)
    pts = []
    for i in range(n + 1):
        a = math.radians(start + sweep * i / n)
        r = 1 + rng.uniform(-wobble, wobble)
        pts.append((rx * r * math.cos(a), ry * r * math.sin(a)))
    return xf(pts, cx, cy, 1.0, rot)


def poly_inside(pt, poly):
    x, y = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def bbox(polys):
    xs = [x for p in polys for x, _ in p]
    ys = [y for p in polys for _, y in p]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------- stroke outline ----------------
def _profile(seed, base, taper_in=None, taper_out=None):
    rng = random.Random(seed)
    tin = taper_in if taper_in is not None else rng.uniform(0.05, 0.14)
    tout = taper_out if taper_out is not None else rng.uniform(0.08, 0.22)
    s0, s1 = rng.uniform(0.35, 0.6), rng.uniform(0.25, 0.5)
    f, amp, ph = rng.uniform(0.8, 2.2), rng.uniform(0.03, 0.09), rng.uniform(0, 6.28)

    def sm(u):
        u = max(0.0, min(1.0, u))
        return u * u * (3 - 2 * u)

    def w(t):
        r = 1.0
        if tin > 0 and t < tin:
            r = s0 + (1 - s0) * sm(t / tin)
        elif tout > 0 and t > 1 - tout:
            r = s1 + (1 - s1) * sm((1 - t) / tout)
        return base * r * (1 + amp * math.sin(2 * math.pi * f * t + ph))
    return w


def _cap(c, ang_from, w, n=6):
    return [(c[0] + w / 2 * math.cos(ang_from - math.pi * i / n), c[1] + w / 2 * math.sin(ang_from - math.pi * i / n))
            for i in range(1, n)]


def stroke_polys(ctrl, width=PEN, seed=1, taper_in=None, taper_out=None, pieces=1, smooth=True):
    """Closed outline polygon(s) for one pen stroke.

    taper_in / taper_out: fraction of length that tapers (None = random, 0 = blunt round cap).
    pieces: split a self-crossing stroke (loops) so fills don't punch holes at the crossing.
    """
    c = catmull(ctrl) if smooth else list(ctrl)
    L = [0.0]
    for i in range(1, len(c)):
        L.append(L[-1] + math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]))
    tot = L[-1] or 1.0
    wf = _profile(seed, width, taper_in, taper_out)
    left, right, ws, nang = [], [], [], []
    for i, p in enumerate(c):
        a, b = c[max(0, i - 1)], c[min(len(c) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        d = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / d, tx / d
        w = wf(L[i] / tot)
        ws.append(w)
        nang.append(math.atan2(ny, nx))
        left.append((p[0] + nx * w / 2, p[1] + ny * w / 2))
        right.append((p[0] - nx * w / 2, p[1] - ny * w / 2))
    n = len(c)
    cuts = [round(k * (n - 1) / pieces) for k in range(pieces + 1)]
    polys = []
    for k in range(pieces):
        i0, i1 = cuts[k], min(n - 1, cuts[k + 1] + (2 if k < pieces - 1 else 0))
        poly = left[i0:i1 + 1] + _cap(c[i1], nang[i1], ws[i1]) + list(reversed(right[i0:i1 + 1])) \
            + _cap(c[i0], nang[i0] + math.pi, ws[i0])
        polys.append(poly)
    return polys


def seed_for(name):
    """Stable seed from an object's name: Sketch(seed_for("bd-loop")). Seeding each sketch from its
    name (instead of a running counter) means adding or removing one sketch never changes the
    wobble of every sketch after it, so revisions don't drift and QA results stay comparable."""
    import zlib
    return zlib.crc32(name.encode("utf-8")) % 100000 + 1000


# ---------------- Sketch ----------------
def _op(kind):
    """Record the outermost vocabulary call on a Sketch (arrow, check, loose_rect...), so the element
    registry knows what a drawing IS without the author describing it. Recording never changes geometry."""
    def deco(f):
        @functools.wraps(f)
        def w(self, *a, **k):
            top = not getattr(self, "_depth", 0)
            self._depth = getattr(self, "_depth", 0) + 1
            try:
                return f(self, *a, **k)
            finally:
                self._depth -= 1
                if top:
                    self.ops.append(kind)
        return w
    return deco


class Sketch:
    """A drawing made of pen strokes. One Sketch = one named object on the slide."""

    def __init__(self, seed=100, kind=None):
        self.items = []          # list of (polygon, hex color)
        self._seed = seed
        self.ops = []            # outermost vocabulary calls, in order (element registry)
        self.kind = kind         # optional explicit kind ("hourglass", "narrator"); else inferred from ops

    def _next(self, seed):
        if seed is not None:
            return seed
        self._seed += 1
        return self._seed

    # --- core ---
    @_op("fill")
    def fill(self, poly, color=CH):
        self.items.append((list(poly), color))
        return self

    @_op("knockout")
    def knockout(self, poly):
        """Background-colored fill under this drawing's strokes, so lines of objects registered
        *before* it disappear where it overlaps them (a counter hiding legs, a knife in front of a
        carrot). Call it first, before the outline strokes."""
        return self.fill(poly, BG)

    @_op("stroke")
    def pen(self, ctrl, color=CH, width=PEN, seed=None, taper_in=None, taper_out=None, pieces=1):
        """One pen stroke through hand-placed control points."""
        for poly in stroke_polys(ctrl, width, self._next(seed), taper_in, taper_out, pieces):
            self.fill(poly, color)
        return self

    def merge(self, other):
        self.items.extend(other.items)
        self.ops.extend(getattr(other, "ops", []))
        return self

    def bbox(self):
        return bbox([p for p, _ in self.items])

    def center(self):
        x0, y0, x1, y1 = self.bbox()
        return ((x0 + x1) / 2, (y0 + y1) / 2)

    def transformed(self, dx=0.0, dy=0.0, rot=0.0, pivot=None):
        out = Sketch(self._seed, self.kind)
        out.ops = list(self.ops)
        pv = pivot or self.center()
        out.items = [(rigid(p, pv, dx, dy, rot), c) for p, c in self.items]
        return out

    # --- vocabulary ---
    @_op("arrow")
    def arrow(self, ctrl, color=CH, width=0.03, seed=None, head=0.2, spread=27):
        """Shaft plus a two-flick arrowhead, the way a hand draws it."""
        sd = self._next(seed)
        rng = random.Random(sd * 7 + 3)
        self.pen(ctrl, color, width, sd)
        c = catmull(ctrl)
        tip = c[-1]
        back = c[max(0, len(c) - 6)]
        ang = math.atan2(tip[1] - back[1], tip[0] - back[0])
        for side, sgn in ((0, 1), (1, -1)):
            a = ang + math.pi + sgn * math.radians(spread + rng.uniform(-5, 5))
            ln = head * rng.uniform(0.85, 1.1)
            end = (tip[0] + ln * math.cos(a), tip[1] + ln * math.sin(a))
            mid = ((tip[0] + end[0]) / 2 + rng.uniform(-0.01, 0.01), (tip[1] + end[1]) / 2 + rng.uniform(-0.01, 0.01))
            self.pen([end, mid, (tip[0] + rng.uniform(-0.01, 0.01), tip[1] + rng.uniform(-0.01, 0.01))],
                     color, width * 0.95, sd + 11 + side, taper_in=0.25, taper_out=0.05)
        return self

    @_op("underline")
    def underline(self, x0, x1, y, color=GREEN, width=0.045, seed=None, rise=0.08):
        """Hand underline: slight upward drift, overshoots the end."""
        self.pen([(x0 - 0.02, y), ((x0 + x1) / 2, y - rise * 0.4), (x1 + 0.1, y - rise)], color, width, seed,
                 taper_in=0.08, taper_out=0.3)
        return self

    @_op("check")
    def check(self, x, y, s=1.0, color=GREEN, width=0.036, seed=None):
        """Hand check mark; (x, y) is roughly the bottom of the tick."""
        return self.pen([(x - 0.15 * s, y - 0.13 * s), (x - 0.05 * s, y), (x + 0.18 * s, y - 0.34 * s)], color, width, seed)

    @_op("xmark")
    def xmark(self, x, y, s=1.0, color=CH, width=0.032, seed=None):
        """Hand X centred on (x, y): two quick crossing strokes."""
        self.pen([(x - 0.13 * s, y - 0.12 * s), (x + 0.02 * s, y + 0.01 * s), (x + 0.13 * s, y + 0.13 * s)], color, width, seed)
        return self.pen([(x + 0.12 * s, y - 0.13 * s), (x - 0.01 * s, y), (x - 0.13 * s, y + 0.14 * s)], color, width)

    @_op("strike")
    def strike(self, x0, x1, y, color=CH, width=0.034, seed=None):
        """Strike-through across a word (y about 40% of cap height above its baseline).
        Declare it with deck.allow_overlap(strike, word) so layout QA knows it's intentional."""
        return self.pen([(x0 - 0.08, y + 0.03), ((x0 + x1) / 2, y - 0.02), (x1 + 0.1, y - 0.05)], color, width, seed)

    @_op("brace")
    def brace(self, x0, x1, y, depth=0.2, color=GR, width=0.026, seed=None, up=False):
        """Horizontal curly brace from x0 to x1 at y, with its point at the middle (down unless up=True).
        Use it to group things the narration groups ("same output"). Returns the point's (x, y)."""
        sgn = -1 if up else 1
        m = (x0 + x1) / 2
        self.pen([(x0, y - sgn * 0.0), (x0 + 0.07, y + sgn * depth * 0.55), (m - 0.08, y + sgn * depth * 0.6),
                  (m, y + sgn * depth), (m + 0.08, y + sgn * depth * 0.6), (x1 - 0.07, y + sgn * depth * 0.55), (x1, y)],
                 color, width, seed)
        self.tip = (m, y + sgn * depth)
        return self

    @_op("box")
    def loose_rect(self, x0, y0, x1, y1, color=CH, width=PEN, seed=None):
        """Box from four separate strokes with small corner overshoots."""
        sd = self._next(seed)
        rng = random.Random(sd)
        j = lambda: rng.uniform(-0.015, 0.015)
        o = lambda: rng.uniform(0.03, 0.08)
        self.pen([(x0 - o(), y0 + j()), ((x0 + x1) / 2, y0 + j()), (x1 + o(), y0 + j())], color, width, sd + 1)
        self.pen([(x0 - o(), y1 + j()), ((x0 + x1) / 2, y1 + j()), (x1 + o(), y1 + j())], color, width, sd + 2)
        self.pen([(x0 + j(), y0 - o()), (x0 + j(), (y0 + y1) / 2), (x0 + j(), y1 + o())], color, width, sd + 3)
        self.pen([(x1 + j(), y0 - o()), (x1 + j(), (y0 + y1) / 2), (x1 + j(), y1 + o())], color, width, sd + 4)
        return self

    @_op("box")
    def rounded_rect(self, x0, y0, x1, y1, r=0.35, color=CH, width=PEN, seed=None, step=0.22, bow=0.03):
        """Rounded rectangle as one loop (a board, a screen, a card in a story scene).

        Points are spaced evenly along the whole outline: Catmull-Rom overshoots into little hooks
        when short corner segments sit next to long straight runs, so never hand-place a few points.
        """
        rnd = random.Random(seed if seed is not None else self._seed + 3)
        corners = [(x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)]
        pts = []
        for ci, (cx, cy, a0) in enumerate(corners):
            for j in range(4):
                a = math.radians(a0 + j * 30)
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            nx, ny, na = corners[(ci + 1) % 4]
            ex, ey = cx + r * math.cos(math.radians(a0 + 90)), cy + r * math.sin(math.radians(a0 + 90))
            sx, sy = nx + r * math.cos(math.radians(na)), ny + r * math.sin(math.radians(na))
            n = max(1, int(math.hypot(sx - ex, sy - ey) / step))
            b = rnd.uniform(-bow, bow)
            for j in range(1, n):
                t = j / n
                px, py = ex + (sx - ex) * t, ey + (sy - ey) * t
                off = b * math.sin(math.pi * t)
                if ci % 2 == 0:
                    px += off
                else:
                    py += off
                pts.append((px, py))
        pts += [pts[0], pts[1]]
        return self.pen(pts, color, width, seed, pieces=2)

    @_op("ring")
    def loose_circle(self, cx, cy, rx, ry, color=GREEN, width=0.035, seed=None):
        """Ring drawn around something to mark it; overshoots its start."""
        sd = self._next(seed)
        self.pen(ellipse_pts(cx, cy, rx, ry, start=random.Random(sd).uniform(150, 230), sweep=395, n=10, seed=sd),
                 color, width, sd, pieces=2)
        return self

    @_op("dimension")
    def dimension(self, x0, x1, y, color=GR, width=0.022, seed=None, tick=0.09):
        """Measuring line with end ticks (label it separately with deck.write)."""
        sd = self._next(seed)
        self.pen([(x0, y + 0.01), ((x0 + x1) / 2, y - 0.01), (x1, y + 0.005)], color, width, sd)
        self.pen([(x0 + 0.005, y - tick), (x0, y + tick)], color, width, sd + 1)
        self.pen([(x1, y - tick), (x1 + 0.005, y + tick)], color, width, sd + 2)
        return self

    @_op("hatch")
    def hatch(self, region, color=GR, spacing=0.12, angle=58, width=0.017, seed=None, inset=0.03):
        """Hand hatching clipped to a polygon region. Use it to mark waste or a category without color."""
        sd = self._next(seed)
        rng = random.Random(sd)
        xs = [p[0] for p in region]
        ys = [p[1] for p in region]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        R = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
        a = math.radians(angle)
        d = (math.cos(a), math.sin(a))
        nrm = (-d[1], d[0])
        k, i = -R, 0
        while k <= R:
            segs, cur = [], []
            for s in range(401):
                t = -R + 2 * R * s / 400
                p = (cx + nrm[0] * k + d[0] * t, cy + nrm[1] * k + d[1] * t)
                if poly_inside(p, region):
                    cur.append(p)
                elif cur:
                    segs.append(cur)
                    cur = []
            if cur:
                segs.append(cur)
            for sg in segs:
                if len(sg) < 4:
                    continue
                p0, p1 = sg[0], sg[-1]
                if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 2.5 * inset:
                    continue
                s0, s1 = inset + rng.uniform(-0.01, 0.03), inset + rng.uniform(-0.01, 0.03)
                j0, j1 = rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012)
                q0 = (p0[0] + d[0] * s0 + nrm[0] * j0, p0[1] + d[1] * s0 + nrm[1] * j0)
                q1 = (p1[0] - d[0] * s1 + nrm[0] * j1, p1[1] - d[1] * s1 + nrm[1] * j1)
                if not (poly_inside(q0, region) and poly_inside(q1, region)):
                    q0 = (p0[0] + d[0] * s0, p0[1] + d[1] * s0)
                    q1 = (p1[0] - d[0] * s1, p1[1] - d[1] * s1)
                self.pen([q0, q1], color, width, sd + 1000 + i, taper_in=0.1, taper_out=0.25)
                i += 1
            k += spacing * rng.uniform(0.88, 1.12)
        return self

    @_op("boundary")
    def dashed_loop(self, ctrl_closed, color=GR, width=0.026, seed=None, dash=(0.11, 0.30), gap=(0.08, 0.16)):
        """Uneven pen dashes along a lumpy closed loop: a system boundary."""
        sd = self._next(seed)
        rng = random.Random(sd)
        c = catmull(list(ctrl_closed) + list(ctrl_closed[:3]), step=0.01)
        L = [0.0]
        for i in range(1, len(c)):
            L.append(L[-1] + math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]))
        p0 = ctrl_closed[0]
        lap = next((L[i] for i in range(len(c)) if L[i] > 1.0 and math.hypot(c[i][0] - p0[0], c[i][1] - p0[1]) < 0.02), L[-1])
        s, j, idx = 0.0, 0, 0
        while s < lap - 0.12:
            dl = rng.uniform(*dash)
            while idx < len(c) and L[idx] < s:
                idx += 1
            seg, k = [], idx
            while k < len(c) and L[k] <= min(s + dl, lap - 0.05):
                seg.append(c[k])
                k += 1
            if len(seg) >= 3:
                self.pen(seg[::2] if len(seg) > 6 else seg, color, width, sd + 2000 + j, taper_in=0.2, taper_out=0.25)
            s += dl + rng.uniform(*gap)
            j += 1
        return self

    @_op("wash")
    def wash(self, x0, y0, x1, y1, color=WASH, seed=None):
        """Highlighter-style fill with slightly uneven edges, kept inside the box."""
        rng = random.Random(self._next(seed))
        top = [(x0 + (x1 - x0) * i / 8, y0 + rng.uniform(0.0, 0.025)) for i in range(9)]
        bot = [(x1 - (x1 - x0) * i / 8, y1 - rng.uniform(0.0, 0.025)) for i in range(9)]
        return self.fill(top + [(x1 - rng.uniform(0, 0.02), (y0 + y1) / 2)] + bot + [(x0 + rng.uniform(0, 0.02), (y0 + y1) / 2)], color)

    @_op("dot")
    def dot(self, cx, cy, r, color=CH, seed=None):
        rng = random.Random(self._next(seed))
        return self.fill([(cx + r * rng.uniform(0.85, 1.1) * math.cos(2 * math.pi * i / 14),
                           cy + r * rng.uniform(0.85, 1.1) * math.sin(2 * math.pi * i / 14) * 0.9) for i in range(14)], color)

    @_op("blob")
    def blob(self, ctrl, color=CH):
        """Small solid shape (a seed, a filled arrowhead) from a smooth closed outline."""
        return self.fill(catmull(list(ctrl) + [ctrl[0]], step=0.004), color)
