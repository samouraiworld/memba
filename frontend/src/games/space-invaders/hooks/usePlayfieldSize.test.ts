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


it("does not feed a normal-flow flex column's content height back into the game", () => {
  const column = document.createElement("div");
  column.style.cssText = "display:flex;flex-direction:column;min-height:568px";
  const main = document.createElement("main");
  main.style.cssText = "flex:1;overflow-y:auto;padding-bottom:10px";
  const root = document.createElement("section");
  const slot = document.createElement("div");
  column.append(main); main.append(root); root.append(slot); document.body.append(column);
  const rect = (top: number, width: number, height: number) => ({ top, bottom: top + height, width, height, x: 0, y: top, left: 0, right: width, toJSON: () => ({}) });
  let viewportHeight = 568;
  vi.spyOn(document.documentElement, "clientHeight", "get").mockImplementation(() => viewportHeight);
  vi.stubGlobal("visualViewport", null);
  const mainBox = vi.spyOn(main, "getBoundingClientRect").mockReturnValue(rect(90, 304, 310));
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(100, 288, 300));
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rect(160, 278, 240));
  const { result, unmount } = renderHook(() => usePlayfieldSize({ current: root }, { current: slot }));
  expect(result.current.availableHeight).toBe(464);
  // Repeat deliveries with the same content-sized box must not take another 4px.
  for (let i = 0; i < 3; i++) {
    mainBox.mockReturnValue(rect(90, 304, 310 - 4 * i));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current.availableHeight).toBe(464);
  }
  viewportHeight = 320;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(result.current.availableHeight).toBe(216);
  viewportHeight = 667;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(result.current.availableHeight).toBe(563);
  unmount(); column.remove();
});

it("still respects padding in a flex scroll body inside an absolute OS window", () => {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;display:flex;flex-direction:column;overflow:hidden";
  const body = document.createElement("div");
  body.style.cssText = "flex:1;overflow-y:auto;padding-bottom:16px";
  const root = document.createElement("section");
  const slot = document.createElement("div");
  host.append(body); body.append(root); root.append(slot); document.body.append(host);
  const rect = (top: number, width: number, height: number) => ({ top, bottom: top + height, width, height, x: 0, y: top, left: 0, right: width, toJSON: () => ({}) });
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(20, 600, 620));
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(80, 600, 520));
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(100, 600, 320));
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rect(120, 600, 300));
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.stubGlobal("visualViewport", null);
  const { result, unmount } = renderHook(() => usePlayfieldSize({ current: root }, { current: slot }));
  expect(result.current.availableHeight).toBe(480);
  unmount(); host.remove();
});
