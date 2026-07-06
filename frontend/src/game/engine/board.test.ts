import { describe, it, expect } from "vitest";
import { emptyCells, spawnTile } from "./board";

describe("emptyCells", () => {
  it("lists empty indices in ascending order", () => {
    const board = [0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(emptyCells(board)).toEqual([0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
  it("returns empty array for a full board", () => {
    expect(emptyCells(new Array(16).fill(2))).toEqual([]);
  });
});

describe("spawnTile", () => {
  it("places exactly one 2-or-4 tile in a previously empty cell", () => {
    const before = new Array(16).fill(0);
    const r = spawnTile(before, 12345, 0, "standard");
    const placed = r.board.filter((v) => v !== 0);
    expect(placed.length).toBe(1);
    expect([2, 4]).toContain(placed[0]);
    expect(r.rngCallCount).toBe(2); // one draw for position, one for value
  });

  it("is deterministic for a given (board, rng, modifier)", () => {
    const before = new Array(16).fill(0);
    const a = spawnTile(before, 999, 0, "standard");
    const b = spawnTile(before, 999, 0, "standard");
    expect(a.board).toEqual(b.board);
    expect(a.rng).toBe(b.rng);
  });

  it("doubles modifier spawns 4-or-8 instead of 2-or-4", () => {
    const before = new Array(16).fill(0);
    const r = spawnTile(before, 12345, 0, "doubles");
    const placed = r.board.filter((v) => v !== 0);
    expect([4, 8]).toContain(placed[0]);
  });
});
