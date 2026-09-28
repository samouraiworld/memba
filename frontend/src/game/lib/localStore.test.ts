import { describe, it, expect, beforeEach, vi } from "vitest";
import { getLocalBest, setLocalBest, getLocalDailyBest, setLocalDailyBest, getLocalStreak, bumpLocalStreak } from "./localStore";
const CHAIN = "portal-loop";
describe("localStore", () => {
  beforeEach(() => localStorage.clear());
  it("tracks a per-day best on its chain only", () => {
    setLocalDailyBest(CHAIN, "2026-07-06", 1200);
    setLocalDailyBest(CHAIN, "2026-07-06", 900); // lower ignored
    expect(getLocalDailyBest(CHAIN, "2026-07-06")).toBe(1200);
    expect(getLocalDailyBest("gnoland1", "2026-07-06")).toBe(0);
    expect(getLocalDailyBest(CHAIN, "2026-07-07")).toBe(0);
  });
  it("increments streak on consecutive days and resets on a gap", () => {
    bumpLocalStreak(CHAIN, "2026-07-06");
    bumpLocalStreak(CHAIN, "2026-07-07");
    expect(getLocalStreak(CHAIN).current).toBe(2);
    expect(getLocalStreak("gnoland1").current).toBe(0);
    bumpLocalStreak(CHAIN, "2026-07-10"); // gap
    expect(getLocalStreak(CHAIN).current).toBe(1);
  });
  it("is idempotent for the same date (no double-count)", () => {
    bumpLocalStreak(CHAIN, "2026-07-06");
    const s = bumpLocalStreak(CHAIN, "2026-07-06");
    expect(s.current).toBe(1);
    expect(getLocalStreak(CHAIN).current).toBe(1);
  });

  it("rejects corrupt best-score and streak records", () => {
    localStorage.setItem("bp:best:practice", "Infinity");
    localStorage.setItem(`bp:daily:${CHAIN}:streak`, JSON.stringify({ current: -3, lastDate: "not-a-date" }));
    expect(getLocalBest("practice")).toBe(0);
    expect(getLocalStreak(CHAIN)).toEqual({ current: 0, lastDate: "" });
  });

  it("does not regress a streak when an older result is restored", () => {
    bumpLocalStreak(CHAIN, "2026-07-06");
    bumpLocalStreak(CHAIN, "2026-07-07");
    expect(bumpLocalStreak(CHAIN, "2026-07-06")).toEqual({ current: 2, lastDate: "2026-07-07" });
    expect(getLocalStreak(CHAIN)).toEqual({ current: 2, lastDate: "2026-07-07" });
  });

  it("does not attribute legacy Daily values to a chain", () => {
    localStorage.setItem("bp:best:2026-07-06", "9000");
    localStorage.setItem("bp:streak", JSON.stringify({ current: 25, lastDate: "2026-07-06" }));
    expect(getLocalDailyBest(CHAIN, "2026-07-06")).toBe(0);
    expect(getLocalStreak(CHAIN)).toEqual({ current: 0, lastDate: "" });
    expect(localStorage.getItem("bp:best:2026-07-06")).toBe("9000");
  });

  it("does not persist a Daily result with a missing chain or invalid date", () => {
    setLocalDailyBest("", "2026-07-06", 400);
    setLocalDailyBest(CHAIN, "2026-99-99", 400);
    bumpLocalStreak("", "2026-07-06");
    bumpLocalStreak(CHAIN, "2026-99-99");
    expect(localStorage.length).toBe(0);
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
    expect(bumpLocalStreak(CHAIN, "2026-07-06")).toEqual({ current: 1, lastDate: "2026-07-06" });
    get.mockRestore();
    set.mockRestore();
  });
});
