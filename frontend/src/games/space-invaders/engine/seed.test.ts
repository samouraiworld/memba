import { describe, it, expect } from "vitest";
import { newGame, step } from "./index";
import type { InputIntent } from "./index";

const idle: InputIntent = { move: 0, fire: false, pause: false };

// The original seed must be retained on state so a run can be certified/replayed:
// `rng` mutates every alien-fire, but `seed` is the immutable input to newGame.
describe("engine seed retention", () => {
  it("retains the seed passed to newGame", () => {
    expect(newGame(12345).seed).toBe(12345);
  });

  it("keeps the seed constant across steps even as rng advances", () => {
    let s = { ...newGame(999), phase: "playing" as const };
    for (let i = 0; i < 50; i++) s = step(s, 16, idle);
    expect(s.seed).toBe(999);
  });
});
