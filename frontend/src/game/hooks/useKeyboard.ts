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
      if (!m) return;
      // Arrows pressed on an interactive control belong to that control, not
      // the board — the mode tablist's Left/Right must not also move a piece.
      // The board itself is a div[role="grid"], so play is unaffected.
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("button, input, select, textarea, a[href]")) return;
      e.preventDefault(); onMove(m);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onMove, enabled]);
}
