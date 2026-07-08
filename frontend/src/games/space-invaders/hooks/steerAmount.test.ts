import { describe, it, expect } from "vitest";
import { steerAmount } from "./useTouch";

// Proportional touch steering: drag distance from the touch-start point maps to
// a continuous steer value in [-1, 1] (was a coarse ±1 that discarded magnitude).
describe("steerAmount", () => {
  it("is zero inside the deadzone", () => {
    expect(steerAmount(0, 60)).toBe(0);
    expect(steerAmount(3, 60)).toBe(0);
    expect(steerAmount(-3, 60)).toBe(0);
  });

  it("reaches full deflection at (or beyond) the range", () => {
    expect(steerAmount(60, 60)).toBe(1);
    expect(steerAmount(-60, 60)).toBe(-1);
    expect(steerAmount(500, 60)).toBe(1);
    expect(steerAmount(-500, 60)).toBe(-1);
  });

  it("is proportional (partial drag → partial steer) and signed", () => {
    const mid = steerAmount(32, 60);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(steerAmount(-32, 60)).toBeCloseTo(-mid, 10);
  });

  it("increases monotonically with drag distance", () => {
    let prev = -Infinity;
    for (let dx = 4; dx <= 60; dx += 4) {
      const v = steerAmount(dx, 60);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
