"""Reference parser for the KSyt diagram text format (.ksd). Executable spec: the TypeScript parser
in src/core/parse.ts must produce the same JSON for every file in fixtures/diagrams/ (see spec/diagram-text.md).

Output is a diagram in the diagram-semantics-reviewer's contract 1.0 shape (nodes, edges, claimed type,
profile, narration), plus web-only fields the reviewer ignores (title, desc, direction, per-element step,
at, side). Feed it straight to review_diagrams.Review(dg).run().

    python ksd_parse.py file.ksd            # prints the diagram JSON
"""
import json
import re
import sys

TYPES = ("flowchart", "activity", "use-case")
PROFILES = ("strict-uml", "uml-inspired", "general-diagram")
DEFAULT_PROFILE = {"flowchart": "general-diagram", "activity": "uml-inspired", "use-case": "uml-inspired"}
KINDS = ("action", "process", "decision", "merge", "fork", "join", "initial", "final", "flow-final",
         "terminator", "io", "actor", "use-case", "note")
UNLABELED = ("initial", "final", "flow-final", "fork", "join", "merge")
EDGE_OPS = [  # longest first
    ("-include->", dict(kind="include", style="dashed-arrow", directed=True)),
    ("-extend->", dict(kind="extend", style="dashed-arrow", directed=True)),
    ("..>", dict(kind="arrow", style="dashed-arrow", directed=True, meaning="proposed")),
    ("-->", dict(kind="arrow", style="solid-arrow", directed=True)),
    ("->", dict(kind="arrow", style="solid-arrow", directed=True)),
    ("--", dict(kind="association", style="plain-line", directed=False)),
]
ID = r"[A-Za-z][A-Za-z0-9_-]*"
NODE_RE = re.compile(r'^(?P<kind>[a-z-]+)\s+(?P<id>%s)(?:\s+"(?P<label>(?:[^"\\]|\\.)*)")?(?P<rest>.*)$' % ID)
EDGE_RE = re.compile(r'^(?P<a>%s)\s+(?P<op>-include->|-extend->|\.\.>|-->|->|--)\s+(?P<b>%s)\s*(?::\s*(?P<label>.*))?$' % (ID, ID))
HEADER = ("diagram", "id", "profile", "title", "desc", "narration", "direction", "legend")


class ParseError(Exception):
    def __init__(self, line, msg):
        super().__init__("line %d: %s" % (line, msg))
        self.line, self.msg = line, msg


def _unquote(s):
    return s.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


def _no_em_dash(text, line):
    if text and "—" in text:
        raise ParseError(line, "em dash in %r (house rule: no em dashes)" % text)


