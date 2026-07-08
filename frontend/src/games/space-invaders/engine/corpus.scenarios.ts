import { REPLAY_VERSION, type InputDelta, type ReplayLog } from "../lib/replay";
import type { InputIntent } from "./types";

// Canonical, hand-authored replay scenarios. These are the cross-language
// contract: the TS engine pins them (see corpus.test.ts), and a future Go/Gno
// port must reproduce the exact same final score + state hash for each. The
// input scripts deliberately exercise movement, rapid fire, misses, kills,
// combos, alien fire, bunkers, wave clears, and the UFO (which spawns ~tick 960).
function build(seed: number, ticks: number, fn: (t: number) => InputIntent): ReplayLog {
  const inputs: InputDelta[] = [];
  let prev: InputIntent | null = null;
  for (let t = 0; t < ticks; t++) {
    const inp = fn(t);
    if (!prev || prev.move !== inp.move || prev.fire !== inp.fire || prev.pause !== inp.pause) {
      inputs.push({ tick: t, move: inp.move, fire: inp.fire, pause: inp.pause });
      prev = inp;
    }
  }
  return { version: REPLAY_VERSION, seed, finalTick: ticks, inputs };
}

const idle = (): InputIntent => ({ move: 0, fire: false, pause: false });

export interface CorpusScenario {
  name: string;
  log: ReplayLog;
}

export const CORPUS_SCENARIOS: CorpusScenario[] = [
  { name: "idle-600", log: build(1, 600, idle) },
  { name: "hold-fire-900", log: build(2, 900, () => ({ move: 0, fire: true, pause: false })) },
  {
    name: "sweep-and-fire-1300",
    log: build(2026, 1300, (t) => ({ move: (((t % 3) - 1) as -1 | 0 | 1), fire: t % 5 === 0, pause: false })),
  },
  { name: "left-hold-fire-700", log: build(7, 700, () => ({ move: -1, fire: true, pause: false })) },
  {
    name: "zigzag-1100",
    log: build(0x5eed, 1100, (t) => ({ move: (t % 2 ? 1 : -1) as -1 | 1, fire: t % 3 === 0, pause: false })),
  },
];
