"""Web figures in the KSyt house style: the slide engine's real pen strokes, real text, SVG out.

The strokes come from engine/pen.py and engine/character.py, byte-identical copies of the
whiteboard-lecture-slides engine, so a figure on the website and a slide in a video share one
geometry (the narrator is literally the same drawing). Coordinates are in inches like the slide
engine; 1 in = 96 CSS px in the SVG. Text sizes are CSS px.

    from figure import Figure
    f = Figure(7.0, 3.2, title="A request takes one of two paths", desc="Flowchart: ...")
    a = f.box("submit", 1.1, 1.6, "submit request")
    b = f.decision("ok", 3.6, 1.6, "approved?")
    f.connect("a-b", a, b)
    f.check()                      # collisions, clipping, phone legibility; raises on errors
    f.save("approval.svg")         # inline-ready (themed by the page's CSS variables)
    f.save("approval.img.svg", standalone=True)   # works as <img>: own colors, dark mode, embedded font subset

Colors are roles, never hex: ink, ink-2 (graphite), accent, accent-strong, wash, terra, page.
"""
import base64
import html
import io
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "engine"))

from pen import Sketch, CH, GR, GREEN, DKG, WASH, TERRA, BG, seed_for, catmull  # noqa: E402
import character  # noqa: E402

PX = 96.0
ROLE = {CH: "ink", GR: "ink-2", GREEN: "accent", DKG: "accent-strong", WASH: "wash", TERRA: "terra", BG: "page"}
HEX = {v: k for k, v in ROLE.items()}

# Must match assets/css/ksyt.css (tests/test_skill.py checks it).
LIGHT = {"ink": "#242B27", "ink-2": "#606A63", "accent": "#256B4A", "accent-strong": "#184C36",
         "wash": "#DCEBDF", "terra": "#C77859", "page": "#FAFAF6"}
DARK = {"ink": "#ECEAE2", "ink-2": "#A9B2AB", "accent": "#7CC39A", "accent-strong": "#A8DCBD",
        "wash": "#2B4536", "terra": "#E3A086", "page": "#1E2521"}

FONT_FILES = {("Kalam", 400): "Kalam-Regular.ttf", ("Kalam", 300): "Kalam-Light.ttf", ("Kalam", 700): "Kalam-Bold.ttf"}
FONT_DIRS = [os.environ.get("KSYT_FONT_DIR", ""), os.path.expanduser("~/.fonts"), "/usr/share/fonts",
             "/usr/local/share/fonts", os.path.expanduser("~/Library/Fonts"), "C:/Windows/Fonts"]


class FigureError(Exception):
    pass


def find_font(family="Kalam", weight=400):
    fname = FONT_FILES.get((family, weight))
    if not fname:
        raise FigureError("No font file known for %s %s" % (family, weight))
    for d in FONT_DIRS:
        if not d or not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            if fname in files:
                return os.path.join(root, fname)
    raise FigureError("%s not found. Run scripts/setup_fonts.sh (or set KSYT_FONT_DIR). Never fall back to "
                      "another font: measurements would be wrong and labels would clip." % fname)


_FONTS = {}


def _font(family, weight):
    from PIL import ImageFont
    key = (family, weight)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(find_font(family, weight), 1000)
    return _FONTS[key]


def measure(text, size, family="Kalam", weight=400):
    """(advance, ink_top, ink_bottom) in px for text at size px; ink relative to the baseline (top is negative)."""
    f = _font(family, weight)
    adv = f.getlength(text) * size / 1000.0
    x0, y0, x1, y1 = f.getbbox(text, anchor="ls")
    return adv, y0 * size / 1000.0, y1 * size / 1000.0


