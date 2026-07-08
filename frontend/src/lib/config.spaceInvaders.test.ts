import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpaceInvadersEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("isSpaceInvadersEnabled", () => {
  it("is false by default", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "");
    expect(isSpaceInvadersEnabled()).toBe(false);
  });
  it("is true only when exactly 'true'", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true");
    expect(isSpaceInvadersEnabled()).toBe(true);
  });
});
