import { describe, it, expect } from "vitest";
import { drainAccumulator, FIXED_MS } from "./useGameLoop";

describe("drainAccumulator", () => {
  it("accumulates sub-step frames until a step is due (high-refresh case)", () => {
    // ~120Hz: 8ms frames, each below FIXED_MS (~16.67). Must still advance.
    let acc = 0, totalSteps = 0;
    for (let i = 0; i < 10; i++) {
      const r = drainAccumulator(acc, 8);
      acc = r.acc;
      totalSteps += r.steps;
    }
    expect(totalSteps).toBeGreaterThan(0); // NOT frozen
  });

  it("runs one step per ~FIXED_MS of accumulated time and keeps the remainder", () => {
    const r = drainAccumulator(0, FIXED_MS + 5);
    expect(r.steps).toBe(1);
    expect(r.acc).toBeGreaterThan(0);
    expect(r.acc).toBeLessThan(FIXED_MS);
  });

  it("clamps huge frames (spiral-of-death guard)", () => {
    const r = drainAccumulator(0, 100000);
    expect(r.steps).toBeLessThanOrEqual(Math.ceil(250 / FIXED_MS));
  });

  it("no steps for a zero frame with empty accumulator", () => {
    expect(drainAccumulator(0, 0)).toEqual({ steps: 0, acc: 0 });
  });
});
