import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// Drag distance (px) that maps to full deflection, plus the deadzone before any
// steer registers.
const STEER_RANGE = 56;
const STEER_DEADZONE = 4;

// Pure proportional steering: drag distance from the touch-start point maps to a
// continuous steer value in [-1, 1] (magnitude, not just direction), so fine
// dodges are possible instead of the old coarse ±1.
export function steerAmount(dx: number, range = STEER_RANGE, deadzone = STEER_DEADZONE): number {
  if (Math.abs(dx) <= deadzone) return 0;
  const span = Math.max(1, range - deadzone);
  const v = (dx - Math.sign(dx) * deadzone) / span;
  return Math.max(-1, Math.min(1, v));
}

// Left half of the play area = steer (pointer left/right of its start),
// right half = fire (tap or hold). Pause handled by an on-screen button in the shell.
export function useTouch(ref: RefObject<HTMLElement>): () => InputIntent {
  const move = useRef<number>(0);
  const fire = useRef(false);
  const steerStartX = useRef<number | null>(null);
  const steerId = useRef<number | null>(null);
  const fireId = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rectHalf = () => el.getBoundingClientRect().left + el.clientWidth / 2;

    const onDown = (e: PointerEvent) => {
      if (e.clientX < rectHalf()) {
        if (steerId.current == null) {
          steerId.current = e.pointerId;
          steerStartX.current = e.clientX;
          move.current = 0;
        }
      } else {
        if (fireId.current == null) {
          fireId.current = e.pointerId;
          fire.current = true;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === steerId.current && steerStartX.current != null) {
        move.current = steerAmount(e.clientX - steerStartX.current);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === steerId.current) {
        steerId.current = null;
        steerStartX.current = null;
        move.current = 0;
      } else if (e.pointerId === fireId.current) {
        fireId.current = null;
        fire.current = false;
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [ref]);

  return useCallback(() => ({ move: move.current, fire: fire.current, pause: false }), []);
}