class Figure:
    def __init__(self, w, h, title, desc="", min_display_px=328):
        """w, h in inches. title: what the figure shows (its finding, not its topic). desc: the text
        alternative, written so someone who can't see it gets the same point. min_display_px: the
        narrowest width it will be shown at (360 px phone minus gutters)."""
        if not title:
            raise FigureError("A figure needs a title: say what it shows.")
        self.w, self.h, self.title, self.desc = w, h, title, desc
        self.min_display_px = min_display_px
        self.elements = []        # (name, Sketch)
        self.texts = []           # dicts
        self.overlaps = set()     # frozenset({a, b}) pairs allowed to touch
        self.names = set()
        self.step = 0             # build-up step for elements registered now (0 = always shown)
        self.steps = {}           # name -> step

    # ---------- registration ----------
    def _name(self, name):
        if name in self.names:
            raise FigureError("Duplicate element name %r: names are identities (and wobble seeds)." % name)
        self.names.add(name)
        return name

    def draw(self, name, sketch):
        self.elements.append((self._name(name), sketch))
        self.steps[name] = self.step
        return sketch

    def at_step(self, k):
        """Everything registered after this call appears at build-up step k (the web version of a phased
        slide: one step per click, all steps reachable, final state shown when JavaScript is off)."""
        self.step = k
        return self

    def sketch(self, name):
        """A new Sketch seeded from its name, already registered. Draw into it with the pen vocabulary."""
        return self.draw(name, Sketch(seed_for(name)))

    def text(self, name, s, x, y, size=24, role="ink", weight=400, anchor="start", family="Kalam"):
        """Handwritten label with its baseline at (x, y) inches. anchor: start | middle | end."""
        if "\u2014" in s:
            raise FigureError("Em dash in %r. House rule: no em dashes." % name)
        adv, top, bot = measure(s, size, family, weight)
        x_px = x * PX - {"start": 0, "middle": adv / 2, "end": adv}[anchor]
        t = dict(name=self._name(name), s=s, x=x, y=y, size=size, role=role, weight=weight, anchor=anchor,
                 family=family, box=(x_px, y * PX + top, x_px + adv, y * PX + bot), step=self.step)
        self.texts.append(t)
        return t

    def allow_overlap(self, a, b):
        """Declare that element/text a may touch b on purpose (a strike-through, a label on its own wash)."""
        self.overlaps.add(frozenset((a, b)))

    def narrator(self, name, x, y, s=1.0, pose="stand", face="neutral", facing=1, **kw):
        """The channel narrator, drawn by the slide engine itself (character.narrator). Returns anchors."""
        k, at = character.narrator(x, y, s, pose=pose, face=face, facing=facing, seed=seed_for(name), **kw)
        self.draw(name, k)
        return at

    # ---------- composed helpers (teaching diagrams: exact, labeled) ----------
    def _label_in(self, name, cx, cy, text, size, role="ink"):
        """Centered label; "\n" breaks lines. Each line is its own text element (name:label, name:label2...)."""
        lines = text.split("\n")
        lh = size * 1.25
        _, top, bot = measure("Hxg", size)
        first = cy * PX - (len(lines) - 1) * lh / 2 - (top + bot) / 2
        for i, ln in enumerate(lines):
            self.text(name + ":label" + ("" if i == 0 else str(i + 1)), ln, cx, (first + i * lh) / PX, size, role=role,
                      anchor="middle")

    @staticmethod
    def _block(text, size):
        lines = text.split("\n")
        return max(measure(ln, size)[0] for ln in lines) / PX, len(lines) * size * 1.25 / PX

    def box(self, name, cx, cy, text, size=24, pad=0.22, w=None, role="ink"):
        tw, th = self._block(text, size)
        bw = w or tw + 2 * pad
        bh = th + 2 * pad * 0.7
        k = self.sketch(name)
        k.loose_rect(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, color=HEX[role])
        self._label_in(name, cx, cy, text, size)
        return dict(name=name, cx=cx, cy=cy, w=bw, h=bh, shape="box")

    def pill(self, name, cx, cy, text, size=24, pad=0.3, w=None, role="ink"):
        tw, th = self._block(text, size)
        bw = w or tw + 2 * pad
        bh = th + 2 * pad * 0.6
        k = self.sketch(name)
        k.rounded_rect(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, r=bh / 2 * 0.95, color=HEX[role])
        self._label_in(name, cx, cy, text, size)
        return dict(name=name, cx=cx, cy=cy, w=bw, h=bh, shape="pill")

    def decision(self, name, cx, cy, text, size=22, pad=0.5, role="ink"):
        adv, th = self._block(text, size)
        hw = adv / 2 + pad
        hh = max(0.42, hw * 0.55)
        k = self.sketch(name)
        pts = [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
        for i in range(4):
            p, q = pts[i], pts[(i + 1) % 4]
            dx, dy = q[0] - p[0], q[1] - p[1]
            L = math.hypot(dx, dy)
            o = 0.05 / L
            k.pen([(p[0] - dx * o, p[1] - dy * o), ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2), (q[0] + dx * o, q[1] + dy * o)],
                  color=HEX[role])
        self._label_in(name, cx, cy, text, size)
        return dict(name=name, cx=cx, cy=cy, w=2 * hw, h=2 * hh, shape="diamond")

    def size_of(self, kind, text, size=None):
        """(w, h) a node would have, before drawing it. kind: box | pill | decision."""
        size = size or {"box": 24, "pill": 22, "decision": 22}[kind]
        tw, th = self._block(text, size)
        if kind == "box":
            return tw + 0.44, th + 0.308
        if kind == "pill":
            return tw + 0.6, th + 0.36
        hw = tw / 2 + 0.5
        return 2 * hw, 2 * max(0.42, hw * 0.55)

    def after(self, prev, kind, name, text, direction="down", gap=0.72, size=None, shift=0.0):
        """Place a node `gap` inches past prev's edge (the arrow's length plus clearance), centered on
        prev's axis plus `shift`. Peers share an axis by construction, so nothing drifts by a hair."""
        w, h = self.size_of(kind, text, size)
        dx = {"down": 0, "up": 0, "right": 1, "left": -1}[direction]
        dy = {"down": 1, "up": -1, "right": 0, "left": 0}[direction]
        cx = prev["cx"] + dx * (prev["w"] / 2 + gap + w / 2) + (shift if dy else 0)
        cy = prev["cy"] + dy * (prev["h"] / 2 + gap + h / 2) + (shift if dx else 0)
        kw = {} if size is None else {"size": size}
        return getattr(self, kind)(name, cx, cy, text, **kw)

    @staticmethod
    def _edge(node, toward, gap=0.06):
        """Point where the line from node's center toward `toward` leaves its outline, plus a gap."""
        cx, cy = node["cx"], node["cy"]
        dx, dy = toward[0] - cx, toward[1] - cy
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        hw, hh = node["w"] / 2, node["h"] / 2
        if node["shape"] == "diamond":
            t = 1.0 / (abs(ux) / hw + abs(uy) / hh)
        else:
            t = min(hw / abs(ux) if ux else 1e9, hh / abs(uy) if uy else 1e9)
        t += gap
        return (cx + ux * t, cy + uy * t)

    def connect(self, name, a, b, label=None, size=20, role="ink", bend=0.0, dashed=False, label_side=1):
        """Arrow from node a to node b, ending at b's outline. A label sits beside the line, never on it."""
        p0 = self._edge(a, (b["cx"], b["cy"]))
        p1 = self._edge(b, (a["cx"], a["cy"]), gap=0.05)
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if L < 0.5:
            raise FigureError("%s: arrow under 0.5 in; the head would crowd the shaft. Move the nodes apart." % name)
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        nx, ny = -(p1[1] - p0[1]) / L, (p1[0] - p0[0]) / L
        ctrl = [p0, (mx + nx * bend, my + ny * bend), p1]
        k = self.sketch(name)
        if dashed:
            c = catmull(ctrl, step=0.01)
            seg, run, on, i = [], 0.0, True, 0
            for j in range(1, len(c)):
                run += math.hypot(c[j][0] - c[j - 1][0], c[j][1] - c[j - 1][1])
                if on:
                    seg.append(c[j])
                lim = 0.14 if on else 0.09
                if run >= lim:
                    if on and len(seg) >= 3:
                        k.pen(seg[::2] if len(seg) > 6 else seg, color=HEX[role], width=0.026, seed=seed_for(name) + i)
                        i += 1
                    seg, run, on = [c[j]], 0.0, not on
            k.arrow([c[-4], c[-1]], color=HEX[role], width=0.026, head=0.16)
        else:
            k.arrow(ctrl, color=HEX[role], head=0.17)
        if label:
            adv, top, bot = measure(label, size)
            horiz = abs(p1[0] - p0[0]) >= abs(p1[1] - p0[1])
            lx, ly = mx + nx * bend, my + ny * bend
            if horiz:  # above the line (label_side=1) or below it (-1), with a clear gap either way
                base = ly - 0.11 - bot / PX if label_side > 0 else ly + 0.11 - top / PX
                self.text(name + ":label", label, lx, base, size, role="ink-2", anchor="middle")
            else:
                self.text(name + ":label", label, lx + 0.14 * label_side, ly - (top + bot) / 2 / PX, size,
                          role="ink-2", anchor="start" if label_side > 0 else "end")
        return dict(name=name, a=a["name"], b=b["name"], p0=p0, p1=p1)

    def boundary(self, name, x0, y0, x1, y1, title=None, size=22):
        """Lumpy dashed loop (a system or trust boundary) with an optional title inside its top-left."""
        k = self.sketch(name)
        rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        pts = []
        for i in range(12):
            a = 2 * math.pi * i / 12
            c, s = math.cos(a), math.sin(a)
            r = 1.0 / max(abs(c) ** 6 + abs(s) ** 6, 1e-9) ** (1 / 6)
            pts.append((cx + rx * c * r * 0.98, cy + ry * s * r * 0.98))
        k.dashed_loop(pts, color=GR)
        if title:
            self.text(name + ":title", title, x0 + 0.3, y0 + 0.42, size, role="ink-2", weight=300)
        return dict(name=name, box=(x0, y0, x1, y1))

    # ---------- QA ----------
    def check(self, raise_on_error=True, scale=2):
        """Collisions and legibility, measured on a raster of the real geometry.

        errors: a stroke through or touching a label's clearance zone; two labels overlapping;
                ink outside the frame.
        warnings: Kalam under 18 px; labels under 13 px at the narrowest display width.
        """
        from PIL import Image, ImageDraw
        W, H = int(self.w * PX * scale), int(self.h * PX * scale)
        errors, warnings = [], []
        masks = {}
        for name, k in self.elements:
            m = Image.new("1", (W, H), 0)
            dr = ImageDraw.Draw(m)
            for poly, color in k.items:
                if color in (WASH, BG):
                    continue
                dr.polygon([(x * PX * scale, y * PX * scale) for x, y in poly], fill=1)
            masks[name] = m
        # knockouts hide earlier strokes
        order = [n for n, _ in self.elements]
        for i, (name, k) in enumerate(self.elements):
            ko = [p for p, c in k.items if c == BG]
            if not ko:
                continue
            km = Image.new("1", (W, H), 0)
            ImageDraw.Draw(km).polygon  # noqa
            for p in ko:
                ImageDraw.Draw(km).polygon([(x * PX * scale, y * PX * scale) for x, y in p], fill=1)
            for prev in order[:i]:
                masks[prev] = Image.composite(Image.new("1", (W, H), 0), masks[prev], km)
        for name, k in self.elements:
            if not k.items:
                continue
            x0, y0, x1, y1 = k.bbox()
            if x0 < 0 or y0 < 0 or x1 > self.w or y1 > self.h:
                errors.append("CLIP %s: ink outside the frame (%.2f, %.2f, %.2f, %.2f in)" % (name, x0, y0, x1, y1))
        for t in self.texts:
            bx0, by0, bx1, by1 = t["box"]
            if bx0 < 0 or by0 < 0 or bx1 > self.w * PX or by1 > self.h * PX:
                errors.append("CLIP %s: label outside the frame" % t["name"])
            pad = 0.03 * PX + 0.06 * t["size"]
            zone = (int((bx0 - pad) * scale), int((by0 - pad) * scale), int((bx1 + pad) * scale), int((by1 + pad) * scale))
            owner = t["name"].split(":")[0]
            for name, m in masks.items():
                if frozenset((name, t["name"])) in self.overlaps or frozenset((name, owner)) in self.overlaps:
                    continue
                crop = m.crop(zone)
                hits = sum(crop.getdata())
                if hits > 2 * scale:
                    errors.append("LINE_THROUGH_TEXT %s crosses or touches %r" % (name, t["s"]))
            if t["family"] == "Kalam" and t["size"] < 18:
                warnings.append("SMALL_KALAM %r at %spx (floor 18)" % (t["s"], t["size"]))
            shown = min(1.0, self.min_display_px / (self.w * PX)) * t["size"]
            if shown < 13:
                warnings.append("PHONE_LEGIBILITY %r renders at %.1fpx on a %dpx-wide screen; give the figure a "
                                "narrow variant (stacked layout) or shrink its width" % (t["s"], shown, self.min_display_px))
        for i, a in enumerate(self.texts):
            for b in self.texts[i + 1:]:
                if frozenset((a["name"], b["name"])) in self.overlaps:
                    continue
                if a["box"][0] < b["box"][2] and b["box"][0] < a["box"][2] and a["box"][1] < b["box"][3] and b["box"][1] < a["box"][3]:
                    errors.append("TEXT_OVERLAP %r and %r" % (a["s"], b["s"]))
        self.report = dict(errors=errors, warnings=warnings)
        if errors and raise_on_error:
            raise FigureError("Figure QA failed:\n  " + "\n  ".join(errors))
        return self.report

    # ---------- output ----------
    def _path(self, polys):
        out = []
        for p in polys:
            pts = ["%.1f %.1f" % (x * PX, y * PX) for x, y in p]
            out.append("M" + " L".join(pts) + "Z")
        return "".join(out)

    def svg(self, standalone=False, id_prefix="fig"):
        W, H = self.w * PX, self.h * PX
        tid, did = id_prefix + "-t", id_prefix + "-d"
        lab = 'aria-labelledby="%s%s"' % (tid, (" " + did) if self.desc else "")
        out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" width="%.0f" height="%.0f" role="img" %s class="ksyt-fig">'
               % (W, H, W, H, lab),
               '<title id="%s">%s</title>' % (tid, html.escape(self.title))]
        if self.desc:
            out.append('<desc id="%s">%s</desc>' % (did, html.escape(self.desc)))
        if standalone:
            out.append("<style>" + self._style() + "</style>")
        for name, k in self.elements:
            groups = {}
            for poly, color in k.items:
                groups.setdefault(ROLE.get(color, "ink"), []).append(poly)
            st = self.steps.get(name, 0)
            out.append('<g data-name="%s"%s>' % (html.escape(name), ' data-step="%d"' % st if st else ""))
            # keep stacking order: knockouts and washes first only if they came first; emit in first-seen order
            seen = []
            for poly, color in k.items:
                r = ROLE.get(color, "ink")
                if r not in seen:
                    seen.append(r)
            for r in seen:
                out.append('<path class="k-%s" d="%s"/>' % (r, self._path(groups[r])))
            out.append("</g>")
        for t in self.texts:
            anchor = "" if t["anchor"] == "start" else ' text-anchor="%s"' % t["anchor"]
            wt = "" if t["weight"] == 400 else ' font-weight="%d"' % t["weight"]
            st = ' data-step="%d"' % t["step"] if t["step"] else ""
            out.append('<text class="k-hand k-%s" data-name="%s"%s x="%.1f" y="%.1f" font-size="%s"%s%s>%s</text>'
                       % (t["role"], html.escape(t["name"]), st, t["x"] * PX, t["y"] * PX, t["size"], anchor, wt,
                          html.escape(t["s"])))
        out.append("</svg>")
        return "\n".join(out)

    def _style(self):
        css = ["text.k-hand{font-family:Kalam,'Atkinson Hyperlegible Next',sans-serif}"]
        css += [".k-%s{fill:var(--%s,%s)}" % (r, r, v) for r, v in LIGHT.items()]
        css.append("@media (prefers-color-scheme:dark){" + "".join(
            ".k-%s{fill:var(--%s,%s)}" % (r, r, v) for r, v in DARK.items()) + "}")
        chars = "".join(sorted({c for t in self.texts for c in t["s"]}))
        faces = []
        for wt in sorted({t["weight"] for t in self.texts}):
            data = _subset_woff2(find_font("Kalam", wt), chars)
            if data:
                faces.append("@font-face{font-family:Kalam;font-weight:%d;src:url(data:font/woff2;base64,%s) format('woff2')}"
                             % (wt, data))
        return "".join(faces + css)

    def save(self, path, standalone=False):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(self.svg(standalone=standalone, id_prefix=os.path.splitext(os.path.basename(path))[0].replace(".", "-")))
        return path


