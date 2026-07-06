import { describe, it, expect } from "vitest";
import { applyMove, LINE_INDICES } from "./move";
import type { GameState } from "./types";

function stateWith(board: number[]): GameState {
  return { board, score: 0, rng: 555, rngCallCount: 0, modifier: "standard", moves: 0, over: false };
}

describe("LINE_INDICES", () => {
  it("has 4 lines of 4 indices for each direction", () => {
    for (const dir of ["U", "R", "D", "L"] as const) {
      expect(LINE_INDICES[dir].length).toBe(4);
      for (const line of LINE_INDICES[dir]) expect(line.length).toBe(4);
    }
  });
});

describe("applyMove", () => {
  it("moves left and merges a row", () => {
    // row 0 = [2,2,0,0]; expect it to become [4,0,0,0] before spawn
    const s = stateWith([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "L");
    expect(next.board[0]).toBe(4);
    expect(next.score).toBe(4);
    expect(next.moves).toBe(1);
    // a spawn happened => exactly one new tile appeared somewhere in indices 1..15
    expect(next.rngCallCount).toBe(2);
    expect(next.board.filter((v) => v !== 0).length).toBe(2);
  });

  it("moves right (tiles pull toward the high index of each row)", () => {
    const s = stateWith([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "R");
    expect(next.board[3]).toBe(4);
  });

  it("moves up (tiles pull toward row 0 of each column)", () => {
    // column 0 = indices 0,4,8,12 = [0,2,2,0]; up => [4,...]
    const s = stateWith([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "U");
    expect(next.board[0]).toBe(4);
  });

  it("returns the SAME state (no spawn, no rng) on a no-op move", () => {
    // full-left-packed row cannot move further left; whole board is a no-op for L
    const s = stateWith([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128]);
    const next = applyMove(s, "L");
    expect(next).toBe(s); // identity — unchanged
    expect(next.rngCallCount).toBe(0);
  });
});
