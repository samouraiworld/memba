import { useEffect, useState } from "react";

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

/** Counts from 0 up to `target` over `durationMs` on animation frames. With
 *  reduced motion (or nothing to count) the target is returned immediately. */
export function useCountUp(target: number, { durationMs = 900, reducedMotion = false } = {}): number {
  const instant = reducedMotion || target <= 0 || durationMs <= 0;
  const [frame, setFrame] = useState<{ target: number; value: number }>({ target, value: 0 });

  useEffect(() => {
    if (instant) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (time: number) => {
      if (start == null) start = time;
      const p = Math.min(1, Math.max(0, (time - start) / durationMs));
      setFrame({ target, value: p >= 1 ? target : Math.floor(target * easeOutCubic(p)) });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, instant]);

  if (instant) return target;
  return frame.target === target ? frame.value : 0;
}
