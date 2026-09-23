import { useId, useState } from "react";
import { useSwipe } from "../hooks/useSwipe";
import type { Move } from "../engine";
import { advanceLayout, layoutFromBoard, type TileLayout } from "../lib/tileMotion";
import { Cell, Tile } from "./Tile";
import "./board.css";

const KEY_MOVES: Record<string, Move> = {
  ArrowUp: "U",
  ArrowRight: "R",
  ArrowDown: "D",
  ArrowLeft: "L",
};

type Motion = { board: number[]; log: string; layout: TileLayout };

/** The move that turned the previous board into this one, when exactly one was played. */
function playedMove(prevLog: string, log: string | undefined): Move | null {
  if (log === undefined || log.length !== prevLog.length + 1 || !log.startsWith(prevLog)) return null;
  return log[log.length - 1] as Move;
}

export function Board({
  board,
  onMove,
  disabled = false,
  moveLog,
}: {
  board: number[];
  onMove: (m: Move) => void;
  disabled?: boolean;
  /** The accepted-move log for this round; lets tiles slide in the direction actually played. */
  moveLog?: string;
}) {
  const swipe = useSwipe(onMove);
  // Tile motion is derived from the authoritative board, never the reverse:
  // each new board advances the layout once, during render, so fast input
  // retargets tiles mid-slide instead of queueing or dropping moves.
  const [motion, setMotion] = useState<Motion>(() => ({
    board,
    log: moveLog ?? "",
    layout: layoutFromBoard(board, 1, "spawned"),
  }));
  if (motion.board !== board) {
    const unchanged = motion.board.every((value, index) => value === board[index]);
    setMotion({
      board,
      log: moveLog ?? "",
      layout: unchanged ? motion.layout : advanceLayout(motion.layout, playedMove(motion.log, moveLog), board),
    });
  }
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
              return <Cell key={index} value={value} index={index} />;
            })}
          </div>
        ))}
      </div>
      <div className="k-bp-tile-layer" aria-hidden="true">
        {motion.layout.tiles.map((tile) => <Tile key={tile.id} tile={tile} />)}
      </div>
      <p id={announcementId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Board updated. {boardSummary}.
      </p>
    </div>
  );
}
