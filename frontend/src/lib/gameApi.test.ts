import { describe, it, expect } from "vitest";
import { gameApi } from "./gameApi";

describe("gameApi", () => {
  it("exposes the four game RPC wrappers", () => {
    expect(typeof gameApi.getDailyChallenge).toBe("function");
    expect(typeof gameApi.submitScore).toBe("function");
    expect(typeof gameApi.getDailyLeaderboard).toBe("function");
    expect(typeof gameApi.getStreak).toBe("function");
  });
});
