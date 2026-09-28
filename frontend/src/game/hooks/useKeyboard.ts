import { useEffect, type RefObject } from "react";
import type { Move } from "../engine";

const KEYS: Record<string, Move> = {
  ArrowUp: "U", ArrowRight: "R", ArrowDown: "D", ArrowLeft: "L",
};

/** Standalone pages accept page keys; an OS game accepts only its front window. */
export function isGameKeyEvent(e: KeyboardEvent, scope: HTMLElement | null): boolean {
  const osWindow = scope?.closest(".os-win");
  if (!osWindow) return true;
  return !osWindow.classList.contains("os-inactive") &&
    e.target instanceof Node && scope !== null && scope.contains(e.target);
}

export function useKeyboard(onMove: (m: Move) => void, enabled: boolean, scopeRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const m = KEYS[e.key];
      if (!m) return;
      if (!isGameKeyEvent(e, scopeRef?.current ?? null)) return;
      // Arrows pressed on an interactive control belong to that control, not
      // the board — the mode tablist's Left/Right must not also move a piece.
      // The board itself is a div[role="grid"], so play is unaffected.
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("button, input, select, textarea, a[href]")) return;
      e.preventDefault(); onMove(m);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onMove, enabled, scopeRef]);
}
