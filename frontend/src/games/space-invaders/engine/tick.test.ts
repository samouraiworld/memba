import { describe, it, expect } from "vitest";
import { newGame, step } from "./index";
import type { InputIntent } from "./index";

const idle: InputIntent = { move: 0, fire: false, pause: false };

// A monotonic tick counter is the canonical replay timeline: inputs are keyed
// by tick, and the verifier replays the same number of step() calls. tick
// counts step() invocations (one per fixed sub-step), independent of wall clock.
describe("engine tick counter", () => {
  it("starts at 0 for a fresh game", () => {
    expect(newGame(1).tick).toBe(0);
  });

  it("increments by exactly one per step() call", () => {
    let s = newGame(1);
    for (let i = 1; i <= 5; i++) {
      s = step(s, 16, idle);
      expect(s.tick).toBe(i);
    }
  });

  it("still increments while paused (every step() call counts)", () => {
    const paused = { ...newGame(1), phase: "paused" as const };
    expect(step(paused, 16, idle).tick).toBe(paused.tick + 1);
  });
});
