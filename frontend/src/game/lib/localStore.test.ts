import { describe, it, expect, beforeEach } from "vitest";
import { getLocalBest, setLocalBest, getLocalStreak, bumpLocalStreak } from "./localStore";
describe("localStore", () => {
  beforeEach(() => localStorage.clear());
  it("tracks a per-day best", () => {
    setLocalBest("2026-07-06", 1200);
    setLocalBest("2026-07-06", 900); // lower ignored
    expect(getLocalBest("2026-07-06")).toBe(1200);
  });
  it("increments streak on consecutive days and resets on a gap", () => {
    bumpLocalStreak("2026-07-06");
    bumpLocalStreak("2026-07-07");
    expect(getLocalStreak().current).toBe(2);
    bumpLocalStreak("2026-07-10"); // gap
    expect(getLocalStreak().current).toBe(1);
  });
  it("is idempotent for the same date (no double-count)", () => {
    bumpLocalStreak("2026-07-06");
    const s = bumpLocalStreak("2026-07-06");
    expect(s.current).toBe(1);
    expect(getLocalStreak().current).toBe(1);
  });
});
