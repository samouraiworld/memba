import { describe, it, expect } from "vitest";
import { advance } from "./useGameLoop";
import { newGame } from "../engine";
import type { InputIntent } from "../engine";

const idle: InputIntent = { move: 0, fire: false, pause: false };

describe("advance (fixed timestep)", () => {
  it("applies multiple fixed steps for a long frame", () => {
    const one = advance({ ...newGame(1), phase: "playing" }, 16.67, { move: 1, fire: false, pause: false });
    const many = advance({ ...newGame(1), phase: "playing" }, 100, { move: 1, fire: false, pause: false });
    expect(many.player.x).toBeGreaterThan(one.player.x);
  });

  it("clamps huge frames to avoid spiral-of-death", () => {
    const s = advance({ ...newGame(1), phase: "playing" }, 100000, idle);
    // Should not throw / hang; state remains valid.
    expect(s.aliens.length).toBeGreaterThan(0);
  });

  it("is a no-op for a zero-length frame", () => {
    const start = { ...newGame(1), phase: "playing" as const };
    expect(advance(start, 0, idle)).toEqual(start);
  });
});
