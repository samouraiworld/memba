import { describe, it, expect } from "vitest";
import { initGame, step, replay } from "./game";
import type { Move } from "./types";

describe("initGame", () => {
  it("starts with exactly two tiles and score 0", () => {
    const s = initGame(12345, "standard");
    expect(s.board.filter((v) => v !== 0).length).toBe(2);
    expect(s.score).toBe(0);
    expect(s.moves).toBe(0);
    expect(s.rngCallCount).toBe(4); // two spawns * (pos+value)
  });

  it("is deterministic for a given seed+modifier", () => {
    expect(initGame(777, "standard")).toEqual(initGame(777, "standard"));
  });
});

describe("replay", () => {
  it("equals folding step() over the moves", () => {
    const moves: Move[] = ["L", "U", "R", "D", "L", "L", "U"];
    let s = initGame(4242, "standard");
    for (const m of moves) s = step(s, m);
    const r = replay(4242, "standard", moves);
    expect(r.board).toEqual(s.board);
    expect(r.score).toBe(s.score);
    expect(r.rngCallCount).toBe(s.rngCallCount);
    expect(r.over).toBe(s.over);
  });

  it("is fully deterministic (same inputs => same result)", () => {
    const moves: Move[] = ["U", "D", "L", "R", "U", "U", "L", "D"];
    expect(replay(9, "standard", moves)).toEqual(replay(9, "standard", moves));
  });

  it("no-op moves change nothing and consume no RNG", () => {
    const moves: Move[] = ["L", "L", "L", "L", "L", "L"]; // repeated L eventually no-ops
    const r1 = replay(123, "standard", moves);
    const r2 = replay(123, "standard", [...moves, "L", "L"]);
    // extra trailing no-op Ls must not change the result
    expect(r2).toEqual(r1);
  });
});
