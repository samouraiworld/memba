import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SpaceInvaders from "./SpaceInvaders";
import type { SpaceInvadersReplayResult } from "./lib/launch";
const geometry = vi.hoisted(() => ({ width: 320, height: 400, availableHeight: 600, landscape: false }));
const advance = vi.hoisted(() => vi.fn());
vi.mock("./hooks/usePlayfieldSize", () => ({ usePlayfieldSize: () => geometry }));
vi.mock("./render/draw", () => ({ draw: vi.fn() }));
vi.mock("./hooks/useGameLoop", async original => {
  const actual = await original<typeof import("./hooks/useGameLoop")>();
  return { ...actual, advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
    const result = actual.advanceWithEvents(...args); advance(args, result.state); return result;
  } };
});
let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
function frame(time: number) { act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(cb => cb(time)); }); }
function size(small: boolean) { Object.assign(geometry, small ? { width: 82, height: 103, availableHeight: 151, landscape: true } : { width: 320, height: 400, availableHeight: 600, landscape: false }); }
beforeEach(() => {
  size(false); callbacks = new Map(); sequence = 0; advance.mockClear(); localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.set(++sequence, cb); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 400, width: 320, height: 400, toJSON: () => ({}) });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "fullscreenEnabled"); Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
});
it.each(["absent", "rejected"])("freezes run/replay when fullscreen is %s and requires explicit resume", async support => {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: support === "rejected" });
  const request = vi.fn().mockRejectedValue(new Error("not allowed"));
  if (support === "rejected") HTMLElement.prototype.requestFullscreen = request;
  const completed = vi.fn<(r: SpaceInvadersReplayResult) => void>();
  const props = { seed: 7, onReplayReady: completed };
  const view = render(<SpaceInvaders {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /free play/i }));
  fireEvent.keyDown(screen.getByRole("group", { name: /game surface/i }), { key: "ArrowRight" });
  frame(0); frame(250); frame(500);
  const saved = advance.mock.calls.at(-1)![1]; const count = advance.mock.calls.length;
  const stale = [...callbacks.values()][0];
  size(true); view.rerender(<SpaceInvaders {...props} />);
  expect(screen.getByRole("heading", { name: "More room to play" })).toHaveFocus();
  expect(screen.getByText(/Your run is paused and kept/)).toBeVisible();
  expect(screen.getByText(/Turn your phone to portrait/)).toBeVisible();
  expect(request).not.toHaveBeenCalled();
  act(() => stale(60_000));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Game fullscreen" })); });
  expect(screen.getByRole("alert")).toHaveTextContent(support === "absent" ? "unavailable" : "could not be changed");
  frame(120_000); expect(advance).toHaveBeenCalledTimes(count); expect(completed).not.toHaveBeenCalled();
  size(false); view.rerender(<SpaceInvaders {...props} />); frame(120_250); frame(120_500);
  expect(advance).toHaveBeenCalledTimes(count);
  expect(screen.getByRole("heading", { name: "Relay paused" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Resume defense" })); frame(120_750);
  expect(advance.mock.calls[count][0][0]).toMatchObject({ seed: saved.seed, tick: saved.tick, score: saved.score, player: saved.player });
  act(() => { for (let i = 1; i <= 600; i++) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(cb => cb(120_750 + i * 250)); } });
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed.mock.calls[0][0]).toMatchObject({ game: "space-invaders", mode: "free", seed: 7, verified: true });
  expect(completed.mock.calls[0][0].events[0]).toEqual([0, 10, 1, 0]);
});
it("acknowledges a small-host launch without deferred auto-start", () => {
  size(true); const ack = vi.fn();
  const props = { seed: 7, launch: { id: "small", game: "space-invaders" as const, mode: "free" as const }, onLaunchConsumed: ack };
  const view = render(<SpaceInvaders {...props} />); frame(0); frame(1000);
  expect(ack).toHaveBeenCalledExactlyOnceWith("small"); expect(advance).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "More room to play" })).toHaveFocus();
  size(false); view.rerender(<SpaceInvaders {...props} />); frame(2000); frame(2250);
  expect(advance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /free play/i })); frame(2500); frame(2750);
  expect(advance).toHaveBeenCalledTimes(1);
});
it("retains a finished result when Play again needs more space", () => {
  size(true); const props = { seed: 7, initialState: { phase: "gameover" as const, score: 1234 } };
  const view = render(<SpaceInvaders {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /play again/i })); expect(screen.getByText("Your result is kept.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to result" })); expect(screen.getByTestId("si-final-score").parentElement).toHaveTextContent("1,234");
  size(false); view.rerender(<SpaceInvaders {...props} />); frame(0); frame(1000);
  expect(advance).not.toHaveBeenCalled(); expect(screen.getByTestId("si-final-score").parentElement).toHaveTextContent("1,234");
});
it("preserves an armed first shot when resized before its first step", () => {
  const view = render(<SpaceInvaders seed={7} />);
  fireEvent.click(screen.getByRole("button", { name: /free play/i })); frame(0);
  size(true); view.rerender(<SpaceInvaders seed={7} />); frame(5000);
  size(false); view.rerender(<SpaceInvaders seed={7} />); frame(6000); expect(advance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resume defense" })); frame(6250);
  expect(advance.mock.calls[0][0][0]).toMatchObject({ seed: 7, tick: 0, phase: "ready" });
  expect(advance.mock.calls[0][0][2]).toMatchObject({ fire: true, pause: false });
});
