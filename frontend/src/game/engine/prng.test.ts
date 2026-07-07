import { describe, it, expect } from "vitest";
import { rngNext } from "./prng";
import prngVectors from "./vectors/prng_vectors.json";

describe("mulberry32 rngNext", () => {
  it("is deterministic for a given seed", () => {
    const a1 = rngNext(12345);
    const a2 = rngNext(12345);
    expect(a1.value).toBe(a2.value);
    expect(a1.state).toBe(a2.state);
  });

  it("returns uint32 values in [0, 2^32)", () => {
    let state = 987654321 >>> 0;
    for (let i = 0; i < 1000; i++) {
      const r = rngNext(state);
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(2 ** 32);
      expect(r.state).toBeGreaterThanOrEqual(0);
      expect(r.state).toBeLessThan(2 ** 32);
      state = r.state;
    }
  });

  it("advances state (not a constant stream)", () => {
    const a = rngNext(1);
    const b = rngNext(a.state);
    expect(a.value).not.toBe(b.value);
  });

  it("matches the committed golden vectors", () => {
    let s = prngVectors.seed >>> 0;
    for (const expected of prngVectors.outputs) {
      const r = rngNext(s);
      expect(r.value).toBe(expected);
      s = r.state;
    }
  });
});
