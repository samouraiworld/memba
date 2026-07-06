import { spawnTile } from "./board";
import { applyMove } from "./move";
import { isGameOver } from "./gameover";
import type { Board, GameState, Modifier, Move } from "./types";

export function initGame(seed: number, modifier: Modifier): GameState {
  const empty: Board = new Array(16).fill(0);
  const first = spawnTile(empty, seed >>> 0, 0, modifier);
  const second = spawnTile(first.board, first.rng, first.rngCallCount, modifier);
  return {
    board: second.board,
    score: 0,
    rng: second.rng,
    rngCallCount: second.rngCallCount,
    modifier,
    moves: 0,
    over: isGameOver(second.board),
  };
}

export function step(state: GameState, move: Move): GameState {
  const next = applyMove(state, move);
  // Depends on applyMove's contract: it returns the IDENTICAL state object on a
  // no-op move. If move.ts is ever changed to always return a fresh object,
  // update this no-op detection (e.g. compare rngCallCount) — see move.test.ts.
  if (next === state) return state; // no-op passthrough
  return { ...next, over: isGameOver(next.board) };
}

export function replay(
  seed: number,
  modifier: Modifier,
  moves: Move[]
): { board: Board; score: number; rngCallCount: number; over: boolean } {
  let s = initGame(seed, modifier);
  for (const m of moves) s = step(s, m);
  return { board: s.board, score: s.score, rngCallCount: s.rngCallCount, over: s.over };
}
