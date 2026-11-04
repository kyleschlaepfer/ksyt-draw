"""Regenerate every golden fixture from the real Python code in ../reference/.

    python3 fixtures/generate.py

Writes:
  fixtures/prng.json            Python random.Random(seed).random() / uniform() sequences
  fixtures/seeds.json           pen.seed_for(name) for a list of names
  fixtures/pen/*.json           pen.Sketch calls and the exact polygons they produce
  fixtures/diagrams/*.json      ksd_parse output for each .ksd (the parser's expected result)
  fixtures/diagrams/*.lint.json review_diagrams.Review findings for each diagram (the linter's expected result)
  fixtures/parse-errors.json    inputs that must fail, with the expected line number

The TypeScript port is correct when it reproduces all of these (polygons within 1e-9 in).
Never edit the JSON by hand: change the .ksd or the reference code, then rerun this.
"""
import glob
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "..", "reference")
sys.path.insert(0, REF)

import pen  # noqa: E402
from pen import Sketch, seed_for, GR, GREEN, CH  # noqa: E402
import ksd_parse  # noqa: E402
import review_diagrams  # noqa: E402


def dump(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


# ---------------------------------------------------------------- PRNG
def prng():
    out = []
    for seed in (0, 1, 3, 100, 1000, 1011, 7003, 65535, 99999, 101999, 4294967295, 4294967296, 123456789012):
        r = random.Random(seed)
        seq = [r.random() for _ in range(12)]
        r2 = random.Random(seed)
        uni = [r2.uniform(-0.015, 0.015) for _ in range(6)]
        out.append(dict(seed=seed, random=seq, uniform_m015_p015=uni))
    dump(os.path.join(HERE, "prng.json"), out)


def seeds():
    names = ["a", "resident", "apply", "e1", "ok", "decision-ok", "fork-split", "usecase-permit:pay",
             "approval:e3", "«include»", "Permit clerk", ""]
    dump(os.path.join(HERE, "seeds.json"), [dict(name=n, seed=seed_for(n)) for n in names])


# ---------------------------------------------------------------- pen
CASES = [
    ("pen-straight", 101, lambda k: k.pen([(0.5, 0.5), (2.5, 0.6)])),
    ("pen-curve-blunt", 102, lambda k: k.pen([(0.5, 1.0), (1.2, 0.6), (2.0, 1.1), (2.6, 0.7)], taper_in=0, taper_out=0)),
    ("pen-pieces", 103, lambda k: k.pen(pen.ellipse_pts(1.5, 1.0, 0.8, 0.4, start=180, sweep=395, n=10, seed=7), pieces=2)),
    ("arrow", 104, lambda k: k.arrow([(0.4, 1.0), (1.5, 0.85), (2.6, 1.0)], head=0.17)),
    ("loose-rect", 105, lambda k: k.loose_rect(0.5, 0.5, 2.5, 1.3)),
    ("rounded-rect", 106, lambda k: k.rounded_rect(0.5, 0.5, 2.7, 1.2, r=0.18, step=0.16)),
    ("pill", 107, lambda k: k.rounded_rect(0.5, 0.5, 2.3, 1.1, r=0.29, step=0.14)),
    ("loose-circle", 108, lambda k: k.loose_circle(1.5, 1.0, 1.0, 0.36, CH, 0.028)),
    ("dot", 109, lambda k: k.dot(1.0, 1.0, 0.13)),
    ("blob-bar", 110, lambda k: k.blob([(0.3, 0.96), (1.5, 0.95), (2.7, 0.96), (2.706, 1.0), (2.7, 1.04),
                                         (1.5, 1.045), (0.3, 1.04), (0.295, 1.0)])),
    ("dashed-loop", 111, lambda k: k.dashed_loop([(0.4, 0.4), (2.0, 0.35), (3.6, 0.45), (3.65, 1.5), (2.0, 1.6), (0.35, 1.5)], color=GR)),
    ("underline", 112, lambda k: k.underline(0.5, 2.0, 1.0)),
    ("check", 113, lambda k: k.check(1.0, 1.0)),
    ("xmark", 114, lambda k: k.xmark(1.0, 1.0)),
    ("wash", 115, lambda k: k.wash(0.5, 0.6, 2.5, 1.2)),
    ("knockout", 116, lambda k: k.knockout([(0.5, 0.5), (2.5, 0.5), (2.5, 1.3), (0.5, 1.3)])),
    ("hatch", 117, lambda k: k.hatch([(0.5, 0.5), (1.6, 0.5), (1.6, 1.2), (0.5, 1.2)])),
    ("seeded-by-name", seed_for("permit-portal:pay"), lambda k: k.loose_circle(1.5, 1.0, 0.9, 0.34, CH, 0.028)),
]


def pen_cases():
    for f in glob.glob(os.path.join(HERE, "pen", "*.json")):
        os.remove(f)
    index = []
    for name, seed, fn in CASES:
        k = Sketch(seed)
        fn(k)
        items = [dict(color=c, poly=[[x, y] for x, y in p]) for p, c in k.items]
        dump(os.path.join(HERE, "pen", name + ".json"), dict(case=name, sketch_seed=seed, ops=k.ops, items=items))
        index.append(dict(case=name, sketch_seed=seed, polys=len(items), points=sum(len(i["poly"]) for i in items)))
    # Calls are code, so record them as the exact source line for the port's test to mirror.
    src = open(__file__, encoding="utf-8").read().split("CASES = [", 1)[1].split("\n]\n", 1)[0]
    dump(os.path.join(HERE, "pen", "_index.json"), dict(cases=index, calls_source=src.strip().splitlines()))


# ---------------------------------------------------------------- parse + lint
PARSE_ERRORS = [
    ("diagram sequence\ntitle x", 1),
    ("title first\ndiagram flowchart", 1),
    ("diagram flowchart\ntitle t\nprocess a\nprocess a", 4),
    ("diagram flowchart\ntitle t\nwidget a", 3),
    ("diagram use-case\ntitle t\nboundary b \"B\" {\nuse-case u\n", 0),
    ("diagram use-case\ntitle t\nboundary b \"B\" {\nboundary c \"C\" {\n}\n}", 4),
    ("diagram flowchart\nprocess a", 0),
    ("diagram flowchart\ntitle a — b", 2),
    ("diagram flowchart\ntitle t\nprocess a \"x\" at 1", 3),
    ("diagram use-case\ntitle t\nstart s", 3),
    ("diagram flowchart\ntitle t\n}", 3),
]


def lint_view(findings):
    keep = ("severity", "rule_id", "location", "confidence")
    return sorted([{k: f[k] for k in keep} for f in findings], key=lambda f: (f["rule_id"], f["location"]))


def diagrams():
    for f in glob.glob(os.path.join(HERE, "diagrams", "*.json")):
        os.remove(f)
    for path in sorted(glob.glob(os.path.join(HERE, "diagrams", "*.ksd"))):
        base = os.path.splitext(path)[0]
        dg = ksd_parse.parse(open(path, encoding="utf-8").read())
        dump(base + ".json", dg)
        rv = review_diagrams.Review(dg)
        fs = rv.run()
        status = review_diagrams.status_for(fs, rv.inferred, rv.claimed)
        dump(base + ".lint.json", dict(inferred_family=rv.inferred, status=status, findings=lint_view(fs),
                                       full_findings=fs))
        print("%-28s %-18s %s" % (os.path.basename(path), status, ", ".join(f["rule_id"] for f in fs) or "-"))
    errs = []
    for src, line in PARSE_ERRORS:
        try:
            ksd_parse.parse(src)
            raise SystemExit("expected a ParseError for %r" % src)
        except ksd_parse.ParseError as ex:
            assert ex.line == line, (src, ex.line, line, ex.msg)
            errs.append(dict(source=src, line=ex.line, message=ex.msg))
    dump(os.path.join(HERE, "parse-errors.json"), errs)


if __name__ == "__main__":
    prng()
    seeds()
    pen_cases()
    diagrams()
    print("fixtures written")
