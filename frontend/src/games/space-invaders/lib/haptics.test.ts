import { describe, it, expect, vi, afterEach } from "vitest";
import { vibrate } from "./haptics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vibrate", () => {
  it("calls navigator.vibrate with the given pattern when supported", () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { vibrate: spy });
    vibrate(30);
    expect(spy).toHaveBeenCalledWith(30);
  });

  it("is a no-op (never throws) when vibrate is unavailable", () => {
    vi.stubGlobal("navigator", {});
    expect(() => vibrate([10, 20, 10])).not.toThrow();
  });
});
