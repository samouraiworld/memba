import type { InputIntent } from "../engine";

// Bump when the input-log wire format changes. The verifier pins this so an
// old replay is rejected rather than silently mis-verified.
export const REPLAY_VERSION = 1;

export interface InputDelta {
  tick: number;
  move: -1 | 0 | 1;
  fire: boolean;
  pause: boolean;
}

export interface ReplayLog {
  version: number;
  seed: number;
  finalTick: number;
  inputs: InputDelta[];
}

const IDLE: InputDelta = { tick: 0, move: 0, fire: false, pause: false };

function sameInput(a: InputDelta, b: InputIntent): boolean {
  return a.move === b.move && a.fire === b.fire && a.pause === b.pause;
}

export interface InputRecorder {
  /** Record the input active at `tick`. Stored only when it differs from the
   *  last recorded delta (run-length / delta encoding). */
  record(tick: number, input: InputIntent): void;
  build(finalTick: number): ReplayLog;
}

export function createInputRecorder(seed: number): InputRecorder {
  const inputs: InputDelta[] = [];
  return {
    record(tick, input) {
      const last = inputs[inputs.length - 1];
      if (last && sameInput(last, input)) return;
      inputs.push({ tick, move: input.move, fire: input.fire, pause: input.pause });
    },
    build(finalTick) {
      return { version: REPLAY_VERSION, seed, finalTick, inputs: inputs.slice() };
    },
  };
}

/** Reconstruct the input active at `tick`: the last delta at or before it,
 *  or idle before the first recorded delta. Mirror of what the verifier runs. */
export function inputAtTick(log: ReplayLog, tick: number): InputIntent {
  let active: InputDelta = IDLE;
  for (const d of log.inputs) {
    if (d.tick > tick) break;
    active = d;
  }
  return { move: active.move, fire: active.fire, pause: active.pause };
}
