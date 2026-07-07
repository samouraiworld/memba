import type { RngState } from "./prng";

export type Move = "U" | "R" | "D" | "L";
export type Modifier = "standard" | "doubles" | "rush";
export type Board = number[]; // length 16, row-major

export interface GameState {
  board: Board;
  score: number;
  rng: RngState;
  rngCallCount: number;
  modifier: Modifier;
  moves: number;
  over: boolean;
}
