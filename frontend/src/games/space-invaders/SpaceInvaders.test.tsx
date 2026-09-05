import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

const advanceSpy = vi.hoisted(() => vi.fn());
const audioSpies = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
vi.mock("./hooks/useGameLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks/useGameLoop")>();
  return {
    ...actual,
    advanceWithEvents: (...args: Parameters<typeof actual.advanceWithEvents>) => {
      advanceSpy();
      return actual.advanceWithEvents(...args);
    },
  };
});
vi.mock("./lib/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/audio")>();
  return {
    ...actual,
    createAudioEngine: () => {
      audioSpies.create();
      return {
        muted: false,
        unlock: vi.fn(),
        play: vi.fn(),
        setMuted: vi.fn(),
        dispose: audioSpies.dispose,
      };
    },
  };
});

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
  advanceSpy.mockClear();
  audioSpies.create.mockClear();
  audioSpies.dispose.mockClear();
});

describe("SpaceInvaders shell", () => {
  it("renders the HUD and a start prompt", () => {
    render(<SpaceInvaders />);
    expect(screen.getByRole("heading", { name: /space invaders/i })).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /daily run/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/space invaders play area/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /signal defense game surface/i })).toHaveAttribute("tabindex", "0");
  });

  it("recreates and disposes audio cleanly under StrictMode", () => {
    const { unmount } = render(<StrictMode><SpaceInvaders /></StrictMode>);
    expect(audioSpies.create).toHaveBeenCalledTimes(2);
    expect(audioSpies.dispose).toHaveBeenCalledTimes(1);
    unmount();
    expect(audioSpies.dispose).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable six-slot HUD when a combo becomes visible", () => {
    const { container } = render(<SpaceInvaders initialState={{ combo: 3 } as never} />);
    expect(container.querySelectorAll(".si-hud > *")).toHaveLength(6);
    expect(screen.getByText("Chain").closest(".si-combo")).not.toHaveClass("si-combo--idle");
  });

  it("shows a game-over sheet when the game ends", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 90 } as never} />);
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });

  it("waits for a mode choice, then starts on input without ticking the menu or armed idle state", () => {
    render(<SpaceInvaders />);
    flushFrame(0);
    flushFrame(500);
    expect(advanceSpy).not.toHaveBeenCalled();

    const surface = screen.getByRole("group", { name: /signal defense game surface/i });
    fireEvent.click(screen.getByRole("button", { name: /free play/i }));
    expect(surface).toHaveFocus();
    expect(screen.getByText(/space fire/i)).toBeInTheDocument();

    flushFrame(750);
    expect(advanceSpy).not.toHaveBeenCalled();

    // hold ArrowRight (and tap Space) — the engine starts on first meaningful input
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    fireEvent.keyDown(surface, { key: " " });

    // frame 1 anchors the loop clock (0 elapsed ms → 0 fixed steps);
    // frame 2 delivers ≥1 fixed step with the held input, starting the run
    flushFrame(800);

    expect(screen.queryByText(/space fire/i)).not.toBeInTheDocument();
    expect(advanceSpy).toHaveBeenCalled();
    expect(screen.queryByText(/game over/i)).not.toBeInTheDocument(); // playing, not dead
  });
});
