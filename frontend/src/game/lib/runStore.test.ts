import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRun, loadRun, runKey, saveRun } from "./runStore";

const RUN = { date: "2026-09-23", seed: 2547279074, modifier: "rush" };

describe("runStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a Daily move log keyed by chain and date", () => {
    saveRun("gnoland-1", RUN, "URDL");
    expect(localStorage.getItem(runKey("gnoland-1", RUN.date))).toContain('"log":"URDL"');
    expect(loadRun("gnoland-1", RUN)).toBe("URDL");
    // Another network never sees it.
    expect(loadRun("other-chain", RUN)).toBeNull();
  });

  it("ignores and removes a run saved for a different seed or modifier", () => {
    saveRun("gnoland-1", RUN, "UR");
    expect(loadRun("gnoland-1", { ...RUN, seed: 1 })).toBeNull();
    expect(localStorage.getItem(runKey("gnoland-1", RUN.date))).toBeNull();

    saveRun("gnoland-1", RUN, "UR");
    expect(loadRun("gnoland-1", { ...RUN, modifier: "standard" })).toBeNull();
    expect(localStorage.getItem(runKey("gnoland-1", RUN.date))).toBeNull();
  });

  it("ignores and removes corrupt entries", () => {
    const key = runKey("gnoland-1", RUN.date);
    for (const raw of [
      "{not json",
      "null",
      JSON.stringify({ ...RUN, version: 1, log: "UXD" }),
      JSON.stringify({ ...RUN, version: 1, log: 42 }),
      JSON.stringify({ ...RUN, version: 99, log: "U" }),
      JSON.stringify({ ...RUN, version: 1, log: "U".repeat(5000) }),
    ]) {
      localStorage.setItem(key, raw);
      expect(loadRun("gnoland-1", RUN)).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("refuses to save a log with foreign characters", () => {
    saveRun("gnoland-1", RUN, "U;D");
    expect(localStorage.getItem(runKey("gnoland-1", RUN.date))).toBeNull();
  });

  it("drops earlier days for the same chain when a new day is saved", () => {
    saveRun("gnoland-1", { ...RUN, date: "2026-09-22" }, "U");
    saveRun("other-chain", { ...RUN, date: "2026-09-22" }, "U");
    saveRun("gnoland-1", RUN, "D");
    expect(localStorage.getItem(runKey("gnoland-1", "2026-09-22"))).toBeNull();
    expect(localStorage.getItem(runKey("other-chain", "2026-09-22"))).not.toBeNull();
    expect(loadRun("gnoland-1", RUN)).toBe("D");
  });

  it("clears a run", () => {
    saveRun("gnoland-1", RUN, "U");
    clearRun("gnoland-1", RUN.date);
    expect(loadRun("gnoland-1", RUN)).toBeNull();
  });

  it("never throws when storage is denied", () => {
    const denied = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("denied"); },
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", denied);
    try {
      expect(() => saveRun("gnoland-1", RUN, "U")).not.toThrow();
      expect(loadRun("gnoland-1", RUN)).toBeNull();
      expect(() => clearRun("gnoland-1", RUN.date)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
