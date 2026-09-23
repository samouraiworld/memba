import { describe, expect, it } from "vitest";
import { formatClock, formatSpoken, msUntilNextUtcMidnight } from "./countdown";

describe("countdown", () => {
  it("counts down to the next 00:00 UTC", () => {
    expect(msUntilNextUtcMidnight(Date.UTC(2026, 8, 23, 20, 47, 30))).toBe((3 * 3600 + 12 * 60 + 30) * 1000);
    expect(msUntilNextUtcMidnight(Date.UTC(2026, 8, 23, 23, 59, 59, 500))).toBe(500);
    // Exactly midnight: a full day until the following board.
    expect(msUntilNextUtcMidnight(Date.UTC(2026, 8, 24))).toBe(86_400_000);
    // Month and year rollover.
    expect(msUntilNextUtcMidnight(Date.UTC(2026, 11, 31, 23, 0))).toBe(3_600_000);
  });

  it("formats a clock and a minute-precision spoken form", () => {
    const ms = (3 * 3600 + 12 * 60 + 30) * 1000;
    expect(formatClock(ms)).toBe("03:12:30");
    expect(formatSpoken(ms)).toBe("3 hours 12 minutes");
    expect(formatSpoken(61 * 60 * 1000)).toBe("1 hour 1 minute");
    expect(formatSpoken(3600 * 1000)).toBe("1 hour");
    expect(formatSpoken(45 * 60 * 1000 + 999)).toBe("45 minutes");
    expect(formatSpoken(20_000)).toBe("less than a minute");
    expect(formatClock(-5)).toBe("00:00:00");
  });
});
