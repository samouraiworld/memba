import { slideLineLeft } from "./slide";
import { spawnTile } from "./board";
import type { GameState, Move } from "./types";

// Each entry lists the 4 lines; each line lists its 4 board indices in the
// order tiles are pulled toward the move direction (leading index first).
export const LINE_INDICES: Record<Move, number[][]> = {
  L: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]],
  R: [[3, 2, 1, 0], [7, 6, 5, 4], [11, 10, 9, 8], [15, 14, 13, 12]],
  U: [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]],
  D: [[12, 8, 4, 0], [13, 9, 5, 1], [14, 10, 6, 2], [15, 11, 7, 3]],
};

export function applyMove(state: GameState, move: Move): GameState {
  const before = state.board;
  const after = before.slice();
  let gained = 0;

  for (const line of LINE_INDICES[move]) {
    const vals = line.map((idx) => before[idx]);
    const { line: slid, gained: g } = slideLineLeft(vals);
    gained += g;
    line.forEach((idx, k) => {
      after[idx] = slid[k];
    });
  }

  const changed = after.some((v, i) => v !== before[i]);
  if (!changed) return state; // no-op: unchanged, no spawn, no RNG

  const spawned = spawnTile(after, state.rng, state.rngCallCount, state.modifier);
  return {
    ...state,
    board: spawned.board,
    score: state.score + gained,
    rng: spawned.rng,
    rngCallCount: spawned.rngCallCount,
    moves: state.moves + 1,
    over: false, // set by initGame/replay via isGameOver in Task 6 wiring
  };
}
