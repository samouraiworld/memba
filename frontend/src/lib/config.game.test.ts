import { describe, it, expect, afterEach, vi } from "vitest";
import { isGameEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

// Mirrors config.spaceInvaders.test.ts — Block Party had no flag-default pin.
describe("isGameEnabled", () => {
  it("is false by default", () => {
    vi.stubEnv("VITE_ENABLE_GAME", "");
    expect(isGameEnabled()).toBe(false);
  });
  it("is true only when exactly 'true'", () => {
    vi.stubEnv("VITE_ENABLE_GAME", "true");
    expect(isGameEnabled()).toBe(true);
  });
});
