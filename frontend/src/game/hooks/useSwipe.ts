import { useRef } from "react";
import type { Move } from "../engine";

const THRESHOLD = 24;

export function useSwipe(onMove: (m: Move) => void) {
  const start = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const clearPointer = (pointerId: number) => {
    if (start.current?.pointerId === pointerId) start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (start.current) return;
      start.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Synthetic events and older embedded browsers may expose the API
        // without registering an active pointer. Coordinate tracking remains
        // safe even when capture is unavailable.
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.pointerId !== e.pointerId) return;
      start.current = null;
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // The pointer may already have been implicitly released by the UA.
      }
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      if (Math.abs(dx) >= Math.abs(dy)) onMove(dx > 0 ? "R" : "L");
      else onMove(dy > 0 ? "D" : "U");
    },
    onPointerCancel: (e: React.PointerEvent) => clearPointer(e.pointerId),
    onLostPointerCapture: (e: React.PointerEvent) => clearPointer(e.pointerId),
  };
}