def parse(src):
    dg = dict(contract_version="1.0", diagram_id="diagram", claimed_diagram_type=None, notation_profile=None,
              narration_excerpt="", legend=None, nodes=[], edges=[],
              web=dict(title=None, desc="", direction="down"))
    warnings = []
    ids = set()
    step = 0
    boundary = None  # id of the open boundary block
    seen_body = False
    for ln, raw in enumerate(src.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        word = line.split(None, 1)[0]
        val = line[len(word):].strip()
        if dg["claimed_diagram_type"] is None:
            if word != "diagram":
                raise ParseError(ln, "the first line must be: diagram flowchart | activity | use-case")
            if val not in TYPES:
                raise ParseError(ln, "unknown diagram type %r (flowchart, activity, use-case)" % val)
            dg["claimed_diagram_type"] = val
            continue
        if word in HEADER and not seen_body:
            if word == "diagram":
                raise ParseError(ln, "diagram declared twice")
            if word == "id":
                if not re.fullmatch(ID, val):
                    raise ParseError(ln, "id must be a slug (letters, digits, - or _)")
                dg["diagram_id"] = val
            elif word == "profile":
                if val not in PROFILES:
                    raise ParseError(ln, "unknown profile %r" % val)
                dg["notation_profile"] = val
            elif word == "direction":
                if val not in ("down", "right"):
                    raise ParseError(ln, "direction is down or right")
                dg["web"]["direction"] = val
            elif word == "narration":
                _no_em_dash(val, ln)
                dg["narration_excerpt"] = (dg["narration_excerpt"] + " " + val).strip()
            elif word == "legend":
                _no_em_dash(val, ln)
                dg["legend"] = val
            else:  # title, desc
                _no_em_dash(val, ln)
                dg["web"][word] = val
            continue
        seen_body = True
        if line == "}":
            if boundary is None:
                raise ParseError(ln, "} without an open boundary")
            boundary = None
            continue
        if word == "step":
            if not re.fullmatch(r"\d+", val):
                raise ParseError(ln, "step takes a whole number")
            step = int(val)
            continue
        if word == "boundary":
            m = re.match(r'^(%s)\s+"((?:[^"\\]|\\.)*)"\s*\{$' % ID, val)
            if not m:
                raise ParseError(ln, 'boundary syntax: boundary <id> "title" {')
            if boundary is not None:
                raise ParseError(ln, "boundaries can't nest")
            bid, title = m.group(1), _unquote(m.group(2))
            _no_em_dash(title, ln)
            if bid in ids:
                raise ParseError(ln, "duplicate id %r" % bid)
            ids.add(bid)
            dg["nodes"].append(dict(id=bid, kind="boundary", label=title, step=step))
            boundary = bid
            continue
        m = EDGE_RE.match(line)
        if m:
            spec = dict(next(s for op, s in EDGE_OPS if op == m.group("op")))
            label = (m.group("label") or "").strip() or None
            _no_em_dash(label, ln)
            e = dict(id="e%d" % (len(dg["edges"]) + 1), kind=spec["kind"], **{"from": m.group("a"), "to": m.group("b")},
                     label=label, style=spec["style"], directed=spec["directed"], step=step)
            if "meaning" in spec:
                e["meaning"] = spec["meaning"]
            dg["edges"].append(e)
            continue
        m = NODE_RE.match(line)
        if not m:
            raise ParseError(ln, "can't read this line")
        kind = {"usecase": "use-case"}.get(m.group("kind"), m.group("kind"))
        if kind in ("start", "end"):
            t = dg["claimed_diagram_type"]
            if t == "use-case":
                raise ParseError(ln, "start/end don't exist in use-case diagrams")
            kind = ("terminator" if t == "flowchart" else ("initial" if kind == "start" else "final"))
            default_label = m.group("kind") if t == "flowchart" else None
        else:
            default_label = "AUTO"
        if kind not in KINDS:
            raise ParseError(ln, "unknown kind %r" % m.group("kind"))
        nid = m.group("id")
        if nid in ids:
            raise ParseError(ln, "duplicate id %r" % nid)
        ids.add(nid)
        if m.group("label") is not None:
            label = _unquote(m.group("label"))
        elif default_label == "AUTO":
            label = None if kind in UNLABELED else re.sub(r"[-_]+", " ", nid)
        else:
            label = default_label
        _no_em_dash(label, ln)
        node = dict(id=nid, kind=kind, label=label, step=step)
        rest = m.group("rest").split()
        i = 0
        while i < len(rest):
            tok = rest[i]
            if tok in ("left", "right"):
                node["side"] = tok
                i += 1
            elif tok == "at":
                nums = rest[i + 1:i + 3]
                if len(nums) != 2 or not all(re.fullmatch(r"-?\d+(\.\d+)?", n) for n in nums):
                    raise ParseError(ln, "at takes two numbers in inches: at X Y")
                node["at"] = [float(nums[0]), float(nums[1])]
                i += 3
            else:
                raise ParseError(ln, "unknown option %r (left, right, at X Y)" % tok)
        if boundary is not None:
            node["inside"] = boundary
        dg["nodes"].append(node)
    if dg["claimed_diagram_type"] is None:
        raise ParseError(0, "empty diagram")
    if boundary is not None:
        raise ParseError(0, "boundary %r is never closed with }" % boundary)
    if not dg["web"]["title"]:
        raise ParseError(0, "a diagram needs a title: one line saying what it shows (its finding, not its topic)")
    if dg["notation_profile"] is None:
        dg["notation_profile"] = DEFAULT_PROFILE[dg["claimed_diagram_type"]]
    for e in dg["edges"]:
        for end in ("from", "to"):
            if e[end] not in ids:
                warnings.append(dict(code="PARSE-UNKNOWN-NODE", edge=e["id"], end=end, node=e[end]))
    dg["web"]["warnings"] = warnings
    return dg


if __name__ == "__main__":
    try:
        print(json.dumps(parse(open(sys.argv[1], encoding="utf-8").read()), indent=2, ensure_ascii=False))
    except ParseError as ex:
        print("ParseError", ex, file=sys.stderr)
        sys.exit(1)
