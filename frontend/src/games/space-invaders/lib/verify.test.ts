import { describe, it, expect } from "vitest";
import { simulateReplay, hashState } from "./verify";
import { createInputRecorder } from "./replay";
import { newGame, step } from "../engine";
import type { InputIntent } from "../engine";
import { FIXED_MS } from "../hooks/useGameLoop";

// The verifier re-simulates the deterministic engine from a recorded input log
// and recomputes the authoritative score + a state hash. This is the anti-cheat
// backbone (the server, and later a Gno realm, run exactly this) — so it must
// reproduce a real run byte-for-byte, and it must never trust a client number.
describe("replay verifier", () => {
  it("hashState is deterministic and sensitive to the score", () => {
    expect(hashState(newGame(1))).toBe(hashState(newGame(1)));
    const a = newGame(1);
    expect(hashState({ ...a, score: a.score + 10 })).not.toBe(hashState(a));
  });

  it("simulateReplay is deterministic for a given log", () => {
    const rec = createInputRecorder(7);
    rec.record(0, { move: 1, fire: true, pause: false });
    rec.record(3, { move: 0, fire: false, pause: false });
    const log = rec.build(50);
    expect(simulateReplay(log)).toEqual(simulateReplay(log));
  });

  it("re-simulates a recorded run to the IDENTICAL score and state hash", () => {
    const seed = 2026;
    const rec = createInputRecorder(seed);
    let live = newGame(seed);
    const script: InputIntent[] = [];
    for (let i = 0; i < 400; i++) {
      script.push({ move: ((i % 3) - 1) as -1 | 0 | 1, fire: i % 5 === 0, pause: false });
    }
    for (let i = 0; i < script.length; i++) {
      rec.record(i, script[i]);
      live = step(live, FIXED_MS, script[i]);
    }
    const log = rec.build(script.length);
    const r = simulateReplay(log);
    expect(r.score).toBe(live.score);
    expect(r.hash).toBe(hashState(live));
    expect(r.state.tick).toBe(script.length);
  });

  it("recomputes the score from inputs alone (a client claim cannot inflate it)", () => {
    const rec = createInputRecorder(1);
    rec.record(0, { move: 0, fire: true, pause: false });
    const log = rec.build(30);
    // simulateReplay's only input is the log — there is no place to pass a claim.
    const verified = simulateReplay(log).score;
    expect(verified).toBe(simulateReplay(log).score);
    expect(Number.isFinite(verified)).toBe(true);
  });
});
