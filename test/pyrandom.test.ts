import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PyRandom, seedFor, pyRound } from "../src/core/pyrandom";

const FIX = new URL("../fixtures/", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, FIX), "utf8"));

describe("PyRandom matches CPython random.Random", () => {
  for (const c of read("prng.json")) {
    it(`seed ${c.seed}`, () => {
      const r = new PyRandom(BigInt(c.seed));
      expect(c.random.map(() => r.random())).toEqual(c.random);
      const r2 = new PyRandom(BigInt(c.seed));
      expect(c.uniform_m015_p015.map(() => r2.uniform(-0.015, 0.015))).toEqual(c.uniform_m015_p015);
    });
  }
});

describe("seedFor matches pen.seed_for", () => {
  for (const c of read("seeds.json")) it(JSON.stringify(c.name), () => expect(seedFor(c.name)).toBe(c.seed));
});

it("pyRound rounds halves to even", () => {
  expect([0.5, 1.5, 2.5, 3.49, 3.51, 7].map(pyRound)).toEqual([0, 2, 2, 3, 4, 7]);
});
