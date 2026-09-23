import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// The game listens at window level so held keys remain reliable while the
// pointer moves across the cabinet. Do not turn that into a page-wide keyboard
// trap: native controls and editable surfaces keep their normal Space/arrow/P
// behaviour, and browser/OS modifier shortcuts always win.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.contentEditable === "true" || target.contentEditable === "plaintext-only")
  ) return true;
  return target.closest(
    "input, textarea, select, option, [contenteditable]:not([contenteditable='false']), [role='textbox']",
  ) !== null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isEditableTarget(target)) return true;
  return target.closest(
    "button, a[href], summary, [role='button'], [role='link'], [role='slider'], [role='checkbox'], [role='radio'], " +
      "[role='switch'], [role='menuitem']",
  ) !== null;
}

/** What a key does in the cabinet. Every gameplay key maps onto one of the
 *  engine's existing actions (move -1/+1, fire, pause), so an A/D/W run
 *  records exactly the same input as the same run played on arrows + Space.
 *  "confirm" (Enter) never reaches the engine: the shell turns it into a menu
 *  choice, a launch, a resume or a restart. */
export type KeyAction = "left" | "right" | "fire" | "pause" | "confirm";

const KEY_ACTIONS: Readonly<Record<string, KeyAction>> = {
  arrowleft: "left",
  a: "left",
  q: "left", // AZERTY left (ZQSD)
  arrowright: "right",
  d: "right",
  " ": "fire",
  spacebar: "fire",
  w: "fire",
  z: "fire", // AZERTY up (ZQSD)
  p: "pause",
  escape: "pause",
  esc: "pause",
  enter: "confirm",
};

/** Pure key → action map (case-insensitive on `KeyboardEvent.key`). */
export function keyAction(key: string): KeyAction | null {
  return KEY_ACTIONS[key.toLowerCase()] ?? null;
}

export interface KeyboardOptions {
  /** Called once per fresh (non-repeat) Enter press on the game surface. */
  onConfirm?: () => void;
}

export function useKeyboard(scopeRef?: RefObject<HTMLElement | null>, options?: KeyboardOptions): () => InputIntent {
  // Held keys per action, so releasing A while ArrowLeft is still down keeps
  // the relay moving (and vice versa).
  const held = useRef<Record<"left" | "right" | "fire", Set<string>>>({
    left: new Set(),
    right: new Set(),
    fire: new Set(),
  });
  const pauseEdge = useRef(false);
  const onConfirmRef = useRef(options?.onConfirm);
  useEffect(() => {
    onConfirmRef.current = options?.onConfirm;
  });

  useEffect(() => {
    const keys = held.current;
    const reset = () => {
      keys.left.clear();
      keys.right.clear();
      keys.fire.clear();
      pauseEdge.current = false;
    };
    const down = (e: KeyboardEvent) => {
      const scope = scopeRef?.current;
      if (scope && (!(e.target instanceof Node) || !scope.contains(e.target))) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = keyAction(e.key);
      if (!action) return;
      // Escape has no native meaning on a button, so it may pause from the
      // pause sheet's own controls; every other key leaves native controls
      // (Enter/Space activate buttons) and editable surfaces alone.
      const isEscape = e.key === "Escape" || e.key === "Esc";
      if (isEscape ? isEditableTarget(e.target) : isInteractiveTarget(e.target)) return;
      const id = e.key.toLowerCase();
      switch (action) {
        case "left":
        case "right":
        case "fire":
          keys[action].add(id);
          e.preventDefault();
          break;
        case "pause":
          if (!e.repeat) pauseEdge.current = true;
          break;
        case "confirm":
          e.preventDefault();
          if (!e.repeat) onConfirmRef.current?.();
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      const action = keyAction(e.key);
      if (action === "left" || action === "right" || action === "fire") keys[action].delete(e.key.toLowerCase());
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
    const keys = held.current;
    const move = (keys.right.size > 0 ? 1 : 0) - (keys.left.size > 0 ? 1 : 0);
    const pause = pauseEdge.current;
    pauseEdge.current = false; // consume edge
    return { move: move as -1 | 0 | 1, fire: keys.fire.size > 0, pause };
  }, []);
}
