import { rngNext, type RngState } from "./prng";
import type { Board, Modifier } from "./types";

export function emptyCells(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) if (board[i] === 0) out.push(i);
  return out;
}

export function spawnTile(
  board: Board,
  rng: RngState,
  rngCallCount: number,
  modifier: Modifier
): { board: Board; rng: RngState; rngCallCount: number } {
  const empties = emptyCells(board);
  // position draw
  let r = rngNext(rng);
  const pos = empties[r.value % empties.length];
  rng = r.state;
  // value draw
  r = rngNext(rng);
  let value = r.value % 10 === 0 ? 4 : 2;
  rng = r.state;
  if (modifier === "doubles") value *= 2;

  const next = board.slice();
  next[pos] = value;
  return { board: next, rng, rngCallCount: rngCallCount + 2 };
}
