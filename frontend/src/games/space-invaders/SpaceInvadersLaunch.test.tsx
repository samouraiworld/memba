import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SpaceInvadersGame from "../../pages/SpaceInvadersGame";
import { WindowActivityContext } from "../../os/page/WindowActivity";
import SpaceInvaders from "./SpaceInvaders";

const advanceSpy = vi.hoisted(() => vi.fn());
vi.mock("./render/draw", () => ({ draw: vi.fn() }));
vi.mock("./hooks/useGameLoop", async (original) => {
  const actual = await original<typeof import("./hooks/useGameLoop")>();
  return { ...actual, advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
    advanceSpy(...args);
    return actual.advanceWithEvents(...args);
  } };
});
let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
const frame = (time: number) => act(() => {
  const current = [...callbacks.values()];
  callbacks.clear();
  current.forEach(cb => cb(time));
});
const acknowledged = vi.fn();
const view = (id = "play-1", active = true) => <StrictMode><WindowActivityContext.Provider value={active}>
  <SpaceInvadersGame launch={{ id, game: "space-invaders", mode: "free" }} onLaunchConsumed={acknowledged} />
</WindowActivityContext.Provider></StrictMode>;

beforeEach(() => {
  callbacks = new Map(); sequence = 0; advanceSpy.mockClear(); acknowledged.mockClear(); localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.set(++sequence, cb); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 400, width: 320, height: 400, toJSON: () => ({}) });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("explicit local launch adapter", () => {
  it("starts once under StrictMode, survives zero-step frames, and does not reset on refocus", () => {
    const { rerender } = render(view());
    frame(0); frame(5);
    expect(advanceSpy).not.toHaveBeenCalled();
    frame(25);
    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith("play-1");
    expect(advanceSpy.mock.calls[0][0]).toMatchObject({ tick: 0, phase: "ready" });
    expect(advanceSpy.mock.calls[0][2]).toEqual({ move: 0, fire: true, pause: false });
    const surface = screen.getByRole("group", { name: /game surface/i });
    expect(surface).toHaveFocus();
    expect(screen.queryByRole("heading", { name: /defend the gno relay|relay standing by/i })).not.toBeInTheDocument();
    rerender(view("play-2"));
    frame(50);
    expect(advanceSpy.mock.calls[1][0].tick).toBeGreaterThan(0);
    expect(advanceSpy.mock.calls[1][2].fire).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    rerender(view("play-3")); frame(75);
    expect(screen.getByRole("heading", { name: /relay paused/i })).toBeInTheDocument();
    expect(advanceSpy).toHaveBeenCalledTimes(2);
  });

  it("defers a launch until the OS window is active and visible", () => {
    const { rerender } = render(view("deferred", false));
    frame(0); expect(advanceSpy).not.toHaveBeenCalled();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    rerender(view("deferred", true));
    frame(20); frame(40); expect(advanceSpy).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    frame(60); frame(80);
    expect(advanceSpy).toHaveBeenCalledTimes(1);
  });

  it("retains a completed score on Play or Daily until explicit Play again", () => {
    const props = { initialState: { phase: "gameover" as const, score: 1234 }, seed: 7 };
    const { rerender } = render(<SpaceInvaders {...props} launch={{ id: "one", game: "space-invaders", mode: "free" }} />);
    frame(0); frame(20);
    rerender(<SpaceInvaders {...props} launch={{ id: "two", game: "space-invaders", mode: "daily" }} />);
    frame(40);
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /game over/i })).toHaveFocus();
    expect(screen.getByTestId("si-final-score").parentElement).toHaveTextContent("1,234");
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    frame(60); frame(80);
    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(advanceSpy.mock.calls[0][0].seed).toBe(7);
  });

  it("defers consumption and focus while a modal is open", () => {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    render(view()); frame(0); frame(20);
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(acknowledged).not.toHaveBeenCalled();
    modal.remove(); frame(40); frame(60);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith("play-1");
    expect(advanceSpy).toHaveBeenCalledTimes(1);
  });
  it("does not switch a running free seed to Daily", () => {
    const props = { seed: 7 };
    const intent = { id: "free", game: "space-invaders" as const, mode: "free" as const };
    const { rerender } = render(<SpaceInvaders {...props} launch={intent} />);
    frame(0); frame(20);
    rerender(<SpaceInvaders {...props} launch={{ ...intent, id: "daily", mode: "daily" }} />);
    frame(40);
    expect(advanceSpy.mock.calls[1][0].seed).toBe(7);
    expect(advanceSpy.mock.calls[1][0].tick).toBeGreaterThan(0);
    expect(screen.getByText(/free play · relay online/i)).toBeInTheDocument();
  });

  it("leaves the intent pending when a queued active frame arrives after deactivation", () => {
    const { rerender } = render(view("pending"));
    const staleFrame = [...callbacks.values()][0];
    rerender(view("pending", false));
    act(() => staleFrame(0));
    expect(acknowledged).not.toHaveBeenCalled();
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /free play/i })).toBeInTheDocument();
    rerender(view("pending", true)); frame(20); frame(40);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith("pending");
    expect(advanceSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["paused", "gameover"] as const)("does not steal focus or discard %s when an inactive intent arrives", phase => {
    const outside = document.createElement("button"); document.body.append(outside);
    const props = { initialState: { phase, score: 321 }, seed: 7 };
    const renderState = (active: boolean, id: string) => <WindowActivityContext.Provider value={active}>
      <SpaceInvaders {...props} launch={{ id, game: "space-invaders", mode: "daily" }} onLaunchConsumed={acknowledged} />
    </WindowActivityContext.Provider>;
    const { rerender } = render(renderState(true, "old"));
    const staleFrame = [...callbacks.values()][0];
    rerender(renderState(false, "new")); outside.focus();
    act(() => staleFrame(0));
    expect(outside).toHaveFocus();
    expect(acknowledged).not.toHaveBeenCalled();
    rerender(renderState(true, "new")); frame(20); frame(40);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith("new");
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: phase === "paused" ? /relay paused/i : /game over/i })).toBeInTheDocument();
    outside.remove();
  });

  it("refocuses a result kept behind the menu without starting another run", () => {
    const props = { initialState: { phase: "gameover" as const, score: 42 }, seed: 7 };
    const { rerender } = render(<SpaceInvaders {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^menu$/i }));
    expect(screen.getByRole("button", { name: /back to result/i })).toBeInTheDocument();
    rerender(<SpaceInvaders {...props} launch={{ id: "result", game: "space-invaders", mode: "free" }} />);
    frame(0); frame(20);
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /game over/i })).toHaveFocus();
    expect(screen.getByTestId("si-final-score").parentElement).toHaveTextContent("42");
  });

});
