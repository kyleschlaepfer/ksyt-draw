"""Reusable diagram grammars in the house style, for topics that aren't stories or ratios.

Each helper registers hand-drawn strokes (deck.draw) and handwritten labels (deck.write) on the
deck, and returns a dict with the names it created (to pass to d.slide(add=...)) and anchor points
(to aim arrows and connectors). Everything stays editable in PowerPoint.

    from diagrams import entity, highlight, relationship, step, decision, flow, timeline

Pick the grammar from what the concept IS, not from what the last lesson used:
  schema / data model     entity() + relationship()   (crow's-foot cardinality)
  procedure / workflow    step() + decision() + flow() (every decision branch labeled)
  sequence over time      timeline()
  quantities / ratios     pen.py strips, fractions, dimension lines
  containment / scope     pen.py dashed_loop (system and trust boundaries)
  UML use cases           actor() + use_case() + subject_boundary() + association() + dependency()
  UML activity            initial_node() + step() + decision() + fork_bar() + final_node()
  flowchart               terminator() + step(kind="process") + decision() + flow()

Every helper also records what it MEANS (diagram_model.py): the kind of element, its label, and for
connectors which elements they join, so Deck.save() can write <Lesson>.diagrams.json for the
diagram-semantics-reviewer. Drawing is unchanged by the recording. Connector ends resolve to the
element whose anchor (or box) they touch; pass src=/dst= names when that would be ambiguous.
Declare the diagram's claimed type and notation profile with d.diagram_meta(member, type=..., ...).
"""
import math

from pen import Sketch, CH, GR, GREEN, seed_for
from deck import text_width, ascent
import diagram_model as dm


def _K(name):
    """Sketch seeded from the element's own name. Adding, removing or reordering other elements never
    changes this one's wobble (a running counter did: inserting one box reshaped every later element,
    and decks built in the same process got different strokes)."""
    return Sketch(seed_for(name.lstrip("!")))


def _ink_rows(text, font, pt):
    """How far the text's real ink reaches above and below its baseline, in inches (measured with the font file)."""
    from deck import _pil
    x0, y0, x1, y1 = _pil(font).getbbox(text, anchor="ls")
    k = pt / 72.0 / 1000.0
    return -y0 * k, max(0, y1) * k


def _center_text(d, name, text, cx, baseline, pt, font="Kalam", color=CH):
    return d.write(name, text, cx - text_width(text, font, pt) / 2, baseline, pt, font, color)


# ---------------- data models ----------------
# room under the last row: a key underline sits ~0.1 in under its baseline, and with only 0.08 in of padding its
# wobble could end up 0.1 in from the table's bottom edge (an almost-touch)
ENTITY_BOTTOM_PAD = 0.16


def entity_size(title, rows, pt=26, key_col=None):
    """(width, height) entity() will draw for these rows, so a row of tables can be laid out before drawing
    (compose.row([...widths], region))."""
    keys = [kk for _, kk in rows if kk]
    if key_col is None:
        key_col = (max(text_width(kk.lower(), "Kalam Light", pt - 6) for kk in keys) + 0.3) if keys else 0.0
    tw = max([text_width(title, "Kalam", pt + 2)] + [text_width(c, "Kalam", pt) for c, _ in rows])
    return key_col + tw + 0.45, pt / 72 * 1.75 + pt / 72 * 1.55 * len(rows) + ENTITY_BOTTOM_PAD


