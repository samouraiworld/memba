import { useRef } from "react";
import type { Move } from "../engine";

const THRESHOLD = 24;

export function useSwipe(onMove: (m: Move) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      if (Math.abs(dx) >= Math.abs(dy)) onMove(dx > 0 ? "R" : "L");
      else onMove(dy > 0 ? "D" : "U");
    },
  };
}
