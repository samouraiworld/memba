import { describe, it, expect } from "vitest";
import { CONFIG, formationStepMs } from "./config";

describe("config", () => {
  it("defines a 5x11 formation", () => {
    expect(CONFIG.alien.rows).toBe(5);
    expect(CONFIG.alien.cols).toBe(11);
  });

  it("formationStepMs is slowest when all alive, fastest when one alive", () => {
    const total = 55;
    const slow = formationStepMs(total, total);
    const fast = formationStepMs(1, total);
    expect(slow).toBeCloseTo(CONFIG.formation.stepMsMax);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThanOrEqual(CONFIG.formation.stepMsMin);
  });

  it("formationStepMs decreases monotonically as aliens die", () => {
    const total = 55;
    let prev = Infinity;
    for (let alive = total; alive >= 1; alive--) {
      const ms = formationStepMs(alive, total);
      expect(ms).toBeLessThanOrEqual(prev);
      prev = ms;
    }
  });
});
