import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic, HAPTIC_MERGE } from "./haptics";

const originalVibrate = (navigator as { vibrate?: unknown }).vibrate;
const originalMatchMedia = window.matchMedia;

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}

describe("haptic", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "vibrate", { value: originalVibrate, configurable: true });
    window.matchMedia = originalMatchMedia;
  });

  it("vibrates when supported and motion is allowed", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    setReducedMotion(false);
    expect(haptic(HAPTIC_MERGE)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_MERGE);
  });

  it("stays still when the player prefers reduced motion", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    setReducedMotion(true);
    expect(haptic(HAPTIC_MERGE)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("is a silent no-op where the API is missing or throws", () => {
    setReducedMotion(false);
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
    expect(haptic(HAPTIC_MERGE)).toBe(false);
    Object.defineProperty(navigator, "vibrate", {
      value: () => { throw new Error("blocked"); },
      configurable: true,
    });
    expect(() => haptic([10, 20])).not.toThrow();
  });
});
