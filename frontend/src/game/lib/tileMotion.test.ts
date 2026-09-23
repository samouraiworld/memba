import { describe, expect, it } from "vitest";
import { initGame, LINE_INDICES, slideLineLeft, step, type GameState, type Move } from "../engine";
import { advanceLayout, boardFromTiles, layoutFromBoard, liveTiles, slideTiles, type TileLayout } from "./tileMotion";

const MOVES: Move[] = ["U", "R", "D", "L"];

// Deterministic test PRNG (mulberry32) — independent of the engine's RNG.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBoard(next: () => number): number[] {
  const density = next();
  return Array.from({ length: 16 }, () => (next() < density ? 2 ** (1 + Math.floor(next() * 6)) : 0));
}

/** The engine's own slide, before the spawn: the reference the motion model must match. */
function engineSlide(board: number[], move: Move): { board: number[]; gained: number } {
  const after = board.slice();
  let gained = 0;
  for (const line of LINE_INDICES[move]) {
    const { line: slid, gained: g } = slideLineLeft(line.map((index) => board[index]));
    gained += g;
    line.forEach((index, k) => { after[index] = slid[k]; });
  }
  return { board: after, gained };
}

function expectUniqueIds(layout: TileLayout) {
  const ids = layout.tiles.map((tile) => tile.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  expect(Math.max(0, ...ids)).toBeLessThan(layout.nextId);
}

describe("tileMotion", () => {
  it("matches the engine slide on 4,000 random boards in every direction", () => {
    const next = rng(0xb10c);
    for (let n = 0; n < 1000; n++) {
      const board = randomBoard(next);
      const layout = layoutFromBoard(board);
      for (const move of MOVES) {
        const reference = engineSlide(board, move);
        const slid = slideTiles(layout, move);
        expect(slid.board).toEqual(reference.board);
        expect(slid.gained).toBe(reference.gained);
      }
    }
  });

  it("tracks tiles through long engine games without a single resync", () => {
    const next = rng(2048);
    let steps = 0;
    for (let game = 0; game < 40; game++) {
      let state: GameState = initGame((next() * 2 ** 32) >>> 0, game % 3 === 0 ? "doubles" : "standard");
      let layout = layoutFromBoard(state.board);
      for (let turn = 0; turn < 400 && !state.over; turn++) {
        const move = MOVES[Math.floor(next() * 4)];
        const after = step(state, move);
        if (after === state) continue; // no-op moves never reach the board
        const before = liveTiles(layout);
        const advanced = advanceLayout(layout, move, after.board);

        expect(boardFromTiles(advanced.tiles)).toEqual(after.board);
        expect(advanced.tiles.filter((tile) => tile.kind === "spawned")).toHaveLength(1);
        const merged = advanced.tiles.filter((tile) => tile.kind === "merged");
        expect(merged.reduce((sum, tile) => sum + tile.value, 0)).toBe(after.score - state.score);
        expect(advanced.tiles.filter((tile) => tile.kind === "consumed")).toHaveLength(merged.length * 2);
        // Every surviving tile keeps its id; only merges and the spawn mint new ones.
        const survivors = advanced.tiles.filter((tile) => tile.kind === "static" || tile.kind === "moved");
        for (const tile of survivors) expect(before.some((old) => old.id === tile.id && old.value === tile.value)).toBe(true);
        expectUniqueIds(advanced);

        state = after;
        layout = advanced;
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(2000);
  });

  it("fuses the pair nearest the leading edge once per move", () => {
    const layout = layoutFromBoard([2, 2, 2, 2, 4, 0, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
    const slid = slideTiles(layout, "R");
    expect(slid.board.slice(0, 8)).toEqual([0, 0, 4, 4, 0, 0, 8, 8]);
    const consumed = slid.tiles.filter((tile) => tile.kind === "consumed");
    // Row 1: ids 3+4 fuse into cell 3, ids 1+2 into cell 2. Row 2: 4s (ids 5, 6) into cell 6.
    expect(consumed.map((tile) => [tile.id, tile.index])).toEqual([[1, 2], [2, 2], [3, 3], [4, 3], [5, 6], [6, 6]]);
    expect(slid.tiles.find((tile) => tile.id === 7)).toMatchObject({ index: 7, kind: "static", value: 8 });
  });

  it("marks tiles that stay put as static and travelling tiles as moved", () => {
    const layout = layoutFromBoard([2, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const slid = slideTiles(layout, "L");
    expect(slid.tiles).toEqual([
      { id: 1, value: 2, index: 0, kind: "static" },
      { id: 2, value: 4, index: 1, kind: "moved" },
    ]);
  });

  it("drops last move's consumed tiles before sliding again", () => {
    let layout = layoutFromBoard([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    layout = advanceLayout(layout, "L", [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(layout.tiles.map((tile) => tile.kind)).toEqual(["consumed", "consumed", "merged", "spawned"]);
    layout = advanceLayout(layout, "U", [4, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(layout.tiles).toEqual([
      { id: 3, value: 4, index: 0, kind: "static" },
      { id: 4, value: 2, index: 3, kind: "moved" },
    ]);
  });

  it("re-lays the board without history when the move does not explain it", () => {
    const layout = layoutFromBoard([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // A restart (move unknown) and a board the move cannot produce both resync.
    for (const [move, board] of [
      [null, [0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]],
      ["R", [0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]],
    ] as const) {
      const next = advanceLayout(layout, move, board);
      expect(boardFromTiles(next.tiles)).toEqual(board);
      expect(next.tiles.every((tile) => tile.kind === "spawned" && tile.id >= layout.nextId)).toBe(true);
    }
  });
});
