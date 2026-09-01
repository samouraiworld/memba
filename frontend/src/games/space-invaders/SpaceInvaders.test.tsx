import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

// Deterministic rAF: callbacks queue up and only run when a test flushes them,
// so each test decides exactly how many frames elapse (and at what timestamps).
let rafQueue: FrameRequestCallback[] = [];

// Run every currently-queued frame callback at `time`. Callbacks scheduled by
// the flushed frame land in the queue for the NEXT flush, mirroring real rAF.
function flushFrame(time: number) {
  const cbs = rafQueue;
  rafQueue = [];
  act(() => {
    for (const cb of cbs) cb(time);
  });
}

beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), fillText: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {}, set font(_v: string) {}, set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
});

describe("SpaceInvaders shell", () => {
  it("renders the HUD and a start prompt", () => {
    render(<SpaceInvaders />);
    expect(screen.getByText(/score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/space invaders play area/i)).toBeInTheDocument();
  });

  it("shows a game-over sheet when the game ends", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 90 } as never} />);
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });

  it("starts the run on the first keyboard input: the ready overlay clears", () => {
    render(<SpaceInvaders />);
    // the ready prompt is showing before any input
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();

    // hold ArrowRight (and tap Space) — the engine starts on first meaningful input
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

    // frame 1 anchors the loop clock (0 elapsed ms → 0 fixed steps);
    // frame 2 delivers ≥1 fixed step with the held input, starting the run
    flushFrame(0);
    flushFrame(50);

    expect(screen.queryByText(/space fire/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/game over/i)).not.toBeInTheDocument(); // playing, not dead
  });
});
