import { describe, it, expect } from "vitest";
import { simulateReplay, hashState } from "./verify";
import { inputAtTick, REPLAY_VERSION, type InputDelta, type ReplayLog } from "./replay";
import { newGame, step } from "../engine";
import { FIXED_MS } from "../hooks/useGameLoop";
import { CORPUS_SCENARIOS } from "../engine/corpus.scenarios";

// simulateReplay was refactored from an O(ticks × deltas) per-tick scan
// (inputAtTick on every tick — 31.5s at the originally planned caps) to an
// O(ticks + deltas) input cursor. The REQUIRED property is semantic identity:
// for any delta list — sorted or not, duplicate ticks, ticks at or past
// finalTick — the cursor must produce the exact state the per-tick scan did.
// inputAtTick is untouched and stays exported, so it IS the old semantics; this
// suite replays it as the oracle.

/** The pre-refactor loop, verbatim: step every tick with inputAtTick's answer. */
function simulateReplayScan(log: ReplayLog): { score: number; hash: number } {
  let s = newGame(log.seed);
  for (let i = 0; i < log.finalTick; i++) {
    s = step(s, FIXED_MS, inputAtTick(log, i));
  }
  return { score: s.score, hash: hashState(s) };
}

// Tiny deterministic PRNG (mulberry32) so the "random" logs are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDelta(rnd: () => number, tick: number): InputDelta {
  return {
    tick,
    move: (Math.round(rnd() * 20) - 10) / 10,
    fire: rnd() < 0.5,
    pause: false,
  };
}

function makeLog(seed: number, finalTick: number, inputs: InputDelta[]): ReplayLog {
  return { version: REPLAY_VERSION, seed, finalTick, inputs };
}

describe("simulateReplay cursor ≡ per-tick scan (old semantics oracle)", () => {
  it("agrees on random well-formed logs (strictly increasing ticks)", () => {
    const rnd = mulberry32(0xc0ffee);
    for (let round = 0; round < 12; round++) {
      const finalTick = 50 + Math.floor(rnd() * 450);
      const inputs: InputDelta[] = [];
      let tick = 0;
      while (tick < finalTick && inputs.length < 60) {
        inputs.push(randomDelta(rnd, tick));
        tick += 1 + Math.floor(rnd() * 25);
      }
      const log = makeLog(1 + round, finalTick, inputs);
      const a = simulateReplay(log);
      const b = simulateReplayScan(log);
      expect({ score: a.score, hash: a.hash }).toEqual(b);
    }
  });

  it("agrees on adversarial logs: duplicate ticks, unsorted lists, out-of-range ticks", () => {
    const rnd = mulberry32(0xbadf00d);
    const shapes: InputDelta[][] = [
      // duplicate ticks (the scan's last-one-wins-within-prefix rule)
      [randomDelta(rnd, 5), randomDelta(rnd, 5), randomDelta(rnd, 5), randomDelta(rnd, 40)],
      // unsorted (the scan breaks at the first delta beyond the tick)
      [randomDelta(rnd, 50), randomDelta(rnd, 10), randomDelta(rnd, 90), randomDelta(rnd, 20)],
      // ticks at/past finalTick (never consumed)
      [randomDelta(rnd, 0), randomDelta(rnd, 199), randomDelta(rnd, 200), randomDelta(rnd, 5000)],
      // everything packed at tick 0
      Array.from({ length: 30 }, () => randomDelta(rnd, 0)),
      // empty list (pure idle run)
      [],
    ];
    shapes.forEach((inputs, i) => {
      const log = makeLog(100 + i, 200, inputs);
      const a = simulateReplay(log);
      const b = simulateReplayScan(log);
      expect({ score: a.score, hash: a.hash }).toEqual(b);
    });
  });

  it("agrees on every determinism-corpus scenario (the cross-language pins)", () => {
    for (const sc of CORPUS_SCENARIOS) {
      const a = simulateReplay(sc.log);
      const b = simulateReplayScan(sc.log);
      expect({ name: sc.name, score: a.score, hash: a.hash }).toEqual({ name: sc.name, ...b });
    }
  });

  it("returns the full final state (the worker reads wave/shots/hits for stats)", () => {
    const log = makeLog(7, 120, [
      { tick: 0, move: 1, fire: true, pause: false },
      { tick: 60, move: -0.5, fire: true, pause: false },
    ]);
    const r = simulateReplay(log);
    expect(r.state.tick).toBe(120);
    expect(r.hash).toBe(hashState(r.state));
    expect(typeof r.state.wave).toBe("number");
    expect(typeof r.state.shots).toBe("number");
    expect(typeof r.state.hits).toBe("number");
  });
});
