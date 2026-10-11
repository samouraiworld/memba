import { describe, it, expect } from "vitest";
import { advanceWithEvents, advanceSteps } from "./useGameLoop";
import { newGame } from "../engine";
import type { InputIntent } from "../engine";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const fire: InputIntent = { move: 0, fire: true, pause: false };

// The render/juice layer needs every event that happened this frame, but a
// frame can run several fixed sub-steps and each step() resets its events. This
// aggregates them while stopping at the first terminal tick.
describe("advanceWithEvents", () => {
  it("yields the same final state as advanceSteps", () => {
    const s = { ...newGame(1), phase: "playing" as const };
    expect(advanceWithEvents(s, 3, idle).state).toEqual(advanceSteps(s, 3, idle));
  });

  it("aggregates events across the sub-steps", () => {
    const s = { ...newGame(1), phase: "playing" as const };
    const { events } = advanceWithEvents(s, 1, fire);
    expect(events.some((e) => e.type === "playerFired")).toBe(true);
  });
});

it("stops a multi-step display frame at its first gameover", () => {
  const state = { ...newGame(7), phase: "playing" as const, lives: 0 };
  const result = advanceWithEvents(state, 15, { move: 0, fire: false, pause: false });
  expect(result.state.phase).toBe("gameover");
  expect(result.state.tick).toBe(1);
  expect(result.state).toEqual(advanceSteps(state, 1, idle));
});