def entity(d, name, x, y, title, rows, pt=26, width=None, key_col=None):
    """Table box: title band, then one row per column.

    rows: list of (column_name, key) where key is "PK", "FK", "PK FK" or None.
    PK columns are underlined (classic ERD notation), and keys are tagged in a narrow left column
    in graphite, so the notation reads without color. Returns
    {"names": [...], "left": x, "right": x1, "top": y, "bottom": y1, "row_y": [centre y of each row],
     "title": text name, "rows": [text names]}.
    """
    keys = [kk for _, kk in rows if kk]
    if key_col is None:
        key_col = (max(text_width(kk.lower(), "Kalam Light", pt - 6) for kk in keys) + 0.3) if keys else 0.0
    row_h = pt / 72 * 1.55
    title_h = pt / 72 * 1.75
    tw = max([text_width(title, "Kalam", pt + 2)] + [text_width(c, "Kalam", pt) for c, _ in rows])
    w = width or (key_col + tw + 0.45)
    x1 = x + w
    y1 = y + title_h + row_h * len(rows) + ENTITY_BOTTOM_PAD
    k = _K(name)
    k.knockout([(x, y), (x1, y), (x1, y1), (x, y1)])  # connectors behind the table stay hidden
    k.loose_rect(x, y, x1, y1)
    k.pen([(x + 0.02, y + title_h), ((x + x1) / 2, y + title_h - 0.012), (x1 - 0.02, y + title_h + 0.005)], width=0.028)
    if any(kk for _, kk in rows):
        k.pen([(x + key_col, y + title_h + 0.04), (x + key_col + 0.005, (y + title_h + y1) / 2), (x + key_col - 0.004, y1 - 0.04)],
              GR, 0.018)
    names = [d.draw(name, k)]
    tname = _center_text(d, name + "-title", title, (x + x1) / 2, y + title_h * 0.7, pt + 2)
    names.append(tname)
    row_names, row_y = [], []
    a = ascent("Kalam") * pt / 72
    for i, (col, key) in enumerate(rows):
        top = y + title_h + i * row_h
        base = top + (row_h + a * 0.72) / 2
        cx = x + (key_col if any(kk for _, kk in rows) else 0.0) + 0.18
        rn = d.write("%s-r%d" % (name, i), col, cx, base, pt)
        row_names.append(rn)
        names.append(rn)
        row_y.append(top + row_h / 2)
        if key:
            names.append(d.write("%s-k%d" % (name, i), key.lower(), x + 0.12, base, pt - 6, "Kalam Light", GR))
        if key and "PK" in key.upper():
            u = _K("%s-u%d" % (name, i)).pen([(cx - 0.02, base + 0.1), (cx + text_width(col, "Kalam", pt) / 2, base + 0.09),
                          (cx + text_width(col, "Kalam", pt) + 0.04, base + 0.1)], CH, 0.024, taper_in=0)
            names.append(d.draw("%s-u%d" % (name, i), u))
            d.allow_overlap("%s-u%d" % (name, i), rn)
    dm.node(d, name, "entity", title, names, bbox=(x, y, x1, y1),
            rows=[{"name": c, "key": kk} for c, kk in rows])
    return dict(names=names, left=x, right=x1, top=y, bottom=y1, row_y=row_y, title=tname, rows=row_names, key_col=key_col)


def highlight(d, name, ent, rows):
    """Highlighter wash behind some of an entity's rows (a composite key, the column the lesson is about).

    Registered directly above the entity's box in the stacking order: a wash registered *before* the
    box would be hidden by the box's knockout fill, and one registered after its key underlines would
    cover them. Text always renders on top. Returns the wash's name for d.slide(add=...).
    """
    rh = (ent["row_y"][1] - ent["row_y"][0]) if len(ent["row_y"]) > 1 else 0.5
    y0 = min(ent["row_y"][i] for i in rows) - rh / 2 + 0.04
    y1 = max(ent["row_y"][i] for i in rows) + rh / 2 - 0.04
    k = _K(name)
    k.wash(ent["left"] + ent["key_col"] + 0.05, y0, ent["right"] - 0.06, y1)
    nm = d.draw(name, k)
    box = d._expand(ent["names"][0])[0]
    d.z.remove(nm)
    d.z.insert(d.z.index(box) + 1, nm)
    return nm


def _end_mark(k, p, toward, card, color):
    """Crow's-foot cardinality mark at endpoint p of a connector heading toward `toward`."""
    ux, uy = toward[0] - p[0], toward[1] - p[1]
    L = math.hypot(ux, uy) or 1.0
    ux, uy = ux / L, uy / L
    nx, ny = -uy, ux

    def at(t, o=0.0):
        return (p[0] + ux * t + nx * o, p[1] + uy * t + ny * o)
    many = "many" in card
    if many:  # three prongs fanning out to the table edge
        for o in (-0.16, 0.0, 0.16):
            k.pen([at(0.3), at(0.15, o * 0.5), at(0.0, o)], color, 0.026, taper_in=0, taper_out=0)
    if card in ("one", "one-and-only-one", "one-or-many"):
        k.pen([at(0.38 if many else 0.2, -0.14), at(0.38 if many else 0.2, 0.14)], color, 0.026, taper_in=0, taper_out=0)
    if card == "one-and-only-one":
        k.pen([at(0.3, -0.14), at(0.3, 0.14)], color, 0.026, taper_in=0, taper_out=0)
    if card.startswith("zero"):
        c = at(0.5)
        r = 0.08
        pts = [(c[0] + r * math.cos(math.radians(a)), c[1] + r * math.sin(math.radians(a))) for a in range(0, 400, 40)]
        k.pen(pts, color, 0.022, pieces=2)


