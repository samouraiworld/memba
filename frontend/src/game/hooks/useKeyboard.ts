import { useEffect } from "react";
import type { Move } from "../engine";

const KEYS: Record<string, Move> = {
  ArrowUp: "U", ArrowRight: "R", ArrowDown: "D", ArrowLeft: "L",
};

export function useKeyboard(onMove: (m: Move) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const m = KEYS[e.key];
      if (m) { e.preventDefault(); onMove(m); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onMove, enabled]);
}
