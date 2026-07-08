import { describe, it, expect } from "vitest";
import { rngNext, rngFloat } from "./prng";

describe("prng", () => {
  it("is deterministic for a given seed", () => {
    const a = rngNext(12345);
    const b = rngNext(12345);
    expect(a).toEqual(b);
  });

  it("advances state so successive draws differ", () => {
    const first = rngNext(1);
    const second = rngNext(first.state);
    expect(second.value).not.toBe(first.value);
  });

  it("rngFloat returns a value in [0,1)", () => {
    let s = 99;
    for (let i = 0; i < 200; i++) {
      const r = rngFloat(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      s = r.state;
    }
  });
});
