import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { lint, norm, cue, EXCLUSIVE_CUES, PARALLEL_CUES } from "../src/core/lint";
import { parse } from "../src/core/parse";
import type { Diagram, Finding } from "../src/core/model";

const DIR = new URL("../fixtures/diagrams/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".lint.json")).sort();

const byKey = (fs: Finding[]) => [...fs].sort((a, b) => (a.rule_id + "\u0000" + a.location).localeCompare(b.rule_id + "\u0000" + b.location));

describe("lint.ts reproduces review_diagrams.Review", () => {
  it("has the nine fixtures", () => expect(files.length).toBe(9));
  for (const f of files) {
    it(f, () => {
      const dg: Diagram = JSON.parse(readFileSync(new URL(f.replace(/\.lint\.json$/, ".json"), DIR), "utf8"));
      const want = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
      const got = lint(dg);
      expect(got.inferred_family).toBe(want.inferred_family);
      expect(got.status).toBe(want.status);
      expect(byKey(got.findings)).toEqual(byKey(want.full_findings));
    });
  }
});

describe("lint helpers and traps", () => {
  it("norm lowercases, strips punctuation and collapses space", () => {
    expect(norm("  Apply, for   Permit!  ")).toBe("apply for permit");
    expect(norm(null)).toBe("");
  });
  it("cue matches the ASCII patterns", () => {
    expect(cue(EXCLUSIVE_CUES, "The customer EITHER gets a refund")).toEqual(["\\beither\\b"]);
    expect(cue(PARALLEL_CUES, "run at the same time")).toEqual(["\\bat the same time\\b"]);
    expect(cue(EXCLUSIVE_CUES, "neither here")).toEqual([]);
  });
  it("profile general-diagram drops uml-only rules, strict-uml raises severities", () => {
    const src = "diagram use-case\ntitle t\nPROFILE\nactor a\nboundary b \"B\" {\nuse-case u\n}\na -> u";
    const general = lint(parse(src.replace("PROFILE", "profile general-diagram")));
    expect(general.findings.map((f) => f.rule_id)).toEqual(["PROFILE-MISMATCH", "UC-LABEL-VERB"]);
    expect(general.status).toBe("pass-with-notes");
    const strict = lint(parse(src.replace("PROFILE", "profile strict-uml")));
    const dir = strict.findings.find((f) => f.rule_id === "UC-ASSOC-DIRECTED");
    expect(dir?.severity).toBe("major");
  });
  it("legend silences XDIAG-ARROW-MEANING; without it mixed meanings on one style are reported", () => {
    const base = "diagram flowchart\ntitle t\nLEGEND\nprocess a\nprocess b\nprocess c\na -> b\nb ..> c\na -include-> c";
    const noLegend = lint(parse(base.replace("LEGEND\n", "")));
    expect(noLegend.findings.some((f) => f.rule_id === "XDIAG-ARROW-MEANING")).toBe(true);
    const withLegend = lint(parse(base.replace("LEGEND", "legend dashed means proposed")));
    expect(withLegend.findings.some((f) => f.rule_id === "XDIAG-ARROW-MEANING")).toBe(false);
  });
  it("votes keep insertion order on a tie (Python max returns the first key)", () => {
    const spec = (kinds: string[]) => ({
      claimed_diagram_type: "unknown", nodes: kinds.map((k, i) => ({ id: "n" + i, kind: k, label: k })), edges: [],
    });
    expect(lint(spec(["entity", "use-case"])).inferred_family).toBe("data");
    expect(lint(spec(["use-case", "entity"])).inferred_family).toBe("use-case");
    // a use-case node plus a flow node is a flow by the special rule, not a tie
    expect(lint(parse("diagram use-case\ntitle t\nuse-case u\nprocess p\nu -- p")).inferred_family).toBe("flow");
  });
  it("flow checks: decision with one exit, dead end, fork structure, guarded fork, no initial/final", () => {
    const r = lint(parse(
      "diagram activity\ntitle t\naction a\ndecision d \"ok?\"\naction b\nfork f\naction c\nstart s\nend e\n" +
      "s -> a\na -> d\nd -> b\nb -> f\nf -> c : [x]\n",
    ));
    const ids = r.findings.map((f) => f.rule_id).sort();
    expect(ids).toEqual(["ACTIVITY-DEAD-END", "ACTIVITY-DECISION-ONE-EXIT", "ACTIVITY-FORK-STRUCTURE", "ACTIVITY-GUARDED-FORK", "STRUCT-ISOLATED"]);
    const dead = r.findings.find((f) => f.rule_id === "ACTIVITY-DEAD-END")!;
    expect(dead.minimal_fix).toBe("Continue the arrow or add an end (final node).");
  });
  it("activity without initial and final gets suggestions; strict-uml makes them minor", () => {
    const r = lint(parse("diagram activity\ntitle t\naction a\naction b\na -> b"));
    expect(r.findings.map((f) => [f.rule_id, f.severity])).toEqual([["ACTIVITY-NO-INITIAL", "suggestion"], ["ACTIVITY-NO-FINAL", "suggestion"]]);
    expect(r.status).toBe("pass-with-notes");
    const s = lint(parse("diagram activity\ntitle t\nprofile strict-uml\naction a\naction b\na -> b"));
    expect(s.findings.map((f) => f.severity)).toEqual(["minor", "minor"]);
  });
  it("isolated nodes and the not-a-diagram status", () => {
    const r = lint(parse("diagram flowchart\ntitle t\nprocess a\nprocess b\nprocess c\na -> b"));
    expect(r.findings.map((f) => [f.rule_id, f.location])).toEqual([["STRUCT-ISOLATED", "process 'c'"]]);
    const notes = lint(parse("diagram flowchart\ntitle t\nnote n \"just a note\""));
    expect(notes.inferred_family).toBe("sketch");
    expect(notes.status).toBe("pass");
  });
  it("use-case: outside boundary, one-word non-verb label, extend direction by structure (a -> between use cases is an association under claimed use-case)", () => {
    const r = lint(parse(
      "diagram use-case\ntitle t\nactor a\nboundary b \"B\" {\nuse-case base \"place order\"\nuse-case ext \"gift wrap\"\n}\nuse-case loose \"orders\"\n" +
      "a -- base\nbase -extend-> ext\nbase -> loose",
    ));
    const ids = r.findings.map((f) => f.rule_id).sort();
    expect(ids).toEqual(["UC-EXTEND-DIRECTION", "UC-LABEL-VERB", "UC-OUTSIDE-BOUNDARY"]);
    expect(r.findings.find((f) => f.rule_id === "UC-EXTEND-DIRECTION")!.confidence).toBe("medium");
  });
  it("narration confirming the include direction keeps it quiet", () => {
    const r = lint(parse(
      "diagram use-case\ntitle t\nnarration Check out always includes authenticate.\nactor c\nboundary s \"S\" {\nuse-case co \"check out\"\nuse-case au \"authenticate\"\n}\nc -- co\nco -include-> au",
    ));
    expect(r.findings).toEqual([]);
    expect(r.status).toBe("pass");
  });
  it("exclusive vs parallel narration cues", () => {
    const r = lint(parse(
      "diagram activity\ntitle t\nnarration Both are done at the same time and in parallel.\nstart s\ndecision d \"which?\"\naction a\naction b\nend e\ns -> d\nd -> a : [x]\nd -> b : [y]\na -> e\nb -> e",
    ));
    expect(r.findings.map((f) => f.rule_id)).toEqual(["ACTIVITY-EXCLUSIVE-VS-PARALLEL"]);
  });
});
