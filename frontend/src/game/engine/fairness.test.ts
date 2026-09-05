import { describe, expect, it } from "vitest";
import { isParTheoreticallyReachable, seedScoreCeiling, theoreticalScoreCeiling } from "./fairness";
import { replay } from "./game";
import type { Move } from "./types";

describe("ranked score reachability bounds", () => {
  it.each([
    ["standard", 30, 640],
    ["doubles", 30, 1280],
    ["rush", 24, 360],
  ] as const)("%s with %i moves has a ceiling of %i", (modifier, moves, expected) => {
    expect(theoreticalScoreCeiling(modifier, moves)).toBe(expected);
  });

  it("proves every current 1000..2999 par unreachable in Standard and Rush", () => {
    for (const modifier of ["standard", "rush"] as const) {
      const budget = modifier === "rush" ? 24 : 30;
      expect(isParTheoreticallyReachable(1000, modifier, budget)).toBe(false);
      expect(isParTheoreticallyReachable(2999, modifier, budget)).toBe(false);
    }
  });

  it("does not overclaim Doubles reachability above its absolute ceiling", () => {
    expect(isParTheoreticallyReachable(1280, "doubles", 30)).toBe(true);
    expect(isParTheoreticallyReachable(1281, "doubles", 30)).toBe(false);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid move budget %s", (budget) => {
    expect(() => theoreticalScoreCeiling("standard", budget)).toThrow(RangeError);
    expect(() => seedScoreCeiling(1, "standard", budget)).toThrow(RangeError);
  });

  it.each([
    [0, "standard", 30, 320],
    [1, "doubles", 30, 624],
    [42, "rush", 24, 180],
    [4_294_967_295, "standard", 30, 316],
  ] as const)("matches the seed ceiling golden for %i/%s", (seed, modifier, budget, expected) => {
    expect(seedScoreCeiling(seed, modifier, budget)).toBe(expected);
  });

  it("keeps modifier scaling explicit and deterministic", () => {
    const moves = "LDRUULDRDLUURRDDLLUDRULDLURRDLUDLRUDDLRU".split("") as Move[];
    for (const seed of [0, 1, 42, 12345, 4_294_967_295]) {
      const standard = replay(seed, "standard", moves);
      const doubles = replay(seed, "doubles", moves);
      const rush = replay(seed, "rush", moves);

      // Rush is a budget modifier, not a different engine/scoring mode.
      expect(rush).toEqual(standard);
      // Doubles preserves board geometry and RNG, scaling every tile and score.
      expect(doubles.board).toEqual(standard.board.map((tile) => tile * 2));
      expect(doubles.score).toBe(standard.score * 2);
      expect(doubles.rngCallCount).toBe(standard.rngCallCount);
      expect(doubles.over).toBe(standard.over);
    }
  });
});
