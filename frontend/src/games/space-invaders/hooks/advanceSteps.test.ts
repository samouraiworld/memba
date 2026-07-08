import { describe, it, expect } from "vitest";
import { advanceSteps, FIXED_MS } from "./useGameLoop";
import { newGame, step } from "../engine";
import type { InputIntent } from "../engine";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const right: InputIntent = { move: 1, fire: false, pause: false };

// advanceSteps runs an exact integer number of fixed sub-steps, so the game
// loop can pass the step count straight through instead of round-tripping it
// as `steps * FIXED_MS` (float) and re-dividing — the source of frame-count
// nondeterminism the onchain replay must not have.
describe("advanceSteps (integer fixed steps)", () => {
  it("is exactly equivalent to calling step() N times with FIXED_MS", () => {
    const s = { ...newGame(1), phase: "playing" as const };
    let manual = s;
    for (let i = 0; i < 3; i++) manual = step(manual, FIXED_MS, right);
    expect(advanceSteps(s, 3, right)).toEqual(manual);
  });

  it("is a no-op for zero steps", () => {
    const s = { ...newGame(1), phase: "playing" as const };
    expect(advanceSteps(s, 0, idle)).toEqual(s);
  });

  it("advances further for more steps", () => {
    const s = { ...newGame(1), phase: "playing" as const };
    const few = advanceSteps(s, 1, right);
    const many = advanceSteps(s, 6, right);
    expect(many.player.x).toBeGreaterThan(few.player.x);
  });
});
