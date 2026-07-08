import { step, type GameState, type InputIntent } from "../engine";

export const FIXED_MS = 1000 / 60;
export const MAX_FRAME_MS = 250; // clamp to avoid spiral-of-death

// Run exactly `nSteps` fixed sub-steps. The game loop passes the integer step
// count from drainAccumulator straight through — never `nSteps * FIXED_MS`
// re-divided as a float, which could run nSteps±1 under rounding error and
// desync an onchain replay. This is the canonical stepping primitive.
export function advanceSteps(
  state: GameState,
  nSteps: number,
  input: InputIntent,
  fixedMs: number = FIXED_MS
): GameState {
  let s = state;
  for (let i = 0; i < nSteps; i++) {
    s = step(s, fixedMs, input);
  }
  return s;
}

// Convenience wrapper: derive the integer step count from a wall-clock frame
// (clamped) and run them. Kept for callers/tests that think in milliseconds;
// internally it defers to advanceSteps so there is a single stepping path.
export function advance(
  state: GameState,
  frameMs: number,
  input: InputIntent,
  fixedMs: number = FIXED_MS
): GameState {
  const clamped = Math.min(Math.max(0, frameMs), MAX_FRAME_MS);
  const nSteps = Math.floor(clamped / fixedMs);
  return advanceSteps(state, nSteps, input, fixedMs);
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