def _subset_woff2(font_path, chars):
    """Kalam subset to just the characters used, as base64 WOFF2 (SIL OFL permits embedding)."""
    if not chars:
        return ""
    try:
        from fontTools import subset
    except ImportError:
        sys.stderr.write("fonttools not installed: standalone SVG text will use the viewer's Kalam if any\n")
        return ""
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    f = subset.load_font(font_path, opts)
    s = subset.Subsetter(opts)
    s.populate(text=chars + " ")
    s.subset(f)
    buf = io.BytesIO()
    subset.save_font(f, buf, opts)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- ready-made art ----------
def narrator_svg(pose="stand", face="neutral", facing=1, title=None, pad=0.18):
    """A single narrator pose, cropped to his ink, as a Figure."""
    k, at = character.narrator(0, 0, 1.0, pose=pose, face=face, facing=facing, seed=seed_for("narrator"))
    x0, y0, x1, y1 = k.bbox()
    f = Figure(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad,
               title=title or "Kyle, the channel's stick-figure narrator with round glasses (%s, %s)" % (pose, face))
    f.draw("narrator", k.transformed(dx=pad - x0, dy=pad - y0, rot=0, pivot=(0, 0)))
    return f


def head_mark(pad=0.06):
    """Just the narrator's head and glasses: the site mark and favicon."""
    k, at = character.narrator(0, 0, 1.0, pose="stand", face="neutral", seed=seed_for("narrator"))
    hx, hy = at["head"]
    r = at["head_r"]
    head = Sketch(1)
    for poly, color in k.items:
        ys = [p[1] for p in poly]
        if min(ys) < hy + r * 0.98:      # everything that starts above the chin
            if max(ys) > hy + r + 0.04:   # the body stroke starts at the chin; skip it
                continue
            head.items.append((poly, color))
    x0, y0, x1, y1 = head.bbox()
    f = Figure(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, title="Kyle Schlaepfer")
    f.draw("mark", head.transformed(dx=pad - x0, dy=pad - y0, rot=0, pivot=(0, 0)))
    return f


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Export house-style art to SVG.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("narrator", help="one narrator pose")
    n.add_argument("--pose", default="stand", choices=sorted(character.POSES))
    n.add_argument("--face", default="neutral", choices=["neutral", "happy", "proud", "worried", "surprised", "wince", "frown"])
    n.add_argument("--facing", type=int, default=1)
    n.add_argument("--out", required=True)
    n.add_argument("--standalone", action="store_true")
    m = sub.add_parser("mark", help="head-and-glasses mark (logo, favicon)")
    m.add_argument("--out", required=True)
    m.add_argument("--standalone", action="store_true")
    a = ap.parse_args()
    fig = narrator_svg(a.pose, a.face, a.facing) if a.cmd == "narrator" else head_mark()
    fig.check()
    print(fig.save(a.out, standalone=a.standalone))