def relationship(d, name, a, b, card_a="one", card_b="many", color=CH, label=None, label_pt=24, src=None, dst=None):
    """Connector between two points (usually table edges at a row's y) with crow's-foot ends.

    card_*: "one", "one-and-only-one", "many", "one-or-many", "zero-or-one", "zero-or-many".
    When the rows sit at different heights the line takes an elbow, so both ends meet their tables
    horizontally and the cardinality marks stay square and readable.
    label: optional verb phrase written above the middle of the line ("enrolls in").
    Returns {"names": [...], "mid": (x, y)}.
    """
    k = _K(name)
    mx = (a[0] + b[0]) / 2
    if abs(a[1] - b[1]) < 0.05:
        mid = (mx, (a[1] + b[1]) / 2 - 0.01)
        k.pen([a, mid, b], color, 0.03, taper_in=0, taper_out=0)
        ta, tb = b, a
    else:
        r = min(0.15, abs(a[1] - b[1]) / 2, abs(b[0] - a[0]) / 4)
        sy = 1 if b[1] > a[1] else -1
        sx = 1 if b[0] > a[0] else -1
        pts = [a, (mx - sx * r, a[1]), (mx, a[1] + sy * r), (mx, b[1] - sy * r), (mx + sx * r, b[1]), b]
        # straight runs get intermediate points so smoothing doesn't bulge the corners
        k.pen([pts[0], ((pts[0][0] + pts[1][0]) / 2, a[1]), pts[1], pts[2]], color, 0.03, taper_in=0, taper_out=0)
        k.pen([pts[2], (mx, (a[1] + b[1]) / 2), pts[3]], color, 0.03, taper_in=0, taper_out=0)
        k.pen([pts[3], pts[4], ((pts[4][0] + pts[5][0]) / 2, b[1]), pts[5]], color, 0.03, taper_in=0, taper_out=0)
        mid = (mx, (a[1] + b[1]) / 2)
        ta, tb = (mx, a[1]), (mx, b[1])
    _end_mark(k, a, ta, card_a, color)
    _end_mark(k, b, tb, card_b, color)
    names = [d.draw(name, k)]
    if label:
        names.append(_center_text(d, name + "-label", label, mid[0], mid[1] - 0.14, label_pt, "Kalam Light", GR))
    dm.edge(d, name, "relationship", a, b, names, src, dst, card_from=card_a, card_to=card_b, label=label,
            style="crowsfoot", directed=False)
    return dict(names=names, mid=mid)


