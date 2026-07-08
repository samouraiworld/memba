import { describe, it, expect } from "vitest";
import { newRunSeed } from "./seed";

// A fresh random seed per run (the fix for the "every game identical" problem).
// Lives in the shell, NOT the engine — crypto here is fine; the sim stays
// Math.random/Date-free.
describe("newRunSeed", () => {
  it("returns a uint32 integer", () => {
    const s = newRunSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it("varies between runs", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) seen.add(newRunSeed());
    expect(seen.size).toBeGreaterThan(1);
  });
});
