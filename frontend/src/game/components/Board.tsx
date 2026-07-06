import { useSwipe } from "../hooks/useSwipe";
import type { Move } from "../engine";
import { Tile } from "./Tile";
import "./board.css";
export function Board({ board, onMove }: { board: number[]; onMove: (m: Move) => void }) {
  const swipe = useSwipe(onMove);
  return (
    <div
      className="k-bp-board"
      role="grid"
      aria-label="Block Party board"
      tabIndex={0}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
    >
      {board.map((v, i) => <Tile key={i} value={v} />)}
    </div>
  );
}
