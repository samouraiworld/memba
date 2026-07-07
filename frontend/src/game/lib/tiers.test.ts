import { describe, it, expect } from "vitest";
import { milestoneLabel, tierEmoji, rankFromPercentile } from "./tiers";
describe("tiers", () => {
  it("labels milestone tiles", () => {
    expect(milestoneLabel(2048)).toBe("Gno Guardian");
    expect(milestoneLabel(8)).toBeNull();
  });
  it("maps values to distinct emoji tiers", () => {
    expect(tierEmoji(0)).toBe("⬛");
    expect(tierEmoji(2)).toBe("🟩");
    expect(tierEmoji(2048)).toBe("🟨");
  });
  it("derives a rank letter from percentile", () => {
    expect(rankFromPercentile(95)).toBe("S");
    expect(rankFromPercentile(10)).toBe("C");
  });
});