# ---------------- processes ----------------
def step(d, name, cx, cy, text, pt=28, pad=0.3, color=CH, kind="action", w=None):
    """Process step sized to its text. Returns names and edge anchors.

    kind="action" (default): rounded box, a UML activity action. kind="process": square-cornered box,
    the classic flowchart process symbol.
    w: fixed width for peers (steps of equal status in one row share a size: compose.uniform_width()).
    Never narrower than the text plus padding."""
    w = max(w or 0, text_width(text, "Kalam", pt) + 2 * pad)
    h = pt / 72 * 1.9
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    k = _K(name)
    k.knockout([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    if kind == "process":
        k.loose_rect(x0, y0, x1, y1, color=color)
    else:
        k.rounded_rect(x0, y0, x1, y1, r=min(0.18, h / 3), color=color, step=0.16)
    names = [d.draw(name, k)]
    a = ascent("Kalam") * pt / 72
    names.append(_center_text(d, name + "-t", text, cx, cy + a * 0.36, pt))
    anchors = dict(left=(x0, cy), right=(x1, cy), top=(cx, y0), bottom=(cx, y1))
    dm.node(d, name, kind, text, names, anchors.values(), (x0, y0, x1, y1))
    return dict(names=names, box=(x0, y0, x1, y1), **anchors)


def decision(d, name, cx, cy, text, pt=26, color=CH, role="decision", pad=0.55):
    """Decision diamond with the question inside. Label every branch with flow(..., label="Yes"/"No").

    role="merge": the same diamond where paths join again (several in, one out); leave text "" for it.
    pad: extra half-width beyond the text. Raise it (or shorten the question) when layout review says the
    label touches the diamond; never shrink the type to fit."""
    tw = text_width(text, "Kalam", pt)
    hw, hh = tw / 2 + pad, pt / 72 * 1.45  # long questions need more pad: the diamond narrows toward its points
    k = _K(name)
    pts = [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
    k.knockout(pts)
    for i in range(4):
        p, q = pts[i], pts[(i + 1) % 4]
        k.pen([(p[0] + (q[0] - p[0]) * -0.02, p[1] + (q[1] - p[1]) * -0.02),
               ((p[0] + q[0]) / 2 + 0.01, (p[1] + q[1]) / 2 - 0.01),
               (q[0] + (q[0] - p[0]) * 0.02, q[1] + (q[1] - p[1]) * 0.02)], color, 0.03)
    names = [d.draw(name, k)]
    a = ascent("Kalam") * pt / 72
    if text:
        names.append(_center_text(d, name + "-t", text, cx, cy + a * 0.36, pt))
    dm.node(d, name, role, text, names, pts, (cx - hw, cy - hh, cx + hw, cy + hh))
    return dict(names=names, left=pts[3], right=pts[1], top=pts[0], bottom=pts[2], box=(cx - hw, cy - hh, cx + hw, cy + hh))


def flow(d, name, a, b, label=None, color=CH, bend=0.0, label_pt=24, label_side=1, src=None, dst=None, meaning=None,
         dashed=False):
    """Arrow from a to b (edge anchors). label: branch label ("Yes"/"No"), placed beside the shaft.

    meaning: what this arrow means when it isn't the diagram's default (control flow in a flowchart,
    data in a DFD, influence in a causal loop): e.g. "data-flow", "influence".
    dashed=True: a proposed, conditional or hypothetical flow (solid = what actually happens). Straight only."""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
    mid = (mx + nx * bend, my + ny * bend)
    gap = 0.06
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    if dashed:
        k = _K(name)
        t, tip = gap, (b[0] - ux * gap, b[1] - uy * gap)
        while t < L - gap - 0.14:
            e = min(t + 0.17, L - gap - 0.06)
            k.pen([(a[0] + ux * t, a[1] + uy * t), (a[0] + ux * e, a[1] + uy * e)], color, 0.028, taper_in=0, taper_out=0)
            t = e + 0.1
        for sgn in (-1, 1):
            ang = math.atan2(uy, ux) + math.pi + sgn * math.radians(27)
            k.pen([(tip[0] + 0.17 * math.cos(ang), tip[1] + 0.17 * math.sin(ang)), tip], color, 0.028, taper_in=0.25, taper_out=0.05)
        meaning = meaning or "proposed"
    else:
        k = _K(name).arrow([(a[0] + ux * gap, a[1] + uy * gap), mid, (b[0] - ux * gap, b[1] - uy * gap)], color, head=0.17)
    names = [d.draw(name, k)]
    if label:
        w = text_width(label, "Kalam", label_pt)
        if label_side:
            # the label's box (caps to descenders) clears the shaft by 0.1 in at any angle, on the chosen side
            top, bot = _ink_rows(label, "Kalam", label_pt)   # ink above / below the baseline, inches
            h = top + bot
            sx, sy = nx * label_side, ny * label_side
            off = w / 2 * abs(sx) + h / 2 * abs(sy) + 0.1
            cx, cy = mid[0] + sx * off, mid[1] + sy * off
            names.append(d.write(name + "-l", label, cx - w / 2, cy + h / 2 - bot, label_pt, "Kalam", GR))
        else:  # label_side=0: centered on the shaft (only for a label deliberately masked onto its line)
            lx, ly = mid[0], mid[1]
            names.append(d.write(name + "-l", label, lx - (w / 2 if abs(nx) <= 0.3 else 0), ly + 0.1, label_pt, "Kalam", GR))
    dm.edge(d, name, "arrow", a, b, names, src, dst, label=label, style="dashed-arrow" if dashed else "solid-arrow",
            directed=True, meaning=meaning)
    return dict(names=names, mid=mid)


# ---------------- time ----------------
def timeline(d, name, x0, x1, y, marks, pt=24, color=CH):
    """Horizontal timeline with labeled ticks. marks: list of (x, label, above?)."""
    k = _K(name).arrow([(x0, y + 0.005), ((x0 + x1) / 2, y - 0.01), (x1, y)], color, head=0.16)
    names = []
    for i, (mx, lab, above) in enumerate(marks):
        k.pen([(mx, y - 0.11), (mx + 0.004, y + 0.11)], color, 0.026, taper_in=0, taper_out=0)
        base = y - 0.25 if above else y + 0.45
        names.append(_center_text(d, "%s-m%d" % (name, i), lab, mx, base, pt))
    names.insert(0, d.draw(name, k))
    dm.node(d, name, "timeline", None, names, bbox=(x0, y - 0.2, x1, y + 0.2), marks=[m[1] for m in marks])
    return dict(names=names)


# ---------------- flowchart / UML notation (hand-drawn, still unmistakable) ----------------
def terminator(d, name, cx, cy, text, pt=26, pad=0.35, color=CH, w=None):
    """Flowchart start/end: a pill (fully rounded ends). w: fixed width (never narrower than the text)."""
    w = max(w or 0, text_width(text, "Kalam", pt) + 2 * pad)
    h = pt / 72 * 1.8
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    k = _K(name)
    k.knockout([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    k.rounded_rect(x0, y0, x1, y1, r=h / 2 - 0.01, color=color, step=0.14)
    names = [d.draw(name, k)]
    names.append(_center_text(d, name + "-t", text, cx, cy + ascent("Kalam") * pt / 72 * 0.36, pt))
    anchors = dict(left=(x0, cy), right=(x1, cy), top=(cx, y0), bottom=(cx, y1))
    dm.node(d, name, "terminator", text, names, anchors.values(), (x0, y0, x1, y1))
    return dict(names=names, box=(x0, y0, x1, y1), **anchors)


def initial_node(d, name, cx, cy, r=0.13, color=CH):
    """UML activity start: a small solid dot."""
    k = _K(name).dot(cx, cy, r, color)
    names = [d.draw(name, k)]
    anchors = dict(left=(cx - r, cy), right=(cx + r, cy), top=(cx, cy - r), bottom=(cx, cy + r))
    dm.node(d, name, "initial", None, names, anchors.values(), (cx - r, cy - r, cx + r, cy + r))
    return dict(names=names, **anchors)


def final_node(d, name, cx, cy, r=0.19, color=CH, flow_final=False):
    """UML activity end: a ring around a dot (bullseye). flow_final=True: a ring with an X (ends one path only)."""
    k = _K(name)
    k.loose_circle(cx, cy, r, r, color, 0.028)
    if flow_final:
        o = r * 0.62
        k.pen([(cx - o, cy - o), (cx + o, cy + o)], color, 0.026, taper_in=0, taper_out=0)
        k.pen([(cx + o, cy - o), (cx - o, cy + o)], color, 0.026, taper_in=0, taper_out=0)
    else:
        k.dot(cx, cy, r * 0.55, color)
    names = [d.draw(name, k)]
    anchors = dict(left=(cx - r, cy), right=(cx + r, cy), top=(cx, cy - r), bottom=(cx, cy + r))
    dm.node(d, name, "flow-final" if flow_final else "final", None, names, anchors.values(), (cx - r, cy - r, cx + r, cy + r))
    return dict(names=names, **anchors)


def fork_bar(d, name, cx, cy, length=2.4, vertical=False, color=CH, join=False):
    """UML fork (or join=True) synchronization bar: a thick, short bar, clearly heavier than any arrow."""
    t = 0.085
    if vertical:
        x0, y0, x1, y1 = cx - t / 2, cy - length / 2, cx + t / 2, cy + length / 2
    else:
        x0, y0, x1, y1 = cx - length / 2, cy - t / 2, cx + length / 2, cy + t / 2
    k = _K(name)
    k.blob([(x0, y0 + 0.004), ((x0 + x1) / 2, y0 - 0.006), (x1, y0), (x1 + 0.006, (y0 + y1) / 2), (x1, y1),
            ((x0 + x1) / 2, y1 + 0.005), (x0, y1), (x0 - 0.005, (y0 + y1) / 2)], color)
    names = [d.draw(name, k)]
    # anchors spread along the bar so several arrows can meet it
    n = 5
    if vertical:
        along = [(x0 if side < 0 else x1, y0 + (y1 - y0) * (i + 0.5) / n) for side in (-1, 1) for i in range(n)]
    else:
        along = [(x0 + (x1 - x0) * (i + 0.5) / n, y0 if side < 0 else y1) for side in (-1, 1) for i in range(n)]
    dm.node(d, name, "join" if join else "fork", None, names, along, (x0, y0, x1, y1))
    return dict(names=names, at=lambda f, side=1: (
        ((x1 if side > 0 else x0), y0 + (y1 - y0) * f) if vertical else (x0 + (x1 - x0) * f, (y1 if side > 0 else y0))),
        top=((cx, y0)), bottom=((cx, y1)), left=((x0, cy)), right=((x1, cy)))


def actor(d, name, cx, top, label, pt=24, h=1.05, color=CH):
    """UML actor: a stick figure (no face, no glasses: it's a role, not the narrator) with its role below."""
    k = _K(name)
    r = h * 0.14
    hy = top + r
    k.loose_circle(cx, hy, r, r, color, 0.026)
    neck, hip = hy + r, top + h * 0.62
    k.pen([(cx, neck), (cx + 0.004, (neck + hip) / 2), (cx, hip)], color, 0.028)
    k.pen([(cx - h * 0.26, neck + h * 0.16), (cx, neck + h * 0.12), (cx + h * 0.26, neck + h * 0.15)], color, 0.026)
    k.pen([(cx, hip), (cx - h * 0.22, top + h)], color, 0.027)
    k.pen([(cx, hip), (cx + h * 0.21, top + h - 0.01)], color, 0.027)
    names = [d.draw(name, k)]
    names.append(_center_text(d, name + "-t", label, cx, top + h + pt / 72 * 1.05, pt))
    bot = top + h + pt / 72 * 1.3
    w = max(h * 0.3, text_width(label, "Kalam", pt) / 2)
    anchors = dict(left=(cx - h * 0.3, top + h * 0.45), right=(cx + h * 0.3, top + h * 0.45), top=(cx, top), bottom=(cx, bot))
    dm.node(d, name, "actor", label, names, anchors.values(), (cx - w, top, cx + w, bot))
    return dict(names=names, **anchors)


def use_case(d, name, cx, cy, text, pt=26, color=CH):
    """UML use case: an ellipse with a verb phrase inside ("place order")."""
    rx = text_width(text, "Kalam", pt) / 2 + 0.42
    ry = pt / 72 * 1.05
    k = _K(name)
    k.knockout([(cx + rx * math.cos(t / 12 * 2 * math.pi), cy + ry * math.sin(t / 12 * 2 * math.pi)) for t in range(12)])
    k.loose_circle(cx, cy, rx, ry, color, 0.028)
    names = [d.draw(name, k)]
    names.append(_center_text(d, name + "-t", text, cx, cy + ascent("Kalam") * pt / 72 * 0.36, pt))
    anchors = dict(left=(cx - rx, cy), right=(cx + rx, cy), top=(cx, cy - ry), bottom=(cx, cy + ry))
    dm.node(d, name, "use-case", text, names, anchors.values(), (cx - rx, cy - ry, cx + rx, cy + ry))
    return dict(names=names, **anchors)


def subject_boundary(d, name, x0, y0, x1, y1, title, pt=24, color=GR):
    """UML subject (system) boundary: a box with the system's name inside its top edge.
    Use cases go inside; actors stay outside."""
    k = _K(name).loose_rect(x0, y0, x1, y1, color=color, width=0.026)
    names = [d.draw(name, k)]
    names.append(d.write(name + "-t", title, x0 + 0.2, y0 + pt / 72 * 1.25, pt, "Kalam", color))
    dm.node(d, name, "boundary", title, names, bbox=(x0, y0, x1, y1))
    return dict(names=names, left=x0, right=x1, top=y0, bottom=y1)


def association(d, name, a, b, color=CH, src=None, dst=None):
    """Plain line (no arrowhead): actor to use case, or a UML association."""
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.01)
    k = _K(name).pen([a, mid, b], color, 0.026, taper_in=0, taper_out=0)
    names = [d.draw(name, k)]
    dm.edge(d, name, "association", a, b, names, src, dst, style="plain-line", directed=False)
    return dict(names=names, mid=mid)


def dependency(d, name, a, b, stereotype="include", color=CH, label_pt=22, src=None, dst=None, dash=0.16, gap=0.1):
    """Dashed arrow with an open head and a «stereotype» label.

    «include»: arrow FROM the including (base) use case TO the included one.
    «extend»:  arrow FROM the extension TO the base use case it extends."""
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    k = _K(name)
    t = 0.06
    while t < L - 0.12:
        e = min(t + dash, L - 0.06)
        k.pen([(a[0] + ux * t, a[1] + uy * t), (a[0] + ux * e, a[1] + uy * e)], color, 0.022, taper_in=0, taper_out=0)
        t = e + gap
    tip = (b[0] - ux * 0.06, b[1] - uy * 0.06)
    for sgn in (-1, 1):
        ang = math.atan2(uy, ux) + math.pi + sgn * math.radians(28)
        k.pen([(tip[0] + 0.2 * math.cos(ang), tip[1] + 0.2 * math.sin(ang)), tip], color, 0.024, taper_in=0, taper_out=0)
    names = [d.draw(name, k)]
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    txt = "\u00ab%s\u00bb" % stereotype
    nx, ny = -uy, ux
    if ny > 0:  # put the label on the upper side of the line
        nx, ny = -nx, -ny
    w = text_width(txt, "Kalam Light", label_pt)
    top, bot = _ink_rows(txt, "Kalam Light", label_pt)
    h = top + bot
    off = w / 2 * abs(nx) + h / 2 * abs(ny) + 0.1  # the label's real ink box clears the line at any angle
    cx, cy = mid[0] + nx * off, mid[1] + ny * off
    names.append(_center_text(d, name + "-l", txt, cx, cy + h / 2 - bot, label_pt, "Kalam Light", GR))
    dm.edge(d, name, stereotype, a, b, names, src, dst, stereotype=stereotype, style="dashed-arrow", directed=True)
    return dict(names=names, mid=mid)


# ---------------- annotations and accumulation (not formal notation: not sent to the diagram reviewer) ----------------
def _target_geom(d, target):
    """('edge', a, b) for a connector drawn with diagrams.py, else ('box', (x0, y0, x1, y1)) from the recorded
    structural box (diagram nodes) or the target's real ink."""
    import compose
    name = target["names"][0] if isinstance(target, dict) else target
    raw = name.lstrip("!")
    m = getattr(d, "dmodel", None) or {"nodes": {}, "edges": {}}
    if raw in m["edges"] and m["edges"][raw].get("a") and m["edges"][raw].get("b"):
        e = m["edges"][raw]
        return raw, ("edge", e["a"], e["b"])
    if raw in m["nodes"] and m["nodes"][raw].get("bbox"):
        return raw, ("box", m["nodes"][raw]["bbox"])
    return raw, ("box", compose.ink_box(d, target))


def annotate(d, name, target, text=None, mark=None, side="right", gap=0.14, pt=26, font="Kalam", color=GR, s=1.0,
             along=0.5, about=None, align="center", x=None):
    """A note or mark that belongs to exactly one element, placed in its own lane beside it.

    target: an element name, a helper's return dict, or a connector drawn with flow()/relationship()/...
    text: the note ("auto", "manual?", "who approves?"); mark: "check", "x" or "?" (a drawn check or x, or a
    handwritten question mark in the accent color unless color= says otherwise).
    side: "right", "left", "top"/"above", "bottom"/"below" for boxes; for connectors "above"/"below"
    (or "left"/"right" on vertical ones) of the shaft, at fraction `along` from its start.
    align ("center"/"left"/"right"): for top/bottom notes, line the note up with the box's middle or one edge. A role
    note goes to one side so a connector can enter the box from the other (a note and a connector never share a lane).
    x: for left/right notes and marks, a shared column (the left edge of every note in it), so a column of checks
    lines up even when the boxes they mark have different widths. Each note stays centered on its own box's row.
    The clearance is measured from the label's real ink, so it never touches its target's line, and it
    records of=target so design QA can check nothing else sits closer (ANNOTATION_AMBIGUOUS).
    Returns {"names": [name]}.
    """
    raw, geom = _target_geom(d, target)
    side = {"above": "top", "below": "bottom"}.get(side, side)
    if mark in ("check", "x"):
        k = Sketch(seed_for(name))
        if mark == "check":
            k.check(0, 0, s, color if color != GR else GREEN)
        else:
            k.xmark(0, 0, s, color if color != GR else CH)
        bx0, by0, bx1, by1 = k.bbox()
        w, h = bx1 - bx0, by1 - by0
    else:
        txt = text if text is not None else "?"
        if mark == "?" and color == GR:
            color = GREEN
        top, bot = _ink_rows(txt, font, pt)
        w, h = text_width(txt, font, pt), top + bot
    if geom[0] == "edge":
        a, b = geom[1], geom[2]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        if ny > 1e-9 or (abs(ny) <= 1e-9 and nx > 0):
            nx, ny = -nx, -ny          # (nx, ny) now points up, or left on a vertical shaft
        if side in ("bottom", "right"):
            nx, ny = -nx, -ny
        px, py = a[0] + (b[0] - a[0]) * along, a[1] + (b[1] - a[1]) * along
        off = w / 2 * abs(nx) + h / 2 * abs(ny) + gap
        cx, cy = px + nx * off, py + ny * off
    else:
        x0, y0, x1, y1 = geom[1]
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        hx = {"center": mx, "left": x0 + w / 2, "right": x1 - w / 2}[align]
        cx, cy = {"right": (x1 + gap + w / 2, my), "left": (x0 - gap - w / 2, my),
                  "top": (hx, y0 - gap - h / 2), "bottom": (hx, y1 + gap + h / 2)}[side]
        if x is not None and side in ("left", "right"):
            cx = x + w / 2
    if mark in ("check", "x"):
        nm = d.draw(name, k.transformed(cx - (bx0 + bx1) / 2, cy - (by0 + by1) / 2), of=raw, about=about)
    else:
        nm = d.write(name, txt, cx - w / 2, cy + h / 2 - bot, pt, font, color, of=raw, about=about)
    return dict(names=[nm])


def stack(d, name, cx, base, labels, w=3.2, h=0.62, gap=0.15, pt=26, color=CH, about=None, organic=0.0):
    """Layers piled up from a fixed base line: accumulation (workarounds on workarounds, debt, system layers).

    Each layer is its own element (name-0 at the bottom, with its label name-0-t), so a reveal adds one layer
    per slide and nothing already drawn moves: the base and the width are the structural anchor.
    All layers share one size (peers). gap: the visible seam between layers; keep it above ~0.12 in, or the
    hand-drawn corner overshoots make neighbours touch (a near-touch reads as an accident).
    organic: deliberate irregularity in inches: a ragged left edge (each layer inset by 0, half or all of it, chosen
    the same way on every build) against a flush right edge. It's personality, declared: the group stops being
    "peers", so size QA doesn't flag it; marks beside it still share one column (annotate(..., x=result["lane"])). Returns {"names": all, "layers": [{"names", "left", "right", "top",
    "bottom", "cy"}...], "top": y of the top edge}.
    """
    import random
    layers, names = [], []
    prev = None
    for i, lab in enumerate(labels):
        y1 = base - i * (h + gap)
        y0 = y1 - h
        ln = "%s-%d" % (name, i)
        inset = 0.0
        if organic:
            # ragged left edge, flush right edge. Neighbouring edges either line up exactly or differ clearly: two
            # edges ALMOST in line point their corner overshoots at each other across the seam (a near-miss).
            rng = random.Random(seed_for(ln) * 13 + 7)
            steps = [0.0, 0.5 * organic, organic]
            ok = [st for st in steps if prev is None or st == prev or abs(st - prev) >= 0.45 * organic]
            inset = rng.choice(ok)
            prev = inset
        lw = w - inset
        lx = cx + inset / 2
        k = Sketch(seed_for(ln))
        k.knockout([(lx - lw / 2, y0), (lx + lw / 2, y0), (lx + lw / 2, y1), (lx - lw / 2, y1)])
        k.loose_rect(lx - lw / 2, y0, lx + lw / 2, y1, color=color)
        ns = [d.draw(ln, k, kind="layer", about="layer %d of %s%s" % (i + 1, name, (": " + lab) if lab else ""))]
        if lab:
            a = ascent("Kalam") * pt / 72
            ns.append(_center_text(d, ln + "-t", lab, lx, (y0 + y1) / 2 + a * 0.36, pt))
            d.describe(ns[-1], of=ln)
        layers.append(dict(names=ns, left=lx - lw / 2, right=lx + lw / 2, top=y0, bottom=y1, cy=(y0 + y1) / 2,
                           box=(lx - lw / 2, y0, lx + lw / 2, y1)))
        names += ns
    d.group(name, [l["names"][0] for l in layers], about=about or "stack", peers=not organic, kind="stack")
    lane = max(l["right"] for l in layers) + 0.3 if layers else cx + w / 2 + 0.3
    return dict(names=names, layers=layers, top=layers[-1]["top"] if layers else base, lane=lane)
