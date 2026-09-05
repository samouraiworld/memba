import { useId } from "react";
import { useSwipe } from "../hooks/useSwipe";
import type { Move } from "../engine";
import { Tile } from "./Tile";
import "./board.css";

const KEY_MOVES: Record<string, Move> = {
  ArrowUp: "U",
  ArrowRight: "R",
  ArrowDown: "D",
  ArrowLeft: "L",
};

export function Board({ board, onMove, disabled = false }: { board: number[]; onMove: (m: Move) => void; disabled?: boolean }) {
  const swipe = useSwipe(onMove);
  const instructionsId = useId();
  const announcementId = useId();
  const boardSummary = [0, 1, 2, 3]
    .map((row) => `Row ${row + 1}: ${board.slice(row * 4, row * 4 + 4).map((value) => value || "empty").join(", ")}`)
    .join(". ");

  return (
    <div className="k-bp-board-shell">
      <p id={instructionsId} className="sr-only">
        {disabled
          ? "Four by four signal board. Daily input is locked until the board is verified live."
          : "Four by four signal board. Use the arrow keys while the board is focused, or swipe, to route every tile."}
      </p>
      <div
        className="k-bp-board"
        role="grid"
        aria-label="Block Party signal board"
        aria-describedby={`${instructionsId} ${announcementId}`}
        aria-rowcount={4}
        aria-colcount={4}
        aria-keyshortcuts={disabled ? undefined : "ArrowUp ArrowRight ArrowDown ArrowLeft"}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled) return;
          const move = KEY_MOVES[event.key];
          if (!move) return;
          event.preventDefault();
          // The page also supports global arrow controls. Keep a focused-board
          // keystroke from reaching that listener and applying the move twice.
          event.stopPropagation();
          onMove(move);
        }}
        onPointerDown={disabled ? undefined : swipe.onPointerDown}
        onPointerUp={disabled ? undefined : swipe.onPointerUp}
        onPointerCancel={disabled ? undefined : swipe.onPointerCancel}
        onLostPointerCapture={disabled ? undefined : swipe.onLostPointerCapture}
      >
        {[0, 1, 2, 3].map((row) => (
          <div className="k-bp-board-row" role="row" aria-rowindex={row + 1} key={row}>
            {board.slice(row * 4, row * 4 + 4).map((value, col) => {
              const index = row * 4 + col;
              return <Tile key={`${index}-${value}`} value={value} index={index} />;
            })}
          </div>
        ))}
      </div>
      <p id={announcementId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Board updated. {boardSummary}.
      </p>
    </div>
  );
}
