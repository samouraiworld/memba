import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpaceInvadersCertifyEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("isSpaceInvadersCertifyEnabled", () => {
  it("is false by default (ships dark)", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "");
    expect(isSpaceInvadersCertifyEnabled()).toBe(false);
  });
  it("is true only when exactly 'true'", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "true");
    expect(isSpaceInvadersCertifyEnabled()).toBe(true);
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "TRUE");
    expect(isSpaceInvadersCertifyEnabled()).toBe(false);
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "1");
    expect(isSpaceInvadersCertifyEnabled()).toBe(false);
  });
  it("is independent of the play flag (both must be on for the UI — the shell enforces that)", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true");
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS_CERTIFY", "");
    expect(isSpaceInvadersCertifyEnabled()).toBe(false);
  });
});
