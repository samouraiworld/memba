import { step, type GameState, type InputIntent } from "../engine";

export const FIXED_MS = 1000 / 60;
export const MAX_FRAME_MS = 250; // clamp to avoid spiral-of-death

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

// Carry leftover sub-step time across frames so high-refresh displays (frame
// delta < FIXED_MS) still advance. Returns how many fixed steps to run now and
// the remaining accumulator (clamped to MAX_FRAME_MS to avoid spiral-of-death).
export function drainAccumulator(
  acc: number,
  frameMs: number,
  fixedMs: number = FIXED_MS,
  maxMs: number = MAX_FRAME_MS
): { steps: number; acc: number } {
  const total = Math.min(Math.max(0, acc) + Math.max(0, frameMs), maxMs);
  const steps = Math.floor(total / fixedMs);
  return { steps, acc: total - steps * fixedMs };
}
