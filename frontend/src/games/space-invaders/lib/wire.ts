// Wire codec for the certify submission's input log.
//
// The backend accepts STRICT int 4-tuples `[tick, move10, fire, pause]`
// (move10 in [-10, 10], fire/pause in {0, 1}, ticks strictly increasing
// < finalTick — verify_worker.ts processInvaders rejects anything else), and
// re-simulates with `move = move10 / 10`. So the LIVE game must consume moves
// already quantized to tenths — quantizeMove is that seam — or the lived run
// and its replay diverge on the very first sub-pixel of steering.

import type { InputIntent } from "../engine";
import type { InputDelta, ReplayLog } from "./replay";

// Mirror of the backend's caps (validate.go MaxFinalTick / MaxEventsInvaders
// and the worker's own defense-in-depth constants). A run past either bound is
// still a valid local game — it just cannot be certified, so the shell gates
// the certify surface on these instead of submitting a guaranteed rejection.
export const MAX_CERTIFY_FINAL_TICK = 216_000; // 1h @ 60Hz
export const MAX_CERTIFY_EVENTS = 10_000;

/** Quantize a steering input to tenths — the exact value both the live engine
 *  and the server's replay (`move10 / 10`) consume. Clamped to [-1, 1] so the
 *  wire's move10 range holds by construction; negative zero is normalized so
 *  the recorded value round-trips the wire bit-for-bit. */
export function quantizeMove(move: number): number {
  const clamped = Math.max(-1, Math.min(1, move));
  const q = Math.round(clamped * 10) / 10;
  return q === 0 ? 0 : q;
}

/** The ONE place live input is combined and quantized (the shell's getInput
 *  delegates here). Every value leaving this seam is a wire-representable
 *  tenth, so the engine, the recorder, and the server's replay all consume the
 *  identical number. Keyboard wins over touch via the pre-existing || rule;
 *  the pause edge is keyboard-only. */
export function combineInput(k: InputIntent, t: InputIntent): InputIntent {
  return {
    move: quantizeMove(k.move || t.move),
    fire: k.fire || t.fire,
    pause: k.pause,
  };
}

/** Encode a recorded log's deltas as the wire's int 4-tuples. Assumes the
 *  recorder's invariants (quantized moves, strictly increasing ticks); the
 *  round() here only converts exact tenths to exact ints — it never repairs. */
export function toWireDeltas(log: ReplayLog): number[][] {
  return log.inputs.map((d) => [d.tick, Math.round(d.move * 10), d.fire ? 1 : 0, d.pause ? 1 : 0]);
}

/** Decode wire tuples back into engine input deltas EXACTLY the way the verify
 *  worker does (`move10 / 10`, `=== 1` booleans) — the client self-verifies on
 *  this decoded form so it simulates precisely what the server will. */
export function fromWireDeltas(tuples: number[][]): InputDelta[] {
  return tuples.map((t) => ({ tick: t[0], move: t[1] / 10, fire: t[2] === 1, pause: t[3] === 1 }));
}
