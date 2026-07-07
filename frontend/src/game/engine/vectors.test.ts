import { describe, it, expect } from "vitest";
import { replay } from "./game";
import gameVectors from "./vectors/game_vectors.json";
import type { Modifier, Move } from "./types";

describe("golden game vectors", () => {
  it("replay reproduces every committed vector exactly", () => {
    for (const v of gameVectors as Array<{
      seed: number; modifier: Modifier; moves: Move[];
      expectedBoard: number[]; expectedScore: number; expectedRngCallCount: number; expectedOver: boolean;
    }>) {
      const r = replay(v.seed, v.modifier, v.moves);
      expect(r.board).toEqual(v.expectedBoard);
      expect(r.score).toBe(v.expectedScore);
      expect(r.rngCallCount).toBe(v.expectedRngCallCount);
      expect(r.over).toBe(v.expectedOver);
    }
  });
});
