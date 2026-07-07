import { describe, it, expect } from "vitest";
import { initGame, step, isGameOver, rngNext } from "./index";
import type { GameState, Move } from "./types";

const MOVES: Move[] = ["U", "R", "D", "L"];

function tileMass(s: GameState): number {
  // number of tiles on the board
  return s.board.filter((v) => v !== 0).length;
}

describe("engine invariants (pseudo-random games)", () => {
  it("score never decreases; tile count grows only by spawns; over is consistent", () => {
    let rngState = 20260706;
    for (let game = 0; game < 200; game++) {
      let s = initGame(rngState, "standard");
      let prevScore = s.score;
      for (let m = 0; m < 60 && !s.over; m++) {
        const draw = rngNext(rngState);
        rngState = draw.state;
        const move = MOVES[draw.value % 4];
        const before = s;
        s = step(s, move);
        // score monotonic
        expect(s.score).toBeGreaterThanOrEqual(prevScore);
        prevScore = s.score;
        // A real move nets AT MOST one new tile (the single spawn). Merges
        // remove tiles, so a multi-merge move can net 0 or negative; a no-op
        // nets 0. The invariant is therefore delta <= 1 (never > +1).
        const delta = tileMass(s) - tileMass(before);
        expect(delta).toBeLessThanOrEqual(1);
      }
      // over flag matches the detector
      expect(s.over).toBe(isGameOver(s.board));
      rngState = rngNext(rngState).state;
    }
  });
});
