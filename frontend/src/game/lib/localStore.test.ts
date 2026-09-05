import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("rejects corrupt best-score and streak records", () => {
    localStorage.setItem("bp:best:practice", "Infinity");
    localStorage.setItem("bp:streak", JSON.stringify({ current: -3, lastDate: "not-a-date" }));
    expect(getLocalBest("practice")).toBe(0);
    expect(getLocalStreak()).toEqual({ current: 0, lastDate: "" });
  });

  it("does not regress a streak when an older result is restored", () => {
    bumpLocalStreak("2026-07-06");
    bumpLocalStreak("2026-07-07");
    expect(bumpLocalStreak("2026-07-06")).toEqual({ current: 2, lastDate: "2026-07-07" });
    expect(getLocalStreak()).toEqual({ current: 2, lastDate: "2026-07-07" });
  });

  it("ignores invalid keys and scores", () => {
    setLocalBest("", 10);
    setLocalBest("practice", Number.NaN);
    setLocalBest("practice", -1);
    expect(localStorage.length).toBe(0);
  });

  it("keeps gameplay usable when storage methods throw", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(getLocalBest("practice")).toBe(0);
    expect(setLocalBest("practice", 10)).toBeUndefined();
    expect(bumpLocalStreak("2026-07-06")).toEqual({ current: 1, lastDate: "2026-07-06" });
    get.mockRestore();
    set.mockRestore();
  });
});
