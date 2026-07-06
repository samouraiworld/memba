import type { Board } from "./types";

export function isGameOver(board: Board): boolean {
  for (let i = 0; i < 16; i++) if (board[i] === 0) return false;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r * 4 + c];
      if (c < 3 && board[r * 4 + c + 1] === v) return false;
      if (r < 3 && board[(r + 1) * 4 + c] === v) return false;
    }
  }
  return true;
}
