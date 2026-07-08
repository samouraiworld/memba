import { useEffect, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// Left half of the play area = steer (pointer left/right of its start),
// right half = fire (tap or hold). Pause handled by an on-screen button in the shell.
export function useTouch(ref: RefObject<HTMLElement>): () => InputIntent {
  const move = useRef<-1 | 0 | 1>(0);
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
        steerId.current = e.pointerId;
        steerStartX.current = e.clientX;
        move.current = 0;
      } else {
        fireId.current = e.pointerId;
        fire.current = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === steerId.current && steerStartX.current != null) {
        const dx = e.clientX - steerStartX.current;
        move.current = dx > 6 ? 1 : dx < -6 ? -1 : 0;
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

  return () => ({ move: move.current, fire: fire.current, pause: false });
}
