import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// The game listens at window level so held keys remain reliable while the
// pointer moves across the cabinet. Do not turn that into a page-wide keyboard
// trap: native controls and editable surfaces keep their normal Space/arrow/P
// behaviour, and browser/OS modifier shortcuts always win.
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.contentEditable === "true" || target.contentEditable === "plaintext-only")
  ) return true;
  return target.closest(
    "button, a[href], input, textarea, select, option, summary, [contenteditable]:not([contenteditable='false']), " +
      "[role='button'], [role='link'], [role='textbox'], [role='slider'], [role='checkbox'], [role='radio'], " +
      "[role='switch'], [role='menuitem']",
  ) !== null;
}

export function useKeyboard(scopeRef?: RefObject<HTMLElement | null>): () => InputIntent {
  const left = useRef(false);
  const right = useRef(false);
  const fire = useRef(false);
  const pauseEdge = useRef(false);

  useEffect(() => {
    const reset = () => {
      left.current = false;
      right.current = false;
      fire.current = false;
      pauseEdge.current = false;
    };
    const down = (e: KeyboardEvent) => {
      const scope = scopeRef?.current;
      if (scope && (!(e.target instanceof Node) || !scope.contains(e.target))) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isInteractiveTarget(e.target)) return;
      if (e.key === "ArrowLeft") { left.current = true; e.preventDefault(); }
      else if (e.key === "ArrowRight") { right.current = true; e.preventDefault(); }
      else if (e.key === " " || e.key === "Spacebar") { fire.current = true; e.preventDefault(); }
      else if (e.key === "p" || e.key === "P") { if (!e.repeat) pauseEdge.current = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") left.current = false;
      else if (e.key === "ArrowRight") right.current = false;
      else if (e.key === " " || e.key === "Spacebar") fire.current = false;
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") reset();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reset();
    };
  }, [scopeRef]);

  return useCallback(() => {
    const move = (right.current ? 1 : 0) - (left.current ? 1 : 0);
    const pause = pauseEdge.current;
    pauseEdge.current = false; // consume edge
    return { move: move as -1 | 0 | 1, fire: fire.current, pause };
  }, []);
}
