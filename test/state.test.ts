import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildHash, compress, parseHash } from "../src/core/state";

const permit = readFileSync(new URL("../fixtures/diagrams/usecase-permit.ksd", import.meta.url), "utf8");

describe("state.ts", () => {
  it("round-trips every field through the hash", () => {
    const h = buildHash({ d: permit, id: "permit-portal", step: 2, theme: "dark", lint: true, qa: true, tools: false });
    const s = parseHash("#" + h);
    expect(s).toEqual({ v: 1, d: permit, id: "permit-portal", step: 2, theme: "dark", lint: true, qa: true, tools: false, undecodable: false });
    const all = parseHash(buildHash({ d: permit, step: "all" }));
    expect(all.step).toBe("all");
    expect(all.lint).toBe(false);
    expect(all.tools).toBe(true);
    expect(all.theme).toBe("auto");
    expect(all.id).toBe("");
  });
  it("survives a compressed form containing + (URLSearchParams encodes it)", () => {
    let text = "";
    let i = 0;
    while (!compress(text).includes("+") && i < 2000) {
      text = "diagram flowchart\ntitle t" + i + "\nprocess a" + i.toString(36) + "\n";
      i++;
    }
    expect(compress(text)).toContain("+");
    const h = buildHash({ d: text });
    expect(h).not.toContain("+");
    expect(parseHash(h).d).toBe(text);
    // lz-string itself maps a stray space back to +, so even a raw + survives; the rule is belt and braces
    expect(parseHash("v=1&d=" + compress(text)).d).toBe(text);
  });
  it("reports a missing or undecodable d", () => {
    expect(parseHash("v=1").d).toBeNull();
    expect(parseHash("v=1").undecodable).toBe(false);
    expect(parseHash("v=1&d=").d).toBeNull();
    const bad = parseHash("v=1&d=%00%00not-lz");
    expect(bad.d).toBeNull();
    expect(bad.undecodable).toBe(true);
    expect(parseHash("v=2&d=x").v).toBe(2);
    expect(parseHash("d=x").v).toBeNull();
  });
  it("qa=1 implies lint", () => {
    expect(parseHash(buildHash({ d: permit, qa: true })).lint).toBe(true);
  });
});
