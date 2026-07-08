import { useEffect, useRef } from "react";
import { step, type GameState, type InputIntent } from "../engine";

const FIXED_MS = 1000 / 60;
const MAX_FRAME_MS = 250; // clamp to avoid spiral-of-death

export function advance(
  state: GameState,
  frameMs: number,
  input: InputIntent,
  fixedMs: number = FIXED_MS
): GameState {
  let remaining = Math.min(Math.max(0, frameMs), MAX_FRAME_MS);
  let s = state;
  while (remaining >= fixedMs) {
    s = step(s, fixedMs, input);
    remaining -= fixedMs;
  }
  return s;
}

export function useGameLoop(
  getState: () => GameState,
  setState: (s: GameState) => void,
  getInput: () => InputIntent
): void {
  const raf = useRef(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    const tick = (t: number) => {
      if (last.current == null) last.current = t;
      const frameMs = t - last.current;
      last.current = t;
      setState(advance(getState(), frameMs, getInput()));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
