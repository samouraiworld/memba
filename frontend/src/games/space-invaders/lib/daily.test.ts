import { describe, it, expect } from "vitest";
import { dailySeedString, seedFromSeedString, formatStateHash } from "./daily";

// The seed derivation is a THREE-implementation contract: this client, the
// node verify worker (verify_worker.ts fnv1aSeed), and the Go spec twin
// (backend validate.go invadersEngineSeed, pinned by
// TestInvadersEngineSeed_Vectors). These vectors are copied from that shared
// set — a drift in any copy makes every certify submission reject, so a change
// here must never be "fixed" by editing the expectation.
describe("seedFromSeedString (FNV-1a/32 over UTF-8 bytes)", () => {
  it.each([
    ["", 2166136261],
    ["a", 3826002220],
    ["abc", 440920331],
    ["invaders-2026-07-13", 3389276757],
    ["invaders-2026-09-01", 3070363140],
    ["invaders-practice-1720000000000-3", 4290068228],
  ])("pins the shared vector %j -> %d", (seed, want) => {
    expect(seedFromSeedString(seed)).toBe(want);
  });

  it("stays inside uint32 (>>> 0 semantics, no sign leak)", () => {
    const h = seedFromSeedString("invaders-2026-09-01");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe("dailySeedString", () => {
  it("is invaders-YYYY-MM-DD in UTC regardless of local timezone", () => {
    // 23:30 UTC on Sep 1 is already Sep 2 in UTC+2 — the seed must stay UTC.
    expect(dailySeedString(new Date("2026-09-01T23:30:00Z"))).toBe("invaders-2026-09-01");
    expect(dailySeedString(new Date("2026-09-01T00:00:00Z"))).toBe("invaders-2026-09-01");
    expect(dailySeedString(new Date("2026-12-31T23:59:59Z"))).toBe("invaders-2026-12-31");
  });

  it("matches the backend's daily seed grammar (invaders-<date>)", () => {
    expect(dailySeedString(new Date("2026-09-01T12:00:00Z"))).toMatch(/^invaders-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatStateHash", () => {
  it("emits exactly 8 lowercase hex chars, zero-padded", () => {
    expect(formatStateHash(0)).toBe("00000000");
    expect(formatStateHash(0x1a)).toBe("0000001a");
    expect(formatStateHash(0xdeadbeef)).toBe("deadbeef");
    expect(formatStateHash(0xffffffff)).toBe("ffffffff");
  });

  it("mirrors the worker's toString(16).padStart(8, \"0\") for the loop fixture", () => {
    // The backend loop test pins stateHash "a7d393c2" for its fixture — the
    // formatting recipe (not the value) is what this guards.
    expect(formatStateHash(0xa7d393c2)).toBe("a7d393c2");
  });

  it("treats the input as uint32 (a signed 32-bit value cannot leak a minus sign)", () => {
    expect(formatStateHash(-1)).toBe("ffffffff");
  });
});
