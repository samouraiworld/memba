import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// Drag distance (px) that maps to full deflection, plus the deadzone before any
// steer registers.
const STEER_RANGE = 56;
const STEER_DEADZONE = 4;

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element &&
    target.closest("button, a[href], input, textarea, select, summary, [contenteditable], [role='button'], [role='link']") !== null;
}

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
// read() only samples; consumeFire() acknowledges a real simulation step.
// reset() discards both held and queued input at non-playing lifecycle boundaries.
export function useTouch(ref: RefObject<HTMLElement>) {
  const move = useRef<number>(0);
  const fire = useRef(false);
  // Coalesce completed, unsampled taps into one bounded pending intent. A
  // render-frame poll is not consumption: high-refresh frames may run no step.
  const pendingFire = useRef(false);
  const fireConsumed = useRef(false);
  const steerStartX = useRef<number | null>(null);
  const steerId = useRef<number | null>(null);
  const fireId = useRef<number | null>(null);
  // The effect owns capture/listener cleanup; callers get a stable reset handle.
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rectHalf = () => el.getBoundingClientRect().left + el.clientWidth / 2;

    const releaseCapture = (pointerId: number | null) => {
      if (pointerId == null || typeof el.releasePointerCapture !== "function") return;
      try {
        if (typeof el.hasPointerCapture !== "function" || el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
      } catch {
        // Capture may already have been released by the browser.
      }
    };
    const reset = () => {
      const activeSteer = steerId.current;
      const activeFire = fireId.current;
      steerId.current = null;
      fireId.current = null;
      steerStartX.current = null;
      move.current = 0;
      fire.current = false;
      pendingFire.current = false;
      fireConsumed.current = false;
      releaseCapture(activeSteer);
      if (activeFire !== activeSteer) releaseCapture(activeFire);
    };
    resetRef.current = reset;
    const capture = (pointerId: number) => {
      if (typeof el.setPointerCapture !== "function") return;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Older browsers and synthetic events can reject capture; the window
        // release listeners below still provide a safe fallback.
      }
    };

    const onDown = (e: PointerEvent) => {
      // Mode/pause/certify controls sit over the same stage. Capturing their
      // pointer on the cabinet would retarget pointerup away from the button
      // and can suppress its click, so controls always keep ownership.
      if (isInteractiveTarget(e.target)) return;
      if (e.clientX < rectHalf()) {
        if (steerId.current == null) {
          steerId.current = e.pointerId;
          steerStartX.current = e.clientX;
          move.current = 0;
          capture(e.pointerId);
        }
      } else {
        if (fireId.current == null) {
          fireId.current = e.pointerId;
          fire.current = true;
          fireConsumed.current = false;
          capture(e.pointerId);
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === steerId.current && steerStartX.current != null) {
        move.current = steerAmount(e.clientX - steerStartX.current);
      }
    };
    const release = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId === steerId.current) {
        steerId.current = null;
        steerStartX.current = null;
        move.current = 0;
      }
      if (e.pointerId === fireId.current) {
        if (!cancelled && !fireConsumed.current) pendingFire.current = true;
        fireId.current = null;
        fire.current = false;
      }
    };
    const onUp = (e: PointerEvent) => release(e, false);
    const onCancel = (e: PointerEvent) => release(e, true);
    // After a normal pointerup the slot is already empty; implicit capture
    // loss must not erase the completed tap waiting for a simulation step.
    const onLostCapture = onCancel;
    const visibility = () => {
      if (document.visibilityState !== "visible") reset();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reset();
      resetRef.current = () => {};
    };
  }, [ref]);

  const read = useCallback((): InputIntent => ({ move: move.current, fire: fire.current || pendingFire.current, pause: false }), []);
  const consumeFire = useCallback(() => {
    pendingFire.current = false;
    if (fire.current) fireConsumed.current = true;
  }, []);
  const reset = useCallback(() => resetRef.current(), []);
  return useMemo(() => ({ read, consumeFire, reset }), [read, consumeFire, reset]);
}
