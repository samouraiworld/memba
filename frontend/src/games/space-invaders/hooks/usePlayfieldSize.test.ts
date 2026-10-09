import { afterEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { fitPlayfield, usePlayfieldSize } from "./usePlayfieldSize";

describe("fitPlayfield", () => {
  it.each([[1000, 600], [280, 400], [420, 180], [200, 0]])("contains the entire 4:5 arena in %s × %s", (w, h) => {
    const fit = fitPlayfield(w, h);
    expect(fit.width).toBeLessThanOrEqual(w);
    expect(fit.height).toBeLessThanOrEqual(h);
    expect(fit.width * 5).toBeCloseTo(fit.height * 4);
    expect(fit.width === w || fit.height === h).toBe(true);
  });
});


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "fullscreenElement"); });

it("subtracts a bounded host's padding and ignores shrink-wrapped clipping", () => {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;overflow-y:auto;padding-bottom:16px";
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "overflow-y:hidden;flex:1"; // not a flex item: host is block
  const root = document.createElement("section");
  const slot = document.createElement("div");
  host.append(wrapper); wrapper.append(root); root.append(slot); document.body.append(host);
  const rect = (top: number, width: number, height: number) => ({ top, bottom: top + height, width, height, x: 0, y: top, left: 0, right: width, toJSON: () => ({}) });
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(20, 600, 620));
  // Wrapper is shorter than the host but must not become a shrinking bound.
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rect(100, 600, 320));
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(100, 600, 320));
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rect(120, 600, 300));
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  const { result, unmount } = renderHook(() => usePlayfieldSize({ current: root }, { current: slot }));
  expect(result.current).toEqual({ availableHeight: 520, width: 240, height: 300, landscape: false });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: wrapper });
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  expect(result.current.availableHeight).toBe(696); // host outside top layer no longer clips
  Reflect.deleteProperty(document, "fullscreenElement");
  vi.mocked(root.getBoundingClientRect).mockReturnValue(rect(-100, 600, 320));
  act(() => window.dispatchEvent(new Event("resize")));
  expect(result.current.availableHeight).toBe(620); // scrolling above the viewport cannot grow the game
  unmount(); host.remove();
});
